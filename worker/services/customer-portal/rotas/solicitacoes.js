// ===== Portal do Cliente: rotas das solicitações =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// /solicitacoes: GET lista (e a conversa sem mensagem interna), POST abre ou
// responde, PATCH muda o status pelo lado do cliente. Escrever exige
// `portal:request:create`; o cliente da solicitação é sempre o do escopo.

import { clientCan, scopedWhere } from "../../../../src/features/logistics/customerPortalDomain.js";
import {
  TIPOS_SOLICITACAO,
  aplicarTransicao,
  prazoDaSolicitacao,
  resumoParaCliente,
  tipoDaEncomendaPermitido,
  tiposGerais,
  validarSolicitacao,
} from "../../../../src/features/logistics/clientRequestDomain.js";
import { clean, response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { inserirMensagem, linhaParaSolicitacao, responderSolicitacao, tipoParaCliente } from "../solicitacoes.js";
import { MAX_LIMIT } from "../visao-do-cliente.js";

export async function rotaDasSolicitacoes({ request, env, url, resource, user, escopo, excedeuLimite }) {
  // ----- Solicitações -----
  //
  // A porta que a aba prometia. O cliente da solicitação vem do escopo da
  // sessão; não existe caminho para o corpo da requisição escolher outro.
  if (resource === "solicitacoes") {
    if (!clientCan(escopo, "portal:request:create") && request.method !== "GET")
      return response({ error: "Seu acesso não permite abrir solicitações." }, 403);

    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      // Filtro opcional por encomenda: a tela da operação lista só os pedidos
      // dela; a aba de atendimento (sem o parâmetro) lista todos.
      const operacaoFiltro = clean(url.searchParams.get("operacaoId"), 60);
      const linhas = await env.DB.prepare(
        `SELECT id, type, subject, description, urgency, status, fields_json,
                operation_id, due_at, opened_by, closed_at, created_at, updated_at
           FROM todogreen_client_requests
          WHERE ${sql}${operacaoFiltro ? " AND operation_id = ?" : ""}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, ...(operacaoFiltro ? [operacaoFiltro] : []), MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

      const solicitacoes = (linhas.results || []).map(linhaParaSolicitacao);
      const detalhe = clean(url.searchParams.get("id"), 60);
      let mensagens = [];
      if (detalhe) {
        // Mensagem interna da equipe não sai daqui. Filtrada no SQL, não na
        // tela — esconder no navegador é entregar o dado e pedir para não olhar.
        const conversa = await env.DB.prepare(
          `SELECT id, author_side, author_name, body, created_at
            FROM todogreen_client_request_messages
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND request_id = ? AND internal = 0
            ORDER BY created_at`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, detalhe)
          .all()
          .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
        mensagens = (conversa.results || []).map((m) => ({
          id: m.id,
          lado: m.author_side,
          autor: m.author_name,
          texto: m.body,
          criadaEm: m.created_at,
        }));
      }

      return response({
        solicitacoes,
        mensagens,
        resumo: resumoParaCliente(solicitacoes),
        tipos: tiposGerais().map(tipoParaCliente),
      });
    }

    if (request.method === "POST") {
      if (excedeuLimite("solicitacao", 30))
        return response({ error: "Muitas solicitações em pouco tempo. Aguarde um instante." }, 429);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      // Uma nova mensagem numa solicitação existente.
      const emResposta = clean(body.solicitacaoId, 60);
      if (emResposta) return responderSolicitacao(env, escopo, user, emResposta, body);

      // Pedido amarrado a uma encomenda (devolução, alteração de endereço,
      // acareação). A operação tem de ser do próprio cliente e o tipo tem de
      // caber na FASE dela: a fase é reconferida no servidor, nunca confiando
      // no que a tela ofereceu.
      const operacaoId = clean(body.operacaoId, 60);
      let operacaoDoPedido = null;
      if (operacaoId) {
        const { sql, params } = scopedWhere(escopo);
        operacaoDoPedido = await env.DB.prepare(
          `SELECT id, reference, status, delivered_at FROM todogreen_client_operations
            WHERE ${sql} AND id = ? LIMIT 1`,
        )
          .bind(...params, operacaoId)
          .first()
          .catch(() => null);
        if (!operacaoDoPedido)
          return response({ error: "Encomenda não encontrada." }, 404);
        const entregue = Boolean(operacaoDoPedido.delivered_at) || operacaoDoPedido.status === "concluida";
        if (!tipoDaEncomendaPermitido(body.tipo, entregue))
          return response(
            {
              error: entregue
                ? "Esta encomenda já foi entregue: só é possível abrir uma acareação."
                : "Esta encomenda ainda não foi entregue: acareação só depois da entrega.",
            },
            409,
          );
      }

      const validacao = validarSolicitacao(body);
      if (!validacao.valido)
        return response({ error: validacao.erros[0], erros: validacao.erros }, 400);

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();
      const { tipo, assunto, descricao, urgencia, campos } = validacao.limpo;
      // Assunto herda a referência da encomenda quando o cliente não escreveu um
      // — a fila da equipe abre o pedido já sabendo de qual entrega se trata.
      const assuntoFinal = operacaoDoPedido
        ? `${TIPOS_SOLICITACAO[tipo]?.rotulo || assunto} — encomenda ${operacaoDoPedido.reference || operacaoId}`.slice(0, 160)
        : assunto;
      await env.DB.prepare(
        `INSERT INTO todogreen_client_requests
           (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
            urgency, status, fields_json, operation_id, due_at, opened_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.clientId,
          escopo.workspaceOwnerId || "",
          tipo,
          assuntoFinal,
          descricao,
          urgencia,
          JSON.stringify(campos),
          operacaoId,
          prazoDaSolicitacao(tipo, urgencia, agora),
          escopo.email,
          agora,
          agora,
        )
        .run();

      // A descrição vira a primeira mensagem da conversa: sem isso a thread
      // começaria no meio, sem o que foi pedido originalmente.
      await inserirMensagem(env, escopo, id, {
        lado: "cliente",
        email: escopo.email,
        nome: user?.name || escopo.email,
        texto: descricao,
      });

      await logPortalEvent(env, escopo, user, "solicitacao_aberta", id, assuntoFinal);
      return response({ ok: true, id }, 201);
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

      const atual = await env.DB.prepare(
        `SELECT id, status FROM todogreen_client_requests
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
        .first();
      if (!atual) return response({ error: "Solicitação não encontrada." }, 404);

      const movimento = aplicarTransicao(atual, {
        lado: "cliente",
        para: clean(body.status, 30),
        autor: escopo.email,
      });
      if (!movimento.ok) return response({ error: movimento.erro }, 409);

      await env.DB.prepare(
        `UPDATE todogreen_client_requests
            SET status = ?, closed_at = ?, closed_by = ?, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(
          movimento.status,
          movimento.encerradoEm,
          movimento.encerradoPor,
          new Date().toISOString(),
          escopo.tenantId,
          escopo.workspaceOwnerId,
          escopo.clientId,
          id,
        )
        .run();

      await logPortalEvent(env, escopo, user, "solicitacao_status", id, movimento.status);
      return response({ ok: true, status: movimento.status });
    }

    return response({ error: "Método não permitido." }, 405);
  }
  return null;
}
