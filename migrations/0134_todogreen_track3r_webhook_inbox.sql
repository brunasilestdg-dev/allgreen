-- TRACK3R: caixa de entrada idempotente para todos os webhooks documentados.
-- Ocorrências continuam no caminho canônico já existente; os demais eventos
-- entram aqui primeiro para nunca perder payload enquanto cada projetor de
-- domínio (TMS, fiscal, financeiro etc.) é ligado de forma segura.

CREATE TABLE IF NOT EXISTS todogreen_tms_webhook_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_ref TEXT NOT NULL DEFAULT '',
  source_sent_at TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'error')),
  processing_error TEXT NOT NULL DEFAULT '',
  receive_count INTEGER NOT NULL DEFAULT 1,
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_owner_id, integration_id, event_type, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_tdg_tms_webhook_events_type_time
  ON todogreen_tms_webhook_events (workspace_owner_id, event_type, last_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tdg_tms_webhook_events_ref
  ON todogreen_tms_webhook_events (workspace_owner_id, event_type, external_ref);
