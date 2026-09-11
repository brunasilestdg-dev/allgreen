-- Bloco 03 (All Green): JORNADA do motorista — turno de trabalho.
--
-- Depois da vistoria, o motorista INICIA e ENCERRA o turno pelo app. As horas
-- trabalhadas saem da diferença início/fim — derivadas, nunca digitadas. Um
-- turno é aberto ao iniciar e fechado ao encerrar; a base garante um só aberto
-- por motorista (índice único parcial), como a régua da jornada exige.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id em toda linha,
-- revision, archived_at em vez de DELETE. O recorte do motorista é o driver_id
-- (0070), como as viagens, as rotas e as vistorias.
CREATE TABLE IF NOT EXISTS todogreen_driver_shifts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  service_date TEXT NOT NULL,                -- 'AAAA-MM-DD'
  started_at TEXT NOT NULL,
  ended_at TEXT,                             -- NULL = turno aberto
  duration_min INTEGER NOT NULL DEFAULT 0,   -- derivado ao encerrar
  start_odometer_km REAL,
  end_odometer_km REAL,
  start_position TEXT NOT NULL DEFAULT '',
  end_position TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);

-- Um turno ABERTO por motorista: a trava está no banco, não só na tela.
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_shift_aberto
  ON todogreen_driver_shifts (workspace_owner_id, driver_id)
  WHERE ended_at IS NULL AND archived_at IS NULL;

-- Listagem: os turnos de um motorista, do mais recente para o mais antigo.
CREATE INDEX IF NOT EXISTS idx_driver_shift_lista
  ON todogreen_driver_shifts (workspace_owner_id, driver_id, service_date DESC, started_at DESC);
