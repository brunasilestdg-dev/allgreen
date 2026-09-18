-- monday.com -> To Do Green
-- Estado OAuth 2.1/PKCE, conexão por conta e inbox idempotente de webhooks.

CREATE TABLE IF NOT EXISTS todogreen_monday_oauth_states (
  state TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdg_monday_oauth_exp
  ON todogreen_monday_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS todogreen_monday_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  monday_account_id TEXT NOT NULL,
  monday_account_name TEXT NOT NULL DEFAULT '',
  monday_account_slug TEXT NOT NULL DEFAULT '',
  connected_by TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, monday_account_id)
);

CREATE INDEX IF NOT EXISTS idx_tdg_monday_connections_workspace
  ON todogreen_monday_connections(tenant_id, workspace_owner_id, status);

CREATE TABLE IF NOT EXISTS todogreen_monday_webhook_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  monday_account_id TEXT NOT NULL DEFAULT '',
  monday_user_id TEXT NOT NULL DEFAULT '',
  board_id TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  processing_error TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdg_monday_webhook_board
  ON todogreen_monday_webhook_events(monday_account_id, board_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tdg_monday_webhook_status
  ON todogreen_monday_webhook_events(status, received_at);
