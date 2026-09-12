-- GreenPay (All Green): carteira de ganhos do motorista — fase 1, razão interno.
--
-- GreenPay NÃO é folha de pagamento (essa é todogreen_payroll_*, do lado de RH).
-- É a carteira do motorista: ganho derivado das viagens entregues, ajustes
-- manuais do gestor, e o ciclo pendente → aprovado → pago. O saldo é sempre
-- SUM, nunca gravado — mesmo desenho de todogreen_financial_entries e
-- todogreen_stock_movements: lançamento imutável, número na tela é soma.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id em toda linha,
-- revision/archived_at, *_json para payload. O recorte do motorista é o
-- driver_id (0070), como as viagens, vistorias e turnos.

-- Régua de ganhos do espaço: quanto o motorista recebe por entrega, por km e o
-- bônus por entrega sem ocorrência. Versionada. Sem régua com valor > 0, a
-- carteira diz "não configurada" em vez de mostrar R$ 0 como se fosse ganho.
CREATE TABLE IF NOT EXISTS todogreen_driver_earning_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  value_per_delivery REAL NOT NULL DEFAULT 0,
  value_per_km REAL NOT NULL DEFAULT 0,
  bonus_no_incident REAL NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
-- Uma régua viva por espaço.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_earning_rule_owner
  ON todogreen_driver_earning_rules (workspace_owner_id)
  WHERE archived_at IS NULL;

-- Razão de ganhos (append-only). operation_id preenchido = ganho derivado de
-- viagem; nulo = ajuste manual (bônus, desconto, correção). amount é crédito
-- (+) ou débito (-). status caminha pendente → aprovado → pago.
CREATE TABLE IF NOT EXISTS todogreen_driver_earnings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  operation_id TEXT,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  reference TEXT,
  service_date TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  memory_json TEXT NOT NULL DEFAULT '{}',
  settlement_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_earnings_driver
  ON todogreen_driver_earnings (workspace_owner_id, driver_id, archived_at, service_date DESC);
-- Idempotência do ganho derivado: uma linha por (operação, tipo). Reprocessar a
-- entrega (fila offline, resync) não duplica o ganho.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_earnings_op_kind
  ON todogreen_driver_earnings (workspace_owner_id, operation_id, kind)
  WHERE operation_id IS NOT NULL AND archived_at IS NULL;
