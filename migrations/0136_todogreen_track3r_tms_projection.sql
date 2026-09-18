-- TRACK3R: listas/romaneios como fatos operacionais do TMS.
-- A encomenda continua canônica em todogreen_tms_documents. A lista fica
-- separada porque uma lista agrupa várias encomendas e carrega motorista/veículo.

CREATE TABLE IF NOT EXISTS todogreen_track3r_lists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_list_code TEXT NOT NULL,
  service_code TEXT NOT NULL DEFAULT '',
  list_type TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL DEFAULT '',
  order_count INTEGER NOT NULL DEFAULT 0,
  origin_unit_code TEXT NOT NULL DEFAULT '',
  origin_unit_name TEXT NOT NULL DEFAULT '',
  destination_unit_code TEXT NOT NULL DEFAULT '',
  destination_unit_name TEXT NOT NULL DEFAULT '',
  driver_code TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  driver_document TEXT NOT NULL DEFAULT '',
  driver_type TEXT NOT NULL DEFAULT '',
  vehicle_code TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL DEFAULT '',
  vehicle_class TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, external_list_code)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_lists_vehicle
  ON todogreen_track3r_lists
    (workspace_owner_id, vehicle_plate, generated_at DESC);

CREATE TABLE IF NOT EXISTS todogreen_track3r_list_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_list_code TEXT NOT NULL,
  external_order_code TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, external_list_code, external_order_code)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_list_orders_order
  ON todogreen_track3r_list_orders
    (workspace_owner_id, integration_id, external_order_code, last_seen_at DESC);
