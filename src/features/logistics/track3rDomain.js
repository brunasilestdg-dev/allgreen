// ===== TRACK3R: do documento do TMS ao registro da vertical =====
//
// Camada pura, e o coração da integração. O transporte (arquivo, API ou webhook)
// muda; isto não. Os três caminhos produzem o MESMO registro canônico, e é por
// isso que descobrir depois que o TRACK3R só exporta relatório — ou que tem API
// — não reescreve nada.
//
// A REGRA QUE ORGANIZA O ARQUIVO: nada aqui força vínculo.
//
// Um documento do TRACK3R pode chegar sem embarcador que case com conta nossa,
// sem placa que exista na frota, sem operação a que pertencer. Isso é normal, não
// defeito: os assuntos nem sempre se relacionam. Duas saídas erradas seriam
// descartar o documento (perde-se o dado) ou casar por aproximação (cria-se um
// vínculo falso que depois ninguém sabe que é falso). A saída certa é ACEITAR
// SEM VÍNCULO e deixar isso visível — `clientId` vazio, `vehicleClass` vazio,
// `operationId` vazio são estados legítimos, e a tela mostra a fila do que falta
// casar.

import { normalizeDocument, isValidDocument } from "./erpCoreDomain.js";
import { normalizeVehicleClass } from "./vehicleClassDomain.js";

const texto = (valor) => String(valor ?? "").trim();

const numero = (valor) => {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  // Planilha brasileira: "1.234,56" e "1234.56" chegam misturados no mesmo
  // arquivo. Number() cru transformaria o primeiro em 1,23456.
  let bruto = texto(valor).replace(/[^\d,.-]/g, "");
  if (!bruto) return 0;
  const virgula = bruto.lastIndexOf(",");
  const ponto = bruto.lastIndexOf(".");
  if (virgula > ponto) bruto = bruto.replace(/\./g, "").replace(",", ".");
  else if (ponto > virgula && virgula >= 0) bruto = bruto.replace(/,/g, "");
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 0;
};

const semAcento = (valor) =>
  texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------------------
// De onde vem cada campo
// ---------------------------------------------------------------------------

// Os nomes à direita são os RÓTULOS REAIS da Consulta de Coletas do TRACK3R,
// como aparecem na tela e, portanto, provavelmente no cabeçalho do relatório
// exportado. Cada campo aceita várias grafias porque não sabemos ainda se o
// arquivo vem com acento, em maiúsculas, ou com o nome interno da API.
//
// `field_map_json` da integração sobrescreve isto — é o que permite ajustar sem
// mexer no código quando o fornecedor responder.
export const TRACK3R_DEFAULT_FIELD_MAP = Object.freeze({
  externalId: ["id", "documento", "numero do documento", "nº do documento", "codigo", "nr documento"],
  kind: ["tipo", "servico", "tipo de servico", "operacao"],
  shipperName: ["embarcador", "cliente", "remetente"],
  shipperGroup: ["embarcador agrupador", "grupo", "agrupador", "nucleo"],
  shipperDocument: ["cnpj", "cnpj embarcador", "documento embarcador", "cnpj do cliente"],
  originUnit: ["unidade origem da coleta", "unidade origem", "origem", "unidade de origem"],
  currentUnit: ["unidade atual da coleta", "unidade atual", "unidade"],
  service: ["servico", "tipo de servico"],
  product: ["produto"],
  status: ["status", "situacao"],
  occurrence: ["ocorrencia", "motivo", "observacao"],
  invoiceNumber: ["numero da nota fiscal", "nº da nota fiscal", "nota fiscal", "nf", "nfe"],
  invoiceKey: ["chave da nota fiscal", "chave nfe", "chave de acesso", "chave"],
  vehiclePlate: ["placa", "placa do veiculo", "veiculo"],
  vehicleClass: ["tipo de veiculo", "classe do veiculo", "categoria do veiculo", "modelo do veiculo"],
  driverName: ["motorista", "condutor", "entregador"],
  packages: ["volumes", "pacotes", "quantidade", "qtd volumes"],
  weightKg: ["peso", "peso kg", "peso bruto"],
  distanceKm: ["distancia", "km", "distancia km"],
  promisedAt: ["previsao", "prazo", "data prometida", "sla", "data prevista"],
  occurredAt: ["data", "data altera", "data do evento", "data hora", "data da baixa"],
});

