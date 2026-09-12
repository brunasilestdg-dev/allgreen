-- Pontos de recarga próprios da To Do Green (bloco de eletrificação).
--
-- O roteirizador já mostra carregadores PÚBLICOS (Open Charge Map / OSM), mas
-- eles são efêmeros: consulta por raio, nada persiste. Faltava o cadastro dos
-- pontos PRÓPRIOS — os que a operação instalou ou contratou (Ground, GreenOn,
-- pátio próprio) — para planejar a rota contando com a infra real da empresa,
-- não só com a rede pública.
--
-- Convenção da vertical (cabeçalho da 0041): tenant_id + workspace_owner_id em
-- toda linha, revision, archived_at em vez de DELETE, colunas próprias só para o
-- que é filtrado; o resto em fields_json. É cadastro da EMPRESA — não tem
-- client_id nem recorte de carteira.
--
-- "Serve pesado" NÃO é coluna: deriva de corrente + potência na leitura
-- (chargingPointsDomain.servePesado), para não gravar uma verdade que pode
-- divergir do fato quando a potência muda.

CREATE TABLE IF NOT EXISTS todogreen_charging_points (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT '',
  current_type TEXT NOT NULL DEFAULT 'AC',
  connector TEXT NOT NULL DEFAULT '',
  power_kw REAL NOT NULL DEFAULT 0,
  latitude REAL,
  longitude REAL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ativo',
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

CREATE INDEX IF NOT EXISTS idx_tdg_charging_owner
  ON todogreen_charging_points (workspace_owner_id, status, updated_at DESC);
