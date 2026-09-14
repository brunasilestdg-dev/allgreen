// ===== Ponte entre a Central Jurídica (nova UI) e o Jurídico canônico do TDG =====
//
// PROBLEMA que este módulo resolve:
// - O TDG grava documentos jurídicos em `todogreen_legal_records` (D1) e o
//   backend usa esse registro em DOIS GATES operacionais reais:
//     * `juridicoConcluido()` — proposta/contrato só avança com documento
//       jurídico vinculado APROVADO ou ASSINADO.
//     * `documentoDeAssinaturaVinculado()` — contrato não é marcado como
//       assinado sem anexo no cofre (`context_type='legal'`).
// - A Central Jurídica nova (UI rica, mais entidades) foi criada gravando em
//   `db.legalContracts` no blob do workspace. Ficaram DOIS Jurídicos: um
//   integrado à operação (TDG) e outro que só existe na UI. É crítico não
//   deixar essa duplicidade — contrato aprovado na UI nova NÃO abriria o
//   gate operacional. A titular alinhou: Jurídico canônico é UM só.
//
// SOLUÇÃO desta camada:
// - Tradutor de vocabulário entre a UI nova e a persistência canônica do TDG.
// - Mantém os vínculos que os gates olham: `campos.contractId` /
//   `campos.proposalId` viajam intactos. Anexos continuam no cofre com
//   `context_type='legal'` (a UI apenas passa link/nome; o cofre é gravado
//   pelo endpoint TDG existente).
// - `isTdgLegalAvailable(db)` decide quando a UI usa o backend TDG em vez do
//   blob (regra: qualquer sinal de acesso à vertical To Do Green).
//
// Sem React, sem rede — hooks e chamadas ficam em `useTdgLegalRecords.js`.

import {
  JURIDICO_RISCOS,
  JURIDICO_SITUACOES,
  JURIDICO_TIPOS,
  normalizarRisco as normalizarRiscoTdg,
  normalizarSituacaoJuridica,
  normalizarTipoJuridico,
} from "../logistics/legalDomain.js";

// Ordem alinhada com o backend: `todogreen_legal_records.status IN
// ('aprovado','assinado')` conclui o gate. Nomes DEVEM bater 1-1.
export const TDG_STATUSES = JURIDICO_SITUACOES.map((s) => s.id);
export const TDG_TYPES = JURIDICO_TIPOS.map((t) => t.id);
export const TDG_RISKS = JURIDICO_RISCOS.map((r) => r.id);

// Mapeia o "tipo" da nova UI (que aceita 14 categorias) para os 8 tipos do
// TDG. Contratos comerciais viram `contrato`; NDA vira `nda`; procuração vira
// `procuracao`; notificação vira `notificacao`; parecer vira `parecer`;
// o resto (locação, franquia, licenciamento, comodato…) vira `contrato` —
// preservado no campo `campos.originalType` para não perder a informação.
const TIPO_UI_PARA_TDG = {
  prestacao_servicos: "contrato",
  fornecimento: "contrato",
  compra_venda: "contrato",
  locacao: "contrato",
  distribuicao: "contrato",
  franquia: "contrato",
  sociedade: "contrato",
  nda: "nda",
  mou: "contrato",
  licenciamento: "contrato",
  comodato: "contrato",
  financeiro: "contrato",
  trabalho: "contrato",
  outro: "outro",
  // Se algum dia a UI passar já o ID canônico, aceitamos direto.
  contrato: "contrato",
  aditivo: "aditivo",
  minuta: "minuta",
  procuracao: "procuracao",
  notificacao: "notificacao",
  parecer: "parecer",
};

// Mapeamento inverso: quando lemos TDG e queremos oferecer um dos tipos da UI.
// Preservamos `originalType` em `fields_json` — se ele existir, é a fonte
// preferida (o dono da UI já escolheu franquia/locação e queremos manter).
const TIPO_TDG_PARA_UI = {
  contrato: "prestacao_servicos",
  aditivo: "prestacao_servicos",
  minuta: "prestacao_servicos",
  nda: "nda",
  procuracao: "outro",
  notificacao: "outro",
  parecer: "outro",
  outro: "outro",
};

