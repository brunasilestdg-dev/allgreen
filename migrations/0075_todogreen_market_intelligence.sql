-- 0075_todogreen_market_intelligence.sql
--
-- Inteligência de mercado não é inteligência de uma conta. RFQs, notícias e
-- sinais comerciais relevantes para a To Do Green precisam existir antes de
-- a empresa virar cliente ou entrar na carteira de alguém.

CREATE TABLE IF NOT EXISTS todogreen_market_research_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  query_plan_json TEXT NOT NULL DEFAULT '[]',
  providers_json TEXT NOT NULL DEFAULT '[]',
  failures_json TEXT NOT NULL DEFAULT '[]',
  result_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todogreen_market_runs_workspace
  ON todogreen_market_research_runs
    (tenant_id, workspace_owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS todogreen_market_intelligence_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  source_query TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, workspace_owner_id, kind, url),
  FOREIGN KEY (run_id) REFERENCES todogreen_market_research_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todogreen_market_items_workspace
  ON todogreen_market_intelligence_items
    (tenant_id, workspace_owner_id, kind, status, checked_at DESC);
