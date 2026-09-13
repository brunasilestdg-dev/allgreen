-- Snapshot de viabilidade operacional (seções 47–50 da consolidação):
-- fotografia IMUTÁVEL e VERSIONADA do que foi prometido numa oportunidade
-- (rota, veículo, energia, autonomia, recarga, risco, custo, CO2, fontes e
-- confiança). Append-only: mudança de premissa cria NOVA versão na mesma
-- cadeia (opportunity_id + scenario_id); nada aqui é atualizado ou apagado.
-- A regra de conteúdo/hash/versão mora em viabilitySnapshotDomain.js.
CREATE TABLE IF NOT EXISTS todogreen_viability_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  previous_content_hash TEXT,
  schema_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_owner_id, opportunity_id, scenario_id, version),
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tdg_viability_owner_opp
  ON todogreen_viability_snapshots(workspace_owner_id, opportunity_id, created_at DESC);
