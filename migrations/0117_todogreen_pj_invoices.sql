-- Notas fiscais dos prestadores PJ — o repasse mensal do colaborador PJ.
--
-- O colaborador PJ imputa a PRÓPRIA nota no portal dele (self-service, igual à
-- chave PIX do motorista em 0116): número, competência, valor e o anexo da NF.
-- O valor informado é CONFERIDO contra o valor esperado (o "salário"/contrato
-- PJ, que mora em todogreen_employees.salario_base) — mas o esperado é
-- AJUSTÁVEL pela operação (ex.: entrou no meio do mês → proporcional, não o
-- cheio). Por isso valor_esperado é copiado para a nota no momento da imputação
-- e pode ser corrigido na análise, sem mexer no cadastro.
--
-- Ciclo: em_analise → aprovada → paga (ou recusada/cancelada). Ao APROVAR, nasce
-- uma conta a pagar em todogreen_financial_entries (kind='cost'); financial_entry_id
-- guarda o elo (idempotência). Ao PAGAR, o adaptador SysPag lê a chave PIX do
-- colaborador (todogreen_bank_accounts, owner_type='employee') e dispara o
-- repasse — dormente até a credencial existir, como o GreenPay do motorista.
--
-- A chave PIX do PJ NÃO fica aqui: mora em todogreen_bank_accounts (0062), o
-- cadastro canônico de banco/PIX, com owner_type='employee' + owner_id.

CREATE TABLE IF NOT EXISTS todogreen_pj_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  competencia TEXT NOT NULL DEFAULT '',          -- 'AAAA-MM'
  numero TEXT NOT NULL DEFAULT '',               -- número da NF de serviço
  valor REAL NOT NULL DEFAULT 0,                 -- valor informado na NF (pelo PJ)
  valor_esperado REAL NOT NULL DEFAULT 0,        -- esperado (salário/contrato), ajustável
  document_url TEXT NOT NULL DEFAULT '',         -- anexo da NF (download do cofre ou link)
  evidence_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'em_analise'
    CHECK (status IN ('em_analise','aprovada','recusada','paga','cancelada')),
  financial_entry_id TEXT,                        -- conta a pagar gerada na aprovação
  settlement_id TEXT,                             -- lote de repasse (SysPag) quando paga
  self_submitted_at TEXT,                         -- quando o próprio PJ imputou
  reviewed_by TEXT,
  reviewed_at TEXT,
  note TEXT NOT NULL DEFAULT '',                  -- motivo de recusa / observação da gestão
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pj_invoices_ws
  ON todogreen_pj_invoices (workspace_owner_id, archived_at, status, competencia);
CREATE INDEX IF NOT EXISTS idx_pj_invoices_emp
  ON todogreen_pj_invoices (workspace_owner_id, employee_id, archived_at);
