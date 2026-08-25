-- ===== Tesouraria: conta bancária, conciliação e trava de período =====
--
-- A migração 0052 deu ao `todogreen_financial_entries` o que faltava para ser
-- contas a pagar e receber de verdade: vencimento, baixa parcial (em
-- `todogreen_financial_payments`), contraparte, documento e status de cobrança.
-- Esta migração NÃO recria nada disso. Ela fecha quatro lacunas que sobraram:
--
--   1. NÃO EXISTE CONTA BANCÁRIA. Sem ela não há saldo por conta, não há
--      conciliação e não se sabe de onde o dinheiro saiu.
--
--   2. `category` e `cost_center` são TEXTO LIVRE. "Combustível", "combustivel"
--      e "Comb." são três linhas do relatório. A 0053 criou o plano de contas e
--      o centro de custo como cadastro; aqui eles finalmente são REFERENCIADOS.
--      As colunas de texto ficam — apagá-las perderia o histórico já digitado —
--      e passam a ser o detalhe livre ao lado do eixo estável.
--
--   3. NÃO HÁ MULTA NEM JUROS. Um título vencido vale mais do que o valor de
--      face, e cobrar o valor de face é perder dinheiro em silêncio.
--
--   4. NÃO HÁ FECHAMENTO. Qualquer lançamento de qualquer mês pode ser alterado
--      a qualquer momento, o que significa que o resultado de janeiro pode mudar
--      em dezembro — e nenhum relatório publicado antes disso continua válido.
--
-- Por que o extrato importado é tabela e não JSON: cada linha do extrato precisa
-- ser casada individualmente com um lançamento, e a conciliação é justamente a
-- consulta "o que ainda não casou". Em JSON, isso obrigaria a carregar todos os
-- extratos para responder.

-- ---------------------------------------------------------------------------
-- Onde o dinheiro está
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_bank_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'corrente'
    CHECK (kind IN ('corrente', 'poupanca', 'caixa', 'aplicacao', 'cartao')),
  bank_code TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  pix_key TEXT NOT NULL DEFAULT '',
  -- Saldo INICIAL, na data em que a conta entrou no sistema. É premissa, não
  -- saldo corrente: o saldo de hoje é este mais a soma das baixas conciliadas.
  -- Guardar o saldo corrente aqui reproduziria o defeito do estoque mutável.
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_date TEXT,
  status TEXT NOT NULL DEFAULT 'ativa',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_bank_accounts_espaco
  ON todogreen_bank_accounts (workspace_owner_id, archived_at, updated_at DESC);

-- ---------------------------------------------------------------------------
-- O eixo estável do relatório
-- ---------------------------------------------------------------------------
-- As colunas de texto (`category`, `cost_center`) continuam existindo e válidas.
-- Estas apontam para o cadastro, e é por elas que o relatório passa a somar sem
-- depender de grafia.
ALTER TABLE todogreen_financial_entries ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_financial_entries ADD COLUMN cost_center_id TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_financial_entries ADD COLUMN bank_account_id TEXT NOT NULL DEFAULT '';

-- Multa e juros do atraso. Ficam separados do valor de face para o relatório
-- poder distinguir o que foi vendido do que foi cobrado por atrasar — somá-los
-- ao `amount` inflaria a receita.
ALTER TABLE todogreen_financial_entries ADD COLUMN late_fee_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE todogreen_financial_entries ADD COLUMN late_interest_month_percent REAL NOT NULL DEFAULT 0;

-- Conciliação: quando esta linha foi casada com o extrato, e com qual linha.
ALTER TABLE todogreen_financial_entries ADD COLUMN reconciled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_todogreen_financial_conta
  ON todogreen_financial_entries (workspace_owner_id, account_id)
  WHERE account_id <> '';
CREATE INDEX IF NOT EXISTS idx_todogreen_financial_centro
  ON todogreen_financial_entries (workspace_owner_id, cost_center_id)
  WHERE cost_center_id <> '';
CREATE INDEX IF NOT EXISTS idx_todogreen_financial_banco
  ON todogreen_financial_entries (workspace_owner_id, bank_account_id, reconciled_at)
  WHERE bank_account_id <> '';

-- ---------------------------------------------------------------------------
-- Extrato importado
-- ---------------------------------------------------------------------------
--
-- O `import_hash` é o que impede a mesma linha de entrar duas vezes quando
-- alguém sobe o mesmo arquivo de novo — o extrato do banco não tem id estável, e
-- reimportar é rotina (o arquivo do dia seguinte repete os dias anteriores).
-- Mesmo desenho do `raw_hash` do tracker.
CREATE TABLE IF NOT EXISTS todogreen_bank_statement_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  -- Positivo é entrada, negativo é saída. Aqui o sinal É o dado: é assim que o
  -- extrato do banco vem, e converter para tipo+quantidade abriria espaço para
  -- interpretar errado o que o banco já disse sem ambiguidade.
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  document TEXT NOT NULL DEFAULT '',
  import_hash TEXT NOT NULL,
  -- O lançamento com que esta linha foi casada. Vazio = ainda não conciliada, e
  -- é essa a consulta que a tela de conciliação abre.
  entry_id TEXT NOT NULL DEFAULT '',
  reconciled_at TEXT,
  reconciled_by TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bank_account_id) REFERENCES todogreen_bank_accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_statement_dedup
  ON todogreen_bank_statement_lines (workspace_owner_id, bank_account_id, import_hash);
CREATE INDEX IF NOT EXISTS idx_todogreen_statement_pendente
  ON todogreen_bank_statement_lines (workspace_owner_id, bank_account_id, reconciled_at, occurred_on);

-- ---------------------------------------------------------------------------
-- Fechamento de período
-- ---------------------------------------------------------------------------
--
-- Uma linha por mês fechado. Enquanto ela existir, nenhum lançamento com
-- competência naquele mês pode ser criado, alterado ou arquivado — é o que faz
-- um resultado publicado continuar valendo.
--
-- Reabrir é possível, mas é registrado (`reopened_at`, `reopened_by`,
-- `reopen_reason`): fechar e reabrir em silêncio seria o mesmo que não fechar.
CREATE TABLE IF NOT EXISTS todogreen_financial_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  -- "AAAA-MM".
  reference_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'fechado'
    CHECK (status IN ('fechado', 'reaberto')),
  -- Retrato do resultado no momento do fechamento. É contra este número que se
  -- compara depois para saber se alguém mexeu no passado.
  totals_json TEXT NOT NULL DEFAULT '{}',
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  reopened_by TEXT,
  reopened_at TEXT,
  reopen_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, reference_month),
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_periods_espaco
  ON todogreen_financial_periods (workspace_owner_id, reference_month DESC);
