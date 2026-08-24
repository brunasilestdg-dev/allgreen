-- 0062_todogreen_work_management.sql
-- Gestão de trabalho nível Monday na vertical: grupos dentro do board, subitens,
-- marcos, recorrências, checklists, tags e data de início. Tudo ADITIVO sobre o
-- todogreen_work_items que já existe — o handler atual continua funcionando sem
-- conhecer as colunas novas (todas com DEFAULT).
-- Convenção: tenant_id + workspace_owner_id, revision, archived_at, *_json para
-- payload, coluna própria só para o que se filtra ou ordena.

-- ── Grupos dentro do board ──────────────────────────────────
-- Uma faixa do board ("A fazer", "Em execução", "Backlog do cliente X"). O item
-- aponta para o grupo; o board organiza os grupos por ordem.

CREATE TABLE IF NOT EXISTS todogreen_work_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#17624f',
  display_order INTEGER NOT NULL DEFAULT 100,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT,
  FOREIGN KEY (board_id) REFERENCES todogreen_work_boards(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_groups_board
  ON todogreen_work_groups (workspace_owner_id, board_id, display_order);

-- ── Colunas novas no item ───────────────────────────────────
-- group_id      : a faixa do board (nulo = sem grupo).
-- parent_item_id: subitem aponta para o item pai (nulo = item de topo).
-- is_milestone  : marco — um item sem duração que baliza a timeline.
-- start_date    : início planejado; com due_date fecha a barra do Gantt.
-- recurrence_json: regra de repetição (frequência, intervalo, fim).
-- checklist_json : itens de verificação [{texto, feito}].
-- tags_json      : etiquetas do item.

ALTER TABLE todogreen_work_items ADD COLUMN group_id TEXT;
ALTER TABLE todogreen_work_items ADD COLUMN parent_item_id TEXT;
ALTER TABLE todogreen_work_items ADD COLUMN is_milestone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE todogreen_work_items ADD COLUMN start_date TEXT;
ALTER TABLE todogreen_work_items ADD COLUMN recurrence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE todogreen_work_items ADD COLUMN checklist_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE todogreen_work_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_work_items_group
  ON todogreen_work_items (workspace_owner_id, group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_parent
  ON todogreen_work_items (workspace_owner_id, parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_schedule
  ON todogreen_work_items (workspace_owner_id, board_id, start_date, due_date);
