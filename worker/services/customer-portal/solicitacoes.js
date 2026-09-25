// ===== Portal do Cliente: solicitações =====
//
// Contrato: `linhaParaSolicitacao(linha)` é a projeção da solicitação que o
// cliente vê; `inserirMensagem` grava uma linha da conversa; e
// `responderSolicitacao(env, escopo, user, id, body)` é o cliente respondendo
// numa solicitação aberta (devolve Response; encerrada é 409). Tudo amarrado a
// tenant, espaço e cliente do escopo da sessão.

import {
  STATUS_SOLICITACAO,
  TIPOS_SOLICITACAO,
  statusValido,
} from "../../../src/features/logistics/clientRequestDomain.js";
import { clean, parse, response } from "../todogreen-client-helpers.js";
import { logPortalEvent } from "./auditoria.js";

export const linhaParaSolicitacao = (linha) => ({
  id: linha.id,
  tipo: linha.type,
  // O rótulo legível do tipo, para a tela não precisar reimplementar o dicionário.
  tipoRotulo: TIPOS_SOLICITACAO[linha.type]?.rotulo || linha.type,
  assunto: linha.subject,
  descricao: linha.description,
  urgencia: linha.urgency,
  status: linha.status,
  campos: parse(linha.fields_json, {}),
  // Vazio para os pedidos gerais; preenchido para os que nascem de uma encomenda.
  operacaoId: linha.operation_id || "",
  prazoEm: linha.due_at,
  abertaPor: linha.opened_by,
  encerradaEm: linha.closed_at,
  criadaEm: linha.created_at,
  atualizadaEm: linha.updated_at,
});

// Um tipo de solicitação como o cliente precisa vê-lo (sem os detalhes internos
// de escopo/fase). Uma só forma, para lista geral e lista da encomenda não
// divergirem.
export const tipoParaCliente = (t) => ({
  id: t.id,
  rotulo: t.rotulo,
  descricao: t.descricao,
  prazoHoras: t.prazoHoras,
  obrigatorios: t.obrigatorios,
  camposRotulo: t.camposRotulo,
});

export async function inserirMensagem(env, escopo, requestId, { lado, email, nome, texto, interna = 0 }) {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_request_messages
       (id, tenant_id, workspace_owner_id, client_id, request_id, author_side, author_email, author_name,
        body, internal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      requestId,
      lado,
      clean(email, 160),
      clean(nome, 120),
      clean(texto, 4000),
      interna ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

export async function responderSolicitacao(env, escopo, user, id, body) {
  const texto = clean(body.mensagem ?? body.texto, 4000);
  if (texto.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

  const atual = await env.DB.prepare(
    `SELECT id, status FROM todogreen_client_requests
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .first();
  if (!atual) return response({ error: "Solicitação não encontrada." }, 404);
  if (STATUS_SOLICITACAO[statusValido(atual.status)].encerrado)
    return response(
      { error: "Esta solicitação já foi encerrada. Abra uma nova para retomar o assunto." },
      409,
    );

  await inserirMensagem(env, escopo, id, {
    lado: "cliente",
    email: escopo.email,
    nome: user?.name || escopo.email,
    texto,
  });

  // Cliente respondeu: a bola volta para a equipe e o relógio dela volta a
  // correr. Deixar em "aguardando cliente" esconderia o pedido da fila.
  const proximo = statusValido(atual.status) === "aguardando_cliente" ? "em_analise" : atual.status;
  await env.DB.prepare(
    `UPDATE todogreen_client_requests SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(proximo, new Date().toISOString(), escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .run();

  await logPortalEvent(env, escopo, user, "solicitacao_mensagem", id, texto.slice(0, 120));
  return response({ ok: true, status: proximo });
}
