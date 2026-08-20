// ===== Ordem de serviço: material que sai do estoque, hora que vira custo =====
//
// Serviço próprio porque tem efeito e tem regra:
//
//   1. CONSUMIR MATERIAL é uma saída de estoque de verdade. Passa pela mesma
//      conferência de saldo do handler de estoque — consumir o que não tem é o
//      mesmo erro de vender o que não tem, e a conferência acontece na MESMA
//      instrução que grava.
//
//   2. O CUSTO UNITÁRIO é copiado do custo médio do estoque no momento do
//      consumo. Recalcular depois faria o custo do serviço mudar quando o preço
//      do fornecedor mudasse, meses após o trabalho ter sido feito.
//
//   3. O AVANÇO é derivado dos apontamentos, nunca gravado. Um percentual em
//      coluna diria 100% enquanto as horas dizem 40%, e ninguém saberia qual dos
//      dois está certo.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  avancoDaOrdem,
  consumoParaMovimento,
  custoDaOrdem,
  devolucaoParaMovimento,
  podeMudarStatus,
  prazoDaOrdem,
  resumoDasOrdens,
  validateMaterialConsumption,
  validateServiceOrder,
  validateTimeEntry,
} from "../../src/features/logistics/serviceOrderDomain.js";

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

// Estimativa ausente continua ausente no banco (NULL), não zero. "Não estimamos"
// e "estimamos zero" são coisas diferentes, e o relatório precisa distinguir.
const estimativaParaBanco = (valor) =>
  valor === null || valor === undefined || valor === "" ? null : numero(valor);

// A mesma regra de sinal do estoque, em SQL. Duas convenções de sinal no produto
// seriam duas chances de somar errado.
const SOMA_ASSINADA = `SUM(CASE
    WHEN kind IN ('entrada', 'ajuste_entrada') THEN quantity
    WHEN kind IN ('saida', 'ajuste_saida') THEN -quantity
    ELSE 0
  END)`;

