// ===== Portal do Cliente: rota da trilha =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET /trilha: os últimos eventos do portal DESTE cliente. Exige
// `portal:user:manage`.

import { clientCan } from "../../../../src/features/logistics/customerPortalDomain.js";
import { response } from "../../todogreen-client-helpers.js";

export async function rotaDaTrilha({ request, env, resource, escopo }) {
  if (request.method === "GET" && resource === "trilha") {
    if (!clientCan(escopo, "portal:user:manage"))
      return response({ error: "Sem permissão para ver a trilha." }, 403);
    const linhas = await env.DB.prepare(
      `SELECT action, target, details, email, created_at
         FROM todogreen_client_portal_events
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({ eventos: linhas.results || [] });
  }
  return null;
}
