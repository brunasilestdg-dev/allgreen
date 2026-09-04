-- Jurídico da vertical To Do Green: minutas, contratos, aditivos e afins com
-- risco, vigência, responsável e situação. Antes a área só tinha página de
-- orientação apontando para Propostas e Documentos — não havia onde registrar e
-- conduzir o próprio documento jurídico.
--
-- O documento se liga ao cliente (e guarda a contraparte por texto, para quando
-- não é um cliente da carteira). Segue o mesmo formato das outras coleções da
-- vertical (colunas próprias + fields_json), para o CRUD genérico de
-- todogreen-vertical-records atender sem caso especial.

CREATE TABLE IF NOT EXISTS todogreen_legal_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  -- Tipo: contrato, aditivo, minuta, nda, procuracao, notificacao, parecer, outro.
  kind TEXT NOT NULL DEFAULT 'minuta',
  -- Risco jurídico: baixo, medio, alto.
  risk TEXT NOT NULL DEFAULT 'medio',
  effective_start TEXT,
  effective_end TEXT,
  owner_user_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  -- Situação: rascunho, em_analise, aprovado, assinado, arquivado, recusado.
  status TEXT NOT NULL DEFAULT 'rascunho',
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

CREATE INDEX IF NOT EXISTS idx_todogreen_legal_owner
  ON todogreen_legal_records (workspace_owner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_legal_client
  ON todogreen_legal_records (workspace_owner_id, client_id);
