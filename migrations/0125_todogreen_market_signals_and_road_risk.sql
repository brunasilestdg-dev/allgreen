-- P5/P6 — Radar estruturado (PNCP · Compras.gov · GDELT → market_signal com
-- fingerprint e score explicável) e Risk Map (PRF por célula geográfica,
-- ANTT por rodovia/km). Sinais e índice de risco são fatos públicos do tenant;
-- a triagem do sinal é por espaço. Tudo aditivo.

CREATE TABLE IF NOT EXISTS todogreen_market_signals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  orgao TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  municipio TEXT NOT NULL DEFAULT '',
  esfera TEXT NOT NULL DEFAULT '',
  modalidade TEXT NOT NULL DEFAULT '',
  situacao TEXT NOT NULL DEFAULT '',
  valor_estimado REAL,
  publicado_em TEXT NOT NULL DEFAULT '',
  prazo_proposta TEXT NOT NULL DEFAULT '',
  dominio TEXT NOT NULL DEFAULT '',
  idioma TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  score_reasons_json TEXT NOT NULL DEFAULT '[]',
  query_text TEXT NOT NULL DEFAULT '',
  seen_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_todogreen_market_signals_score
  ON todogreen_market_signals (tenant_id, kind, score DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_market_signals_uf
  ON todogreen_market_signals (tenant_id, uf, prazo_proposta);

-- Triagem por espaço (novo/triado/descartado/convertido) — o sinal é público,
-- a decisão é de cada operação.
CREATE TABLE IF NOT EXISTS todogreen_market_signal_triage (
  workspace_owner_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT NOT NULL DEFAULT '',
  opportunity_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_owner_id, signal_id)
);

-- Estado de sincronização das fontes públicas de mercado e risco (mesmo
-- formato de todogreen_energy_reference_sync; source = 'pncp:transporte',
-- 'compras-gov', 'gdelt:<termo>', 'antt:<recurso>', 'prf:import').
CREATE TABLE IF NOT EXISTS todogreen_reference_sync (
  source TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  status TEXT NOT NULL DEFAULT 'never',
  last_attempt_at TEXT NOT NULL DEFAULT '',
  last_success_at TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT NOT NULL DEFAULT '',
  records INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error_message TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}'
);

-- Risk Map: células geográficas (~1,1 km) com UPS agregada das ocorrências da
-- PRF (latitude/longitude) e segmentos rodovia/km (PRF e ANTT).
CREATE TABLE IF NOT EXISTS todogreen_road_risk_cells (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  source TEXT NOT NULL DEFAULT 'prf',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  acidentes INTEGER NOT NULL DEFAULT 0,
  mortos INTEGER NOT NULL DEFAULT 0,
  feridos_graves INTEGER NOT NULL DEFAULT 0,
  feridos_leves INTEGER NOT NULL DEFAULT 0,
  ups REAL NOT NULL DEFAULT 0,
  rodovias_json TEXT NOT NULL DEFAULT '[]',
  primeiro TEXT NOT NULL DEFAULT '',
  ultimo TEXT NOT NULL DEFAULT '',
  janela_meses INTEGER NOT NULL DEFAULT 24,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todogreen_road_risk_cells_ups
  ON todogreen_road_risk_cells (tenant_id, ups DESC);

CREATE TABLE IF NOT EXISTS todogreen_road_risk_segments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  source TEXT NOT NULL,
  rodovia TEXT NOT NULL,
  km INTEGER NOT NULL,
  concessionaria TEXT NOT NULL DEFAULT '',
  acidentes INTEGER NOT NULL DEFAULT 0,
  mortos INTEGER NOT NULL DEFAULT 0,
  feridos INTEGER NOT NULL DEFAULT 0,
  ups REAL NOT NULL DEFAULT 0,
  primeiro TEXT NOT NULL DEFAULT '',
  ultimo TEXT NOT NULL DEFAULT '',
  janela_meses INTEGER NOT NULL DEFAULT 12,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todogreen_road_risk_segments_rodovia
  ON todogreen_road_risk_segments (tenant_id, rodovia, km);
