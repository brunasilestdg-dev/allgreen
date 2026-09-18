-- TRACK3R: cotações recebidas como referência comercial/precificação.
-- Não viram cenário canônico automaticamente: uma cotação do fornecedor não
-- deve substituir uma simulação aprovada da To Do Green.

CREATE TABLE IF NOT EXISTS todogreen_track3r_quotes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_quote_code TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  taker_code TEXT NOT NULL DEFAULT '',
  shipper_code TEXT NOT NULL DEFAULT '',
  service_code TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  volume_count INTEGER NOT NULL DEFAULT 0,
  volumes_json TEXT NOT NULL DEFAULT '[]',
  origin_ibge TEXT NOT NULL DEFAULT '',
  origin_city TEXT NOT NULL DEFAULT '',
  origin_state TEXT NOT NULL DEFAULT '',
  destination_zip TEXT NOT NULL DEFAULT '',
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  freight_weight REAL NOT NULL DEFAULT 0,
  pickup_fee REAL NOT NULL DEFAULT 0,
  delivery_fee REAL NOT NULL DEFAULT 0,
  dispatch_fee REAL NOT NULL DEFAULT 0,
  ad_valorem REAL NOT NULL DEFAULT 0,
  gris REAL NOT NULL DEFAULT 0,
  quoted_amount REAL NOT NULL DEFAULT 0,
  tax_type TEXT NOT NULL DEFAULT '',
  tax_description TEXT NOT NULL DEFAULT '',
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_base REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  lead_time_value REAL NOT NULL DEFAULT 0,
  lead_time_unit TEXT NOT NULL DEFAULT '',
  promised_date TEXT NOT NULL DEFAULT '',
  weight_entered REAL NOT NULL DEFAULT 0,
  weight_cubed REAL NOT NULL DEFAULT 0,
  weight_charged REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, external_quote_code)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_quotes_workspace
  ON todogreen_track3r_quotes
    (workspace_owner_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_quotes_client
  ON todogreen_track3r_quotes
    (workspace_owner_id, client_id, last_seen_at DESC);
