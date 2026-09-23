-- Mercado Livre / Mercado Envios -> To Do Green
-- Estado OAuth 2.0 + PKCE e conexão por espaço (tokens cifrados em AES-GCM).
-- O refresh token do Mercado Livre é de uso único: toda renovação grava o novo.

CREATE TABLE IF NOT EXISTS todogreen_mercadolivre_oauth_states (
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

CREATE INDEX IF NOT EXISTS idx_tdg_meli_oauth_exp
  ON todogreen_mercadolivre_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS todogreen_mercadolivre_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  meli_user_id TEXT NOT NULL,
  meli_nickname TEXT NOT NULL DEFAULT '',
  connected_by TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id)
);
