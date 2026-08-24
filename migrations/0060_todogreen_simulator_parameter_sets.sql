-- Parâmetros do simulador por escopo, com versionamento e isolamento do espaço.
-- A tabela antiga permanece para leitura de réguas já existentes.

CREATE TABLE IF NOT EXISTS todogreen_simulator_parameter_sets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global','product','modality','vehicle','region','client','contract')),
  scope_key TEXT NOT NULL DEFAULT 'global',
  parameters_json TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','superseded','archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, scope_type, scope_key, version)
);

CREATE INDEX IF NOT EXISTS idx_todogreen_simulator_parameters_active
  ON todogreen_simulator_parameter_sets
    (tenant_id, workspace_owner_id, status, scope_type, scope_key, effective_from DESC);
