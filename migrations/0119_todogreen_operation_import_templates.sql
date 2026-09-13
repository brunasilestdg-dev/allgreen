-- 0119_todogreen_operation_import_templates.sql
--
-- "Salvar e reusar rotas": rota fixa/recorrente que se repete (mesma lista de
-- paradas, todo dia ou toda semana). Em vez de recolar a lista, a pessoa salva
-- um MODELO nomeado (cliente + paradas, uma por linha, no mesmo formato da
-- importação em massa) e o reaplica quando quiser — a aplicação geocodifica e
-- CRIA operações novas para a data escolhida, que então seguem o fluxo normal
-- do despacho (roteirização, casamento por classe, eventos de entrega). Guardar
-- o texto das paradas, e não rotas prontas, evita rota órfã que os eventos
-- operacionais não conseguem concluir.
--
-- Nome próprio (import_templates) para NÃO colidir com todogreen_route_templates
-- da migração 0062, que é o cadastro de lanes do TMS (origem/destino/unidade) —
-- conceito distinto.

CREATE TABLE IF NOT EXISTS todogreen_operation_import_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  stops_text TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tdg_op_import_templates_owner
  ON todogreen_operation_import_templates (workspace_owner_id, archived_at, name);
