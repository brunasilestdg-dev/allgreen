// ===== Registros da vertical: travas de negócio =====
//
// Contrato: cada trava lê o banco do espaço do vínculo (`access.ownerId`) e
// responde se a mudança pode acontecer — nenhuma escreve nada, e quem chama
// escolhe o status HTTP (400/409).
// - `validarFinanceiro(corpo, atual)`: "" ou o motivo (o pago só muda por baixa).
// - `bloqueioDeCompetencia(env, access, ...lancamentos)`: "" ou o motivo
//   (competência fechada não aceita lançamento, alteração nem arquivamento).
// - `proposalLiberada(env, access, cenarioId)`: { liberada, motivo } do Deal Desk.
// - `carimboDeViabilidade(snapshot)`: o elo auditável gravado na proposta.
// - `juridicoConcluido(env, access, { contractId, proposalId })`: há documento
//   jurídico APROVADO/ASSINADO vinculado (ou o fluxo legado aprovado)?
// - `documentoDeAssinaturaVinculado(env, access, { contractId, proposalId })`:
//   há anexo do documento jurídico no cofre (ou o anexo legado do fluxo)?

import { TENANT_ID } from "../todogreen-access.js";
import { bloqueioPorFechamento } from "../../../src/features/logistics/treasuryDomain.js";
import { doBanco as pedidoDoBanco } from "../todogreen-deal-desk.js";
import { liberacaoDaProposta } from "../../../src/features/logistics/dealDeskDomain.js";
import { numero, texto } from "./util.js";

export const validarFinanceiro = (corpo, atual = null) => {
  const valor = numero(corpo.valor);
  const pago = Math.max(0, numero(corpo.valorPago));
  if (pago > valor + 0.0001) return "O valor pago não pode superar o valor do lançamento.";
  if (!atual && pago > 0)
    return "Crie o lançamento e use a ação de baixa para registrar o pagamento com histórico.";
  if (
    atual
    && Object.prototype.hasOwnProperty.call(corpo, "valorPago")
    && Math.abs(pago - numero(atual.paid_amount)) > 0.0001
  ) return "O valor pago só pode mudar por uma baixa financeira.";
  return "";
};

// A tela já recusa gerar a proposta quando o Deal Desk não liberou a
// simulação — "Guarda no código, não só no `disabled`", diz o comentário lá.
// Só que o guarda estava no componente React, e qualquer chamada direta a
// este endpoint passava por cima dele. A régua é a mesma (liberacaoDaProposta,
// de dealDeskDomain.js); o que muda é onde ela é aplicada.
// O que a proposta liberada leva consigo: QUAL versão da viabilidade a
// autorizou. É o elo auditável entre a promessa ao cliente e a fotografia
// operacional que a sustentou (seção 49).
export const carimboDeViabilidade = (snap) => ({
  snapshotId: snap?.id || "",
  version: snap?.version ?? null,
  contentHash: snap?.contentHash || "",
  liberadaEm: new Date().toISOString(),
});

export const proposalLiberada = async (env, access, cenarioId, { liberando = true } = {}) => {
  const cenario = await env.DB.prepare(
    `SELECT result_json FROM pricing_scenarios
      WHERE tenant_id=? AND workspace_owner_id=? AND id=?`,
  ).bind(TENANT_ID, access.ownerId, cenarioId).first();
  const { results } = await env.DB.prepare(
    "SELECT * FROM todogreen_deal_desk_requests WHERE workspace_owner_id = ? AND scenario_id = ?",
  )
    .bind(access.ownerId, cenarioId)
    .all();
  if (liberando && cenario && !(results || []).length) {
    let resultado = {};
    try { resultado = JSON.parse(cenario.result_json || "{}"); } catch { resultado = {}; }
    if (resultado.approval?.required)
      return { liberada: false, motivo: "Esta simulação exige aprovação comercial antes da proposta. Abra o pedido ao Deal Desk." };
  }
  return liberacaoDaProposta(cenarioId, (results || []).map(pedidoDoBanco));
};

// A trava do fechamento de período (migração 0056). Um mês fechado não aceita
// lançamento novo, alteração nem arquivamento — é o que faz um resultado
// publicado continuar valendo. Sem isso, o resultado de janeiro poderia mudar em
// dezembro e nenhum relatório emitido antes continuaria verdadeiro.
//
// Vale para as DUAS competências numa alteração: a de onde o lançamento está e a
// para onde ele iria. Checar só uma permitiria tirar um lançamento de um mês
// fechado (mudando o resultado dele) ou empurrar um lançamento para dentro dele.
export const bloqueioDeCompetencia = async (env, access, ...entradas) => {
  const { results } = await env.DB.prepare(
    `SELECT reference_month AS referenceMonth, status FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'fechado'`,
  ).bind(TENANT_ID, access.ownerId).all();
  const periodos = results || [];
  if (!periodos.length) return "";
  for (const entrada of entradas) {
    if (!entrada) continue;
    const bloqueio = bloqueioPorFechamento(entrada, periodos);
    if (bloqueio) return bloqueio;
  }
  return "";
};

