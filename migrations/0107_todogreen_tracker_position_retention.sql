-- Retenção de posições do rastreador.
--
-- `expurgarPosicoesAntigasDoTracker` (worker/services/todogreen-tracker.js) roda
-- no cron e apaga posições além da janela de retenção. O filtro é por
-- `recorded_at` GLOBAL (todos os espaços), mas os índices existentes de
-- `todogreen_tracker_positions` são prefixados por `workspace_owner_id`
-- (idx_tdg_tracker_position_time / _vehicle_time) e não servem a esse filtro.
--
-- Este índice torna o SELECT ... WHERE recorded_at < ? ORDER BY recorded_at ASC
-- LIMIT ? uma varredura de índice em vez de uma varredura de tabela cheia — que
-- é justamente o que evita a limpeza custar caro quando a tabela já cresceu.
CREATE INDEX IF NOT EXISTS idx_tdg_tracker_position_recorded
  ON todogreen_tracker_positions (recorded_at);
