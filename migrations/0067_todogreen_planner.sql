-- 0067_todogreen_planner.sql
-- Planner estilo Microsoft Planner: um plano tem baldes (buckets) e tarefas
-- com responsável, prazo, progresso e checklist. Cada plano é PRIVADO (só quem
-- criou vê) ou COMPARTILHADO (todo o espaço vê) — é o "pode ser compartilhado
-- ou não". Convenção da vertical: tenant_id + workspace_owner_id, revision,
-- archived_at.

CREATE TABLE IF NOT EXISTS todogreen_planner_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- private: só o criador; shared: todo o espaço de trabalho.
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'shared')),
  color TEXT NOT NULL DEFAULT '#17624f',
  -- Ordem dos baldes e rótulos, no plano (leves, não indexados).
  buckets_json TEXT NOT NULL DEFAULT '[]',
  owner_user_id TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_planner_plans_ws
  ON todogreen_planner_plans (workspace_owner_id, visibility, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_plans_owner
  ON todogreen_planner_plans (workspace_owner_id, owner_user_id);

CREATE TABLE IF NOT EXISTS todogreen_planner_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  assignee_user_id TEXT NOT NULL DEFAULT '',
  assignee_label TEXT NOT NULL DEFAULT '',
  -- MS Planner: nao_iniciada / em_andamento / concluida. O progresso numérico
  -- é derivado do status e do checklist, nunca digitado avulso.
  progress TEXT NOT NULL DEFAULT 'nao_iniciada'
    CHECK (progress IN ('nao_iniciada', 'em_andamento', 'concluida')),
  priority TEXT NOT NULL DEFAULT 'media'
    CHECK (priority IN ('baixa', 'media', 'alta', 'urgente')),
  start_date TEXT,
  due_date TEXT,
  completed_at TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  display_order INTEGER NOT NULL DEFAULT 100,
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES todogreen_planner_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_plan
  ON todogreen_planner_tasks (workspace_owner_id, plan_id, archived_at, display_order);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_assignee
  ON todogreen_planner_tasks (workspace_owner_id, assignee_user_id, progress, due_date);
