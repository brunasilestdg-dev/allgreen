-- 0087_todogreen_purchase_request_triagem.sql
-- Triagem de Suprimentos: a requisição pode ser DEVOLVIDA ao requisitante para
-- ajuste, ou DIRECIONADA À GESTÃO quando a decisão é acima da alçada de
-- Suprimentos. A 0055 travou `status` num CHECK que não previa esses dois
-- estados, e o SQLite não altera CHECK sem reconstruir a tabela.
--
-- Nenhuma outra tabela referencia todogreen_purchase_requests por chave
-- estrangeira (o pedido guarda request_id como texto solto), então a
-- reconstrução é segura: nova tabela com o CHECK ampliado, cópia dos dados,
-- troca de nome, índices recriados. Todas as demais colunas e regras seguem
-- idênticas à 0055.

CREATE TABLE todogreen_purchase_requests_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  document_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  justification TEXT NOT NULL DEFAULT '',
  requester_user_id TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),
  needed_by TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'pendente', 'devolvida', 'em_gestao', 'aprovada', 'recusada', 'atendida', 'cancelada')),
  items_json TEXT NOT NULL DEFAULT '[]',
  approved_by TEXT,
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
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

INSERT INTO todogreen_purchase_requests_new
  SELECT id, tenant_id, workspace_owner_id, document_number, title, justification,
         requester_user_id, cost_center_id, priority, needed_by, status, items_json,
         approved_by, approved_at, decision_note, fields_json, revision, created_by,
         updated_by, created_at, updated_at, archived_at
    FROM todogreen_purchase_requests;

DROP TABLE todogreen_purchase_requests;
ALTER TABLE todogreen_purchase_requests_new RENAME TO todogreen_purchase_requests;

CREATE INDEX IF NOT EXISTS idx_todogreen_purchase_requests_espaco
  ON todogreen_purchase_requests (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_purchase_requests_fila
  ON todogreen_purchase_requests (workspace_owner_id, status, needed_by);
