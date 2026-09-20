-- Ponte TEMPORÁRIA de receita comercial até os webhooks/API do Track3R entrarem.
-- Guarda um retrato (daily + monthly, já pré-agregado pela extração externa)
-- por workspace. NÃO é a contabilidade canônica (essa segue em
-- todogreen_financial_entries/titles): o painel só usa este retrato como fonte
-- de receita enquanto o ledger canônico estiver vazio. Uma linha por
-- (tenant, workspace, fonte) — a reimportação substitui o retrato.
CREATE TABLE IF NOT EXISTS todogreen_commercial_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'artefato',
  daily_json TEXT NOT NULL DEFAULT '[]',
  monthly_json TEXT NOT NULL DEFAULT '[]',
  captured_from TEXT NOT NULL DEFAULT '',
  captured_to TEXT NOT NULL DEFAULT '',
  total_receita REAL NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, source)
);
