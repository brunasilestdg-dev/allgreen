-- 0063_todogreen_payroll.sql
-- Pessoas e folha. Dado sensível (LGPD): CPF, salário e dependentes só saem
-- para rh/admin/owner — a coluna existe aqui, mas o handler decide quem lê.
-- Vocabulário "colaborador", nunca "funcionário" (no produto, funcionário é a
-- persona de IA). Convenção: tenant_id + workspace_owner_id, revision,
-- archived_at, período travado após fechamento.

-- ── Colaboradores ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS todogreen_employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL DEFAULT '',
  matricula TEXT NOT NULL DEFAULT '',
  cargo TEXT NOT NULL DEFAULT '',
  departamento TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT NOT NULL DEFAULT '',
  vinculo TEXT NOT NULL DEFAULT 'clt'
    CHECK (vinculo IN ('clt', 'pj', 'estagio', 'temporario', 'autonomo', 'aprendiz')),
  salario_base REAL NOT NULL DEFAULT 0,
  dependentes INTEGER NOT NULL DEFAULT 0,
  jornada_semanal REAL NOT NULL DEFAULT 44,
  admissao_em TEXT NOT NULL DEFAULT '',
  desligamento_em TEXT,
  motivo_desligamento TEXT NOT NULL DEFAULT '',
  regime_horas TEXT NOT NULL DEFAULT 'mensalista',
  user_id TEXT,
  resource_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'afastado', 'ferias', 'desligado')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_ws
  ON todogreen_employees (workspace_owner_id, archived_at, status, nome);

-- ── Ponto (distinto de db.timeEntries, que é hora faturável) ─
-- O ponto registra a jornada real do colaborador; a hora faturável ao cliente
-- é outra coisa e mora noutro lugar. Append-only: correção é lançamento novo.

CREATE TABLE IF NOT EXISTS todogreen_time_clock (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  dia TEXT NOT NULL,
  entrada TEXT NOT NULL DEFAULT '',
  saida TEXT NOT NULL DEFAULT '',
  horas_normais REAL NOT NULL DEFAULT 0,
  horas_extras REAL NOT NULL DEFAULT 0,
  horas_noturnas REAL NOT NULL DEFAULT 0,
  falta INTEGER NOT NULL DEFAULT 0,
  abonado INTEGER NOT NULL DEFAULT 0,
  observacao TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (employee_id) REFERENCES todogreen_employees(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_time_clock_emp
  ON todogreen_time_clock (workspace_owner_id, employee_id, dia);

-- ── Fechamento de folha (período travado) ───────────────────

CREATE TABLE IF NOT EXISTS todogreen_payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  competencia TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'mensal'
    CHECK (tipo IN ('mensal', 'adiantamento', 'ferias', 'decimo_terceiro', 'rescisao')),
  status TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'fechada', 'reaberta')),
  versao_tabela TEXT NOT NULL DEFAULT '',
  total_proventos REAL NOT NULL DEFAULT 0,
  total_descontos REAL NOT NULL DEFAULT 0,
  total_liquido REAL NOT NULL DEFAULT 0,
  total_fgts REAL NOT NULL DEFAULT 0,
  total_inss REAL NOT NULL DEFAULT 0,
  total_irrf REAL NOT NULL DEFAULT 0,
  fechada_por TEXT NOT NULL DEFAULT '',
  fechada_em TEXT,
  reaberta_por TEXT NOT NULL DEFAULT '',
  reaberta_em TEXT,
  notas TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (tenant_id, workspace_owner_id, competencia, tipo)
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_ws
  ON todogreen_payroll_runs (workspace_owner_id, competencia DESC);

-- ── Itens da folha (holerite por colaborador) ───────────────

CREATE TABLE IF NOT EXISTS todogreen_payroll_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  salario_base REAL NOT NULL DEFAULT 0,
  total_proventos REAL NOT NULL DEFAULT 0,
  total_descontos REAL NOT NULL DEFAULT 0,
  liquido REAL NOT NULL DEFAULT 0,
  base_inss REAL NOT NULL DEFAULT 0,
  inss_valor REAL NOT NULL DEFAULT 0,
  base_irrf REAL NOT NULL DEFAULT 0,
  irrf_valor REAL NOT NULL DEFAULT 0,
  fgts_valor REAL NOT NULL DEFAULT 0,
  proventos_json TEXT NOT NULL DEFAULT '[]',
  descontos_json TEXT NOT NULL DEFAULT '[]',
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (payroll_run_id) REFERENCES todogreen_payroll_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES todogreen_employees(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run
  ON todogreen_payroll_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_emp
  ON todogreen_payroll_items (workspace_owner_id, employee_id);

-- ── Férias (aquisitivo/gozo, distinto de resourceAbsences) ──

CREATE TABLE IF NOT EXISTS todogreen_vacations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  periodo_aquisitivo_inicio TEXT NOT NULL DEFAULT '',
  periodo_aquisitivo_fim TEXT NOT NULL DEFAULT '',
  gozo_inicio TEXT,
  gozo_fim TEXT,
  dias INTEGER NOT NULL DEFAULT 30,
  abono_pecuniario INTEGER NOT NULL DEFAULT 0,
  adiantar_decimo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'programada'
    CHECK (status IN ('programada', 'aprovada', 'em_gozo', 'concluida', 'cancelada')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT,
  FOREIGN KEY (employee_id) REFERENCES todogreen_employees(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vacations_emp
  ON todogreen_vacations (workspace_owner_id, employee_id, status);
