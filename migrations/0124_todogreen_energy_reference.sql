-- P4 — Energia: referências públicas (ANEEL tarifas homologadas, ANP preço de
-- diesel, ONS curva de carga) em cache operacional + perfil de energia do
-- espaço. Referências são fatos públicos compartilhados pelo tenant; o perfil
-- (distribuidora, subgrupo, modalidade, UF/município, demanda contratada,
-- tarifas/preços contratuais e horários da frota) é por espaço. Tudo aditivo.

CREATE TABLE IF NOT EXISTS todogreen_energy_profiles (
  workspace_owner_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  distribuidora TEXT NOT NULL DEFAULT '',
  subgrupo TEXT NOT NULL DEFAULT '',
  modalidade TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  municipio TEXT NOT NULL DEFAULT '',
  regiao TEXT NOT NULL DEFAULT '',
  subsistema_ons TEXT NOT NULL DEFAULT 'SE',
  demanda_contratada_kw REAL,
  tarifa_contratual_kwh REAL,
  tarifa_contratual_data TEXT NOT NULL DEFAULT '',
  tarifa_informada_kwh REAL,
  tarifa_informada_data TEXT NOT NULL DEFAULT '',
  tarifa_fallback_kwh REAL,
  horas_ponta_json TEXT NOT NULL DEFAULT '[]',
  horas_intermediario_json TEXT NOT NULL DEFAULT '[]',
  diesel_produto TEXT NOT NULL DEFAULT 'diesel_s10',
  diesel_contratual_l REAL,
  diesel_contratual_data TEXT NOT NULL DEFAULT '',
  diesel_frota_l REAL,
  diesel_frota_data TEXT NOT NULL DEFAULT '',
  diesel_fallback_l REAL,
  saida_hora INTEGER,
  chegada_hora INTEGER,
  soc_chegada_percent REAL,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tarifas homologadas da ANEEL (dados abertos, "Tarifa de Aplicação"), por
-- distribuidora/subgrupo/modalidade/posto e vigência. R$/MWh como publicado;
-- tarifa_kwh = (TUSD + TE) / 1000. source_updated_at = DatGeracaoConjuntoDados.
CREATE TABLE IF NOT EXISTS todogreen_energy_tariff_reference (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  distribuidora TEXT NOT NULL,
  cnpj TEXT NOT NULL DEFAULT '',
  resolucao TEXT NOT NULL DEFAULT '',
  base_tarifaria TEXT NOT NULL DEFAULT '',
  subgrupo TEXT NOT NULL,
  modalidade TEXT NOT NULL,
  classe TEXT NOT NULL DEFAULT '',
  subclasse TEXT NOT NULL DEFAULT '',
  detalhe TEXT NOT NULL DEFAULT '',
  posto TEXT NOT NULL DEFAULT '',
  faixa TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL DEFAULT 'MWh',
  tusd_mwh REAL,
  te_mwh REAL,
  tarifa_kwh REAL,
  vigencia_inicio TEXT NOT NULL DEFAULT '',
  vigencia_fim TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT NOT NULL DEFAULT '',
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todogreen_energy_tariff_reference_par
  ON todogreen_energy_tariff_reference (distribuidora, subgrupo, modalidade, vigencia_inicio DESC);

-- Preço de combustível da ANP agregado (mediana por município/UF/região/país
-- e semana de coleta). Só agregados: nenhum posto, endereço ou CNPJ é retido.
CREATE TABLE IF NOT EXISTS todogreen_fuel_price_reference (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  produto TEXT NOT NULL,
  nivel TEXT NOT NULL,
  chave TEXT NOT NULL,
  semana TEXT NOT NULL,
  mediana REAL NOT NULL,
  media REAL,
  minimo REAL,
  maximo REAL,
  amostras INTEGER NOT NULL DEFAULT 0,
  coleta_inicio TEXT NOT NULL DEFAULT '',
  coleta_fim TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'anp',
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todogreen_fuel_price_reference_chave
  ON todogreen_fuel_price_reference (produto, nivel, chave, semana DESC);

-- Perfil médio de carga horária do SIN por subsistema (ONS, curva de carga
-- horária): 24 linhas por subsistema, recalculadas a cada ingestão.
CREATE TABLE IF NOT EXISTS todogreen_grid_load_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  subsistema TEXT NOT NULL,
  hora INTEGER NOT NULL,
  media_mw REAL NOT NULL,
  amostras INTEGER NOT NULL DEFAULT 0,
  janela_dias INTEGER NOT NULL DEFAULT 0,
  source_last_instant TEXT NOT NULL DEFAULT '',
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todogreen_grid_load_profiles_subsistema
  ON todogreen_grid_load_profiles (subsistema, hora);

-- Estado de cada fonte de referência: quando tentou, quando conseguiu, a data
-- da fonte (sourceUpdatedAt) e o erro — é o que a Saúde do sistema mostra.
CREATE TABLE IF NOT EXISTS todogreen_energy_reference_sync (
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
