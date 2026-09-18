-- TRACK3R: averbação recebida do TMS como fato externo.
-- CT-e usa o módulo fiscal canônico (todogreen_fiscal_documents). Averbação
-- permanece separada porque é evidência de seguro, não um documento SEFAZ.

CREATE TABLE IF NOT EXISTS todogreen_track3r_endorsements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_order_code TEXT NOT NULL,
  external_cte_code TEXT NOT NULL DEFAULT '',
  cte_number TEXT NOT NULL DEFAULT '',
  cte_series TEXT NOT NULL DEFAULT '',
  endorsed_at TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, integration_id, external_order_code, protocol)
);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_endorsements_order
  ON todogreen_track3r_endorsements
    (workspace_owner_id, integration_id, external_order_code, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_tdg_track3r_endorsements_cte
  ON todogreen_track3r_endorsements
    (workspace_owner_id, cte_number, cte_series);