// Procura o valor pelo primeiro apelido que existir na linha. Compara sem acento
// e sem caixa, porque cabeçalho de relatório brasileiro varia nos dois.
const valorDoCampo = (linha, apelidos = []) => {
  if (!linha || typeof linha !== "object") return "";
  const porChave = new Map(Object.keys(linha).map((chave) => [semAcento(chave), linha[chave]]));
  for (const apelido of apelidos) {
    const achado = porChave.get(semAcento(apelido));
    if (achado !== undefined && achado !== null && texto(achado) !== "") return achado;
  }
  return "";
};

const mapaEfetivo = (fieldMap = {}) => {
  const efetivo = { ...TRACK3R_DEFAULT_FIELD_MAP };
  for (const [campo, valor] of Object.entries(fieldMap || {})) {
    if (!valor) continue;
    // A configuração pode mandar um nome só ou uma lista. Aceitar os dois evita
    // que ajustar um campo exija reescrever o mapa inteiro.
    const lista = Array.isArray(valor) ? valor : [valor];
    // A configuração entra NA FRENTE dos padrões, não em vez deles: assim
    // ajustar um campo não quebra os apelidos que já funcionavam.
    efetivo[campo] = [...lista.map(texto).filter(Boolean), ...(efetivo[campo] || [])];
  }
  return efetivo;
};

// ---------------------------------------------------------------------------
// Tipo de documento e status
// ---------------------------------------------------------------------------

export const TMS_DOCUMENT_KINDS = Object.freeze([
  { id: "coleta", name: "Coleta" },
  { id: "entrega", name: "Entrega" },
  { id: "transferencia", name: "Transferência" },
  { id: "coleta_reversa", name: "Coleta reversa" },
  { id: "ocorrencia", name: "Ocorrência" },
]);

// "Coleta Reversa" é o serviço que aparece na tela do TRACK3R e é um fluxo
// distinto: a mercadoria volta. Tratá-la como coleta comum faria o relatório
// somar o que saiu com o que voltou.
export const normalizeDocumentKind = (valor) => {
  const bruto = semAcento(valor);
  if (!bruto) return "";
  if (bruto.includes("revers")) return "coleta_reversa";
  if (bruto.includes("transfer")) return "transferencia";
  if (bruto.includes("ocorrenc")) return "ocorrencia";
  if (bruto.includes("entrega") || bruto.includes("delivery")) return "entrega";
  if (bruto.includes("coleta") || bruto.includes("pickup")) return "coleta";
  return "";
};

// O status do TRACK3R vira um evento da linha do tempo da operação. Os valores
// de destino são EXATAMENTE os que `todogreen_client_operation_events.kind` já
// aceita (migração 0045) — é o encaixe que dispensa tabela nova.
//
// Devolve "" quando não reconhece, e o documento entra sem evento. Chutar
// "entrega" para um status desconhecido registraria uma entrega que não houve.
export const mapearStatusParaEvento = (status) => {
  const bruto = semAcento(status);
  if (!bruto) return "";

  // Ordem importa, e o mais específico vem primeiro. Dois casos ensinaram por
  // quê: "Nova tentativa agendada" é reagendamento, mas contém "tentativa" e
  // cairia em ocorrência se a ocorrência viesse antes; e "recusou" não casa com
  // "recusad", por isso o radical é "recus".
  if (/(reagend|remarcad|nova tentativa|nova data)/.test(bruto)) return "reagendamento";
  if (/(nao entregue|nao realizada|insucesso|tentativa|devolv|recus|avaria|extravi|sinistro|falha)/.test(bruto))
    return "ocorrencia";
  if (/(entregue|baixa|finalizad|conclu)/.test(bruto)) return "entrega";
  if (/(chegou|chegada|na base|no destino|recebido na unidade)/.test(bruto)) return "chegada";
  if (/(em transito|transito|em rota|saiu para entrega|transferencia)/.test(bruto)) return "transito";
  if (/(coletad|coleta realizada|retirad)/.test(bruto)) return "coleta";
  if (/(documento|nota|nf)/.test(bruto)) return "documento";
  return "";
};

// Status que significam "acabou", para o relatório saber o que ainda está aberto.
export const statusEncerrado = (status) => {
  const evento = mapearStatusParaEvento(status);
  return evento === "entrega";
};

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

