-- Cadastros mestres e controles transacionais da vertical To Do Green.
--
-- Esta migração NÃO insere dados da empresa, colaboradores, motoristas, bases,
-- rotas, tabelas ou contas. Ela cria somente a estrutura para que os dados reais
-- sejam cadastrados depois, com origem, validade, revisão e trilha de auditoria.

-- ---------------------------------------------------------------------------
-- Empresa e documentos regulatórios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_company_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  trade_name TEXT NOT NULL DEFAULT '',
  document TEXT NOT NULL DEFAULT '',
  state_registration TEXT NOT NULL DEFAULT '',
  city_registration TEXT NOT NULL DEFAULT '',
  rntrc TEXT NOT NULL DEFAULT '',
  rntrc_category TEXT NOT NULL DEFAULT '',
  rntrc_status TEXT NOT NULL DEFAULT '',
  rntrc_checked_at TEXT,
  address_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_company_profile_scope
  ON todogreen_company_profiles (tenant_id, workspace_owner_id)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS todogreen_company_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'outro',
  number TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','expired','revoked','not_applicable')),
  document_url TEXT NOT NULL DEFAULT '',
  document_hash TEXT NOT NULL DEFAULT '',
  evidence_id TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES todogreen_company_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_company_documents_due
  ON todogreen_company_documents (workspace_owner_id, kind, expires_at, archived_at);

-- ---------------------------------------------------------------------------
-- Pessoas: cadastro canônico de colaboradores e documentação de DP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_code TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  document TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (employment_type IN ('employee','pj','temporary','intern','apprentice','third_party','other')),
  hire_date TEXT,
  termination_date TEXT,
  job_title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  manager_user_id TEXT,
  work_email TEXT NOT NULL DEFAULT '',
  personal_email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  operational_unit_id TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','leave','inactive','terminated')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_employees_code
  ON todogreen_employees (workspace_owner_id, employee_code)
  WHERE employee_code <> '' AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_employees_document
  ON todogreen_employees (workspace_owner_id, document)
  WHERE document <> '' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tdg_employees_status
  ON todogreen_employees (workspace_owner_id, status, department, archived_at);

