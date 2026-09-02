-- Convites de primeiro acesso da To Do Green.
-- O token bruto existe apenas no link enviado por e-mail; no banco fica o hash.
CREATE TABLE IF NOT EXISTS todogreen_access_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_access_invites_token
  ON todogreen_access_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_tdg_access_invites_lookup
  ON todogreen_access_invites(tenant_id, workspace_owner_id, email, status);
