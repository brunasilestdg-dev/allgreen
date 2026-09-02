import { randomHex, sha256 } from "../auth/credenciais.js";
import { json } from "../lib/http.js";
import { podeNaVertical, TENANT_ID } from "./todogreen-access.js";

export const TMS_API_SCOPES = Object.freeze([
  "shipments:read",
  "shipments:write",
  "tracking:write",
  "pod:write",
  "routing:write",
  "fiscal:read",
  "ciot:read",
  "billing:read",
]);

const canManageKeys = (access) =>
  ["owner", "admin"].includes(access?.role)
  || podeNaVertical(access, "*")
  || podeNaVertical(access, "integration:manage")
  || podeNaVertical(access, "tms:manage");

const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);

const view = (row) => ({
  id: row.id,
  name: row.name,
  clientId: row.client_id || "",
  keyPrefix: row.key_prefix,
  scopes: (() => {
    try { return JSON.parse(row.scopes_json || "[]"); } catch { return []; }
  })(),
  rateLimitPerMinute: Number(row.rate_limit_per_minute || 120),
  lastUsedAt: row.last_used_at || null,
  revokedAt: row.revoked_at || null,
  createdAt: row.created_at,
});

export async function handleTodoGreenTmsApiKeys(request, env, access, user, url) {
  if (!canManageKeys(access))
    return json({ error: "Seu acesso não permite gerenciar a API externa do TMS." }, 403);

  const parts = url.pathname.replace(/^\/api\/todogreen\/tms-api-keys\/?/, "").split("/").filter(Boolean);
  const id = parts[0] || "";

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id,name,client_id,key_prefix,scopes_json,rate_limit_per_minute,last_used_at,revoked_at,created_at
         FROM todogreen_tms_api_keys
        WHERE tenant_id=? AND workspace_owner_id=?
        ORDER BY revoked_at IS NULL DESC, created_at DESC`,
    ).bind(TENANT_ID, access.ownerId).all();
    return json({ keys: (rows.results || []).map(view), availableScopes: TMS_API_SCOPES });
  }

  if (request.method === "POST" && !id) {
    const body = await request.json().catch(() => ({}));
    const name = text(body.name, 80);
    const clientId = text(body.clientId, 120);
    if (!name) return json({ error: "Informe um nome para identificar a chave." }, 400);

    const requested = Array.isArray(body.scopes) ? body.scopes : ["shipments:read"];
    const scopes = [...new Set(requested.map((item) => text(item, 40)).filter((item) => TMS_API_SCOPES.includes(item)))];
    if (!scopes.length) return json({ error: "Selecione ao menos um escopo válido." }, 400);

    // Chave limitada a cliente só nasce se esse cliente existir no domínio
    // operacional do mesmo workspace. Contrato, OS ou operação é evidência
    // suficiente durante a consolidação dos cadastros legados.
    if (clientId) {
      const client = await env.DB.prepare(
        `SELECT client_id FROM (
           SELECT client_id FROM todogreen_contracts WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
           UNION ALL
           SELECT client_id FROM todogreen_service_orders WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
           UNION ALL
           SELECT client_id FROM todogreen_client_operations WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
         ) LIMIT 1`,
      ).bind(TENANT_ID, access.ownerId, clientId, TENANT_ID, access.ownerId, clientId, TENANT_ID, access.ownerId, clientId).first().catch(() => null);
      if (!client) return json({ error: "Cliente não encontrado neste espaço da To Do Green." }, 404);
    }

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_tms_api_keys
        WHERE tenant_id=? AND workspace_owner_id=? AND revoked_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId).first();
    if (Number(count?.total || 0) >= 30)
      return json({ error: "Limite de 30 chaves ativas atingido. Revogue uma chave antes de criar outra." }, 409);

    const rateLimit = Math.min(600, Math.max(30, Number(body.rateLimitPerMinute) || 120));
    const key = `tdg_live_${randomHex(24)}`;
    const now = new Date().toISOString();
    const keyId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_tms_api_keys
       (id,tenant_id,workspace_owner_id,client_id,name,key_hash,key_prefix,scopes_json,
        rate_limit_per_minute,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      keyId, TENANT_ID, access.ownerId, clientId, name, await sha256(key), key.slice(0, 17),
      JSON.stringify(scopes), rateLimit, user.id, now,
    ).run();

    return json({
      id: keyId,
      key,
      keyPrefix: key.slice(0, 17),
      clientId,
      scopes,
      rateLimitPerMinute: rateLimit,
      warning: "Copie esta chave agora. O valor completo não será exibido novamente.",
    }, 201);
  }

  if (request.method === "DELETE" && id) {
    const result = await env.DB.prepare(
      `UPDATE todogreen_tms_api_keys SET revoked_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revoked_at IS NULL`,
    ).bind(new Date().toISOString(), id, TENANT_ID, access.ownerId).run();
    if (!result.meta?.changes) return json({ error: "Chave não encontrada ou já revogada." }, 404);
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
}