// Situações: o mapeamento respeita o dicionário do TDG (que o backend usa).
// A UI nova tem "vigente" (assinado com contrato ativo), "encerrado",
// "rescindido" — mapeamos para o mais próximo TDG (`assinado` e `arquivado`)
// para não inventar estado que o backend não valida.
const SITUACAO_UI_PARA_TDG = {
  rascunho: "rascunho",
  em_negociacao: "rascunho",
  em_analise: "em_analise",
  ajuste_solicitado: "ajuste_solicitado",
  aprovado: "aprovado",
  vigente: "assinado",
  encerrado: "arquivado",
  rescindido: "arquivado",
  arquivado: "arquivado",
  // Aceita também o ID canônico:
  assinado: "assinado",
  recusado: "recusado",
};

const SITUACAO_TDG_PARA_UI = {
  rascunho: "rascunho",
  em_analise: "em_analise",
  ajuste_solicitado: "ajuste_solicitado",
  aprovado: "aprovado",
  assinado: "vigente",
  arquivado: "arquivado",
  recusado: "rescindido",
};

// Risco: o TDG só tem 3 níveis. `critico` da UI vira `alto` mas preserva o
// original em `fields_json.uiRisk`, para que readback restaure o rótulo.
const RISCO_UI_PARA_TDG = {
  baixo: "baixo",
  medio: "medio",
  alto: "alto",
  critico: "alto",
};

const RISCO_TDG_PARA_UI = {
  baixo: "baixo",
  medio: "medio",
  alto: "alto",
};

const cleanText = (value, max = 4000) => String(value ?? "").slice(0, max);
const cleanDate = (value) => cleanText(value, 10);

// -----------------------------------------------------------------------
// Detecção do TDG no espaço atual
// -----------------------------------------------------------------------

// Sinais possíveis (qualquer um deles indica que a vertical está disponível):
// - `db.verticals?.todogreen === true`
// - `db.user?.verticals` contendo "todogreen"
// - `db.preferences?.vertical === "todogreen"`
// - `db.todogreen?.enabled === true` (usado por algumas telas do vertical)
// - papel do usuário TDG (`db.user?.todogreenRole`)
export const isTdgLegalAvailable = (db) => {
  if (!db) return false;
  if (db.verticals && db.verticals.todogreen === true) return true;
  if (db.todogreen && db.todogreen.enabled === true) return true;
  if (Array.isArray(db.user?.verticals) && db.user.verticals.includes("todogreen"))
    return true;
  if (db.preferences && db.preferences.vertical === "todogreen") return true;
  if (db.user && typeof db.user.todogreenRole === "string" && db.user.todogreenRole)
    return true;
  return false;
};

// -----------------------------------------------------------------------
// Tradução TDG (D1) -> nova UI (Central Jurídica)
// -----------------------------------------------------------------------

