// ===== Portal do Cliente: prévia interna =====
//
// Contrato: `handleTodoGreenClientPortalPreview(request, env, access, user)` é
// do lado INTERNO (o roteador já exigiu leitura da vertical) e só lê. O cliente
// precisa estar no espaço do vínculo e, para quem não gere clientes, na própria
// carteira — fora dela, 404. Monta o mesmo escopo e o mesmo menu do portal com
// o papel pedido, sem criar sessão de cliente nem gravar trilha em nome dele.

import {
  menuForAccess,
  normalizeEmail,
  permissionsForRole,
  clientPortalRole,
  scopedWhere,
} from "../../../src/features/logistics/customerPortalDomain.js";
import { TENANT_ID, clean, response } from "../todogreen-client-helpers.js";
import { clientOverview } from "./visao-geral.js";

// Prévia interna e somente leitura. Ela monta o mesmo escopo e o mesmo menu
// usados pelo portal, mas não cria uma sessão de cliente nem grava eventos em
// nome dele. O id ainda passa pela regra da carteira do usuário interno.
export async function handleTodoGreenClientPortalPreview(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "GET") return response({ error: "Método não permitido." }, 405);
  const url = new URL(request.url);
  const clientId = clean(url.pathname.split("/").filter(Boolean)[3], 60);
  if (!clientId) return response({ error: "Informe o cliente." }, 400);
  const canManageInternal = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") || access?.permissions?.includes("clients:manage");
  const sessionEmail = normalizeEmail(user?.email);
  const client = await env.DB.prepare(
    `SELECT c.id,c.name,c.status,c.portal_enabled,c.workspace_owner_id
       FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL
        AND (?=1 OR EXISTS (
          SELECT 1 FROM todogreen_client_assignments a
           WHERE a.tenant_id=c.tenant_id AND a.client_id=c.id
             AND a.status='active' AND lower(a.seller_email)=?
        ))`,
  ).bind(clientId, TENANT_ID, access.ownerId, canManageInternal ? 1 : 0, sessionEmail).first();
  if (!client) return response({ error: "Cliente não encontrado na sua carteira." }, 404);

  const usersResult = await env.DB.prepare(
    `SELECT email,role,status,updated_at AS updatedAt
       FROM todogreen_client_users
      WHERE tenant_id=? AND client_id=? AND status='active'
      ORDER BY email`,
  ).bind(TENANT_ID, client.id).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  const users = usersResult.results || [];
  const requestedRole = clientPortalRole(url.searchParams.get("role") || users[0]?.role);
  const previewScope = {
    tenantId: TENANT_ID, clientId: client.id, clientName: client.name,
    workspaceOwnerId: client.workspace_owner_id, email: sessionEmail,
    role: requestedRole, permissions: permissionsForRole(requestedRole), status: "active",
  };
  const { sql, params } = scopedWhere(previewScope);
  const [summary, recent, documents, requests] = await Promise.all([
    clientOverview(env, previewScope),
    env.DB.prepare(
      `SELECT id,reference,status,service_date AS serviceDate,origin,destination
         FROM todogreen_client_operations WHERE ${sql} AND lower(status) != 'rascunho'
        ORDER BY service_date DESC,created_at DESC LIMIT 5`,
    ).bind(...params).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_evidences WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_client_requests WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
  ]);
  return response({
    preview: true,
    client: { id: client.id, name: client.name },
    portal: {
      enabled: client.portal_enabled === 1,
      role: requestedRole,
      permissions: previewScope.permissions,
      menu: menuForAccess(previewScope),
    },
    users: users.map((item) => ({ email: item.email, role: clientPortalRole(item.role), updatedAt: item.updatedAt })),
    summary,
    recentOperations: recent.results || [],
    counts: {
      operations: Number(summary?.operacoes?.total || 0),
      documents: Number(documents?.total || 0),
      requests: Number(requests?.total || 0),
    },
  });
}
