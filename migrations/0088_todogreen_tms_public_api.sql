-- API externa do TMS To Do Green.
--
-- A credencial é própria do produto logístico, pode ser limitada a um cliente
-- e nunca é persistida em claro. O prefixo serve só para identificação visual.
-- A API usa as tabelas operacionais já existentes como fonte de verdade.

CREATE TABLE IF NOT EXISTS todogreen_tms_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '["shipments:read"]',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
  last_used_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todogreen_tms_api_keys_owner
  ON todogreen_tms_api_keys (tenant_id, workspace_owner_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS todogreen_tms_api_idempotency (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (api_key_id) REFERENCES todogreen_tms_api_keys(id) ON DELETE CASCADE,
  UNIQUE(api_key_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_todogreen_tms_api_idempotency_created
  ON todogreen_tms_api_idempotency (created_at);

-- Eventos recebidos pela API são próprios do TMS e append-only. TRACK3R pode
-- alimentar a mesma linha do tempo depois, sem virar a fonte de verdade.
CREATE TABLE IF NOT EXISTS todogreen_tms_tracking_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  service_order_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  notes TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  external_event_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (service_order_id) REFERENCES todogreen_service_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todogreen_tms_tracking_events_order
  ON todogreen_tms_tracking_events (workspace_owner_id, service_order_id, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_tms_tracking_external_event
  ON todogreen_tms_tracking_events (workspace_owner_id, external_event_id)
  WHERE external_event_id <> '';

-- Unidade física da carga. Permite first/middle/last mile e carga fracionada
-- sem esconder volumes dentro de fields_json da ordem.
CREATE TABLE IF NOT EXISTS todogreen_tms_packages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  service_order_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  weight_kg REAL NOT NULL DEFAULT 0,
  length_cm REAL NOT NULL DEFAULT 0,
  width_cm REAL NOT NULL DEFAULT 0,
  height_cm REAL NOT NULL DEFAULT 0,
  declared_value REAL NOT NULL DEFAULT 0,
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_key TEXT NOT NULL DEFAULT '',
  handling_unit TEXT NOT NULL DEFAULT 'volume',
  status TEXT NOT NULL DEFAULT 'created',
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (service_order_id) REFERENCES todogreen_service_orders(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, workspace_owner_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_todogreen_tms_packages_order
  ON todogreen_tms_packages (workspace_owner_id, service_order_id, status);