// Recebe uma linha vinda do endpoint `/api/todogreen/records/legal` (JSON no
// formato `daLinha` de `todogreen-vertical-records.js`) e devolve o shape de
// `legalContract` que a nova UI entende.
export const tdgLegalToContract = (row = {}) => {
  const campos = row.campos || {};
  const originalUiType = TIPO_UI_PARA_TDG[campos.originalType] ? campos.originalType : "";
  const type = originalUiType || TIPO_TDG_PARA_UI[row.tipo] || "prestacao_servicos";
  const uiRisk = campos.uiRisk && Object.prototype.hasOwnProperty.call(RISCO_UI_PARA_TDG, campos.uiRisk) ? campos.uiRisk : "";
  const risk = uiRisk || RISCO_TDG_PARA_UI[row.risco] || "medio";
  return {
    id: row.id,
    source: "tdg",
    tdgKind: row.tipo,
    tdgStatus: row.situacao,
    title: cleanText(row.titulo, 240),
    type,
    status: SITUACAO_TDG_PARA_UI[row.situacao] || "rascunho",
    risk,
    confidentiality: campos.confidentiality || "interno",
    counterparty: cleanText(row.contraparte, 240),
    counterpartyDocument: cleanText(campos.cnpj, 40),
    amount: Number(campos.amount) || 0,
    currency: cleanText(campos.currency || "BRL", 10) || "BRL",
    startDate: cleanDate(row.inicioVigencia),
    endDate: cleanDate(row.fimVigencia),
    renewalMode: campos.renewalMode === "automatic" ? "automatic" : "manual",
    renewalNoticeDays: Math.max(0, Math.min(365, Number(campos.renewalNoticeDays) || 30)),
    approvalStatus: campos.approvalStatus || (row.situacao === "aprovado" ? "aprovado" : "pendente"),
    responsibleId: row.responsavelId || null,
    externalOfficeId: campos.externalOfficeId || null,
    links: Array.isArray(campos.links) ? campos.links : [],
    clientId: row.clientId || "",
    contractId: cleanText(campos.contractId, 120),
    proposalId: cleanText(campos.proposalId, 120),
    notes: cleanText(row.observacoes, 4000),
    revision: row.revision,
    createdAt: row.criadoEm,
    updatedAt: row.atualizadoEm,
  };
};

// -----------------------------------------------------------------------
// Tradução nova UI -> payload TDG (POST/PATCH)
// -----------------------------------------------------------------------

// Payload no formato `colunas` do TDG. Preservamos `originalType`, `uiRisk`
// e demais campos "novos" em `fields_json` — o backend não os olha, mas na
// próxima leitura a UI restaura tudo.
export const contractToTdgLegal = (contract = {}) => {
  const uiRisk = contract.risk || "medio";
  const risco = RISCO_UI_PARA_TDG[uiRisk] || "medio";
  const situacao = SITUACAO_UI_PARA_TDG[contract.status] || "rascunho";
  const tipo = TIPO_UI_PARA_TDG[contract.type] || "contrato";
  return {
    titulo: cleanText(contract.title, 240),
    clientId: cleanText(contract.clientId, 120),
    contraparte: cleanText(contract.counterparty, 240),
    tipo,
    risco,
    inicioVigencia: cleanDate(contract.startDate),
    fimVigencia: cleanDate(contract.endDate),
    responsavelId: contract.responsibleId || null,
    observacoes: cleanText(contract.notes, 4000),
    situacao,
    // `campos` vira `fields_json`. Guardamos: o tipo original da UI (para não
    // perder franquia/locação etc.), o risco original (crítico), documento,
    // valor, moeda, aviso prévio, vínculos que os GATES leem
    // (`contractId`/`proposalId`), e status de aprovação da UI.
    campos: {
      originalType: contract.type || tipo,
      uiRisk,
      confidentiality: contract.confidentiality || "interno",
      cnpj: cleanText(contract.counterpartyDocument, 40),
      amount: Number(contract.amount) || 0,
      currency: cleanText(contract.currency || "BRL", 10),
      renewalMode: contract.renewalMode === "automatic" ? "automatic" : "manual",
      renewalNoticeDays: Math.max(0, Math.min(365, Number(contract.renewalNoticeDays) || 30)),
      approvalStatus: contract.approvalStatus || "pendente",
      externalOfficeId: contract.externalOfficeId || null,
      links: Array.isArray(contract.links) ? contract.links : [],
      // GATE DEPENDS ON THESE — não remover.
      contractId: cleanText(contract.contractId, 120),
      proposalId: cleanText(contract.proposalId, 120),
    },
  };
};

// -----------------------------------------------------------------------
// Normalizadores expostos para os testes de outros módulos
// -----------------------------------------------------------------------

export const normalizeTdgStatus = (id) => normalizarSituacaoJuridica(id);
export const normalizeTdgType = (id) => normalizarTipoJuridico(id);
export const normalizeTdgRisk = (id) => normalizarRiscoTdg(id);
