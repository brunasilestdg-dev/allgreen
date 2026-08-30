-- Workflows empresariais transversais: Jurídico, Qualidade e Marketing.
-- O mesmo motor serve a qualquer processo que precise dono, SLA, aprovação,
-- histórico e recorrência, sem cada área inventar uma tabela diferente.

CREATE TABLE IF NOT EXISTS todogreen_enterprise_workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('legal','quality','marketing','general')),
  kind TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  owner_user_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','in_progress','blocked','done','cancelled')),
  due_at TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  approval_json TEXT NOT NULL DEFAULT '{}',
  recurrence_json TEXT NOT NULL DEFAULT '{}',
  source_template_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tdg_enterprise_workflows_scope
  ON todogreen_enterprise_workflows (tenant_id, workspace_owner_id, domain, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tdg_enterprise_workflows_due
  ON todogreen_enterprise_workflows (tenant_id, workspace_owner_id, due_at, status);

CREATE TABLE IF NOT EXISTS todogreen_enterprise_workflow_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES todogreen_enterprise_workflows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_enterprise_workflow_events
  ON todogreen_enterprise_workflow_events (workflow_id, created_at);

-- Arquivos internos em chunks. Contrato recebido do cliente pode continuar só
-- como referência externa; documento próprio pode ser enviado e guardado aqui.
CREATE TABLE IF NOT EXISTS todogreen_internal_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT,
  workflow_id TEXT,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'internal_upload' CHECK (source IN ('internal_upload','client_reference')),
  external_url TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_internal_files_scope
  ON todogreen_internal_files (tenant_id, workspace_owner_id, client_id, created_at);

CREATE TABLE IF NOT EXISTS todogreen_internal_file_chunks (
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_base64 TEXT NOT NULL,
  PRIMARY KEY (file_id, chunk_index),
  FOREIGN KEY (file_id) REFERENCES todogreen_internal_files(id) ON DELETE CASCADE
);