// O TRACK3R mostra data em dd/mm/aaaa (a tela traz "19/08/2026"). Aceitar só ISO
// perderia toda linha do relatório exportado.
export const normalizeDate = (valor) => {
  const bruto = texto(valor);
  if (!bruto) return "";
  const iso = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // Ano com dois dígitos é ambíguo e não vale o risco de virar 1925.
  return "";
};

// Guarda a hora quando ela vem, porque prazo de SLA se decide no horário, não no
// dia. Sem hora, devolve só a data.
export const normalizeDateTime = (valor) => {
  const dia = normalizeDate(valor);
  if (!dia) return "";
  const hora = texto(valor).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return hora ? `${dia}T${hora[1]}:${hora[2]}:${hora[3] || "00"}` : dia;
};

// ---------------------------------------------------------------------------
// A normalização
// ---------------------------------------------------------------------------

// Uma linha do TRACK3R — de arquivo, de API ou de webhook — vira o registro
// canônico. Campo que não vem fica vazio; nada é inventado.
export const normalizarDocumento = (bruto = {}, fieldMap = {}) => {
  const mapa = mapaEfetivo(fieldMap);
  const pega = (campo) => valorDoCampo(bruto, mapa[campo]);

  const servico = texto(pega("service"));
  const kindDeclarado = normalizeDocumentKind(pega("kind"));
  const documento = normalizeDocument(pega("shipperDocument"));
  const chave = texto(pega("invoiceKey")).replace(/\D+/g, "");

  return {
    externalId: texto(pega("externalId")).slice(0, 120),
    // O tipo pode vir no campo de tipo OU no de serviço ("Coleta Reversa" é um
    // serviço na tela do TRACK3R). Sem achar em nenhum dos dois, fica vazio.
    kind: kindDeclarado || normalizeDocumentKind(servico) || "",
    shipperName: texto(pega("shipperName")).slice(0, 240),
    shipperGroup: texto(pega("shipperGroup")).slice(0, 240),
    // Documento inválido NÃO é guardado: ele viraria uma chave de casamento
    // falsa, e casar embarcador por CNPJ errado é pior que não casar.
    shipperDocument: documento && isValidDocument(documento) ? documento : "",
    originUnit: texto(pega("originUnit")).slice(0, 200),
    currentUnit: texto(pega("currentUnit")).slice(0, 200),
    service: servico.slice(0, 200),
    product: texto(pega("product")).slice(0, 200),
    status: texto(pega("status")).slice(0, 120),
    occurrence: texto(pega("occurrence")).slice(0, 500),
    invoiceNumber: texto(pega("invoiceNumber")).slice(0, 60),
    // Chave de NF-e tem 44 dígitos. Guardar 43 criaria um vínculo que nunca
    // casa com o XML, e o erro só apareceria meses depois.
    invoiceKey: chave.length === 44 ? chave : "",
    vehiclePlate: texto(pega("vehiclePlate")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
    // De moto a carreta. Vazio quando não reconhece — nunca chuta, porque
    // classificar carreta como van erraria custo, cobrança e habilitação de uma
    // vez.
    vehicleClass: normalizeVehicleClass(pega("vehicleClass")),
    driverName: texto(pega("driverName")).slice(0, 200),
    packages: Math.max(0, numero(pega("packages"))),
    weightKg: Math.max(0, numero(pega("weightKg"))),
    distanceKm: Math.max(0, numero(pega("distanceKm"))),
    promisedAt: normalizeDateTime(pega("promisedAt")),
    occurredAt: normalizeDateTime(pega("occurredAt")),
    payload: bruto,
  };
};

// ---------------------------------------------------------------------------
// Deduplicação
// ---------------------------------------------------------------------------

// Determinístico, sem hora do sistema e sem aleatório. Prioriza o id do TRACK3R;
// na falta dele, a combinação que identifica o documento na prática.
//
// O STATUS FICA FORA do hash de propósito: a mesma coleta reaparece no relatório
// do dia seguinte com status novo, e incluir o status faria cada mudança criar um
// documento em vez de atualizar o que existe.
export const hashDoDocumento = (doc = {}) => {
  const id = texto(doc.externalId);
  if (id) return `id:${id}`;
  return [
    texto(doc.kind),
    texto(doc.shipperName).toLowerCase(),
    texto(doc.invoiceNumber),
    texto(doc.invoiceKey),
    normalizeDate(doc.occurredAt),
    texto(doc.originUnit).toLowerCase(),
    String(doc.packages ?? 0),
  ].join("|");
};

// ---------------------------------------------------------------------------
// Casamento do embarcador — sem forçar
// ---------------------------------------------------------------------------

// Casa por CNPJ, e só por CNPJ. O AGENTS.md é explícito: "Não criar uma segunda
// coleção de clientes nem ligar contas por nome quando houver identificador."
//
// Devolve `{clientId, criterio}` ou `null`. `null` é resultado legítimo e comum:
// o documento entra sem conta e aparece na fila do que falta casar. Casar por
// nome parecido criaria vínculo falso que ninguém depois sabe que é falso.
export const casarEmbarcador = (doc = {}, clientes = []) => {
  const documento = normalizeDocument(doc.shipperDocument);
  if (documento && isValidDocument(documento)) {
    const porDocumento = clientes.find(
      (cliente) => normalizeDocument(cliente?.document) === documento,
    );
    if (porDocumento) return { clientId: texto(porDocumento.id), criterio: "cnpj" };
  }
  return null;
};

// Sugestões por nome e grupo, para uma PESSOA escolher — nunca aplicadas
// sozinhas. É a mesma postura da conciliação bancária: sugerir é útil, casar
// automaticamente é o que ninguém revisa depois.
export const sugerirEmbarcador = (doc = {}, clientes = []) => {
  const nome = semAcento(doc.shipperName);
  const grupo = semAcento(doc.shipperGroup);
  if (!nome && !grupo) return [];

  return clientes
    .map((cliente) => {
      const alvo = semAcento(cliente?.name);
      const alvoLegal = semAcento(cliente?.legalName);
      if (!alvo && !alvoLegal) return null;
      let pontos = 0;
      const motivos = [];

      if (nome && (alvo === nome || alvoLegal === nome)) { pontos += 60; motivos.push("nome idêntico"); }
      else if (nome && (alvo.includes(nome) || nome.includes(alvo))) { pontos += 35; motivos.push("nome contido"); }

      // O grupo é o sinal que liga "AMAZON DBA" e "AMAZON RETAIL" à mesma conta —
      // exatamente o NUCLEO/GRUPO da carteira herdada.
      if (grupo && (alvo.includes(grupo) || grupo.includes(alvo))) {
        pontos += 30;
        motivos.push("grupo do embarcador");
      }
      return pontos > 0 ? { clientId: texto(cliente.id), name: texto(cliente.name), pontos, motivos } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 5);
};

// ---------------------------------------------------------------------------
// Projeção na operação da vertical
// ---------------------------------------------------------------------------

// Monta o registro de `todogreen_client_operations` a partir do documento. Pura:
// devolve e não grava.
//
// Devolve `null` quando falta o mínimo — cliente casado e data. Projetar sem
// cliente criaria operação órfã; projetar sem data criaria operação que nenhum
// relatório de período encontra. Nos dois casos é melhor o documento ficar na
// fila, visível, do que gerar um registro que ninguém consegue usar.
export const projetarOperacao = (doc = {}, opcoes = {}) => {
  const clientId = texto(doc.clientId || opcoes.clientId);
  const quando = normalizeDate(doc.occurredAt);
  if (!clientId || !quando) return null;

  const evento = mapearStatusParaEvento(doc.status);
  const entregue = evento === "entrega";

  // Os nomes aqui espelham as COLUNAS REAIS de `todogreen_client_operations`
  // (migrações 0033 e 0045): `reference`, `service_date`, `origin`,
  // `destination`, `distance_km`, `promised_at`, `delivered_at`. Volume, peso e
  // ocupação NÃO têm coluna própria nessa tabela — a 0047 os consolidou em
  // `fields_json`, e é para lá que eles vão. Inventar coluna aqui faria o INSERT
  // falhar em produção.
  return {
    clientId,
    serviceDate: quando,
    referenceMonth: quando.slice(0, 7),
    // A referência é o que a pessoa procura quando o cliente pergunta: número da
    // nota, ou o id do TRACK3R quando não há nota.
    referencia: texto(doc.invoiceNumber) || texto(doc.externalId),
    origem: texto(doc.originUnit),
    destino: texto(doc.currentUnit),
    distanceKm: Math.max(0, numero(doc.distanceKm)),
    vehiclePlate: texto(doc.vehiclePlate),
    driverName: texto(doc.driverName),
    promisedAt: texto(doc.promisedAt) || null,
    // Só marca entrega quando o status DIZ entrega. Preencher com a data do
    // evento em qualquer status faria toda ocorrência contar como entregue.
    deliveredAt: entregue ? texto(doc.occurredAt) : null,
    // O vocabulário de status da tabela é `planejada` por padrão; `concluida` e
    // `active` são os que a vertical já usa nas outras escritas.
    status: entregue ? "concluida" : "active",
    // Uma ocorrência conta como incidente da operação — é o que alimenta o
    // Green Score e o SLA.
    incidentes: evento === "ocorrencia" ? 1 : 0,
    campos: {
      sourceTmsDocumentId: texto(doc.id),
      sourceTms: "track3r",
      service: texto(doc.service),
      product: texto(doc.product),
      shipperGroup: texto(doc.shipperGroup),
      vehicleClass: texto(doc.vehicleClass),
      // Sem coluna própria na tabela: vivem no payload, como a 0047 decidiu.
      packages: Math.max(0, numero(doc.packages)),
      weightKg: Math.max(0, numero(doc.weightKg)),
      lastStatus: texto(doc.status),
      lastOccurrence: texto(doc.occurrence),
    },
  };
};

// O evento da linha do tempo, quando o status é reconhecível.
export const projetarEvento = (doc = {}) => {
  const kind = mapearStatusParaEvento(doc.status);
  if (!kind) return null;
  return {
    kind,
    titulo: texto(doc.status),
    descricao: texto(doc.occurrence),
    local: texto(doc.currentUnit) || texto(doc.originUnit),
    ocorridoEm: texto(doc.occurredAt),
  };
};

// ---------------------------------------------------------------------------
// Validação e retrato
// ---------------------------------------------------------------------------

// O mínimo para o documento valer a pena guardar. Deliberadamente baixo: cliente,
// veículo e operação são vínculos que podem faltar, e faltar não é erro.
export const validarDocumento = (doc = {}) => {
  if (!texto(doc.externalId) && !texto(doc.invoiceNumber) && !texto(doc.shipperName))
    return "A linha não tem documento, nota fiscal nem embarcador — não há como identificá-la.";
  if (!normalizeDate(doc.occurredAt) && !normalizeDate(doc.promisedAt))
    return "A linha não tem data reconhecível (use AAAA-MM-DD ou dd/mm/aaaa).";
  return "";
};

// O que a tela de integração precisa dizer: quanto entrou, e quanto ainda não
// tem vínculo. Sem esse segundo número, a integração parece completa enquanto
// metade dos documentos não chegou a lugar nenhum.
export const resumoDaImportacao = (documentos = []) => {
  const base = {
    total: documentos.length,
    semEmbarcador: 0,
    semClasseDeVeiculo: 0,
    semProjecao: 0,
    porTipo: {},
    porClasse: {},
  };
  return documentos.reduce((resumo, doc) => {
    if (!texto(doc?.clientId)) resumo.semEmbarcador += 1;
    if (!texto(doc?.vehicleClass)) resumo.semClasseDeVeiculo += 1;
    if (!texto(doc?.operationId)) resumo.semProjecao += 1;
    const tipo = texto(doc?.kind) || "(sem tipo)";
    resumo.porTipo[tipo] = (resumo.porTipo[tipo] || 0) + 1;
    const classe = texto(doc?.vehicleClass) || "(sem classe)";
    resumo.porClasse[classe] = (resumo.porClasse[classe] || 0) + 1;
    return resumo;
  }, base);
};

// As perguntas a fazer ao suporte do TRACK3R. Ficam no código porque é aqui que
// se sabe exatamente o que falta para ligar API e webhook.
export const PERGUNTAS_AO_TRACK3R = Object.freeze([
  "Existe API REST? Qual a URL base e onde está a documentação?",
  "Como se emite o token de acesso, e em qual cabeçalho ele vai?",
  "Existe webhook de mudança de status de coleta e de entrega? Como o segredo é validado?",
  "Quais campos vêm em Consulta Dados Nota Fiscal (número, série, chave de 44 dígitos, valor)?",
  "O relatório exportado sai em CSV ou XLSX, e com quais colunas exatas no cabeçalho?",
  "O embarcador vem com CNPJ, ou só com nome e agrupador?",
  "O tipo de veículo vem no documento? Com que vocabulário (moto, van, VUC, truck, carreta)?",
  "Existe identificador estável do documento que não muda quando o status muda?",
]);
