// ===== Registros da vertical: baixas do razão financeiro =====
//
// Contrato: `listarPagamentos`, `registrarPagamento` e `estornarPagamento`
// (env, access, user, entryId[, corpo | paymentId]) devolvem Response. O razão
// é imutável: a baixa soma, o estorno lança o compensatório negativo.
// Autorização: o roteador exige a permissão de escrita do financeiro; aqui o
// lançamento precisa estar no espaço e na carteira (`noAlcanceDaCarteira`),
// senão 404. A baixa exige a `revision` lida (409 se mudou).

import { TENANT_ID } from "../todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "../todogreen-governance.js";
import { noAlcanceDaCarteira } from "./acesso.js";
import { COLECOES } from "./colecoes/index.js";
import { json, numero, texto } from "./util.js";

export const listarPagamentos = async (env, access, user, entryId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,amount,paid_at,payment_method,reference,notes,created_by,created_at
       FROM todogreen_financial_payments
      WHERE tenant_id=? AND workspace_owner_id=? AND entry_id=?
      ORDER BY paid_at DESC, created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, entryId).all();
  return json({
    pagamentos: (results || []).map((row) => ({
      id: row.id, valor: row.amount, pagoEm: row.paid_at, meioPagamento: row.payment_method,
      referencia: row.reference, observacoes: row.notes, criadoPor: row.created_by, criadoEm: row.created_at,
    })),
  });
};

