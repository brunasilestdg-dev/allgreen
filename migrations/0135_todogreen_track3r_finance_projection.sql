-- TRACK3R: fatos financeiros e cadastros de referência recebidos por webhook.
-- Não cria uma segunda contabilidade: faturas são projetadas no Financeiro
-- canônico. Estas tabelas preservam os fatos externos necessários para
-- conciliação, margem por encomenda e resolução de tomador/embarcador/unidade.

CREATE TABLE IF NOT EXISTS todogreen_track3r_entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('embarcador','tomador','unidade')),
  external_code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  trade_name TEXT NOT NULL DEFAULT '',
  document TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, entity_type, external_code)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_entities_document
  ON todogreen_track3r_entities
    (workspace_owner_id, entity_type, document);

CREATE TABLE IF NOT EXISTS todogreen_track3r_order_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_order_code TEXT NOT NULL,
  product_code TEXT NOT NULL DEFAULT '',
  product_description TEXT NOT NULL DEFAULT '',
  merchandise_value REAL NOT NULL DEFAULT 0,
  weight_kg REAL NOT NULL DEFAULT 0,
  freight REAL NOT NULL DEFAULT 0,
  ad_valorem REAL NOT NULL DEFAULT 0,
  gris REAL NOT NULL DEFAULT 0,
  dispatch_fee REAL NOT NULL DEFAULT 0,
  toll_fee REAL NOT NULL DEFAULT 0,
  river_fee REAL NOT NULL DEFAULT 0,
  difficult_access_fee REAL NOT NULL DEFAULT 0,
  unloading_fee REAL NOT NULL DEFAULT 0,
  ctrc_fee REAL NOT NULL DEFAULT 0,
  extra_pickup_fee REAL NOT NULL DEFAULT 0,
  extra_delivery_fee REAL NOT NULL DEFAULT 0,
  trt_fee REAL NOT NULL DEFAULT 0,
  emex_fee REAL NOT NULL DEFAULT 0,
  tde_fee REAL NOT NULL DEFAULT 0,
  cfop TEXT NOT NULL DEFAULT '',
  tax_rate REAL NOT NULL DEFAULT 0,
  icms REAL NOT NULL DEFAULT 0,
  iss REAL NOT NULL DEFAULT 0,
  total_freight REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, external_order_code)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_order_values_workspace
  ON todogreen_track3r_order_values
    (workspace_owner_id, last_seen_at DESC);
