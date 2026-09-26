// ===== Compras: requisição → pedido → recebimento =====
//
// Serviço próprio, e não coleção genérica, por três razões:
//
//   1. O pedido tem LINHAS em tabela separada, que precisam ser gravadas junto
//      com a cabeça, na mesma transação.
//
//   2. A mudança de status obedece a uma máquina de estados declarada
//      (`podeMudarStatusDoPedido`). O PATCH genérico aceitaria qualquer valor e
//      deixaria um pedido encerrado voltar para rascunho.
//
//   3. O recebimento tem EFEITO: gera movimento de estoque e título a pagar. É
//      o ponto mais delicado do módulo, e o que o torna idempotente é
//      `stock_posted_at` — lançar duas vezes o mesmo recebimento dobraria o
//      estoque e a dívida.
//
// O que NÃO está aqui, de propósito: a comparação de propostas de fornecedor.
// `supplierBidTotals`, `compareSupplierBids` e `bestOffersByItem` já existem em
// `src/domain.js`, testados, com a regra que importa — proposta incompleta nunca
// ganha de uma completa.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import { bloqueioDeCompetencia } from "./vertical-records/gates.js";
import { saldoDisponivel } from "./todogreen-stock.js";
// `exigeAprovacao` existe e está testado em purchaseDomain.js, mas ainda não é
// aplicado aqui: a alçada precisa de um LIMITE configurado, e o limite não pode
// vir do corpo do pedido — quem compra escolheria o próprio teto. O lugar dele é
// junto da régua da vertical (`todogreen_pricing_parameters`, versionada e
// justificada), e ligar isso é o passo seguinte. Até então todo pedido pode ser
// aprovado por quem tem `purchase:manage`, e o que já protege é o retrato do
// total aprovado: editar depois derruba a validade da aprovação.
import {
  aprovacaoAindaVale,
  linhasDoPedidoDaRequisicao,
  podeMudarStatusDaRequisicao,
  podeMudarStatusDoPedido,
  recebimentoParaConta,
  recebimentoParaMovimentos,
  recepcaoDoPedido,
  totalDoPedido,
  validarLinhasDoRecebimento,
  validateOrder,
  validateReceipt,
  validateRequest,
} from "../../src/features/logistics/purchaseDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);

// O status pedido no corpo, lido do jeito que a máquina de estados o aplica. O
// portão de alçada (`todogreen-purchasing-enterprise.js`) usa este MESMO leitor:
// quando cada lado lia de um jeito, "aprovada " passava pelo portão como edição
// comum e chegava aqui, aparada, como aprovação.
export const statusDoCorpo = (corpo) => texto(corpo?.status, 40);
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const lista = (valor) => (Array.isArray(valor) ? valor : []);

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

