-- Perfil físico e energético do veículo (seção 38) + observações de energia
-- por viagem (seção 44, digital twin básico). Tudo aditivo.
--
-- Perfil físico: alimenta o truck costing do Valhalla (altura/largura/
-- comprimento/peso/eixos) e o pré-flight (PBT, capacidade). Perfil energético:
-- conector e potência máxima de recarga para o smart charging; consumo de
-- referência (catálogo) separado do consumo nominal já existente.
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN height_m REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN width_m REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN length_m REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN tare_kg REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN gross_weight_kg REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN axles INTEGER;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN connector_type TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN max_charging_power_kw REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN reference_consumption_kwh_km REAL;

-- Observações de energia por viagem: a linha de base REAL. `measurement_type`
-- diz se veio de telemetria/OCPP (MEASURED), digitação (INFORMED) ou import.
CREATE TABLE IF NOT EXISTS todogreen_vehicle_energy_observations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL DEFAULT '',
  route_id TEXT NOT NULL DEFAULT '',
  driver_id TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  distance_km REAL NOT NULL,
  energy_kwh REAL,
  soc_start_percent REAL,
  soc_end_percent REAL,
  charged_kwh REAL,
  payload_kg REAL,
  temperature_c REAL,
  soh_percent REAL,
  measurement_type TEXT NOT NULL DEFAULT 'INFORMED',
  source TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tdg_vehicle_energy_obs_vehicle
  ON todogreen_vehicle_energy_observations(workspace_owner_id, vehicle_id, observed_at DESC);
