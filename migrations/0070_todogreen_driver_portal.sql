-- 0070_todogreen_driver_portal.sql
--
-- O motorista como DADO, não como texto. A operação guardava "motorista" em
-- campo livre (driver_name) — impossível recortar "as minhas viagens" — e o
-- cadastro de motoristas (0062) não tinha como ligar uma pessoa logada ao seu
-- registro. Estas duas colunas fecham os dois elos:
--
-- 1) operação → motorista por id (driver_name continua existindo como rótulo
--    de exibição e para histórico antigo);
-- 2) motorista → e-mail de login, preenchido no cadastro mestre. É por ele
--    que o portal do motorista resolve QUEM está pedindo as viagens.

ALTER TABLE todogreen_client_operations ADD COLUMN driver_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tdg_operations_driver
  ON todogreen_client_operations (workspace_owner_id, driver_id, archived_at, service_date DESC);

ALTER TABLE todogreen_drivers ADD COLUMN user_email TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tdg_drivers_email
  ON todogreen_drivers (workspace_owner_id, user_email)
  WHERE user_email <> '';
