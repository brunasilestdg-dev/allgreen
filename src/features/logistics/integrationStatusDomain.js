// ===== Estado canônico de integração (observabilidade) =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM.
//
// Seção 32: código existente NÃO significa integração ativa. Toda integração
// precisa informar um ESTADO honesto. O serviço todogreen-integration-health
// guarda os flags brutos por espaço (configured/authenticated/online/error/
// checkedAt); este domínio DERIVA daí o estado canônico e o frescor, para a UI
// e os health checks mostrarem a verdade — nunca "ativo" quando não está.
//
// Estados (seção 32):
//   CONNECTED           — configurado, autenticado, online e recente
//   DEGRADED            — configurado e autenticado, mas offline agora ou dado velho
//   FALLBACK            — operando com fonte de contingência declarada
//   NOT_CONFIGURED      — sem credencial/URL: a integração nem foi ligada
//   EXTERNAL_DEPENDENCY — configurado, mas aguardando credencial/dependência externa
//   ERROR               — configurado e falhando de fato

export const INTEGRATION_STATES = Object.freeze({
  CONNECTED: "CONNECTED",
  DEGRADED: "DEGRADED",
  FALLBACK: "FALLBACK",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  EXTERNAL_DEPENDENCY: "EXTERNAL_DEPENDENCY",
  ERROR: "ERROR",
});

const bool = (v) => v === true || v === 1 || v === "1" || v === "true";
const parseTime = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Deriva o estado canônico + frescor de uma integração a partir dos flags de
 * saúde. `staleMs` define quando o último sucesso é considerado velho.
 */
export function deriveIntegrationStatus(health = {}, { now = Date.now(), staleMs } = {}) {
  const configured = bool(health.configured);
  const authenticated = bool(health.authenticated);
  const online = bool(health.online);
  const fallbackActive = bool(health.fallbackActive);
  const error = String(health.error || "").trim();

  const lastSuccessAt = parseTime(health.lastSuccessAt) ?? (online ? parseTime(health.checkedAt) : null);
  const lastFailureAt = parseTime(health.lastFailureAt) ?? (error ? parseTime(health.checkedAt) : null);
  const reference = lastSuccessAt ?? parseTime(health.checkedAt);
  const ageMs = reference === null ? null : Math.max(0, now - reference);
  const stale = Number.isFinite(Number(staleMs)) && ageMs !== null ? ageMs > Number(staleMs) : false;

  let state;
  if (!configured) state = INTEGRATION_STATES.NOT_CONFIGURED;
  else if (error && !online) state = INTEGRATION_STATES.ERROR;
  else if (!authenticated) state = INTEGRATION_STATES.EXTERNAL_DEPENDENCY;
  else if (fallbackActive) state = INTEGRATION_STATES.FALLBACK;
  else if (!online) state = INTEGRATION_STATES.DEGRADED;
  else if (stale) state = INTEGRATION_STATES.DEGRADED;
  else state = INTEGRATION_STATES.CONNECTED;

  return {
    integrationId: String(health.integrationId || "").trim(),
    state,
    stale,
    ageMs,
    configured,
    authenticated,
    online,
    fallbackActive,
    error,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : null,
    checkedAt: health.checkedAt || null,
  };
}

const HEALTHY = new Set([INTEGRATION_STATES.CONNECTED]);
const ATTENTION = new Set([INTEGRATION_STATES.DEGRADED, INTEGRATION_STATES.FALLBACK, INTEGRATION_STATES.EXTERNAL_DEPENDENCY]);
const BROKEN = new Set([INTEGRATION_STATES.ERROR]);

// Agrega uma lista de integrações num panorama para o painel.
export function summarizeIntegrations(list = [], opts = {}) {
  const statuses = (Array.isArray(list) ? list : []).map((h) => deriveIntegrationStatus(h, opts));
  const counts = statuses.reduce((acc, s) => {
    acc[s.state] = (acc[s.state] || 0) + 1;
    return acc;
  }, {});
  return {
    total: statuses.length,
    counts,
    healthy: statuses.filter((s) => HEALTHY.has(s.state)).length,
    attention: statuses.filter((s) => ATTENTION.has(s.state)).length,
    broken: statuses.filter((s) => BROKEN.has(s.state)).length,
    notConfigured: statuses.filter((s) => s.state === INTEGRATION_STATES.NOT_CONFIGURED).length,
    statuses,
  };
}

const LABEL_PT = {
  CONNECTED: "Conectado",
  DEGRADED: "Degradado",
  FALLBACK: "Contingência",
  NOT_CONFIGURED: "Não configurado",
  EXTERNAL_DEPENDENCY: "Aguardando credencial/externo",
  ERROR: "Com erro",
};
export const integrationStateLabel = (state) => LABEL_PT[state] || state;