CREATE TABLE IF NOT EXISTS todogreen_employee_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','expired','revoked','not_applicable')),
  document_url TEXT NOT NULL DEFAULT '',
  document_hash TEXT NOT NULL DEFAULT '',
  evidence_id TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (employee_id) REFERENCES todogreen_employees(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_employee_documents_due
  ON todogreen_employee_documents (workspace_owner_id, employee_id, expires_at, archived_at);

-- ---------------------------------------------------------------------------
-- Motoristas: pessoa operacional independente do cadastro de colaborador
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_drivers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL DEFAULT '',
  party_id TEXT NOT NULL DEFAULT '',
  driver_code TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  document TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (employment_type IN ('employee','aggregate','pj','third_party','other')),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  operational_unit_id TEXT NOT NULL DEFAULT '',
  base_name TEXT NOT NULL DEFAULT '',
  availability_status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (availability_status IN ('available','allocated','off_shift','leave','blocked','unavailable')),
  cnh_number TEXT NOT NULL DEFAULT '',
  cnh_category TEXT NOT NULL DEFAULT '',
  cnh_expires_at TEXT,
  mopp_expires_at TEXT,
  rntrc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','blocked','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_drivers_code
  ON todogreen_drivers (workspace_owner_id, driver_code)
  WHERE driver_code <> '' AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_drivers_document
  ON todogreen_drivers (workspace_owner_id, document)
  WHERE document <> '' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tdg_drivers_availability
  ON todogreen_drivers (workspace_owner_id, status, availability_status, archived_at);

CREATE TABLE IF NOT EXISTS todogreen_driver_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','expired','revoked','not_applicable')),
  document_url TEXT NOT NULL DEFAULT '',
  document_hash TEXT NOT NULL DEFAULT '',
  evidence_id TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (driver_id) REFERENCES todogreen_drivers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_driver_documents_due
  ON todogreen_driver_documents (workspace_owner_id, driver_id, expires_at, archived_at);

-- ---------------------------------------------------------------------------
-- Bases, rotas e tabelas de preço
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_operational_units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'base'
    CHECK (kind IN ('headquarters','base','hub','cross_dock','warehouse','support','other')),
  document TEXT NOT NULL DEFAULT '',
  address_json TEXT NOT NULL DEFAULT '{}',
  latitude REAL,
  longitude REAL,
  operating_hours_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_operational_units_code
  ON todogreen_operational_units (workspace_owner_id, code)
  WHERE code <> '' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS todogreen_route_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  origin_unit_id TEXT NOT NULL DEFAULT '',
  destination_unit_id TEXT NOT NULL DEFAULT '',
  origin_json TEXT NOT NULL DEFAULT '{}',
  destination_json TEXT NOT NULL DEFAULT '{}',
  distance_km REAL NOT NULL DEFAULT 0,
  estimated_duration_min INTEGER NOT NULL DEFAULT 0,
  vehicle_category TEXT NOT NULL DEFAULT '',
  toll_amount REAL NOT NULL DEFAULT 0,
  restrictions_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_route_templates_code
  ON todogreen_route_templates (workspace_owner_id, code)
  WHERE code <> '' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tdg_route_templates_origin_destination
  ON todogreen_route_templates (workspace_owner_id, origin_unit_id, destination_unit_id, status, archived_at);

CREATE TABLE IF NOT EXISTS todogreen_price_tables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  contract_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BRL',
  valid_from TEXT,
  valid_until TEXT,
  adjustment_index TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','expired','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_price_tables_code
  ON todogreen_price_tables (workspace_owner_id, code)
  WHERE code <> '' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tdg_price_tables_scope
  ON todogreen_price_tables (workspace_owner_id, client_id, product_id, status, valid_from, valid_until, archived_at);

CREATE TABLE IF NOT EXISTS todogreen_price_table_rows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  price_table_id TEXT NOT NULL,
  route_id TEXT NOT NULL DEFAULT '',
  vehicle_category TEXT NOT NULL DEFAULT '',
  origin_key TEXT NOT NULL DEFAULT '',
  destination_key TEXT NOT NULL DEFAULT '',
  min_quantity REAL NOT NULL DEFAULT 0,
  max_quantity REAL,
  charge_unit TEXT NOT NULL DEFAULT '',
  unit_price REAL NOT NULL DEFAULT 0,
  minimum_charge REAL NOT NULL DEFAULT 0,
  additional_rules_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (price_table_id) REFERENCES todogreen_price_tables(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_price_rows_table
  ON todogreen_price_table_rows (workspace_owner_id, price_table_id, status, archived_at);

-- ---------------------------------------------------------------------------
-- Contas bancárias. Os dados ficam vazios até cadastro real.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_bank_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'company'
    CHECK (owner_type IN ('company','party','employee','driver')),
  owner_id TEXT NOT NULL DEFAULT '',
  bank_code TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  account_digit TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'checking'
    CHECK (account_type IN ('checking','savings','payment','other')),
  pix_key_type TEXT NOT NULL DEFAULT '',
  pix_key TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','inactive')),
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_bank_accounts_owner
  ON todogreen_bank_accounts (workspace_owner_id, owner_type, owner_id, status, archived_at);

-- ---------------------------------------------------------------------------
-- Implantação operacional interna, separada da ativação cadastral do cliente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_implementation_projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  operation_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','in_progress','ready','go_live','completed','on_hold','cancelled')),
  owner_user_id TEXT,
  target_go_live_at TEXT,
  actual_go_live_at TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  operating_model_json TEXT NOT NULL DEFAULT '{}',
  capacity_json TEXT NOT NULL DEFAULT '{}',
  integrations_json TEXT NOT NULL DEFAULT '{}',
  billing_json TEXT NOT NULL DEFAULT '{}',
  support_json TEXT NOT NULL DEFAULT '{}',
  rasci_json TEXT NOT NULL DEFAULT '{}',
  risks_json TEXT NOT NULL DEFAULT '[]',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_implementation_projects
  ON todogreen_implementation_projects (workspace_owner_id, client_id, status, target_go_live_at, archived_at);

CREATE TABLE IF NOT EXISTS todogreen_implementation_gates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','blocked','done','waived')),
  due_at TEXT,
  blocking INTEGER NOT NULL DEFAULT 1,
  evidence_required INTEGER NOT NULL DEFAULT 0,
  evidence_id TEXT NOT NULL DEFAULT '',
  completed_by TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES todogreen_implementation_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tdg_implementation_gates
  ON todogreen_implementation_gates (workspace_owner_id, project_id, status, due_at, archived_at);

-- ---------------------------------------------------------------------------
-- POD obrigatório para tornar a OS faturável.
-- Contratos podem declarar explicitamente billing_rules_json.podRequired=false.
-- Ausência da regra significa POD obrigatório, que é a opção segura.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_tdg_billing_requires_pod
BEFORE INSERT ON todogreen_billing_items
WHEN COALESCE((
  SELECT json_extract(c.billing_rules_json, '$.podRequired')
    FROM todogreen_contracts c
   WHERE c.id = NEW.contract_id
     AND c.tenant_id = NEW.tenant_id
     AND c.workspace_owner_id = NEW.workspace_owner_id
     AND c.archived_at IS NULL
), 1) <> 0
AND NOT EXISTS (
  SELECT 1
    FROM todogreen_proofs_of_delivery p
   WHERE p.tenant_id = NEW.tenant_id
     AND p.workspace_owner_id = NEW.workspace_owner_id
     AND p.service_order_id = NEW.service_order_id
)
BEGIN
  SELECT RAISE(ABORT, 'BILLING_BLOCKED:POD_REQUIRED');
END;

-- ---------------------------------------------------------------------------
-- Fiscal: um registro interno não pode parecer documento autorizado.
-- A emissão real depende de retorno do autorizador/SEFAZ/prefeitura.
-- ---------------------------------------------------------------------------
ALTER TABLE todogreen_invoices ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'prepared';
ALTER TABLE todogreen_invoices ADD COLUMN authorization_protocol TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_invoices ADD COLUMN authorized_at TEXT;
ALTER TABLE todogreen_invoices ADD COLUMN rejected_at TEXT;
ALTER TABLE todogreen_invoices ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS trg_tdg_invoice_prepare_status
AFTER INSERT ON todogreen_invoices
WHEN COALESCE(NEW.external_key, '') = ''
BEGIN
  UPDATE todogreen_invoices
     SET status = 'prepared', authorization_status = 'prepared'
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tdg_invoice_authorized_requires_key
BEFORE UPDATE OF authorization_status ON todogreen_invoices
WHEN NEW.authorization_status = 'authorized' AND COALESCE(NEW.external_key, '') = ''
BEGIN
  SELECT RAISE(ABORT, 'FISCAL_AUTHORIZATION_BLOCKED:EXTERNAL_KEY_REQUIRED');
END;

UPDATE todogreen_invoices
   SET status = 'prepared', authorization_status = 'prepared'
 WHERE COALESCE(external_key, '') = '' AND status = 'issued';

-- ---------------------------------------------------------------------------
-- Compras → contas a pagar na espinha financeira nova.
-- O serviço legado ainda lança todogreen_financial_entries no recebimento.
-- Este bridge cria o título canônico sem duplicar a dívida.
-- ---------------------------------------------------------------------------
ALTER TABLE todogreen_goods_receipts ADD COLUMN financial_title_id TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS trg_tdg_purchase_entry_to_payable_title
AFTER INSERT ON todogreen_financial_entries
WHEN NEW.kind = 'cost'
 AND COALESCE(json_extract(NEW.fields_json, '$.sourceReceiptId'), '') <> ''
 AND NEW.amount > 0
BEGIN
  INSERT OR IGNORE INTO todogreen_financial_titles (
    id, tenant_id, workspace_owner_id, number, kind, party_id, client_id,
    supplier_id, contract_id, service_order_id, billing_run_id, invoice_id,
    purchase_order_id, installment, competence_date, issue_date, due_date,
    original_amount, open_amount, status, chart_account_id, cost_center_id,
    fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at
  ) VALUES (
    'payable-' || NEW.id,
    NEW.tenant_id,
    NEW.workspace_owner_id,
    'PAG-' || substr(replace(NEW.id, '-', ''), 1, 16),
    'payable',
    '', '', '', '', '', '', '',
    COALESCE(json_extract(NEW.fields_json, '$.sourcePurchaseOrderId'), ''),
    1,
    COALESCE(NEW.competence_date, date(NEW.created_at)),
    date(NEW.created_at),
    COALESCE(NEW.due_date, date(NEW.created_at)),
    NEW.amount,
    MAX(0, NEW.amount - COALESCE(NEW.paid_amount, 0)),
    CASE
      WHEN COALESCE(NEW.paid_amount, 0) >= NEW.amount THEN 'settled'
      WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN 'partial'
      ELSE 'open'
    END,
    '', NEW.cost_center,
    json_object(
      'source', 'purchase_receipt',
      'legacyFinancialEntryId', NEW.id,
      'sourceReceiptId', json_extract(NEW.fields_json, '$.sourceReceiptId'),
      'counterparty', NEW.counterparty,
      'documentNumber', NEW.document_number
    ),
    1, NEW.created_by, NEW.updated_by, NEW.created_at, NEW.updated_at, NULL
  );

  UPDATE todogreen_goods_receipts
     SET financial_title_id = 'payable-' || NEW.id
   WHERE id = json_extract(NEW.fields_json, '$.sourceReceiptId')
     AND tenant_id = NEW.tenant_id
     AND workspace_owner_id = NEW.workspace_owner_id;
END;
