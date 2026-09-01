-- Evidência de saúde de conectores por espaço. Não guarda credenciais,
-- payloads de clientes nem resposta de provedores, apenas o diagnóstico útil.
CREATE TABLE IF NOT EXISTS todogreen_integration_health_events (
  id TEXT PRIMARY KEY,
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  configured INTEGER NOT NULL DEFAULT 0,
  authenticated INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  next_action TEXT,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdg_integration_health_owner_checked
  ON todogreen_integration_health_events(workspace_owner_id, checked_at DESC);
