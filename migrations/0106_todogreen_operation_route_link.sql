-- 0106 — elo transacional entre operação canônica e rota executável.
--
-- `todogreen_routes` já guardava o plano do dia e
-- `todogreen_client_operations` já guardava a execução. Sem uma chave entre
-- as duas, o despacho só conseguia copiar motorista/placa e os eventos do
-- motorista não tinham qual rota avançar. As colunas são aditivas: operações
-- antigas continuam válidas e rotas manuais continuam independentes.

ALTER TABLE todogreen_client_operations ADD COLUMN route_id TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_client_operations ADD COLUMN route_stop_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_tdg_operations_route
  ON todogreen_client_operations (workspace_owner_id, route_id, archived_at, route_stop_order)
  WHERE route_id <> '';
