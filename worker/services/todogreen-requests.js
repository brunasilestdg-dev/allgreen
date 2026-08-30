// ===== Solicitações do cliente: lado da equipe =====
//
// A outra metade da caixa de entrada. Sem esta, o portal seria um formulário
// que grava no banco e ninguém lê — pior que não ter formulário nenhum, porque
// o cliente escreve confiando que alguém vai responder.
//
// A regra de acesso é a inversa do portal: aqui é gente da To Do Green, e o
// vendedor só enxerga os clientes da própria carteira. Quem gere a operação vê
// tudo. O recorte acontece no SQL, nunca na tela.

import {
  STATUS_SOLICITACAO,
  aplicarTransicao,
  filaDaEquipe,
  indicadoresDaEquipe,
  situacaoDoPrazo,
  statusValido,
} from "../../src/features/logistics/clientRequestDomain.js";
import { TENANT_ID, podeVerTodaCarteira, recorteDeCarteira } from "./todogreen-access.js";
import { notificarPortalDoCliente } from "./todogreen-notify.js";
const MAX_LIMIT = 200;

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

// A regra em si mora em `todogreen-access.js` — reaproveitada aqui em vez de
// reimplementada, para que vendedor e gestora vejam a mesma carteira em toda
// a vertical, não uma versão levemente diferente por arquivo.
const podeVerTudo = podeVerTodaCarteira;
const recorteDaCarteira = (access, email) => recorteDeCarteira(access, email, "r");

const linhaParaSolicitacao = (linha) => ({
  id: linha.id,
  clienteId: linha.client_id,
  clienteNome: linha.client_name,
  tipo: linha.type,
  assunto: linha.subject,
  descricao: linha.description,
  urgencia: linha.urgency,
  status: linha.status,
  campos: parse(linha.fields_json, {}),
  prazoEm: linha.due_at,
  abertaPor: linha.opened_by,
  responsavel: linha.assigned_to,
  encerradoEm: linha.closed_at,
  encerradoPor: linha.closed_by,
  criadaEm: linha.created_at,
  atualizadaEm: linha.updated_at,
});

// Confirma que a solicitação está dentro da carteira de quem pediu, ANTES de
// qualquer escrita. Devolve 404 e não 403 quando está fora: dizer "existe mas
// não é sua" já entrega que o cliente existe.
async function solicitacaoNoAlcance(env, access, email, id) {
  const recorte = recorteDaCarteira(access, email);
  return env.DB.prepare(
    `SELECT r.id, r.client_id, r.status, r.due_at
       FROM todogreen_client_requests r
      WHERE r.tenant_id = ? AND r.workspace_owner_id = ? AND r.id = ? ${recorte.sql}`,
  )
    .bind(TENANT_ID, access.ownerId, id, ...recorte.params)
    .first();
}

