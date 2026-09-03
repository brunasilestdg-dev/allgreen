-- Qualidade da vertical To Do Green: não conformidades com causa raiz, plano de
-- ação, dono e prazo. Antes a área só tinha página de orientação apontando para
-- Ocorrências e Indicadores — não havia onde registrar e tratar a NC em si.
--
-- A não conformidade se liga ao cliente e, quando existe, à operação afetada,
-- para Qualidade puxar do mesmo lugar que Operação registra. Segue o mesmo
-- formato das outras coleções da vertical (colunas próprias + fields_json),
-- para o CRUD genérico de todogreen-vertical-records atender sem caso especial.

CREATE TABLE IF NOT EXISTS todogreen_quality_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  operation_id TEXT NOT NULL DEFAULT '',
  -- Tipo da não conformidade: sla, avaria, atraso, documento, processo, outro.
  kind TEXT NOT NULL DEFAULT 'processo',
  -- Gravidade: baixa, media, alta, critica.
  severity TEXT NOT NULL DEFAULT 'media',
  root_cause TEXT NOT NULL DEFAULT '',
  action_plan TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  due_date TEXT,
  -- Situação: aberta, em_acao, resolvida, reincidente.
  status TEXT NOT NULL DEFAULT 'aberta',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todogreen_quality_owner
  ON todogreen_quality_records (workspace_owner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_quality_client
  ON todogreen_quality_records (workspace_owner_id, client_id);
