// Histórico técnico por espaço. Estado atual e evidência são coisas diferentes:
// uma chave pode estar cadastrada, mas só um teste ou sincronização comprova
// autenticação e disponibilidade.
const clean = (value, size = 500) => String(value || "").trim().slice(0, size);

export async function recordTodoGreenIntegrationHealth(env, {
  ownerId,
  integrationId,
  configured = false,
  authenticated = false,
  online = false,
  error = "",
  nextAction = "",
  checkedAt = new Date().toISOString(),
} = {}) {
  if (!env?.DB || !ownerId || !integrationId) return null;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  await env.DB.prepare(
    `INSERT INTO todogreen_integration_health_events
      (id, workspace_owner_id, integration_id, configured, authenticated, online, error_message, next_action, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, clean(ownerId, 100), clean(integrationId, 80),
    configured ? 1 : 0, authenticated ? 1 : 0, online ? 1 : 0,
    clean(error, 500), clean(nextAction, 300), checkedAt,
  ).run().catch(() => null);
  return id;
}

export async function latestTodoGreenIntegrationHealth(env, ownerId) {
  if (!env?.DB || !ownerId) return [];
  const rows = await env.DB.prepare(
    `SELECT integration_id AS integrationId, configured, authenticated, online,
            error_message AS error, next_action AS nextAction, checked_at AS checkedAt
       FROM todogreen_integration_health_events
      WHERE workspace_owner_id = ?
      ORDER BY checked_at DESC`,
  ).bind(clean(ownerId, 100)).all().then((result) => result.results || []).catch(() => []);

  const latest = new Map();
  for (const row of rows)
    if (!latest.has(row.integrationId))
      latest.set(row.integrationId, {
        ...row,
        configured: Boolean(row.configured),
        authenticated: Boolean(row.authenticated),
        online: Boolean(row.online),
      });
  return [...latest.values()];
}
