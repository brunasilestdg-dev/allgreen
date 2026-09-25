// ===== Portal do Cliente: trilha =====
//
// Contrato: `logPortalEvent(env, escopo, user, action, target, details)` grava
// o evento em todogreen_client_portal_events com tenant, espaço e cliente do
// ESCOPO da sessão (nunca do pedido), com os textos cortados. Nunca lança:
// falha na trilha não derruba o portal.

import { clean } from "../todogreen-client-helpers.js";

export async function logPortalEvent(env, escopo, user, action, target = "", details = "") {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_portal_events
       (id, tenant_id, workspace_owner_id, client_id, user_id, email, action, target, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      user?.id || null,
      escopo.email,
      clean(action, 80),
      clean(target, 200),
      clean(details, 500),
      new Date().toISOString(),
    )
    .run()
    .catch(() => {});
}
