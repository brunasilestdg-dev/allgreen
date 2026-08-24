// ===== Deal Desk: a aprovação que impede =====
//
// A regra de alçada, prazo, versão e bloqueio mora em
// src/features/logistics/dealDeskDomain.js — o mesmo módulo que a tela usa.
// Duplicar a escada de alçada aqui faria a tela mostrar um nível e o servidor
// gravar outro, que é a forma mais silenciosa de um controle deixar de valer.
//
// O que este arquivo garante e a tela não tem como garantir:
//
//   • quem pede não decide, mesmo chamando a API direto;
//   • ninguém decide acima da própria alçada;
//   • o histórico só recebe INSERT — nenhum caminho aqui atualiza ou apaga
//     evento;
//   • a decisão registra a versão vigente, e revisar reabre.

import { TENANT_ID, paginacao, podeNaVertical, podeVerTodaCarteira } from "./todogreen-access.js";
import { reguaEmVigor } from "./todogreen-pricing-parameters.js";
import {
  SITUACOES,
  alcadaPorId,
  montarPedido,
  podeDecidir,
  revisarPedido,
} from "../../src/features/logistics/dealDeskDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 2000) => String(valor ?? "").trim().slice(0, max);
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};

// Exportado porque quem cria uma proposta precisa saber, com a mesma régua
// exata, se a simulação está liberada — duplicar este mapeamento lá faria os
// dois lados um dia lerem status diferentes da mesma linha.
export const doBanco = (row) => ({
  id: row.id,
  cenarioId: row.scenario_id,
  cliente: row.client_name,
  alcadaId: row.alcada_id,
  desvioPontos: row.deviation_points,
  motivoDaAlcada: row.alcada_reason,
  gatilhos: parse(row.triggers_json, []),
  justificativa: row.justification,
  solicitanteId: row.requester_id,
  situacao: row.status,
  versao: row.version,
  decisorId: row.decided_by || "",
  decisaoJustificativa: row.decision_note || "",
  decididoEm: row.decided_at || "",
  prazoEm: row.due_at,
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const eventoDoBanco = (row) => ({
  id: row.id,
  pedidoId: row.request_id,
  tipo: row.kind,
  versao: row.version,
  autorId: row.author_id,
  autorNome: row.author_name,
  texto: row.body,
  dados: parse(row.payload_json, {}),
  criadoEm: row.created_at,
});

// O histórico é só acréscimo. Esta é a única função que escreve na tabela de
// eventos, e ela não tem caminho de UPDATE nem de DELETE.
const registrarEvento = (env, { pedidoId, ownerId, tipo, versao, user, texto: corpo, dados }) =>
  env.DB.prepare(
    `INSERT INTO todogreen_deal_desk_events
       (id, request_id, workspace_owner_id, kind, version, author_id, author_name, body, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      pedidoId,
      ownerId,
      tipo,
      versao,
      user.id,
      texto(user.name || "", 160),
      texto(corpo || "", 4000),
      JSON.stringify(dados || {}),
      new Date().toISOString(),
    )
    .run();

const buscarPedido = (env, id, ownerId) =>
  env.DB.prepare(
    "SELECT * FROM todogreen_deal_desk_requests WHERE id = ? AND workspace_owner_id = ?",
  )
    .bind(id, ownerId)
    .first();

// A régua em vigor. O desvio precisa ser medido contra o piso que valia agora,
// não contra um número escolhido por quem pede.
//
// A régua é do tenant, não do espaço: é a mesma consulta de
// todogreen-pricing-parameters.js, e ler por outro critério aqui faria a tela
// mostrar um piso e o Deal Desk usar outro.
const reguaVigente = async (env, ownerId) => (await reguaEmVigor(env, ownerId)).parametros;

const cenarioDoEspaco = (env, cenarioId, ownerId) =>
  env.DB.prepare(
    "SELECT * FROM pricing_scenarios WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?",
  )
    .bind(cenarioId, TENANT_ID, ownerId)
    .first();

// Quem pode ENXERGAR um pedido específico por id — diferente de quem pode
// DECIDIR sobre ele. Quem tem alçada decide fora da própria carteira de
// propósito (a alçada é da operação, não do cliente), e essa pessoa também
// precisa conseguir abrir o pedido para revisar. Fora isso, só quem abriu o
// pedido ou quem tem o cliente dele na própria carteira. Sem este corte,
// bastava digitar a URL com um id alheio para ler margem e condição
// comercial de cliente que não é seu.
async function pedidoVisivel(env, access, user, row) {
  if (!row) return false;
  if (podeVerTodaCarteira(access) || podeNaVertical(access, "deal:approve")) return true;
  if (row.requester_id === user.id) return true;
  const cenario = await cenarioDoEspaco(env, row.scenario_id, access.ownerId);
  if (!cenario?.client_id) return false;
  const atribuido = await env.DB.prepare(
    `SELECT 1 FROM todogreen_client_assignments
      WHERE tenant_id = ? AND client_id = ? AND status = 'active' AND lower(seller_email) = ? LIMIT 1`,
  )
    .bind(TENANT_ID, cenario.client_id, String(user.email || "").trim().toLowerCase())
    .first();
  return Boolean(atribuido);
}

async function abrir(env, access, user, corpo) {
  const cenarioId = texto(corpo.cenarioId, 120);
  const cenario = await cenarioDoEspaco(env, cenarioId, access.ownerId);
  // 404 e não 403: dizer "existe, mas não é seu" já entrega que existe.
  if (!cenario) return json({ error: "Simulação não encontrada." }, 404);

  const resultado = parse(cenario.result_json, {});
  const regua = await reguaVigente(env, access.ownerId);
  // Alçada, desvio e prazo saem do resultado gravado e da régua vigente —
  // nunca do corpo do pedido. Deixar quem pede escolher a própria alçada é o
  // controle virando autoatendimento.
  const { valido, problemas, pedido: pedidoMontado } = montarPedido({
    cenarioId,
    resultado,
    regua,
    justificativa: corpo.justificativa,
    solicitanteId: user.id,
  });
  if (!valido) return json({ error: problemas.join(" ") }, 400);

  // Os gatilhos gravados na simulação são de quando ela foi calculada — antes
  // de qualquer evidência existir. A ausência de evidência só pode ser
  // conferida agora, contra o cofre real, não contra o que estava salvo.
  const semEvidencia = await env.DB
    .prepare(
      "SELECT id FROM todogreen_evidences WHERE workspace_owner_id = ? AND calculo_id = ? AND status = 'ativo' LIMIT 1",
    )
    .bind(access.ownerId, cenarioId)
    .first()
    .then((linha) => !linha);
  const pedido = semEvidencia
    ? { ...pedidoMontado, gatilhos: [...pedidoMontado.gatilhos, "Operação sem evidência suficiente"] }
    : pedidoMontado;

  const pendente = await env.DB
    .prepare(
      `SELECT id FROM todogreen_deal_desk_requests
        WHERE workspace_owner_id = ? AND scenario_id = ? AND status = 'pendente' LIMIT 1`,
    )
    .bind(access.ownerId, cenarioId)
    .first();
  if (pendente)
    return json({ error: "Já existe um pedido pendente para esta simulação." }, 409);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_deal_desk_requests
       (id, tenant_id, workspace_owner_id, scenario_id, client_name, alcada_id, deviation_points,
        alcada_reason, triggers_json, justification, requester_id, status, version,
        decided_by, decision_note, decided_at, due_at, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 1, NULL, '', NULL, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      TENANT_ID,
      access.ownerId,
      cenarioId,
      texto(corpo.cliente || cenario.client_id, 200),
      pedido.alcadaId,
      pedido.desvioPontos,
      pedido.motivoDaAlcada,
      JSON.stringify(pedido.gatilhos),
      pedido.justificativa,
      user.id,
      pedido.prazoEm,
      agora,
      agora,
    )
    .run();

  await registrarEvento(env, {
    pedidoId: id,
    ownerId: access.ownerId,
    tipo: "abertura",
    versao: 1,
    user,
    texto: pedido.justificativa,
    dados: { alcadaId: pedido.alcadaId, desvioPontos: pedido.desvioPontos, prazoEm: pedido.prazoEm },
  });

  return json({ pedido: doBanco(await buscarPedido(env, id, access.ownerId)) }, 201);
}

async function decidir(env, access, user, id, corpo) {
  const row = await buscarPedido(env, id, access.ownerId);
  if (!row) return json({ error: "Pedido não encontrado." }, 404);
  const pedido = doBanco(row);

  const aprovar = corpo.decisao === "aprovar";
  if (!aprovar && corpo.decisao !== "recusar")
    return json({ error: "Diga se é aprovar ou recusar." }, 400);

  const nota = texto(corpo.justificativa, 4000);
  // Recusa sem motivo escrito não ensina nada a quem vai revisar a condição.
  if (!aprovar && nota.length < 10)
    return json({ error: "Escreva por que a condição foi recusada." }, 400);

  const veredito = podeDecidir(pedido, {
    userId: user.id,
    role: access.role,
    permissions: access.permissions,
  });
  if (!veredito.pode) return json({ error: veredito.motivo }, 403);

  const agora = new Date().toISOString();
  const situacao = aprovar ? SITUACOES.aprovado : SITUACOES.recusado;
  // A decisão só vale para a versão que estava na mesa. Se alguém revisou entre
  // abrir a tela e clicar, o UPDATE não casa e a decisão não passa.
  const { meta } = await env.DB.prepare(
    `UPDATE todogreen_deal_desk_requests
        SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?,
            updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_owner_id = ? AND status = 'pendente' AND version = ?`,
  )
    .bind(situacao, user.id, nota, agora, agora, id, access.ownerId, pedido.versao)
    .run();
  if (!meta?.changes)
    return json(
      { error: "A condição foi revisada enquanto você decidia. Recarregue e veja a versão atual." },
      409,
    );

  await registrarEvento(env, {
    pedidoId: id,
    ownerId: access.ownerId,
    tipo: "decisao",
    versao: pedido.versao,
    user,
    texto: nota,
    dados: { situacao, alcadaId: pedido.alcadaId },
  });

  return json({ pedido: doBanco(await buscarPedido(env, id, access.ownerId)) });
}

async function revisar(env, access, user, id, corpo) {
  const row = await buscarPedido(env, id, access.ownerId);
  if (!row) return json({ error: "Pedido não encontrado." }, 404);
  const atual = doBanco(row);
  if (atual.situacao === SITUACOES.cancelado)
    return json({ error: "Pedido cancelado não é revisado. Abra um novo." }, 409);

  const cenario = await cenarioDoEspaco(env, atual.cenarioId, access.ownerId);
  const resultado = parse(cenario?.result_json, {});
  const regua = await reguaVigente(env, access.ownerId);

  const { valido, problemas, pedido } = revisarPedido(atual, {
    resultado,
    regua,
    justificativa: corpo.justificativa,
  });
  if (!valido) return json({ error: problemas.join(" ") }, 400);

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_deal_desk_requests
        SET status = 'pendente', version = ?, alcada_id = ?, deviation_points = ?,
            alcada_reason = ?, justification = ?, due_at = ?,
            decided_by = NULL, decision_note = '', decided_at = NULL,
            updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_owner_id = ? AND version = ?`,
  )
    .bind(
      pedido.versao,
      pedido.alcadaId,
      pedido.desvioPontos,
      pedido.motivoDaAlcada,
      pedido.justificativa,
      pedido.prazoEm,
      agora,
      id,
      access.ownerId,
      atual.versao,
    )
    .run();

  // A decisão anterior sai da linha corrente, mas continua no histórico: é lá
  // que a pergunta "quem aprovou a versão 1?" tem resposta.
  await registrarEvento(env, {
    pedidoId: id,
    ownerId: access.ownerId,
    tipo: "revisao",
    versao: pedido.versao,
    user,
    texto: pedido.justificativa,
    dados: { versaoAnterior: atual.versao, alcadaId: pedido.alcadaId, prazoEm: pedido.prazoEm },
  });

  return json({ pedido: doBanco(await buscarPedido(env, id, access.ownerId)) });
}

async function comentar(env, access, user, id, corpo) {
  const row = await buscarPedido(env, id, access.ownerId);
  if (!row) return json({ error: "Pedido não encontrado." }, 404);
  if (!(await pedidoVisivel(env, access, user, row)))
    return json({ error: "Pedido não encontrado." }, 404);
  const mensagem = texto(corpo.texto, 4000);
  if (!mensagem) return json({ error: "Escreva o comentário." }, 400);
  await registrarEvento(env, {
    pedidoId: id,
    ownerId: access.ownerId,
    tipo: "comentario",
    versao: row.version,
    user,
    texto: mensagem,
  });
  return json({ ok: true }, 201);
}

async function cancelar(env, access, user, id, corpo) {
  const row = await buscarPedido(env, id, access.ownerId);
  if (!row) return json({ error: "Pedido não encontrado." }, 404);
  if (row.status !== SITUACOES.pendente)
    return json({ error: "Só pedido pendente pode ser cancelado." }, 409);
  // Cancelar é do dono do pedido ou de quem tem alçada; não é de qualquer um
  // que passe por ali e queira limpar a fila.
  const ehSolicitante = row.requester_id === user.id;
  if (!ehSolicitante && !podeNaVertical(access, "deal:approve"))
    return json({ error: "Só quem pediu, ou quem aprova, cancela o pedido." }, 403);

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_deal_desk_requests
        SET status = 'cancelado', updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_owner_id = ? AND status = 'pendente'`,
  )
    .bind(agora, id, access.ownerId)
    .run();
  await registrarEvento(env, {
    pedidoId: id,
    ownerId: access.ownerId,
    tipo: "cancelamento",
    versao: row.version,
    user,
    texto: texto(corpo.justificativa, 4000),
  });
  return json({ ok: true });
}

export async function handleTodoGreenDealDesk(request, env, access, user) {
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, deal-desk, [id], [acao]
  const id = texto(partes[3], 120);
  const acao = texto(partes[4], 40);

  if (request.method === "GET" && !id) {
    // Mesma regra de `pedidoVisivel`, em forma de filtro de lista: quem tem
    // alçada (ou visão da carteira inteira) vê a fila toda; o resto vê o que
    // pediu, mais o que é do cliente na própria carteira. Sem o "o que
    // pediu", um vendedor deixaria de ver o próprio pedido assim que ele
    // fosse de um cliente ainda não formalmente atribuído a ele.
    const podeTudo = podeVerTodaCarteira(access) || podeNaVertical(access, "deal:approve");
    const clausulaCarteira = podeTudo
      ? ""
      : `AND (d.requester_id = ? OR EXISTS (
              SELECT 1 FROM todogreen_client_assignments a
               WHERE a.tenant_id = s.tenant_id AND a.client_id = s.client_id
                 AND a.status = 'active' AND lower(a.seller_email) = ?
            ))`;
    const paramsCarteira = podeTudo ? [] : [user.id, String(user.email || "").trim().toLowerCase()];

    const situacaoPedida = texto(url.searchParams.get("status"), 20);
    const clausulaSituacao = situacaoPedida && Object.values(SITUACOES).includes(situacaoPedida)
      ? "AND d.status = ?"
      : "";
    const paramsSituacao = clausulaSituacao ? [situacaoPedida] : [];

    const { limit, offset } = paginacao(url);
    const base = `FROM todogreen_deal_desk_requests d
         JOIN pricing_scenarios s
           ON s.id = d.scenario_id AND s.tenant_id = d.tenant_id
          AND s.workspace_owner_id = d.workspace_owner_id
        WHERE d.workspace_owner_id = ? ${clausulaCarteira} ${clausulaSituacao}`;
    const params = [access.ownerId, ...paramsCarteira, ...paramsSituacao];
    const [{ results }, totalRow] = await Promise.all([
      env.DB.prepare(`SELECT d.* ${base} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset)
        .all(),
      env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
    ]);
    return json({
      pedidos: (results || []).map(doBanco),
      total: totalRow?.total || 0,
      limit,
      offset,
    });
  }

  if (request.method === "GET" && id && acao === "historico") {
    const pedido = await buscarPedido(env, id, access.ownerId);
    if (!pedido || !(await pedidoVisivel(env, access, user, pedido)))
      return json({ error: "Pedido não encontrado." }, 404);
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_deal_desk_events
        WHERE request_id = ? AND workspace_owner_id = ? ORDER BY created_at ASC LIMIT 500`,
    )
      .bind(id, access.ownerId)
      .all();
    return json({ pedido: doBanco(pedido), historico: (results || []).map(eventoDoBanco) });
  }

  if (request.method === "GET" && id) {
    const pedido = await buscarPedido(env, id, access.ownerId);
    if (!pedido || !(await pedidoVisivel(env, access, user, pedido)))
      return json({ error: "Pedido não encontrado." }, 404);
    return json({ pedido: doBanco(pedido) });
  }

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST" && !id) {
    if (!podeNaVertical(access, "pricing:simulate"))
      return json({ error: "Seu papel não pode pedir aprovação comercial." }, 403);
    return abrir(env, access, user, corpo);
  }
  if (request.method === "POST" && id && acao === "decisao") return decidir(env, access, user, id, corpo);
  if (request.method === "POST" && id && acao === "revisao") return revisar(env, access, user, id, corpo);
  if (request.method === "POST" && id && acao === "comentario") return comentar(env, access, user, id, corpo);
  if (request.method === "POST" && id && acao === "cancelamento") return cancelar(env, access, user, id, corpo);

  return json({ error: "Método não permitido." }, 405);
}

export const ALCADA_DO_PEDIDO = alcadaPorId;
