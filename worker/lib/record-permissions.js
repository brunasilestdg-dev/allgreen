// ===== Quem pode gerenciar um registro do espaço =====
//
// Contrato
// - Recebe: `env`, quem age (`actorId`), o dono do espaço (`ownerId`) e o
//   id do registro.
// - Devolve: `true` ou `false`.
// - Quem chama: sites (`canManageSite`), formulários públicos
//   (`canManagePublicForm`) e portal do cliente (`canManageClientPortal`).
// - Regra: dono do espaço e papel `admin` sempre podem; qualquer outro
//   membro precisa passar por `canEditRecord` no registro guardado no JSON
//   do dono. Só conseguir ver o registro nunca basta.

import { membershipRole } from "./membership.js";
import { canEditRecord, resolveViewerContext } from "./visibility.js";

// public_sites/public_site_leads live entirely outside RESTRICTED_FIELDS —
// canAccessWorkspace only proves the actor belongs to the space, not that
// they're allowed to touch this specific site. Look the site up in the
// owner's own workspace JSON and run it through the same canSeeTask a
// non-owner would need to pass for any other record, so a colaborador can't
// publish/unpublish/delete or read leads for a site someone else made.
async function canManageWorkspaceRecord(
  env,
  actorId,
  ownerId,
  collection,
  recordId,
) {
  if (actorId === ownerId) return true;
  const role = await membershipRole(env, actorId, ownerId);
  if (!role) return false;
  if (role === "admin") return true;
  const row = await env.DB.prepare(
    "SELECT data FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  if (!row) return false;
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return false;
  }
  const record = (Array.isArray(data[collection]) ? data[collection] : []).find(
    (item) => item && item.id === recordId,
  );
  if (!record) return false;
  const ctx = resolveViewerContext(data, actorId);
  return canEditRecord(record, actorId, ctx);
}

export const canManageSite = (env, actorId, ownerId, siteId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "sites", siteId);

export const canManagePublicForm = (env, actorId, ownerId, formId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "publicForms", formId);

export const canManageClientPortal = (env, actorId, ownerId, portalId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "clientPortals", portalId);