// Documentos jurídicos (todogreen_legal_records) deste espaço amarrados a um
// contrato/proposta, via `campos.contractId`/`campos.proposalId` (fields_json).
// O corte de espaço fica no SQL; o casamento por contrato/proposta é em JS
// porque o vínculo mora no JSON — o mesmo padrão do gate legado. Só devolve os
// ids, para o chamador decidir o que a situação de cada um significa.
const idsJuridicosDoContrato = async (env, access, cid, pid, { status } = {}) => {
  const filtroStatus = Array.isArray(status) && status.length
    ? ` AND status IN (${status.map(() => "?").join(",")})` : "";
  const { results } = await env.DB
    .prepare(
      `SELECT id, status, fields_json FROM todogreen_legal_records
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL${filtroStatus}`,
    )
    .bind(TENANT_ID, access.ownerId, ...(status || []))
    .all()
    .catch(() => ({ results: [] }));
  const ids = [];
  for (const row of results || []) {
    let campos = {};
    try { campos = JSON.parse(row.fields_json || "{}"); } catch { campos = {}; }
    if ((cid && texto(campos.contractId, 120) === cid) || (pid && texto(campos.proposalId, 120) === pid))
      ids.push(row.id);
  }
  return ids;
};

// Gate do Jurídico (regra da titular: todo contrato passa pelo Jurídico antes
// de ser aprovado ou assinado). Fonte única, escolhida pela titular: a página
// do Jurídico (todogreen_legal_records). Um documento amarrado a este
// contrato/proposta e já Aprovado ou Assinado conclui o gate. O fluxo antigo em
// todogreen_enterprise_workflows (domínio "legal") permanece aceito como legado
// — contratos aprovados antes da unificação não podem regredir.
export const juridicoConcluido = async (env, access, { contractId = "", proposalId = "" }) => {
  const cid = texto(contractId, 120);
  const pid = texto(proposalId, 120);
  if (!cid && !pid) return false;
  // Fonte única: documento do Jurídico aprovado/assinado amarrado ao contrato.
  const concluidos = await idsJuridicosDoContrato(env, access, cid, pid, { status: ["aprovado", "assinado"] });
  if (concluidos.length) return true;
  // Legado: fluxo jurídico do painel empresarial.
  const { results } = await env.DB
    .prepare(
      `SELECT data_json, approval_json, status FROM todogreen_enterprise_workflows
        WHERE tenant_id=? AND workspace_owner_id=? AND domain='legal' AND archived_at IS NULL`,
    )
    .bind(TENANT_ID, access.ownerId)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of results || []) {
    let data = {};
    let approval = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    try { approval = JSON.parse(row.approval_json || "{}"); } catch { approval = {}; }
    const refereEsteContrato =
      (cid && texto(data.contractId, 120) === cid) ||
      (pid && texto(data.proposalId, 120) === pid);
    if (!refereEsteContrato) continue;
    const aprovacoes = Array.isArray(approval.approvals) ? approval.approvals : [];
    if (row.status === "approved" && ["juridico", "dono-negocio"].every((stepId) =>
      aprovacoes.some((a) => a.stepId === stepId && ["approved", "ressalva"].includes(a.decision))))
      return true;
  }
  return false;
};

// Há ao menos um anexo no cofre interno para algum dos contextos dados? O corte
// de espaço é o de sempre; o context_type diz de qual sistema veio o anexo.
const temAnexoNoCofre = async (env, access, contextType, ids) => {
  if (!ids.length) return false;
  const marcadores = ids.map(() => "?").join(",");
  const anexo = await env.DB
    .prepare(
      `SELECT id FROM todogreen_internal_files
        WHERE tenant_id=? AND workspace_owner_id=? AND context_type=?
          AND context_id IN (${marcadores}) AND archived_at IS NULL
          AND source='internal_upload' AND byte_size>0 LIMIT 1`,
    )
    .bind(TENANT_ID, access.ownerId, contextType, ...ids)
    .first()
    .catch(() => null);
  return Boolean(anexo);
};

// Gate da assinatura: não se marca um contrato como assinado sem a evidência do
// documento assinado. Fonte única (escolha da titular): o arquivo anexado ao
// documento do Jurídico deste contrato (cofre interno, context_type='legal').
// O fluxo antigo (EnterpriseWorkflowPanel, context_type='workflow') segue aceito
// como legado, para contratos que já anexaram a evidência por lá.
export const documentoDeAssinaturaVinculado = async (env, access, { contractId = "", proposalId = "" }) => {
  const cid = texto(contractId, 120);
  const pid = texto(proposalId, 120);
  if (!cid && !pid) return false;
  // Novo: anexo no próprio documento do Jurídico amarrado a este contrato.
  const idsJuridicos = await idsJuridicosDoContrato(env, access, cid, pid);
  if (await temAnexoNoCofre(env, access, "legal", idsJuridicos)) return true;
  // Legado: anexo no fluxo jurídico do painel empresarial.
  const { results } = await env.DB
    .prepare(
      `SELECT id, data_json FROM todogreen_enterprise_workflows
        WHERE tenant_id=? AND workspace_owner_id=? AND domain='legal' AND archived_at IS NULL`,
    )
    .bind(TENANT_ID, access.ownerId)
    .all()
    .catch(() => ({ results: [] }));
  const ids = [];
  for (const row of results || []) {
    let data = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    if ((cid && texto(data.contractId, 120) === cid) || (pid && texto(data.proposalId, 120) === pid))
      ids.push(row.id);
  }
  return temAnexoNoCofre(env, access, "workflow", ids);
};
