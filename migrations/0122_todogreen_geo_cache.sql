-- Cache de dados geográficos/externos (seção 115): elevação (Valhalla
-- /height), clima (Open-Meteo) e futuras consultas caras. Guarda quando a
-- FONTE atualizou (source_updated_at) e quando NÓS ingerimos (ingested_at),
-- para o consumidor dizer "dado de tal hora" em vez de fingir tempo real.
-- Sem escopo por espaço: a altura de um ponto e o clima de uma coordenada não
-- pertencem a um cliente. Nada aqui é verdade de negócio — é acelerador.
CREATE TABLE IF NOT EXISTS todogreen_geo_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT,
  ingested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdg_geo_cache_kind_expires
  ON todogreen_geo_cache(kind, expires_at);
