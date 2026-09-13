-- GreenPay fase 2: contratos de ganho recorrente do motorista.
--
-- A fase 1 (0113) montou a carteira: ganho derivado da entrega + ajustes
-- manuais, ciclo pendente → aprovado → pago. Faltava o ganho FIXO mensal (ajuda
-- de custo, retainer): um valor combinado que entra todo mês, sem depender de
-- viagem. É o contrato.
--
-- O contrato é só a DEFINIÇÃO (motorista, valor, dia). O lançamento do mês vai
-- para todogreen_driver_earnings (kind 'contrato'), com referência única
-- (greenPayStatementDomain.referenciaDoContrato) que impede duplicar ao gerar o
-- mês de novo. "Nada de dinheiro criado sozinho": o mês é gerado por ação
-- explícita do gestor ("gerar mês"), como o autoPost manual do monólito.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id, revision,
-- archived_at em vez de DELETE.
CREATE TABLE IF NOT EXISTS todogreen_driver_earning_contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tdg_earning_contract_owner
  ON todogreen_driver_earning_contracts (workspace_owner_id, driver_id, archived_at);