const ordemDaLinha = (row) => ({
  id: row.id,
  documentNumber: row.document_number,
  title: row.title,
  description: row.description,
  clientId: row.client_id,
  operationId: row.operation_id,
  opportunityId: row.opportunity_id,
  costCenterId: row.cost_center_id,
  warehouseId: row.warehouse_id,
  responsibleUserId: row.responsible_user_id,
  kind: row.kind,
  priority: row.priority,
  status: row.status,
  // NULL volta como null, não como 0 — é o que preserva "não estimamos".
  estimatedHours: row.estimated_hours === null ? null : row.estimated_hours,
  estimatedCost: row.estimated_cost === null ? null : row.estimated_cost,
  scheduledStart: row.scheduled_start || "",
  scheduledEnd: row.scheduled_end || "",
  startedAt: row.started_at || "",
  finishedAt: row.finished_at || "",
  notes: row.notes,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const materialDaLinha = (row) => ({
  id: row.id,
  orderId: row.order_id,
  itemId: row.item_id,
  quantity: row.quantity,
  unitCost: row.unit_cost,
  stockMovementId: row.stock_movement_id,
  consumedAt: row.consumed_at,
  notes: row.notes,
  criadoEm: row.created_at,
});

const apontamentoDaLinha = (row) => ({
  id: row.id,
  orderId: row.order_id,
  userId: row.user_id,
  personName: row.person_name,
  hours: row.hours,
  hourlyCost: row.hourly_cost,
  workedOn: row.worked_on,
  description: row.description,
  billable: row.billable === 1,
  criadoEm: row.created_at,
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const filhosDaOrdem = async (env, ownerId, orderId) => {
  const [materiais, apontamentos] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM todogreen_service_order_materials
        WHERE order_id = ? AND tenant_id = ? AND workspace_owner_id = ?
        ORDER BY consumed_at, created_at`,
    ).bind(orderId, TENANT_ID, ownerId).all(),
    env.DB.prepare(
      `SELECT * FROM todogreen_service_order_time
        WHERE order_id = ? AND tenant_id = ? AND workspace_owner_id = ?
        ORDER BY worked_on, created_at`,
    ).bind(orderId, TENANT_ID, ownerId).all(),
  ]);
  return {
    materiais: (materiais.results || []).map(materialDaLinha),
    apontamentos: (apontamentos.results || []).map(apontamentoDaLinha),
  };
};

// A ordem nunca sai daqui sem custo, avanço e prazo calculados. Obrigar a tela a
// somar isso reproduziria a regra em JSX — que é onde ela divergiria.
const ordemCompleta = async (env, ownerId, row, hoje) => {
  const ordem = ordemDaLinha(row);
  const { materiais, apontamentos } = await filhosDaOrdem(env, ownerId, ordem.id);
  return {
    ...ordem,
    materiais,
    apontamentos,
    custo: custoDaOrdem(ordem, materiais, apontamentos),
    avanco: avancoDaOrdem(ordem, apontamentos),
    prazo: prazoDaOrdem(ordem, hoje),
  };
};

const lerOrdem = async (env, ownerId, id, hoje) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_service_orders
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, ownerId).first();
  return row ? ordemCompleta(env, ownerId, row, hoje) : null;
};

const listarOrdens = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const hoje = texto(url.searchParams.get("hoje"), 10) || new Date().toISOString().slice(0, 10);
  const status = texto(url.searchParams.get("status"), 40);
  const clienteId = texto(url.searchParams.get("cliente"), 120);
  const filtros = [
    status ? "AND status = ?" : "",
    clienteId ? "AND client_id = ?" : "",
  ].join(" ");
  const params = [
    TENANT_ID, access.ownerId,
    ...(status ? [status] : []),
    ...(clienteId ? [clienteId] : []),
  ];
  const base = `FROM todogreen_service_orders
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtros}`;

  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);

  const registros = await Promise.all(
    (results || []).map((row) => ordemCompleta(env, access.ownerId, row, hoje)),
  );
  return json({
    registros,
    resumo: resumoDasOrdens(registros, hoje),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

// ---------------------------------------------------------------------------
// Ordem
// ---------------------------------------------------------------------------

const criarOrdem = async (env, access, user, corpo) => {
  const erro = validateServiceOrder(corpo);
  if (erro) return json({ error: erro }, 400);

  // Cliente e depósito, quando informados, precisam existir NESTE espaço. Um id
  // digitado errado criaria uma OS órfã que só apareceria como problema no
  // relatório de custo.
  const clienteId = texto(corpo.clientId, 120);
  if (clienteId) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(clienteId, TENANT_ID, access.ownerId).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }
  const depositoId = texto(corpo.warehouseId, 120);
  if (depositoId) {
    const deposito = await env.DB.prepare(
      `SELECT id FROM todogreen_warehouses
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(depositoId, TENANT_ID, access.ownerId).first();
    if (!deposito) return json({ error: "Depósito não encontrado neste espaço." }, 404);
  }

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_service_orders
       (id, tenant_id, workspace_owner_id, document_number, title, description,
        client_id, operation_id, opportunity_id, cost_center_id, warehouse_id,
        responsible_user_id, kind, priority, status, estimated_hours, estimated_cost,
        scheduled_start, scheduled_end, started_at, finished_at, notes, fields_json,
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      id, TENANT_ID, access.ownerId, texto(corpo.documentNumber, 60),
      texto(corpo.title, 240), texto(corpo.description, 4000),
      clienteId, texto(corpo.operationId, 120), texto(corpo.opportunityId, 120),
      texto(corpo.costCenterId, 120), depositoId,
      texto(corpo.responsibleUserId, 120) || user.id,
      ["servico", "instalacao", "manutencao", "projeto", "adequacao"].includes(texto(corpo.kind))
        ? texto(corpo.kind) : "servico",
      ["baixa", "normal", "alta", "urgente"].includes(texto(corpo.priority))
        ? texto(corpo.priority) : "normal",
      estimativaParaBanco(corpo.estimatedHours), estimativaParaBanco(corpo.estimatedCost),
      texto(corpo.scheduledStart, 20) || null, texto(corpo.scheduledEnd, 20) || null,
      texto(corpo.notes, 4000), JSON.stringify(objeto(corpo.campos)),
      user.id, user.id, agora, agora,
    )
    .run();

  return json({ registro: await lerOrdem(env, access.ownerId, id, agora.slice(0, 10)) }, 201);
};

const atualizarOrdem = async (env, access, user, id, corpo) => {
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao <= 0)
    return json({ error: "Informe a revisão da ordem que você leu." }, 400);

  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_service_orders
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Ordem não encontrada." }, 404);

  const novoStatus = texto(corpo.status, 40) || atual.status;
  if (novoStatus !== atual.status && !podeMudarStatus(atual.status, novoStatus))
    return json({ error: `Uma ordem ${atual.status} não pode ir para ${novoStatus}.` }, 409);

  const proximo = { ...ordemDaLinha(atual), ...corpo };
  const erro = validateServiceOrder(proximo);
  if (erro) return json({ error: erro }, 400);

  const agora = new Date().toISOString();
  // Entrar em execução marca o início; concluir marca o fim. As datas são
  // consequência da decisão, não campo para digitar — assim não divergem do
  // status.
  const iniciando = novoStatus === "em_execucao" && !atual.started_at;
  const concluindo = novoStatus === "concluida" && atual.status !== "concluida";
  const reabrindo = atual.status === "concluida" && novoStatus !== "concluida";

  const meta = await env.DB.prepare(
    `UPDATE todogreen_service_orders
        SET title = ?, description = ?, client_id = ?, operation_id = ?, opportunity_id = ?,
            cost_center_id = ?, warehouse_id = ?, responsible_user_id = ?, kind = ?,
            priority = ?, status = ?, estimated_hours = ?, estimated_cost = ?,
            scheduled_start = ?, scheduled_end = ?, started_at = ?, finished_at = ?,
            notes = ?, fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(
      texto(proximo.title, 240), texto(proximo.description, 4000),
      texto(proximo.clientId, 120), texto(proximo.operationId, 120),
      texto(proximo.opportunityId, 120), texto(proximo.costCenterId, 120),
      texto(proximo.warehouseId, 120), texto(proximo.responsibleUserId, 120),
      ["servico", "instalacao", "manutencao", "projeto", "adequacao"].includes(texto(proximo.kind))
        ? texto(proximo.kind) : atual.kind,
      ["baixa", "normal", "alta", "urgente"].includes(texto(proximo.priority))
        ? texto(proximo.priority) : atual.priority,
      novoStatus,
      corpo.estimatedHours === undefined ? atual.estimated_hours : estimativaParaBanco(corpo.estimatedHours),
      corpo.estimatedCost === undefined ? atual.estimated_cost : estimativaParaBanco(corpo.estimatedCost),
      texto(proximo.scheduledStart, 20) || null, texto(proximo.scheduledEnd, 20) || null,
      iniciando ? agora : atual.started_at,
      concluindo ? agora : reabrindo ? null : atual.finished_at,
      texto(proximo.notes, 4000), JSON.stringify(objeto(proximo.campos)),
      user.id, agora, id, TENANT_ID, access.ownerId, revisao,
    )
    .run();

  if (!meta?.meta?.changes)
    return json({
      error: "Esta ordem mudou enquanto você editava. Recarregue para ver a versão atual.",
    }, 409);

  return json({ registro: await lerOrdem(env, access.ownerId, id, agora.slice(0, 10)) });
};

// ---------------------------------------------------------------------------
// Consumo de material — o ponto com efeito no estoque
// ---------------------------------------------------------------------------

const custoMedioDoItem = async (env, ownerId, itemId, warehouseId) => {
  // Média ponderada das entradas daquele item no depósito. A mesma regra de
  // `custoMedioPonderado`, expressa em SQL porque trazer todos os movimentos
  // para o Worker pararia de escalar. Só as entradas formam custo: a saída
  // consome, não precifica.
  const row = await env.DB.prepare(
    `SELECT SUM(quantity * unit_cost) AS valor, SUM(quantity) AS qtd
       FROM todogreen_stock_movements
      WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?
        AND kind IN ('entrada', 'ajuste_entrada')`,
  ).bind(TENANT_ID, ownerId, itemId, warehouseId).first();
  const qtd = numero(row?.qtd);
  return qtd > 0 ? numero(row?.valor) / qtd : 0;
};

const consumirMaterial = async (env, access, user, orderId, corpo) => {
  const ordem = await lerOrdem(env, access.ownerId, orderId, new Date().toISOString().slice(0, 10));
  if (!ordem) return json({ error: "Ordem não encontrada." }, 404);
  if (["concluida", "cancelada"].includes(ordem.status))
    return json({
      error: `Não é possível consumir material numa ordem ${ordem.status}. Reabra a ordem primeiro.`,
    }, 409);

  const erro = validateMaterialConsumption(corpo);
  if (erro) return json({ error: erro }, 400);

  const itemId = texto(corpo.itemId, 120);
  const depositoId = texto(corpo.warehouseId, 120) || texto(ordem.warehouseId, 120);
  if (!depositoId) return json({ error: "Informe o depósito de onde o material sai." }, 400);

  const [item, deposito] = await Promise.all([
    env.DB.prepare(
      `SELECT id FROM todogreen_items
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(itemId, TENANT_ID, access.ownerId).first(),
    env.DB.prepare(
      `SELECT id FROM todogreen_warehouses
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(depositoId, TENANT_ID, access.ownerId).first(),
  ]);
  if (!item) return json({ error: "Material não encontrado neste espaço." }, 404);
  if (!deposito) return json({ error: "Depósito não encontrado neste espaço." }, 404);

  const consumoId = crypto.randomUUID();
  const movimentoId = crypto.randomUUID();
  const agora = new Date().toISOString();
  const quantidade = Math.abs(numero(corpo.quantity));
  // Copiado AGORA e congelado na linha. Recalcular depois faria o custo do
  // serviço mudar quando o preço do fornecedor mudasse.
  const custoUnitario = await custoMedioDoItem(env, access.ownerId, itemId, depositoId);

  const movimento = consumoParaMovimento(
    { id: consumoId, itemId, quantity: quantidade, warehouseId: depositoId, consumedAt: texto(corpo.consumedAt, 40) },
    ordem,
  );
  if (!movimento) return json({ error: "Consumo inválido." }, 400);

  // A saída é CONDICIONAL ao saldo, na mesma instrução que grava — consumir o
  // que não tem é o mesmo erro de vender o que não tem, e ler o saldo antes
  // deixaria dois consumos simultâneos passarem os dois.
  const colunas = `(id, tenant_id, workspace_owner_id, item_id, warehouse_id, kind, quantity,
     unit_cost, origin_type, origin_id, origin_number, transfer_group,
     occurred_at, notes, fields_json, created_by, created_at)`;
  const valores = [
    movimentoId, TENANT_ID, access.ownerId, itemId, depositoId, "saida", quantidade,
    0, movimento.originType, consumoId, movimento.originNumber, "",
    movimento.occurredAt, `Consumo da ordem ${ordem.documentNumber || ordem.id}`, "{}",
    user.id, agora,
  ];
  const marcas = valores.map(() => "?").join(", ");

  const resultado = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_stock_movements ${colunas}
       SELECT ${marcas}
        WHERE (
          SELECT COALESCE(${SOMA_ASSINADA}, 0)
            FROM todogreen_stock_movements
           WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?
        ) >= ?`,
    ).bind(...valores, TENANT_ID, access.ownerId, itemId, depositoId, quantidade),
    env.DB.prepare(
      `INSERT INTO todogreen_service_order_materials
         (id, tenant_id, workspace_owner_id, order_id, item_id, quantity, unit_cost,
          stock_movement_id, consumed_at, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      consumoId, TENANT_ID, access.ownerId, orderId, itemId, quantidade, custoUnitario,
      movimentoId, movimento.occurredAt, texto(corpo.notes, 1000), user.id, agora,
    ),
  ]);

  // O `batch` é atômico, mas a condição do SELECT não faz o batch falhar: ela só
  // não insere. Sem esta conferência, a linha da OS registraria um consumo que o
  // estoque não teve.
  if (!resultado?.[0]?.meta?.changes) {
    await env.DB.prepare("DELETE FROM todogreen_service_order_materials WHERE id = ?")
      .bind(consumoId).run();
    const saldo = await env.DB.prepare(
      `SELECT COALESCE(${SOMA_ASSINADA}, 0) AS saldo FROM todogreen_stock_movements
        WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?`,
    ).bind(TENANT_ID, access.ownerId, itemId, depositoId).first();
    return json({
      error: `Saldo insuficiente: há ${numero(saldo?.saldo)} em estoque neste depósito.`,
      saldoDisponivel: numero(saldo?.saldo),
    }, 409);
  }

  return json({ registro: await lerOrdem(env, access.ownerId, orderId, agora.slice(0, 10)) }, 201);
};

// Devolver o que sobrou. Entrada de volta ao depósito com o custo com que saiu, e
// a linha do consumo é reduzida — o material devolvido não custou à ordem.
const devolverMaterial = async (env, access, user, orderId, corpo) => {
  const ordem = await lerOrdem(env, access.ownerId, orderId, new Date().toISOString().slice(0, 10));
  if (!ordem) return json({ error: "Ordem não encontrada." }, 404);

  const consumoId = texto(corpo.consumoId, 120);
  const consumo = ordem.materiais.find((linha) => linha.id === consumoId);
  if (!consumo) return json({ error: "Consumo não encontrado nesta ordem." }, 404);

  const quantidade = Math.abs(numero(corpo.quantity));
  const movimento = devolucaoParaMovimento(consumo, ordem, quantidade);
  if (!movimento)
    return json({
      error: `Não é possível devolver ${quantidade} de um consumo de ${consumo.quantity}.`,
    }, 409);

  const agora = new Date().toISOString();
  const restante = Math.round((consumo.quantity - quantidade) * 10000) / 10000;
  const gravacoes = [
    env.DB.prepare(
      `INSERT INTO todogreen_stock_movements
         (id, tenant_id, workspace_owner_id, item_id, warehouse_id, kind, quantity,
          unit_cost, origin_type, origin_id, origin_number, transfer_group,
          occurred_at, notes, fields_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'entrada', ?, ?, ?, ?, ?, '', ?, ?, '{}', ?, ?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, movimento.itemId, movimento.warehouseId,
      movimento.quantity, movimento.unitCost, movimento.originType, consumoId,
      movimento.originNumber, movimento.occurredAt,
      `Devolução da ordem ${ordem.documentNumber || ordem.id}`, user.id, agora,
    ),
  ];

  // Devolveu tudo: a linha do consumo deixa de existir. Manter uma linha com
  // quantidade zero faria o relatório contar um consumo que não houve.
  gravacoes.push(
    restante > 0
      ? env.DB.prepare(
          `UPDATE todogreen_service_order_materials SET quantity = ?
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
        ).bind(restante, consumoId, TENANT_ID, access.ownerId)
      : env.DB.prepare(
          `DELETE FROM todogreen_service_order_materials
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
        ).bind(consumoId, TENANT_ID, access.ownerId),
  );

  await env.DB.batch(gravacoes);
  return json({ registro: await lerOrdem(env, access.ownerId, orderId, agora.slice(0, 10)) });
};

// ---------------------------------------------------------------------------
// Apontamento de hora
// ---------------------------------------------------------------------------

const apontarHora = async (env, access, user, orderId, corpo) => {
  const ordem = await lerOrdem(env, access.ownerId, orderId, new Date().toISOString().slice(0, 10));
  if (!ordem) return json({ error: "Ordem não encontrada." }, 404);
  if (ordem.status === "cancelada")
    return json({ error: "Não é possível apontar hora numa ordem cancelada." }, 409);

  const erro = validateTimeEntry(corpo);
  if (erro) return json({ error: erro }, 400);

  // O custo/hora vem do perfil de recurso quando existir; o informado no corpo
  // só vale como sobrescrita explícita. Sem isso, quem aponta escolheria o
  // próprio custo.
  let custoHora = Math.max(0, numero(corpo.hourlyCost));
  const userId = texto(corpo.userId, 120);
  if (!corpo.hourlyCost && userId) {
    const perfil = await env.DB.prepare(
      `SELECT hourly_cost FROM todogreen_employees
        WHERE user_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(userId, TENANT_ID, access.ownerId).first().catch(() => null);
    if (perfil) custoHora = Math.max(0, numero(perfil.hourly_cost));
  }

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_service_order_time
       (id, tenant_id, workspace_owner_id, order_id, user_id, person_name, hours,
        hourly_cost, worked_on, description, billable, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, TENANT_ID, access.ownerId, orderId, userId, texto(corpo.personName, 200),
      Math.abs(numero(corpo.hours)), custoHora, texto(corpo.workedOn, 20),
      texto(corpo.description, 1000), corpo.billable === true ? 1 : 0, user.id, agora,
    )
    .run();

  return json({ registro: await lerOrdem(env, access.ownerId, orderId, agora.slice(0, 10)) }, 201);
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenServiceOrders(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, service-orders, [id], [acao]
  const partes = url.pathname.split("/").filter(Boolean);
  const id = texto(partes[3], 120);
  const acao = texto(partes[4], 40);

  if (request.method === "GET") {
    if (!id) return listarOrdens(env, access, url);
    const hoje = texto(url.searchParams.get("hoje"), 10) || new Date().toISOString().slice(0, 10);
    const ordem = await lerOrdem(env, access.ownerId, id, hoje);
    return ordem ? json({ registro: ordem }) : json({ error: "Ordem não encontrada." }, 404);
  }

  if (!podeNaVertical(access, "production:manage"))
    return json({ error: "Seu papel não pode movimentar ordens de serviço." }, 403);

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST") {
    if (!id) return criarOrdem(env, access, user, corpo);
    if (acao === "materiais") return consumirMaterial(env, access, user, id, corpo);
    if (acao === "devolucoes") return devolverMaterial(env, access, user, id, corpo);
    if (acao === "horas") return apontarHora(env, access, user, id, corpo);
    return json({ error: "Ação desconhecida." }, 404);
  }

  if (request.method === "PATCH" && id && !acao) return atualizarOrdem(env, access, user, id, corpo);

  if (request.method === "DELETE" && id && !acao) {
    const agora = new Date().toISOString();
    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_service_orders
          SET archived_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(agora, user.id, agora, id, TENANT_ID, access.ownerId).run();
    return meta?.changes ? json({ ok: true }) : json({ error: "Ordem não encontrada." }, 404);
  }

  // Consumo e apontamento não são editados: o consumo já movimentou o estoque.
  // Corrigir consumo é devolver; corrigir hora é apontar o ajuste.
  if (["PATCH", "PUT", "DELETE"].includes(request.method) && ["materiais", "horas"].includes(acao))
    return json({
      error: "Consumo e apontamento não são editados. Devolva o material ou aponte o ajuste.",
    }, 405);

  return json({ error: "Método não permitido." }, 405);
}
