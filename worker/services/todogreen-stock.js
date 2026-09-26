// ===== Estoque: o movimento entra, o saldo é consultado =====
//
// Não é CRUD, e por isso não cabe no caminho genérico de
// `todogreen-vertical-records.js`. Três coisas mudam:
//
//   1. Movimento é INSERT sempre. Não tem PATCH nem DELETE — errou, lança o
//      ajuste contrário. É o que permite auditar o saldo em vez de acreditar
//      nele.
//
//   2. Saída acima do saldo é RECUSADA, não aparada. O catálogo do monólito faz
//      `Math.max(0, stock - quantidade)` e engole a diferença; aqui a resposta é
//      409 com o saldo disponível, porque "vendi mais do que tinha" é
//      informação, não arredondamento.
//
//   3. A checagem de saldo e a gravação são UMA instrução. Ler o saldo e depois
//      inserir deixaria duas saídas simultâneas passarem pela mesma conferência
//      — as duas leriam saldo 10 e as duas gravariam 8. O `INSERT ... SELECT ...
//      WHERE (SELECT SUM(...)) >= ?` resolve isso no banco: quando a condição
//      falha, zero linha é inserida e `meta.changes` conta 0.
//
// Transferência é o par saída+entrada com o mesmo `transfer_group`, gravado por
// `env.DB.batch()`. Como um registro só, o saldo por depósito precisaria de um
// caso especial em toda consulta.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  divergenciaDeContagem,
  validateMovement,
  validateTransfer,
} from "../../src/features/logistics/stockDomain.js";

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

const movimentoDaLinha = (row) => ({
  id: row.id,
  itemId: row.item_id,
  warehouseId: row.warehouse_id,
  kind: row.kind,
  quantity: row.quantity,
  unitCost: row.unit_cost,
  originType: row.origin_type,
  originId: row.origin_id,
  originNumber: row.origin_number,
  transferGroup: row.transfer_group,
  occurredAt: row.occurred_at,
  notes: row.notes,
  campos: parse(row.fields_json, {}),
  criadoPor: row.created_by,
  createdAt: row.created_at,
});

// O saldo, somado no banco. Trazer os movimentos para o Worker e somar em JS
// funcionaria com mil linhas e pararia de funcionar com um milhão — e o
// `SUM` com `CASE` é a mesma regra de sinal de `SINAL_DO_MOVIMENTO`, só que
// expressa em SQL.
const SOMA_ASSINADA = `SUM(CASE
    WHEN kind IN ('entrada', 'ajuste_entrada') THEN quantity
    WHEN kind IN ('saida', 'ajuste_saida') THEN -quantity
    ELSE 0
  END)`;

export const saldoDisponivel = async (env, ownerId, itemId, warehouseId) => {
  const row = await env.DB.prepare(
    `SELECT COALESCE(${SOMA_ASSINADA}, 0) AS saldo
       FROM todogreen_stock_movements
      WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?`,
  )
    .bind(TENANT_ID, ownerId, itemId, warehouseId)
    .first();
  return numero(row?.saldo);
};

