// ===== Portal do Cliente: rotas do NPS =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// /nps: GET as respostas e o resumo; POST registra a nota (detrator abre
// ocorrência só com `portal:request:create`). A operação avaliada só entra se
// for do cliente da sessão.

import { clientCan, scopedWhere } from "../../../../src/features/logistics/customerPortalDomain.js";
import { prazoDaSolicitacao } from "../../../../src/features/logistics/clientRequestDomain.js";
import {
  calcularNPS,
  causasDeInsatisfacao,
  classificarNPS,
  faixaNPS,
  precisaOcorrencia,
} from "../../../../src/features/logistics/npsDomain.js";
import { clean, response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { MAX_LIMIT } from "../visao-do-cliente.js";

export async function rotaDoNps({ request, env, resource, user, escopo, excedeuLimite }) {
  // ----- Sua avaliação (NPS) -----
  //
  // A voz do cliente que fecha ciclo. Ele responde de 0 a 10; a nota de
  // detrator (0..6) abre automaticamente uma ocorrência com prazo — a mesma
  // todogreen_client_requests type='ocorrencia' que a equipe já trata. NPS que
  // não vira ação é enquete. O cliente da resposta vem do escopo da sessão,
  // nunca do corpo.
  if (resource === "nps") {
    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      const linhas = await env.DB.prepare(
        `SELECT id, operation_id, nota, classe, motivo, comentario,
                incident_request_id, created_at
           FROM todogreen_client_nps
          WHERE ${sql}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta NPS falhou", erro?.message || erro), { results: [] }));

      const respostas = (linhas.results || []).map((l) => ({
        id: l.id,
        operacaoId: l.operation_id || null,
        nota: l.nota,
        classe: l.classe,
        motivo: l.motivo || "",
        comentario: l.comentario || "",
        ocorrenciaId: l.incident_request_id || null,
        respondidoEm: l.created_at,
      }));

      const resumo = calcularNPS(respostas);
      return response({
        respostas,
        resumo: { ...resumo, faixa: faixaNPS(resumo.nps) },
        causas: causasDeInsatisfacao(respostas),
        // A última avaliação orienta a tela: já respondi? o que respondi?
        ultima: respostas[0] || null,
      });
    }

    if (request.method === "POST") {
      if (excedeuLimite("nps", 10))
        return response({ error: "Muitas respostas em pouco tempo. Aguarde um instante." }, 429);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      const classe = classificarNPS(body.nota);
      if (classe == null)
        return response({ error: "Informe uma nota de 0 a 10." }, 400);
      const nota = Number(body.nota);
      const motivo = clean(body.motivo, 120);
      const comentario = clean(body.comentario, 500);
      // A operação avaliada é opcional, mas se vier tem de ser do cliente da
      // sessão — nunca aceito um id de operação de outra carteira.
      let operationId = clean(body.operacaoId, 60) || null;
      if (operationId) {
        const dono = await env.DB.prepare(
          `SELECT 1 FROM todogreen_client_operations
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, operationId)
          .first()
          .catch(() => null);
        if (!dono) operationId = null;
      }

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();

      // A ponte que fecha o ciclo: detrator abre ocorrência com responsável e
      // prazo. Mesma tabela, mesmo motor da fila da equipe. Sem isso, uma nota
      // baixa some — e NPS que não trata detrator é enquete, não gestão.
      // Nota de detrator abre ocorrência — mas isso é criar um chamado, então
      // exige a permissão de criar solicitação. Um perfil só-leitura registra a
      // nota (feedback é sempre bem-vindo) sem, por essa via, abrir ocorrência
      // que ele não poderia abrir direto.
      let incidentId = null;
      if (precisaOcorrencia(nota) && clientCan(escopo, "portal:request:create")) {
        incidentId = crypto.randomUUID();
        const assunto = `Avaliação baixa (nota ${nota})`;
        const descricao = motivo || comentario
          ? `${motivo ? `Motivo: ${motivo}. ` : ""}${comentario}`.trim()
          : "Cliente registrou nota de detrator na pesquisa de satisfação.";
        await env.DB.prepare(
          `INSERT INTO todogreen_client_requests
             (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
              urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ocorrencia', ?, ?, 'alta', 'aberta', ?, ?, ?, ?, ?)`,
        )
          .bind(
            incidentId,
            escopo.tenantId,
            escopo.clientId,
            escopo.workspaceOwnerId || "",
            assunto,
            descricao,
            JSON.stringify(operationId ? { origemNps: id, operacaoId: operationId } : { origemNps: id }),
            prazoDaSolicitacao("ocorrencia", "alta", agora),
            escopo.email,
            agora,
            agora,
          )
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO todogreen_client_nps
           (id, tenant_id, workspace_owner_id, client_id, operation_id, nota, classe,
            motivo, comentario, incident_request_id, respondido_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.workspaceOwnerId || "",
          escopo.clientId,
          operationId,
          nota,
          classe,
          motivo,
          comentario,
          incidentId,
          escopo.email,
          agora,
        )
        .run();

      await logPortalEvent(env, escopo, user, "nps_respondido", id, `nota ${nota} (${classe})`);
      return response({ ok: true, id, classe, ocorrenciaId: incidentId }, 201);
    }

    return response({ error: "Método não permitido." }, 405);
  }
  return null;
}
