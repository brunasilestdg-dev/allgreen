// Histórico técnico por espaço. Estado atual e evidência são coisas diferentes:
// uma chave pode estar cadastrada, mas só um teste ou sincronização comprova
// autenticação e disponibilidade.
//
// Métricas (seção 114): `latencyMs` e `recordsProcessed` são opcionais e
// alimentam a tela "Saúde do sistema" (colunas da migration 0120).
const clean = (value, size = 500) => String(value || "").trim().slice(0, size);
const inteiroOuNulo = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.round(Number(value)) : null);

export async function recordTodoGreenIntegrationHealth(env, {
  ownerId,
  integrationId,
  configured = false,
  authenticated = false,
  online = false,
  error = "",
  nextAction = "",
  checkedAt = new Date().toISOString(),
  latencyMs = null,
  recordsProcessed = null,
} = {}) {
  if (!env?.DB || !ownerId || !integrationId) return null;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  await env.DB.prepare(
    `INSERT INTO todogreen_integration_health_events
      (id, workspace_owner_id, integration_id, configured, authenticated, online, error_message, next_action, checked_at, latency_ms, records_processed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, clean(ownerId, 100), clean(integrationId, 80),
    configured ? 1 : 0, authenticated ? 1 : 0, online ? 1 : 0,
    clean(error, 500), clean(nextAction, 300), checkedAt,
    inteiroOuNulo(latencyMs), inteiroOuNulo(recordsProcessed),
  ).run().catch(() => null);
  return id;
}

export async function latestTodoGreenIntegrationHealth(env, ownerId) {
  if (!env?.DB || !ownerId) return [];
  const rows = await env.DB.prepare(
    `SELECT integration_id AS integrationId, configured, authenticated, online,
            error_message AS error, next_action AS nextAction, checked_at AS checkedAt,
            latency_ms AS latencyMs, records_processed AS recordsProcessed
       FROM todogreen_integration_health_events
      WHERE workspace_owner_id = ?
      ORDER BY checked_at DESC`,
  ).bind(clean(ownerId, 100)).all().then((result) => result.results || []).catch(() => []);

  // Último evento por integração + último SUCESSO e última FALHA (podem ser
  // eventos diferentes): é o que distingue "caiu agora" de "nunca funcionou".
  const latest = new Map();
  const lastSuccess = new Map();
  const lastFailure = new Map();
  for (const row of rows) {
    const online = Boolean(row.online);
    if (online && !lastSuccess.has(row.integrationId)) lastSuccess.set(row.integrationId, row.checkedAt);
    if (!online && !lastFailure.has(row.integrationId)) lastFailure.set(row.integrationId, row.checkedAt);
    if (!latest.has(row.integrationId))
      latest.set(row.integrationId, {
        ...row,
        configured: Boolean(row.configured),
        authenticated: Boolean(row.authenticated),
        online,
        latencyMs: inteiroOuNulo(row.latencyMs),
        recordsProcessed: inteiroOuNulo(row.recordsProcessed),
      });
  }
  return [...latest.values()].map((row) => ({
    ...row,
    lastSuccessAt: lastSuccess.get(row.integrationId) || null,
    lastFailureAt: lastFailure.get(row.integrationId) || null,
  }));
}