// Confirma que material e depósito existem NESTE espaço antes de movimentar.
// Sem isso, um id digitado errado criaria saldo de um material que não existe, e
// o erro só apareceria no inventário.
const cadastroValido = async (env, ownerId, itemId, warehouseId) => {
  const [item, deposito] = await Promise.all([
    env.DB.prepare(
      `SELECT id FROM todogreen_items
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(itemId, TENANT_ID, ownerId).first(),
    env.DB.prepare(
      `SELECT id FROM todogreen_warehouses
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(warehouseId, TENANT_ID, ownerId).first(),
  ]);
  if (!item) return "Material não encontrado neste espaço.";
  if (!deposito) return "Depósito não encontrado neste espaço.";
  return "";
};

const COLUNAS_DO_MOVIMENTO = `(id, tenant_id, workspace_owner_id, item_id, warehouse_id, kind,
   quantity, unit_cost, origin_type, origin_id, origin_number, transfer_group,
   occurred_at, notes, fields_json, created_by, created_at)`;

const valoresDoMovimento = (id, ownerId, corpo, userId, agora) => [
  id,
  TENANT_ID,
  ownerId,
  texto(corpo.itemId, 120),
  texto(corpo.warehouseId, 120),
  texto(corpo.kind, 40),
  Math.abs(numero(corpo.quantity)),
  Math.max(0, numero(corpo.unitCost)),
  texto(corpo.originType, 40),
  texto(corpo.originId, 120),
  texto(corpo.originNumber, 60),
  texto(corpo.transferGroup, 120),
  texto(corpo.occurredAt, 40),
  texto(corpo.notes, 1000),
  JSON.stringify(objeto(corpo.campos)),
  userId,
  agora,
];

// A gravação condicional. Quando o movimento tira estoque, o INSERT só acontece
// se o saldo cobrir a quantidade — conferido dentro da MESMA instrução, que é o
// único jeito de duas saídas simultâneas não passarem as duas.
const gravarMovimento = async (env, access, user, corpo) => {
  // Só a SAÍDA operacional é conferida contra o saldo. `ajuste_saida` existe
  // justamente para corrigir o saldo — inclusive para baixo, inclusive deixando
  // negativo. Barrá-lo por falta de saldo impediria de registrar a falta que a
  // contagem acabou de encontrar, e o saldo negativo é o sinal visível de que
  // há lançamento faltando (melhor do que um zero que finge estar certo).
  const confereSaldo = texto(corpo.kind, 40) === "saida";
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  const valores = valoresDoMovimento(id, access.ownerId, corpo, user.id, agora);
  const marcas = valores.map(() => "?").join(", ");

  if (!confereSaldo) {
    await env.DB.prepare(
      `INSERT INTO todogreen_stock_movements ${COLUNAS_DO_MOVIMENTO} VALUES (${marcas})`,
    ).bind(...valores).run();
    return { ok: true, id };
  }

  const quantidade = Math.abs(numero(corpo.quantity));
  const meta = await env.DB.prepare(
    `INSERT INTO todogreen_stock_movements ${COLUNAS_DO_MOVIMENTO}
     SELECT ${marcas}
      WHERE (
        SELECT COALESCE(${SOMA_ASSINADA}, 0)
          FROM todogreen_stock_movements
         WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?
      ) >= ?`,
  )
    .bind(
      ...valores,
      TENANT_ID,
      access.ownerId,
      texto(corpo.itemId, 120),
      texto(corpo.warehouseId, 120),
      quantidade,
    )
    .run();

  if (!meta?.meta?.changes) return { ok: false };
  return { ok: true, id };
};

const lerMovimento = async (env, ownerId, id) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_stock_movements
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(id, TENANT_ID, ownerId).first();
  return row ? movimentoDaLinha(row) : null;
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const listarMovimentos = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const itemId = texto(url.searchParams.get("item"), 120);
  const warehouseId = texto(url.searchParams.get("deposito"), 120);
  const filtros = [
    itemId ? "AND item_id = ?" : "",
    warehouseId ? "AND warehouse_id = ?" : "",
  ].join(" ");
  const params = [TENANT_ID, access.ownerId, ...(itemId ? [itemId] : []), ...(warehouseId ? [warehouseId] : [])];
  const base = `FROM todogreen_stock_movements
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtros}`;

  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT * ${base} ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map(movimentoDaLinha),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

// Saldos agregados por material e depósito, somados no banco. É a resposta que
// a tela de estoque abre.
const listarSaldos = async (env, access) => {
  const { results } = await env.DB.prepare(
    `SELECT m.item_id AS itemId, m.warehouse_id AS warehouseId,
            COALESCE(${SOMA_ASSINADA}, 0) AS saldo
       FROM todogreen_stock_movements m
      WHERE m.tenant_id = ? AND m.workspace_owner_id = ?
      GROUP BY m.item_id, m.warehouse_id
      HAVING saldo <> 0
      ORDER BY m.item_id`,
  ).bind(TENANT_ID, access.ownerId).all();
  return json({ saldos: results || [] });
};

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

const criarMovimento = async (env, access, user, corpo) => {
  const erro = validateMovement(corpo);
  if (erro) return json({ error: erro }, 400);

  const cadastro = await cadastroValido(env, access.ownerId, texto(corpo.itemId, 120), texto(corpo.warehouseId, 120));
  if (cadastro) return json({ error: cadastro }, 404);

  const resultado = await gravarMovimento(env, access, user, corpo);
  if (!resultado.ok) {
    const saldo = await saldoDisponivel(
      env, access.ownerId, texto(corpo.itemId, 120), texto(corpo.warehouseId, 120),
    );
    return json({
      error: `Saldo insuficiente: há ${saldo} em estoque neste depósito.`,
      saldoDisponivel: saldo,
    }, 409);
  }
  return json({ registro: await lerMovimento(env, access.ownerId, resultado.id) }, 201);
};

// Transferência: as duas pontas na mesma `batch`, que o D1 executa como
// transação. Gravar a saída e depois a entrada em chamadas separadas deixaria
// estoque desaparecido no meio se a segunda falhasse.
const criarTransferencia = async (env, access, user, corpo) => {
  const erro = validateTransfer(corpo);
  if (erro) return json({ error: erro }, 400);

  const origem = texto(corpo.fromWarehouseId, 120);
  const destino = texto(corpo.toWarehouseId, 120);
  const itemId = texto(corpo.itemId, 120);

  for (const deposito of [origem, destino]) {
    const cadastro = await cadastroValido(env, access.ownerId, itemId, deposito);
    if (cadastro) return json({ error: cadastro }, 404);
  }

  const quantidade = Math.abs(numero(corpo.quantity));
  const saldo = await saldoDisponivel(env, access.ownerId, itemId, origem);
  if (saldo < quantidade)
    return json({
      error: `Saldo insuficiente na origem: há ${saldo} em estoque.`,
      saldoDisponivel: saldo,
    }, 409);

  const grupo = crypto.randomUUID();
  const agora = new Date().toISOString();
  const ocorridoEm = texto(corpo.occurredAt, 40) || agora;
  const comum = {
    itemId,
    quantity: quantidade,
    occurredAt: ocorridoEm,
    notes: corpo.notes,
    originType: "transferencia",
    originId: grupo,
    transferGroup: grupo,
    campos: corpo.campos,
  };

  const saidaId = crypto.randomUUID();
  const entradaId = crypto.randomUUID();
  const marcas = valoresDoMovimento(saidaId, access.ownerId, comum, user.id, agora).map(() => "?").join(", ");
  const sql = `INSERT INTO todogreen_stock_movements ${COLUNAS_DO_MOVIMENTO} VALUES (${marcas})`;

  // A saída também é condicional, para a transferência não furar o saldo se
  // outra saída entrar entre a conferência acima e a gravação.
  const valoresSaida = valoresDoMovimento(
    saidaId, access.ownerId, { ...comum, warehouseId: origem, kind: "saida" }, user.id, agora,
  );
  const condicional = `INSERT INTO todogreen_stock_movements ${COLUNAS_DO_MOVIMENTO}
     SELECT ${marcas}
      WHERE (
        SELECT COALESCE(${SOMA_ASSINADA}, 0)
          FROM todogreen_stock_movements
         WHERE tenant_id = ? AND workspace_owner_id = ? AND item_id = ? AND warehouse_id = ?
      ) >= ?`;

  const resultado = await env.DB.batch([
    env.DB.prepare(condicional).bind(
      ...valoresSaida, TENANT_ID, access.ownerId, itemId, origem, quantidade,
    ),
    env.DB.prepare(sql).bind(
      ...valoresDoMovimento(
        entradaId, access.ownerId, { ...comum, warehouseId: destino, kind: "entrada", unitCost: corpo.unitCost },
        user.id, agora,
      ),
    ),
  ]);

  // Se a saída não entrou, a entrada não pode valer — o batch é atômico, mas a
  // condição do SELECT não faz o batch falhar, só não insere. Sem esta
  // conferência, uma transferência sem saldo criaria estoque do nada.
  if (!resultado?.[0]?.meta?.changes) {
    await env.DB.prepare("DELETE FROM todogreen_stock_movements WHERE transfer_group = ?").bind(grupo).run();
    const atual = await saldoDisponivel(env, access.ownerId, itemId, origem);
    return json({
      error: `Saldo insuficiente na origem: há ${atual} em estoque.`,
      saldoDisponivel: atual,
    }, 409);
  }

  return json({
    registro: { transferGroup: grupo, itemId, origem, destino, quantidade, occurredAt: ocorridoEm },
  }, 201);
};

// ---------------------------------------------------------------------------
// Inventário
// ---------------------------------------------------------------------------

const contagemDaLinha = (row) => ({
  id: row.id,
  numeroDocumento: row.document_number,
  warehouseId: row.warehouse_id,
  situacao: row.status,
  linhas: parse(row.lines_json, []),
  contadoEm: row.counted_at,
  fechadoEm: row.closed_at || "",
  notas: row.notes,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const listarContagens = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const base = `FROM todogreen_stock_counts
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`;
  const params = [TENANT_ID, access.ownerId];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY counted_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map(contagemDaLinha),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

// Abrir a contagem grava o saldo do sistema de cada linha NAQUELE momento. Sem
// esse retrato, fechar amanhã compararia o contado de hoje com o saldo de
// amanhã e acusaria divergência que não existiu.
const abrirContagem = async (env, access, user, corpo) => {
  const warehouseId = texto(corpo.warehouseId, 120);
  if (!warehouseId) return json({ error: "Informe o depósito da contagem." }, 400);

  const deposito = await env.DB.prepare(
    `SELECT id FROM todogreen_warehouses
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(warehouseId, TENANT_ID, access.ownerId).first();
  if (!deposito) return json({ error: "Depósito não encontrado neste espaço." }, 404);

  const { results } = await env.DB.prepare(
    `SELECT item_id AS itemId, COALESCE(${SOMA_ASSINADA}, 0) AS saldo
       FROM todogreen_stock_movements
      WHERE tenant_id = ? AND workspace_owner_id = ? AND warehouse_id = ?
      GROUP BY item_id`,
  ).bind(TENANT_ID, access.ownerId, warehouseId).all();

  const informadas = Array.isArray(corpo.linhas) ? corpo.linhas : [];
  const porItem = new Map(informadas.map((linha) => [texto(linha?.itemId, 120), linha]));
  const doSistema = (results || []).map((linha) => ({
    itemId: linha.itemId,
    saldoSistema: numero(linha.saldo),
    contado: porItem.get(linha.itemId)?.contado ?? null,
  }));
  // Item informado que não tem movimento nenhum ainda entra com saldo zero: é
  // exatamente o caso de "achei no galpão algo que o sistema não conhece".
  for (const [itemId, linha] of porItem) {
    if (!itemId || doSistema.some((l) => l.itemId === itemId)) continue;
    doSistema.push({ itemId, saldoSistema: 0, contado: linha?.contado ?? null });
  }

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_stock_counts
       (id, tenant_id, workspace_owner_id, document_number, warehouse_id, status,
        lines_json, counted_at, notes, fields_json, revision,
        created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      id, TENANT_ID, access.ownerId, texto(corpo.numeroDocumento, 60), warehouseId,
      JSON.stringify(doSistema), texto(corpo.contadoEm, 40) || agora,
      texto(corpo.notas, 1000), JSON.stringify(objeto(corpo.campos)),
      user.id, user.id, agora, agora,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM todogreen_stock_counts WHERE id = ?").bind(id).first();
  return json({ registro: contagemDaLinha(row) }, 201);
};

const atualizarContagem = async (env, access, user, id, corpo) => {
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao <= 0)
    return json({ error: "Informe a revisão da contagem que você leu." }, 400);

  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_stock_counts
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Contagem não encontrada." }, 404);
  if (atual.status !== "aberta")
    return json({ error: "Esta contagem já foi encerrada e não muda mais." }, 409);

  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : parse(atual.lines_json, []);
  const agora = new Date().toISOString();
  const meta = await env.DB.prepare(
    `UPDATE todogreen_stock_counts
        SET lines_json = ?, notes = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(
      JSON.stringify(linhas), texto(corpo.notas ?? atual.notes, 1000),
      user.id, agora, id, TENANT_ID, access.ownerId, revisao,
    )
    .run();

  if (!meta?.meta?.changes)
    return json({
      error: "Esta contagem mudou enquanto você editava. Recarregue para ver a versão atual.",
    }, 409);

  const row = await env.DB.prepare("SELECT * FROM todogreen_stock_counts WHERE id = ?").bind(id).first();
  return json({ registro: contagemDaLinha(row) });
};

// Fechar a contagem transforma cada divergência num movimento de ajuste. O
// ajuste é um movimento como qualquer outro — é assim que a correção fica
// auditável, em vez de o saldo simplesmente mudar de valor.
const fecharContagem = async (env, access, user, id) => {
  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_stock_counts
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Contagem não encontrada." }, 404);
  if (atual.status !== "aberta")
    return json({ error: "Esta contagem já foi encerrada." }, 409);

  const divergencias = divergenciaDeContagem(parse(atual.lines_json, []))
    .filter((linha) => linha.ajuste);
  const agora = new Date().toISOString();
  const marcas = valoresDoMovimento("x", access.ownerId, {}, user.id, agora).map(() => "?").join(", ");
  const sql = `INSERT INTO todogreen_stock_movements ${COLUNAS_DO_MOVIMENTO} VALUES (${marcas})`;

  // O ajuste NÃO é condicional ao saldo: ele existe justamente para corrigir o
  // saldo, inclusive para baixo, e recusá-lo por falta de saldo impediria de
  // registrar a falta que a contagem acabou de encontrar.
  const gravacoes = divergencias.map((linha) =>
    env.DB.prepare(sql).bind(
      ...valoresDoMovimento(crypto.randomUUID(), access.ownerId, {
        itemId: linha.itemId,
        warehouseId: atual.warehouse_id,
        kind: linha.ajuste.kind,
        quantity: linha.ajuste.quantity,
        originType: "inventario",
        originId: id,
        originNumber: atual.document_number,
        occurredAt: atual.counted_at,
        notes: "Ajuste de inventário",
      }, user.id, agora),
    ),
  );

  gravacoes.push(
    env.DB.prepare(
      `UPDATE todogreen_stock_counts
          SET status = 'fechada', closed_at = ?, revision = revision + 1,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'aberta'`,
    ).bind(agora, user.id, agora, id, TENANT_ID, access.ownerId),
  );

  await env.DB.batch(gravacoes);
  const row = await env.DB.prepare("SELECT * FROM todogreen_stock_counts WHERE id = ?").bind(id).first();
  return json({ registro: contagemDaLinha(row), ajustes: divergencias.length });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenStock(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, stock, [recurso], [id], [acao]
  const partes = url.pathname.split("/").filter(Boolean);
  const recurso = texto(partes[3], 40);
  const id = texto(partes[4], 120);
  const acao = texto(partes[5], 40);

  if (request.method === "GET") {
    if (recurso === "saldos") return listarSaldos(env, access);
    if (recurso === "contagens") return listarContagens(env, access, url);
    if (recurso === "movimentos" || !recurso) return listarMovimentos(env, access, url);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  // Leitura segue o vínculo; escrita exige permissão. É a mesma assimetria do
  // caminho genérico das coleções.
  if (!podeNaVertical(access, "stock:manage"))
    return json({ error: "Seu papel não pode movimentar o estoque." }, 403);

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST") {
    if (recurso === "movimentos") return criarMovimento(env, access, user, corpo);
    if (recurso === "transferencias") return criarTransferencia(env, access, user, corpo);
    if (recurso === "contagens") {
      if (id && acao === "fechar") return fecharContagem(env, access, user, id);
      if (!id) return abrirContagem(env, access, user, corpo);
    }
    return json({ error: "Recurso desconhecido." }, 404);
  }

  if (request.method === "PATCH" && recurso === "contagens" && id)
    return atualizarContagem(env, access, user, id, corpo);

  // Movimento não tem PATCH nem DELETE de propósito: errou, lança o ajuste
  // contrário. As duas linhas ficam visíveis, e é isso que permite auditar.
  if (["PATCH", "DELETE", "PUT"].includes(request.method) && recurso === "movimentos")
    return json({
      error: "Movimento de estoque não é editado nem apagado. Lance o ajuste contrário.",
    }, 405);

  return json({ error: "Método não permitido." }, 405);
}
