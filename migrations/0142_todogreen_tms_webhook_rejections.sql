-- Registro das tentativas de webhook TRACK3R RECUSADAS (401/503).
--
-- A tabela de eventos (todogreen_tms_webhook_events) só guarda o que foi aceito
-- (200). Quando o fornecedor bate num endpoint com token errado/ausente (401) ou
-- num endpoint sem segredo configurado (503), não ficava nenhum rastro — e sem
-- isso não dá para saber se um evento "não chega" porque não é enviado ou porque
-- é enviado e recusado. Este log responde exatamente essa pergunta.
--
-- NUNCA guardar o valor do token aqui. Só se um cabeçalho Token veio (booleano),
-- o endpoint, o status HTTP, o motivo, o IP e a contagem de tentativas.
CREATE TABLE IF NOT EXISTS todogreen_tms_webhook_rejections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  integration_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  http_status INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  token_present INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (tenant_id, integration_id, event_type, http_status, reason, token_present)
);

CREATE INDEX IF NOT EXISTS idx_tdg_tms_webhook_rejections_time
  ON todogreen_tms_webhook_rejections (tenant_id, last_seen_at);