export async function handleTodoGreenRequests(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  const email = String(user?.email || "").trim().toLowerCase();
  const recorte = recorteDaCarteira(access, email);

  if (request.method === "GET") {
    const linhas = await env.DB.prepare(
      `SELECT r.id, r.client_id, c.name AS client_name, r.type, r.subject,
              r.description, r.urgency, r.status, r.fields_json, r.due_at,
              r.opened_by, r.assigned_to, r.closed_at, r.closed_by,
              r.created_at, r.updated_at
         FROM todogreen_client_requests r
         JOIN todogreen_clients c
           ON c.id = r.client_id AND c.tenant_id = r.tenant_id
          AND c.workspace_owner_id = r.workspace_owner_id
        WHERE r.tenant_id = ? AND r.workspace_owner_id = ? ${recorte.sql}
        ORDER BY r.created_at DESC
        LIMIT ?`,
    )
      .bind(TENANT_ID, access.ownerId, ...recorte.params, MAX_LIMIT)
      .all()
      .catch(() => ({ results: [] }));

    const solicitacoes = (linhas.results || []).map(linhaParaSolicitacao);

    const id = clean(url.searchParams.get("id"), 60);
    let mensagens = [];
    if (id && (await solicitacaoNoAlcance(env, access, email, id))) {
      // A equipe vê a conversa inteira, inclusive as notas internas: é o lado
      // que as escreveu.
      const conversa = await env.DB.prepare(
          `SELECT id, author_side, author_name, author_email, body, internal, created_at
           FROM todogreen_client_request_messages
          WHERE tenant_id = ? AND workspace_owner_id = ? AND request_id = ?
          ORDER BY created_at`,
      )
        .bind(TENANT_ID, access.ownerId, id)
        .all()
        .catch(() => ({ results: [] }));
      mensagens = (conversa.results || []).map((m) => ({
        id: m.id,
        lado: m.author_side,
        autor: m.author_name || m.author_email,
        texto: m.body,
        interna: m.internal === 1,
        criadaEm: m.created_at,
      }));
    }

    return response({
      solicitacoes: solicitacoes.map((s) => ({ ...s, prazo: situacaoDoPrazo(s) })),
      fila: filaDaEquipe(solicitacoes).map((s) => s.id),
      indicadores: indicadoresDaEquipe(solicitacoes),
      mensagens,
      carteiraCompleta: podeVerTudo(access),
    });
  }

  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }

    const id = clean(body.id ?? body.solicitacaoId, 60);
    const texto = clean(body.mensagem ?? body.texto, 4000);
    if (!id) return response({ error: "Informe a solicitação." }, 400);
    if (texto.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

    const atual = await solicitacaoNoAlcance(env, access, email, id);
    if (!atual) return response({ error: "Solicitação não encontrada." }, 404);
    if (STATUS_SOLICITACAO[statusValido(atual.status)].encerrado)
      return response({ error: "Esta solicitação já foi encerrada." }, 409);

    const interna = body.interna === true || body.internal === true;
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_request_messages
         (id, tenant_id, workspace_owner_id, client_id, request_id, author_side, author_email,
          author_name, body, internal, created_at)
       VALUES (?, ?, ?, ?, ?, 'equipe', ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        TENANT_ID,
        access.ownerId,
        atual.client_id,
        id,
        email,
        clean(user?.name || email, 120),
        texto,
        interna ? 1 : 0,
        agora,
      )
      .run();

    // Nota interna não move o pedido: ela é conversa da equipe consigo mesma,
    // e marcar como "respondida" faria o cliente esperar por algo que nunca
    // chegou até ele.
    if (!interna) {
      const movimento = aplicarTransicao(atual, {
        lado: "equipe",
        para: clean(body.status, 30) || "respondida",
        autor: email,
      });
      if (movimento.ok) {
        await env.DB.prepare(
          `UPDATE todogreen_client_requests
            SET status = ?, closed_at = ?, closed_by = ?, updated_at = ?
            WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?`,
        )
          .bind(
            movimento.status,
            movimento.encerradoEm,
            movimento.encerradoPor,
            agora,
            TENANT_ID,
            access.ownerId,
            id,
          )
          .run();
      }
    }

    // O cliente fica sabendo que a equipe respondeu — antes, só descobria se
    // voltasse ao portal sozinho. Nota interna não notifica ninguém.
    if (!interna) {
      await notificarPortalDoCliente(env, atual.client_id, {
        assunto: `Sua solicitação "${clean(atual.subject, 80)}" recebeu resposta`,
        titulo: "A To Do Green respondeu sua solicitação",
        corpo: `A equipe respondeu "${clean(atual.subject, 120)}". Abra o portal para ler e continuar a conversa.`,
        origem: new URL(request.url).origin,
      });
    }

    return response({ ok: true });
  }

  if (request.method === "PATCH") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const id = clean(body.id, 60);
    if (!id) return response({ error: "Informe a solicitação." }, 400);

    const atual = await solicitacaoNoAlcance(env, access, email, id);
    if (!atual) return response({ error: "Solicitação não encontrada." }, 404);

    // Assumir o pedido é diferente de mudar o estado dele: quem assume não
    // move a régua do SLA, só passa a responder por ele.
    if (body.assumir === true) {
      await env.DB.prepare(
        `UPDATE todogreen_client_requests SET assigned_to = ?, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?`,
      )
        .bind(email, new Date().toISOString(), TENANT_ID, access.ownerId, id)
        .run();
      return response({ ok: true, responsavel: email });
    }

    const movimento = aplicarTransicao(atual, {
      lado: "equipe",
      para: clean(body.status, 30),
      autor: email,
    });
    if (!movimento.ok) return response({ error: movimento.erro }, 409);

    await env.DB.prepare(
      `UPDATE todogreen_client_requests
          SET status = ?, closed_at = ?, closed_by = ?, updated_at = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?`,
    )
      .bind(
        movimento.status,
        movimento.encerradoEm,
        movimento.encerradoPor,
        new Date().toISOString(),
        TENANT_ID,
        access.ownerId,
        id,
      )
      .run();

    return response({ ok: true, status: movimento.status });
  }

  return response({ error: "Método não permitido." }, 405);
}
