-- Operação de recarga da To Do Green: sessão real, reserva e preço por kWh.
--
-- O cadastro de pontos (0114) diz ONDE se recarrega. Faltava o que ACONTECE no
-- ponto: a sessão de recarga (energia medida por recarga, não estimada pelo
-- hodômetro), a reserva do carregador (para dois veículos não brigarem pela
-- mesma tomada) e o preço por kWh (para cobrar quem recarrega — B2B/B2C).
--
-- Convenção da vertical (cabeçalho da 0041): tenant_id + workspace_owner_id em
-- toda linha, revision, archived_at em vez de DELETE, colunas próprias só para
-- o que é filtrado; o resto em fields_json. São coleções genéricas da vertical
-- (todogreen-vertical-records COLECOES), servidas pelo /api/todogreen/records.
--
-- Honestidade preservada nas leituras, não nas colunas:
--  - o CUSTO da sessão é derivado da tarifa na hora (smartChargingDomain), NÃO
--    é coluna — tarifa muda e custo gravado envelhece calado;
--  - OCPP é a fonte automática futura (dormente): `source` nasce 'manual' e fica
--    pronto para 'ocpp' quando a central alimentar a medição sozinha.

-- Sessão de recarga: uma recarga que de fato aconteceu. energy_kwh é MEDIDO
-- (lido do medidor ou informado). client_id preenchido = recarga de terceiro
-- (faturável); vazio = uso da própria frota (custo, vira Gestão de Energia).
CREATE TABLE IF NOT EXISTS todogreen_charging_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  charging_point_id TEXT NOT NULL DEFAULT '',
  charging_point_name TEXT NOT NULL DEFAULT '',
  vehicle_id TEXT NOT NULL DEFAULT '',
  vehicle_label TEXT NOT NULL DEFAULT '',
  driver_id TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  ended_at TEXT NOT NULL DEFAULT '',
  energy_kwh REAL NOT NULL DEFAULT 0,
  meter_start REAL NOT NULL DEFAULT 0,
  meter_end REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'em_andamento',
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_charging_session_owner
  ON todogreen_charging_sessions (workspace_owner_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tdg_charging_session_client
  ON todogreen_charging_sessions (workspace_owner_id, client_id, started_at DESC);

-- Reserva de carregador: janela [start_at, end_at) de um ponto para um veículo.
-- O conflito (duas ativas no mesmo ponto em horários que se cruzam) é barrado
-- no servidor pela guarda de escrita (chargerReservationDomain.conflitoDeReserva),
-- a mesma regra da tela.
CREATE TABLE IF NOT EXISTS todogreen_charger_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  charging_point_id TEXT NOT NULL DEFAULT '',
  charging_point_name TEXT NOT NULL DEFAULT '',
  vehicle_id TEXT NOT NULL DEFAULT '',
  vehicle_label TEXT NOT NULL DEFAULT '',
  driver_id TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL DEFAULT '',
  end_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'reservada',
  note TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_charger_reservation_owner
  ON todogreen_charger_reservations (workspace_owner_id, charging_point_id, start_at);

-- Preço por kWh (tabela de recarga). scope 'base' = tabela pública; 'segmento'
-- = B2B/B2C; 'cliente' = contrato de um cliente. O mais específico vence
-- (chargingBillingDomain.resolverPrecoKwh). É cadastro da empresa.
CREATE TABLE IF NOT EXISTS todogreen_charging_price_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'base',
  segment TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  price_per_kwh REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_charging_price_owner
  ON todogreen_charging_price_rules (workspace_owner_id, scope);