const requisicaoDaLinha = (row) => ({
  id: row.id,
  numeroDocumento: row.document_number,
  title: row.title,
  justificativa: row.justification,
  requisitanteId: row.requester_user_id,
  costCenterId: row.cost_center_id,
  prioridade: row.priority,
  precisaEm: row.needed_by || "",
  status: row.status,
  items: parse(row.items_json, []),
  aprovadoPor: row.approved_by || "",
  aprovadoEm: row.approved_at || "",
  notaDecisao: row.decision_note,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const pedidoDaLinha = (row) => ({
  id: row.id,
  numeroDocumento: row.document_number,
  supplierPartyId: row.supplier_party_id,
  supplierName: row.supplier_name || "",
  requestId: row.request_id,
  rfqId: row.rfq_id,
  warehouseId: row.warehouse_id,
  costCenterId: row.cost_center_id,
  status: row.status,
  approvalStatus: row.approval_status,
  aprovadoPor: row.approved_by || "",
  aprovadoEm: row.approved_at || "",
  notaDecisao: row.decision_note,
  freight: row.freight,
  taxes: row.taxes,
  discount: row.discount,
  approvedTotal: row.approved_total,
  paymentTermDays: row.payment_term_days,
  esperadoEm: row.expected_at || "",
  notas: row.notes,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const linhaDoPedidoDaLinha = (row) => ({
  id: row.id,
  orderId: row.order_id,
  itemId: row.item_id,
  description: row.description,
  unit: row.unit,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  lineNumber: row.line_number,
  campos: parse(row.fields_json, {}),
});

const recebimentoDaLinha = (row) => ({
  id: row.id,
  numeroDocumento: row.document_number,
  orderId: row.order_id,
  warehouseId: row.warehouse_id,
  kind: row.kind,
  invoiceNumber: row.invoice_number,
  invoiceKey: row.invoice_key,
  linhas: parse(row.lines_json, []),
  receivedAt: row.received_at,
  estoqueLancadoEm: row.stock_posted_at || "",
  financialEntryId: row.financial_entry_id,
  notas: row.notes,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  archivedAt: row.archived_at || null,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const linhasDoPedido = async (env, ownerId, orderId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_purchase_order_items
      WHERE order_id = ? AND tenant_id = ? AND workspace_owner_id = ?
      ORDER BY line_number`,
  ).bind(orderId, TENANT_ID, ownerId).all();
  return (results || []).map(linhaDoPedidoDaLinha);
};

const recebimentosDoPedido = async (env, ownerId, orderId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_goods_receipts
      WHERE order_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
      ORDER BY received_at`,
  ).bind(orderId, TENANT_ID, ownerId).all();
  return (results || []).map(recebimentoDaLinha);
};

// O pedido nunca sai daqui sem a recepção calculada: quem lê a lista precisa
// saber o que falta chegar, e obrigar a tela a somar isso reproduziria a regra
// em JSX — que é onde ela divergiria.
const pedidoCompleto = async (env, ownerId, row) => {
  const pedido = pedidoDaLinha(row);
  const [linhas, recebimentos] = await Promise.all([
    linhasDoPedido(env, ownerId, pedido.id),
    recebimentosDoPedido(env, ownerId, pedido.id),
  ]);
  return {
    ...pedido,
    linhas,
    recebimentos,
    totais: totalDoPedido(pedido, linhas),
    recepcao: recepcaoDoPedido(linhas, recebimentos),
    aprovacaoValida: aprovacaoAindaVale(pedido, linhas),
  };
};

// O nome do fornecedor entra por JOIN, não por cópia na linha do pedido. Cópia
// congelaria a grafia e faria dois pedidos do mesmo fornecedor mostrarem nomes
// diferentes depois de uma correção no cadastro.
const SELECT_PEDIDO = `SELECT o.*, p.legal_name AS supplier_name
     FROM todogreen_purchase_orders o
     LEFT JOIN todogreen_parties p
       ON p.id = o.supplier_party_id AND p.workspace_owner_id = o.workspace_owner_id`;

const lerPedido = async (env, ownerId, id) => {
  const row = await env.DB.prepare(
    `${SELECT_PEDIDO}
      WHERE o.id = ? AND o.tenant_id = ? AND o.workspace_owner_id = ? AND o.archived_at IS NULL`,
  ).bind(id, TENANT_ID, ownerId).first();
  return row ? pedidoCompleto(env, ownerId, row) : null;
};

const listarRequisicoes = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const status = texto(url.searchParams.get("status"), 40);
  const filtro = status ? "AND status = ?" : "";
  const params = [TENANT_ID, access.ownerId, ...(status ? [status] : [])];
  const base = `FROM todogreen_purchase_requests
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtro}`;
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map(requisicaoDaLinha),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

const listarPedidos = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const status = texto(url.searchParams.get("status"), 40);
  const fornecedor = texto(url.searchParams.get("fornecedor"), 120);
  const filtro = [status ? "AND o.status = ?" : "", fornecedor ? "AND o.supplier_party_id = ?" : ""].join(" ");
  const params = [
    TENANT_ID, access.ownerId,
    ...(status ? [status] : []),
    ...(fornecedor ? [fornecedor] : []),
  ];
  const onde = `WHERE o.tenant_id = ? AND o.workspace_owner_id = ? AND o.archived_at IS NULL ${filtro}`;
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`${SELECT_PEDIDO} ${onde} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_purchase_orders o ${onde}`,
    ).bind(...params).first(),
  ]);
  const registros = await Promise.all((results || []).map((row) => pedidoCompleto(env, access.ownerId, row)));
  return json({ registros, total: totalRow?.total || 0, limit, offset });
};

// ---------------------------------------------------------------------------
// Requisição
// ---------------------------------------------------------------------------

const criarRequisicao = async (env, access, user, corpo) => {
  const erro = validateRequest({ title: corpo.title, items: corpo.items });
  if (erro) return json({ error: erro }, 400);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_purchase_requests
       (id, tenant_id, workspace_owner_id, document_number, title, justification,
        requester_user_id, cost_center_id, priority, needed_by, status, items_json,
        decision_note, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      id, TENANT_ID, access.ownerId, texto(corpo.numeroDocumento, 60),
      texto(corpo.title, 240), texto(corpo.justificativa, 4000),
      // Quando não informado, o requisitante é quem está criando — o caso comum
      // é a pessoa pedir para si.
      texto(corpo.requisitanteId, 120) || user.id,
      texto(corpo.costCenterId, 120),
      ({ baixa: "baixa", media: "normal", média: "normal", normal: "normal", alta: "alta", critica: "urgente", crítica: "urgente", urgente: "urgente" }[texto(corpo.prioridade).toLowerCase()] || "normal"),
      texto(corpo.precisaEm, 20) || null,
      ["rascunho", "pendente"].includes(texto(corpo.status)) ? texto(corpo.status) : "pendente",
      JSON.stringify(lista(corpo.items)),
      JSON.stringify(objeto(corpo.campos)), user.id, user.id, agora, agora,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM todogreen_purchase_requests WHERE id = ?").bind(id).first();
  return json({ registro: requisicaoDaLinha(row) }, 201);
};

const atualizarRequisicao = async (env, access, user, id, corpo) => {
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao <= 0)
    return json({ error: "Informe a revisão da requisição que você leu." }, 400);

  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_purchase_requests
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Requisição não encontrada." }, 404);

  const novoStatus = statusDoCorpo(corpo) || atual.status;
  if (novoStatus !== atual.status && !podeMudarStatusDaRequisicao(atual.status, novoStatus))
    return json({
      error: `Uma requisição ${atual.status} não pode ir para ${novoStatus}.`,
    }, 409);

  const proximo = {
    title: corpo.title ?? atual.title,
    items: corpo.items ?? parse(atual.items_json, []),
  };
  const erro = validateRequest(proximo);
  if (erro) return json({ error: erro }, 400);

  // Toda decisão de Suprimentos/gestão registra quem agiu e quando — aprovar,
  // recusar, devolver ao requisitante ou direcionar à gestão. Sem isso, a
  // devolução e o encaminhamento aconteceriam sem autor.
  const decide = ["aprovada", "recusada", "devolvida", "em_gestao"].includes(novoStatus) && novoStatus !== atual.status;
  const agora = new Date().toISOString();
  const meta = await env.DB.prepare(
    `UPDATE todogreen_purchase_requests
        SET title = ?, justification = ?, requester_user_id = ?, cost_center_id = ?,
            priority = ?, needed_by = ?, status = ?, items_json = ?,
            approved_by = ?, approved_at = ?, decision_note = ?,
            fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(
      texto(proximo.title, 240),
      texto(corpo.justificativa ?? atual.justification, 4000),
      texto(corpo.requisitanteId ?? atual.requester_user_id, 120),
      texto(corpo.costCenterId ?? atual.cost_center_id, 120),
      ["baixa", "normal", "alta", "urgente"].includes(texto(corpo.prioridade))
        ? texto(corpo.prioridade) : atual.priority,
      texto(corpo.precisaEm ?? atual.needed_by, 20) || null,
      novoStatus,
      JSON.stringify(lista(proximo.items)),
      decide ? user.id : atual.approved_by,
      decide ? agora : atual.approved_at,
      texto(corpo.notaDecisao ?? atual.decision_note, 2000),
      JSON.stringify(objeto(corpo.campos ?? parse(atual.fields_json, {}))),
      user.id, agora, id, TENANT_ID, access.ownerId, revisao,
    )
    .run();

  if (!meta?.meta?.changes)
    return json({
      error: "Esta requisição mudou enquanto você editava. Recarregue para ver a versão atual.",
    }, 409);

  const row = await env.DB.prepare("SELECT * FROM todogreen_purchase_requests WHERE id = ?").bind(id).first();
  return json({ registro: requisicaoDaLinha(row) });
};

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

const gravarLinhas = (env, ownerId, orderId, linhas, agora) =>
  linhas.map((linha, indice) =>
    env.DB.prepare(
      `INSERT INTO todogreen_purchase_order_items
         (id, tenant_id, workspace_owner_id, order_id, item_id, description, unit,
          quantity, unit_price, line_number, fields_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, ownerId, orderId,
      texto(linha.itemId, 120), texto(linha.description ?? linha.descricao, 400),
      texto(linha.unit ?? linha.unidade, 10) || "UN",
      Math.abs(numero(linha.quantity ?? linha.quantidade)),
      Math.max(0, numero(linha.unitPrice ?? linha.precoUnitario)),
      indice + 1, JSON.stringify(objeto(linha.campos)), agora,
    ),
  );

const criarPedido = async (env, access, user, corpo) => {
  // A requisição, quando informada, dita as linhas — e precisa estar aprovada.
  // Aceitar linhas soltas com uma requisição em rascunho deixaria a aprovação
  // virar formalidade.
  let linhas = lista(corpo.linhas);
  const requestId = texto(corpo.requestId, 120);
  if (requestId) {
    const requisicao = await env.DB.prepare(
      `SELECT * FROM todogreen_purchase_requests
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(requestId, TENANT_ID, access.ownerId).first();
    if (!requisicao) return json({ error: "Requisição não encontrada neste espaço." }, 404);
    if (requisicao.status !== "aprovada")
      return json({ error: "A requisição precisa estar aprovada para gerar pedido." }, 409);
    if (!linhas.length) linhas = linhasDoPedidoDaRequisicao(requisicaoDaLinha(requisicao));
  }

  const erro = validateOrder({ ...corpo, supplierPartyId: texto(corpo.supplierPartyId, 120) }, linhas);
  if (erro) return json({ error: erro }, 400);

  const fornecedor = await env.DB.prepare(
    `SELECT id, payment_term_days FROM todogreen_parties
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(texto(corpo.supplierPartyId, 120), TENANT_ID, access.ownerId).first();
  if (!fornecedor) return json({ error: "Fornecedor não encontrado neste espaço." }, 404);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_purchase_orders
         (id, tenant_id, workspace_owner_id, document_number, supplier_party_id, request_id,
          rfq_id, warehouse_id, cost_center_id, status, approval_status, decision_note,
          freight, taxes, discount, approved_total, payment_term_days, expected_at, notes,
          fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', 'nao_requerida', '',
               ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
    ).bind(
      id, TENANT_ID, access.ownerId, texto(corpo.numeroDocumento, 60),
      texto(corpo.supplierPartyId, 120), requestId, texto(corpo.rfqId, 120),
      texto(corpo.warehouseId, 120), texto(corpo.costCenterId, 120),
      Math.max(0, numero(corpo.freight)), Math.max(0, numero(corpo.taxes)),
      Math.max(0, numero(corpo.discount)),
      // Sem prazo informado, herda o do cadastro do fornecedor — que é onde a
      // condição negociada mora.
      Math.max(0, Math.trunc(
        corpo.paymentTermDays === undefined ? numero(fornecedor.payment_term_days) : numero(corpo.paymentTermDays),
      )),
      texto(corpo.esperadoEm, 20) || null, texto(corpo.notas, 4000),
      JSON.stringify(objeto(corpo.campos)), user.id, user.id, agora, agora,
    ),
    ...gravarLinhas(env, access.ownerId, id, linhas, agora),
  ]);

  return json({ registro: await lerPedido(env, access.ownerId, id) }, 201);
};

const atualizarPedido = async (env, access, user, id, corpo) => {
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao <= 0)
    return json({ error: "Informe a revisão do pedido que você leu." }, 400);

  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_purchase_orders
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Pedido não encontrado." }, 404);

  const novoStatus = statusDoCorpo(corpo) || atual.status;
  if (novoStatus !== atual.status && !podeMudarStatusDoPedido(atual.status, novoStatus))
    return json({ error: `Um pedido ${atual.status} não pode ir para ${novoStatus}.` }, 409);

  // Pedido já enviado ou encerrado não muda de item nem de preço: o fornecedor
  // já recebeu o documento, e alterá-lo aqui faria o que ele entrega divergir do
  // que o sistema diz ter sido pedido.
  const mexeNasLinhas = corpo.linhas !== undefined;
  if (mexeNasLinhas && !["rascunho", "aprovado"].includes(atual.status))
    return json({
      error: "Só pedido em rascunho ou aprovado pode ter os itens alterados.",
    }, 409);

  const linhas = mexeNasLinhas
    ? lista(corpo.linhas)
    : await linhasDoPedido(env, access.ownerId, id);
  const erro = validateOrder(
    { supplierPartyId: texto(corpo.supplierPartyId ?? atual.supplier_party_id, 120), ...corpo },
    linhas,
  );
  if (erro) return json({ error: erro }, 400);

  const agora = new Date().toISOString();
  const totais = totalDoPedido(
    {
      freight: corpo.freight ?? atual.freight,
      taxes: corpo.taxes ?? atual.taxes,
      discount: corpo.discount ?? atual.discount,
    },
    linhas,
  );

  // Um pedido editado após a aprovação volta para rascunho. Só comparar o
  // total não basta: trocar item/fornecedor pelo mesmo valor também altera o
  // objeto da aprovação. A nova rodada começa sem as etapas antigas.
  const alterouPedidoAprovado = atual.status === "aprovado" && (
    mexeNasLinhas
    || Math.abs(totais.total - numero(atual.approved_total)) > 0.01
    || texto(corpo.supplierPartyId ?? atual.supplier_party_id, 120) !== atual.supplier_party_id
    || texto(corpo.warehouseId ?? atual.warehouse_id, 120) !== atual.warehouse_id
    || texto(corpo.costCenterId ?? atual.cost_center_id, 120) !== atual.cost_center_id
  );
  if (novoStatus === "enviado" && (
    alterouPedidoAprovado
    || !aprovacaoAindaVale(pedidoDaLinha(atual), linhas)
  )) return json({ error: "O pedido mudou após a aprovação. Reenvie para a alçada antes de enviar ao fornecedor." }, 409);
  const statusGravado = alterouPedidoAprovado ? "rascunho" : novoStatus;
  const camposGravados = objeto(corpo.campos ?? parse(atual.fields_json, {}));
  if (alterouPedidoAprovado) delete camposGravados.purchaseApprovalFlow;

  // Aprovar grava o total do momento. É esse retrato que `aprovacaoAindaVale`
  // usa depois para denunciar pedido editado após a aprovação.
  const aprovando = novoStatus === "aprovado" && atual.status !== "aprovado";
  const gravacoes = [
    env.DB.prepare(
      `UPDATE todogreen_purchase_orders
          SET supplier_party_id = ?, warehouse_id = ?, cost_center_id = ?, status = ?,
              approval_status = ?, approved_by = ?, approved_at = ?, approved_total = ?,
              decision_note = ?, freight = ?, taxes = ?, discount = ?,
              payment_term_days = ?, expected_at = ?, notes = ?, fields_json = ?,
              revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(
      texto(corpo.supplierPartyId ?? atual.supplier_party_id, 120),
      texto(corpo.warehouseId ?? atual.warehouse_id, 120),
      texto(corpo.costCenterId ?? atual.cost_center_id, 120),
      statusGravado,
      alterouPedidoAprovado ? "pendente" : (aprovando ? "aprovada" : atual.approval_status),
      alterouPedidoAprovado ? null : (aprovando ? user.id : atual.approved_by),
      alterouPedidoAprovado ? null : (aprovando ? agora : atual.approved_at),
      aprovando ? totais.total : atual.approved_total,
      texto(corpo.notaDecisao ?? atual.decision_note, 2000),
      Math.max(0, numero(corpo.freight ?? atual.freight)),
      Math.max(0, numero(corpo.taxes ?? atual.taxes)),
      Math.max(0, numero(corpo.discount ?? atual.discount)),
      Math.max(0, Math.trunc(numero(corpo.paymentTermDays ?? atual.payment_term_days))),
      texto(corpo.esperadoEm ?? atual.expected_at, 20) || null,
      texto(corpo.notas ?? atual.notes, 4000),
      JSON.stringify(camposGravados),
      user.id, agora, id, TENANT_ID, access.ownerId, revisao,
    ),
  ];

  if (mexeNasLinhas) {
    gravacoes.push(
      env.DB.prepare(
        "DELETE FROM todogreen_purchase_order_items WHERE order_id = ? AND workspace_owner_id = ?",
      ).bind(id, access.ownerId),
      ...gravarLinhas(env, access.ownerId, id, linhas, agora),
    );
  }

  const resultado = await env.DB.batch(gravacoes);
  if (!resultado?.[0]?.meta?.changes)
    return json({
      error: "Este pedido mudou enquanto você editava. Recarregue para ver a versão atual.",
    }, 409);

  return json({ registro: await lerPedido(env, access.ownerId, id) });
};

// ---------------------------------------------------------------------------
// Recebimento — o ponto com efeito
// ---------------------------------------------------------------------------

const fingerprintDoRecebimento = async (pedidoId, corpo) => {
  const linhas = lista(corpo.linhas).map((linha) => ({
    id: texto(linha.orderItemId, 120), quantidade: Number(linha.quantidade ?? linha.quantity),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const dados = JSON.stringify([pedidoId, texto(corpo.warehouseId, 120),
    texto(corpo.kind) === "devolucao" ? "devolucao" : "recebimento",
    texto(corpo.receivedAt, 40), texto(corpo.numeroDocumento, 60),
    texto(corpo.invoiceNumber, 60), texto(corpo.invoiceKey, 44), linhas]);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dados));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const criarRecebimento = async (env, access, user, corpo) => {
  const erro = validateReceipt(corpo);
  if (erro) return json({ error: erro }, 400);

  const pedido = await lerPedido(env, access.ownerId, texto(corpo.orderId, 120));
  if (!pedido) return json({ error: "Pedido não encontrado neste espaço." }, 404);
  const fingerprint = await fingerprintDoRecebimento(pedido.id, corpo);
  const buscarRecebimentoRepetido = () => env.DB.prepare(
    `SELECT * FROM todogreen_goods_receipts
      WHERE tenant_id=? AND workspace_owner_id=? AND order_id=?
        AND json_extract(fields_json,'$.requestFingerprint')=? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId, pedido.id, fingerprint).first();
  const jaGravado = await buscarRecebimentoRepetido();
  if (jaGravado) return json({ registro: recebimentoDaLinha(jaGravado),
    movimentos: 0, contaGerada: Boolean(jaGravado.financial_entry_id), pedido }, 200);
  // Receber contra pedido em rascunho significaria que a mercadoria chegou antes
  // de alguém aprovar a compra. Isso acontece na vida real, mas tem de ser
  // resolvido aprovando o pedido, não ignorando a aprovação.
  if (!["aprovado", "enviado"].includes(pedido.status))
    return json({
      error: `Não é possível receber contra um pedido ${pedido.status}. Aprove e envie o pedido primeiro.`,
    }, 409);
  if (!pedido.aprovacaoValida)
    return json({ error: "O pedido mudou após a aprovação. Reenvie para a alçada antes de receber." }, 409);

  const kind = texto(corpo.kind) === "devolucao" ? "devolucao" : "recebimento";
  const linhasErro = validarLinhasDoRecebimento(
    lista(corpo.linhas), pedido.linhas, pedido.recebimentos, kind,
  );
  if (linhasErro) return json({ error: linhasErro }, 409);

  const deposito = texto(corpo.warehouseId, 120);
  const existeDeposito = await env.DB.prepare(
    `SELECT id FROM todogreen_warehouses
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(deposito, TENANT_ID, access.ownerId).first();
  if (!existeDeposito) return json({ error: "Depósito não encontrado neste espaço." }, 404);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  const recebimento = {
    id,
    orderId: pedido.id,
    warehouseId: deposito,
    kind,
    linhas: lista(corpo.linhas),
    receivedAt: texto(corpo.receivedAt, 40),
    documentNumber: texto(corpo.numeroDocumento, 60),
    invoiceNumber: texto(corpo.invoiceNumber, 60),
  };

  const movimentos = recebimentoParaMovimentos(recebimento, pedido.linhas);
  if (kind === "devolucao") {
    const porItem = new Map();
    for (const movimento of movimentos) {
      porItem.set(movimento.itemId, (porItem.get(movimento.itemId) || 0) + movimento.quantity);
    }
    for (const [itemId, quantidade] of porItem) {
      const saldo = await saldoDisponivel(env, access.ownerId, itemId, deposito);
      if (saldo + 0.0001 < quantidade)
        return json({ error: `Estoque insuficiente para devolver. Saldo disponível: ${saldo}.` }, 409);
    }
  }
  // O título só é criado quando quem recebe pede. Conta a pagar nascendo sozinha
  // é dinheiro aparecendo sem decisão — o mesmo princípio do `postToFinance` do
  // pedido de venda no monólito.
  const conta = corpo.gerarConta === false
    ? null
    : recebimentoParaConta(recebimento, pedido, pedido.linhas, { categoria: corpo.categoria });
  if (conta) {
    const bloqueio = await bloqueioDeCompetencia(env, access, { mesReferencia: conta.mesReferencia });
    if (bloqueio) return json({ error: bloqueio }, 409);
  }
  const contaId = conta ? crypto.randomUUID() : "";

  const gravacoes = [
    env.DB.prepare(
      `INSERT INTO todogreen_goods_receipts
         (id, tenant_id, workspace_owner_id, document_number, order_id, warehouse_id, kind,
          invoice_number, invoice_key, lines_json, received_at, stock_posted_at,
          financial_entry_id, notes, fields_json, revision,
          created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
    ).bind(
      id, TENANT_ID, access.ownerId, recebimento.documentNumber, pedido.id, deposito, kind,
      recebimento.invoiceNumber, texto(corpo.invoiceKey, 44).replace(/\D+/g, ""),
      JSON.stringify(recebimento.linhas), recebimento.receivedAt,
      // Marcado na mesma gravação dos movimentos: é o que torna o lançamento
      // idempotente e auditável.
      movimentos.length ? agora : null,
      contaId, texto(corpo.notas, 4000), JSON.stringify({ ...objeto(corpo.campos), requestFingerprint: fingerprint }),
      user.id, user.id, agora, agora,
    ),
  ];

  for (const movimento of movimentos) {
    gravacoes.push(
      env.DB.prepare(
        `INSERT INTO todogreen_stock_movements
           (id, tenant_id, workspace_owner_id, item_id, warehouse_id, kind, quantity,
            unit_cost, origin_type, origin_id, origin_number, transfer_group,
            occurred_at, notes, fields_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, '{}', ?, ?)`,
      ).bind(
        crypto.randomUUID(), TENANT_ID, access.ownerId, movimento.itemId, movimento.warehouseId,
        movimento.kind, movimento.quantity, movimento.unitCost,
        movimento.originType, movimento.originId, movimento.originNumber,
        movimento.occurredAt, kind === "devolucao" ? "Devolução ao fornecedor" : "Recebimento de compra",
        user.id, agora,
      ),
    );
  }

  if (conta) {
    gravacoes.push(
      env.DB.prepare(
        `INSERT INTO todogreen_financial_entries
           (id, tenant_id, workspace_owner_id, kind, client_id, product_id, scenario_id,
            category, description, amount, reference_month, status, fields_json,
            due_date, paid_amount, counterparty, party_id, document_number, cost_center,
            budget_code, payment_method, competence_date, contract_id, invoice_status,
            revision, created_by, updated_by, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, 'cost', '', '', '', ?, ?, ?, ?, 'confirmed', ?,
                 ?, 0, ?, ?, ?, ?, '', '', ?, '', ?, 1, ?, ?, ?, ?, NULL)`,
      ).bind(
        contaId, TENANT_ID, access.ownerId, conta.categoria, conta.descricao,
        conta.valor, conta.mesReferencia, JSON.stringify(conta.campos),
        conta.vencimentoEm || null, conta.contraparte, conta.partyId || "", conta.numeroDocumento,
        conta.centroCusto, conta.competenciaEm || null, conta.statusFinanceiro,
        user.id, user.id, agora, agora,
      ),
    );
  }

  try {
    await env.DB.batch(gravacoes);
  } catch (error) {
    // A restrição única também protege duas tentativas simultâneas do mesmo POST.
    const existente = await buscarRecebimentoRepetido();
    if (!existente) throw error;
    return json({ registro: recebimentoDaLinha(existente), movimentos: 0,
      contaGerada: Boolean(existente.financial_entry_id), pedido: await lerPedido(env, access.ownerId, pedido.id) }, 200);
  }

  const row = await env.DB.prepare("SELECT * FROM todogreen_goods_receipts WHERE id = ?").bind(id).first();
  return json({
    registro: recebimentoDaLinha(row),
    movimentos: movimentos.length,
    contaGerada: Boolean(conta),
    pedido: await lerPedido(env, access.ownerId, pedido.id),
  }, 201);
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenPurchasing(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, purchasing, [recurso], [id]
  const partes = url.pathname.split("/").filter(Boolean);
  const recurso = texto(partes[3], 40);
  const id = texto(partes[4], 120);

  if (request.method === "GET") {
    if (recurso === "requisicoes") return listarRequisicoes(env, access, url);
    if (recurso === "pedidos") {
      if (id) {
        const pedido = await lerPedido(env, access.ownerId, id);
        return pedido ? json({ registro: pedido }) : json({ error: "Pedido não encontrado." }, 404);
      }
      return listarPedidos(env, access, url);
    }
    return json({ error: "Recurso desconhecido." }, 404);
  }

  const corpo = await request.json().catch(() => ({}));

  // Requisitar é de qualquer área: pedir não gasta, quem gasta é o pedido. Por
  // isso CRIAR uma requisição é aberto a qualquer papel da vertical — a
  // solicitação nasce e aparece para Suprimentos. Enviar/reenviar a própria
  // requisição a Suprimentos (status "pendente") também é do requisitante: é
  // seguro porque "pendente" só é alcançável de "rascunho" ou "devolvida" pela
  // máquina de estados — nunca dá aprovação. A triagem (aprovar, recusar,
  // devolver, direcionar à gestão), os pedidos e os recebimentos seguem
  // restritos a purchase:manage logo abaixo.
  if (request.method === "POST" && recurso === "requisicoes")
    return criarRequisicao(env, access, user, corpo);
  if (request.method === "PATCH" && id && recurso === "requisicoes" && statusDoCorpo(corpo) === "pendente")
    return atualizarRequisicao(env, access, user, id, corpo);

  if (!podeNaVertical(access, "purchase:manage"))
    return json({ error: "Seu papel não pode movimentar compras." }, 403);

  if (request.method === "POST") {
    if (recurso === "pedidos") return criarPedido(env, access, user, corpo);
    if (recurso === "recebimentos") return criarRecebimento(env, access, user, corpo);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  if (request.method === "PATCH" && id) {
    if (recurso === "requisicoes") return atualizarRequisicao(env, access, user, id, corpo);
    if (recurso === "pedidos") return atualizarPedido(env, access, user, id, corpo);
  }

  // Recebimento não é editado: ele já gerou movimento de estoque e título.
  // Corrigir é lançar uma devolução, que fica visível ao lado do recebimento.
  if (["PATCH", "PUT", "DELETE"].includes(request.method) && recurso === "recebimentos")
    return json({
      error: "Recebimento não é editado nem apagado. Lance uma devolução.",
    }, 405);

  return json({ error: "Método não permitido." }, 405);
}
