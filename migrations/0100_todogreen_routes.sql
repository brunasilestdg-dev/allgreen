-- Rotas do dia atribuídas a um motorista (#139).
--
-- O roteirizador (RoteirizacaoPage) até aqui era efêmero: traçava, otimizava e
-- mostrava a rota, mas nada ficava salvo nem chegava ao motorista. Esta tabela
-- é o objeto "rota planejada": um cabeçalho (motorista, veículo, data, resumo)
-- e a lista ORDENADA de paradas em `stops_json`. A operação planeja e atribui;
-- o app do motorista lê pelo driver_id (mesmo recorte das viagens) e vai
-- concluindo parada por parada.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id em toda linha,
-- `revision` para concorrência otimista, `archived_at` no lugar de DELETE,
-- `*_json` para o payload de lista com coluna própria só para o que é filtrado.
-- As paradas vivem inteiras em stops_json porque são sempre lidas/gravadas com
-- a rota — nunca consultadas isoladamente.

CREATE TABLE IF NOT EXISTS todogreen_routes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  name TEXT,
  driver_id TEXT,
  driver_name TEXT,
  vehicle_plate TEXT,
  service_date TEXT,
  status TEXT NOT NULL DEFAULT 'planejada',
  origin TEXT,
  destination TEXT,
  distance_km REAL,
  duration_min REAL,
  toll_total REAL,
  stops_json TEXT,
  notes TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- Listagem do espaço, sempre por (dono, ativos, mais recente primeiro).
CREATE INDEX IF NOT EXISTS idx_todogreen_routes_owner
  ON todogreen_routes (workspace_owner_id, archived_at, updated_at DESC);

-- "Minhas rotas" do motorista: recorte por driver_id, como as viagens (0070).
CREATE INDEX IF NOT EXISTS idx_todogreen_routes_driver
  ON todogreen_routes (workspace_owner_id, driver_id, archived_at);