export const registrarPagamento = async (env, access, user, entryId, corpo) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const lancamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  // Recebível que nasceu de um título faturado (ponte 0069, id 'entry-<titleId>')
  // tem baixa SÓ pela via do título (Faturamento › Títulos): dar baixa aqui no
  // razão não reduziria o open_amount do título e abriria dupla baixa do mesmo
  // recebível. Receita avulsa (sem título) segue baixável normalmente aqui.
  if (typeof entryId === "string" && entryId.startsWith("entry-") && lancamento?.kind === "revenue") {
    const titulo = await env.DB.prepare(
      "SELECT status FROM todogreen_financial_titles WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
    ).bind(entryId.slice(6), TENANT_ID, access.ownerId).first();
    if (titulo && ["open", "partial", "overdue"].includes(titulo.status))
      return json({ error: "Este recebível vem de um título faturado. Dê a baixa em Faturamento › Títulos; o razão é atualizado sozinho." }, 409);
  }
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao !== Number(lancamento.revision))
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  if (lancamento.invoice_status === "cancelled")
    return json({ error: "Um lançamento cancelado não pode receber baixa." }, 409);
  const valor = numero(corpo.valor);
  const restante = Math.max(0, numero(lancamento.amount) - numero(lancamento.paid_amount));
  if (valor <= 0) return json({ error: "Informe um valor de baixa maior que zero." }, 400);
  if (valor > restante + 0.0001)
    return json({ error: `A baixa supera o saldo aberto de ${restante.toFixed(2)}.` }, 409);
  const pagoEm = texto(corpo.pagoEm, 40) || new Date().toISOString();
  const novoPago = numero(lancamento.paid_amount) + valor;
  const novoStatus = novoPago >= numero(lancamento.amount) - 0.0001 ? "paid" : "partial";
  const agora = new Date().toISOString();
  const pagamentoId = crypto.randomUUID();
  const [updateResult, insertResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET paid_amount=?, paid_at=?, payment_method=?, invoice_status=?, revision=revision+1,
              updated_by=?, updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=? AND archived_at IS NULL`,
    ).bind(
      novoPago, novoStatus === "paid" ? pagoEm : lancamento.paid_at,
      texto(corpo.meioPagamento, 80), novoStatus, user.id, agora,
      entryId, TENANT_ID, access.ownerId, revisao,
    ),
    env.DB.prepare(
      `INSERT INTO todogreen_financial_payments
         (id,tenant_id,workspace_owner_id,entry_id,amount,paid_at,payment_method,reference,notes,created_by,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM todogreen_financial_entries
           WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?
        )`,
    ).bind(
      pagamentoId, TENANT_ID, access.ownerId, entryId, valor, pagoEm,
      texto(corpo.meioPagamento, 80), texto(corpo.referencia, 160), texto(corpo.observacoes, 1000),
      user.id, agora, entryId, TENANT_ID, access.ownerId, revisao + 1,
    ),
  ]);
  if (!updateResult?.meta?.changes || !insertResult?.meta?.changes)
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "payment_added", resourceType: "financial", resourceId: entryId,
    clientId: lancamento.client_id, before: COLECOES.financial.daLinha(lancamento),
    after: COLECOES.financial.daLinha(atualizada), details: `Baixa ${pagamentoId}`,
  });
  return json({
    pagamento: {
      id: pagamentoId, valor, pagoEm, meioPagamento: texto(corpo.meioPagamento, 80),
      referencia: texto(corpo.referencia, 160), observacoes: texto(corpo.observacoes, 1000),
    },
    registro: COLECOES.financial.daLinha(atualizada),
  }, 201);
};

// Estornar uma baixa. O razão é imutável: não se apaga o pagamento, lança-se um
// compensatório negativo que referencia o original e reabre o saldo. É como se
// ajusta um lançamento sem corromper o histórico — a mesma filosofia do estoque
// e do deal desk. Estornar duas vezes o mesmo pagamento é recusado.
//
// Sobre o fechamento de competência: o estorno NÃO chama `bloqueioDeCompetencia`,
// de propósito e em paridade com `registrarPagamento` — a baixa também não chama.
// A trava congela a competência (o accrual, o valor reconhecido no resultado),
// não o lado caixa. Pagar um título cuja competência já fechou é rotina; poder
// pagar mas não poder estornar seria a assimetria errada. O `amount` do
// lançamento (o que a trava protege) não é tocado aqui — só `paid_amount`/status.
export const estornarPagamento = async (env, access, user, entryId, paymentId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const pagamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_payments
      WHERE id=? AND entry_id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(paymentId, entryId, TENANT_ID, access.ownerId).first();
  if (!pagamento) return json({ error: "Baixa não encontrada." }, 404);
  if (numero(pagamento.amount) < 0)
    return json({ error: "Este lançamento já é um estorno." }, 409);
  const jaEstornado = await env.DB.prepare(
    `SELECT 1 FROM todogreen_financial_payments
      WHERE entry_id=? AND tenant_id=? AND workspace_owner_id=? AND reference=?`,
  ).bind(entryId, TENANT_ID, access.ownerId, `estorno:${paymentId}`).first();
  if (jaEstornado) return json({ error: "Esta baixa já foi estornada." }, 409);

  const lancamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  if (!lancamento) return json({ error: "Lançamento não encontrado." }, 404);

  const valor = numero(pagamento.amount);
  const novoPago = Math.max(0, numero(lancamento.paid_amount) - valor);
  const novoStatus = novoPago <= 0.0001 ? "pending" : "partial";
  const agora = new Date().toISOString();
  const estornoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET paid_amount=?, invoice_status=?, revision=revision+1, updated_by=?, updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(novoPago, novoStatus, user.id, agora, entryId, TENANT_ID, access.ownerId),
    env.DB.prepare(
      `INSERT INTO todogreen_financial_payments
         (id,tenant_id,workspace_owner_id,entry_id,amount,paid_at,payment_method,reference,notes,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      estornoId, TENANT_ID, access.ownerId, entryId, -valor, agora,
      pagamento.payment_method || "", `estorno:${paymentId}`,
      `Estorno da baixa ${paymentId}`, user.id, agora,
    ),
  ]);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "payment_reversed", resourceType: "financial", resourceId: entryId,
    clientId: lancamento.client_id, before: COLECOES.financial.daLinha(lancamento),
    after: COLECOES.financial.daLinha(atualizada), details: `Estorno ${estornoId} da baixa ${paymentId}`,
  });
  return json({ estorno: { id: estornoId, valor: -valor, referencia: `estorno:${paymentId}` }, registro: COLECOES.financial.daLinha(atualizada) }, 201);
};
