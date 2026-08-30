-- 0078_todogreen_crm_comments.sql
-- Comentários do comercial, com a regra de alcance da titular (30/08):
-- comentário na CONTA (client_id preenchido, opportunity_id vazio) aparece em
-- todas as oportunidades daquela conta; comentário numa OPORTUNIDADE
-- (opportunity_id preenchido) fica só nela, mesmo quando a oportunidade está
-- atrelada a um cliente. A regra mora no dado — quem lê decide o corte com os
-- dois campos, sem tabela de espelhamento.
CREATE TABLE IF NOT EXISTS todogreen_crm_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  opportunity_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  -- Autor carimbado pelo servidor a partir da sessão; o navegador não escolhe.
  author_email TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_crm_comments_owner
  ON todogreen_crm_comments (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_crm_comments_client
  ON todogreen_crm_comments (workspace_owner_id, client_id, archived_at);
