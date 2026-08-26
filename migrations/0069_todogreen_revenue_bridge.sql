-- 0069_todogreen_revenue_bridge.sql
--
-- A ponte que faltava no lado da RECEITA. A vertical tem duas espinhas
-- financeiras: a transacional (todogreen_financial_titles/settlements, onde o
-- faturamento grava) e o razão (todogreen_financial_entries/payments, que a
-- Tesouraria concilia, o fechamento trava e todos os painéis leem).
--
-- A compra já tem ponte (trg_tdg_purchase_entry_to_payable_title, 0062):
-- lançamento de custo do recebimento vira título a pagar. A receita não tinha
-- nada — faturar uma OS criava título invisível para a conciliação, para o
-- fechamento de período e para a receita dos painéis. Era a planilha paralela.
--
-- Sentido desta ponte: título a receber → lançamento de receita; baixa do
-- título → pagamento no razão. IDs determinísticos ('entry-'||title.id,
-- 'pay-'||settlement.id) + INSERT OR IGNORE dão idempotência. Não há laço:
-- o trigger de compras só dispara em kind='cost', este só grava kind='revenue'.

-- ---------------------------------------------------------------------------
-- Numeração fiscal atômica. O MAX(numero)+1 do fiscal era leitura-depois-
-- escrita: duas assinaturas simultâneas produziam o mesmo número. A série
-- fiscal ganha contador próprio (a todogreen_document_series tem CHECK que não
-- aceita tipos fiscais) e o índice único é o cinto de segurança.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todogreen_fiscal_series (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('cte', 'mdfe', 'nfse')),
  serie INTEGER NOT NULL DEFAULT 1,
  next_number INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, doc_type, serie),
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Semeia o contador a partir do maior número já emitido, para espaços que já
-- assinaram documentos com a numeração antiga.
INSERT OR IGNORE INTO todogreen_fiscal_series
  (id, tenant_id, workspace_owner_id, doc_type, serie, next_number, created_at, updated_at)
SELECT lower(hex(randomblob(16))), tenant_id, workspace_owner_id, doc_type, serie,
       MAX(numero) + 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')
  FROM todogreen_fiscal_documents
 WHERE numero IS NOT NULL
 GROUP BY tenant_id, workspace_owner_id, doc_type, serie;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_fiscal_numero_unico
  ON todogreen_fiscal_documents (tenant_id, workspace_owner_id, doc_type, serie, numero)
  WHERE numero IS NOT NULL;

-- O documento fiscal passa a saber de que fatura nasceu. O fechamento do
-- faturamento gravava um "CTE-000001" em todogreen_invoices sem tocar o
-- módulo fiscal — dois mundos numerando o mesmo frete. Com o vínculo, a
-- fatura vira RASCUNHO fiscal pré-preenchido e a emissão acontece uma vez só.
ALTER TABLE todogreen_fiscal_documents ADD COLUMN invoice_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_fiscal_invoice_unica
  ON todogreen_fiscal_documents (tenant_id, workspace_owner_id, invoice_id)
  WHERE invoice_id <> '' AND archived_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_tdg_receivable_title_to_entry
AFTER INSERT ON todogreen_financial_titles
WHEN NEW.kind = 'receivable' AND NEW.original_amount > 0
BEGIN
  INSERT OR IGNORE INTO todogreen_financial_entries (
    id, tenant_id, workspace_owner_id, kind, client_id, product_id, scenario_id,
    category, description, amount, reference_month, status, fields_json,
    revision, created_by, updated_by, created_at, updated_at, archived_at,
    due_date, paid_at, paid_amount, counterparty, document_number, cost_center,
    budget_code, payment_method, competence_date, contract_id, invoice_status
  ) VALUES (
    'entry-' || NEW.id,
    NEW.tenant_id,
    NEW.workspace_owner_id,
    'revenue',
    NEW.client_id,
    '', '',
    'faturamento',
    'Título ' || NEW.number || ' do faturamento',
    NEW.original_amount,
    substr(NEW.competence_date, 1, 7),
    'confirmed',
    json_object(
      'source', 'billing_title',
      'titleId', NEW.id,
      'serviceOrderId', NEW.service_order_id,
      'billingRunId', NEW.billing_run_id,
      'invoiceId', NEW.invoice_id
    ),
    1, NEW.created_by, NEW.updated_by, NEW.created_at, NEW.updated_at, NULL,
    NEW.due_date, NULL, 0, '', NEW.number, '',
    '', '', NEW.competence_date, NEW.contract_id, 'pending'
  );
END;

-- A baixa do título reflete no razão como pagamento — é o que a conciliação
-- casa com a linha do extrato. paid_amount é recalculado a partir do próprio
-- razão (paid_amount + valor da baixa), nunca sobrescrito por fora.
CREATE TRIGGER IF NOT EXISTS trg_tdg_settlement_to_entry_payment
AFTER INSERT ON todogreen_settlements
WHEN EXISTS (
  SELECT 1 FROM todogreen_financial_entries e
   WHERE e.id = 'entry-' || NEW.title_id
     AND e.tenant_id = NEW.tenant_id
     AND e.workspace_owner_id = NEW.workspace_owner_id
)
BEGIN
  INSERT OR IGNORE INTO todogreen_financial_payments (
    id, tenant_id, workspace_owner_id, entry_id, amount, paid_at,
    payment_method, reference, notes, created_by, created_at
  ) VALUES (
    'pay-' || NEW.id,
    NEW.tenant_id,
    NEW.workspace_owner_id,
    'entry-' || NEW.title_id,
    NEW.amount,
    NEW.settled_at,
    NEW.method,
    COALESCE(NULLIF(NEW.reference, ''), 'settlement:' || NEW.id),
    NEW.notes,
    NEW.created_by,
    NEW.created_at
  );

  UPDATE todogreen_financial_entries
     SET paid_amount = paid_amount + NEW.amount,
         paid_at = NEW.settled_at,
         payment_method = NEW.method,
         invoice_status = CASE
           WHEN paid_amount + NEW.amount >= amount THEN 'paid'
           ELSE 'partial'
         END,
         revision = revision + 1,
         updated_by = NEW.created_by,
         updated_at = NEW.created_at
   WHERE id = 'entry-' || NEW.title_id
     AND tenant_id = NEW.tenant_id
     AND workspace_owner_id = NEW.workspace_owner_id;
END;

-- E a volta do lado a pagar: o título 'payable-<entryId>' nasceu do lançamento
-- de compra (ponte da 0062). Baixá-lo pela tela de títulos precisa quitar o
-- lançamento de origem — senão a compra ficaria "em aberto" no razão para
-- sempre, mesmo paga.
CREATE TRIGGER IF NOT EXISTS trg_tdg_settlement_to_purchase_entry
AFTER INSERT ON todogreen_settlements
WHEN NEW.title_id LIKE 'payable-%'
 AND EXISTS (
  SELECT 1 FROM todogreen_financial_entries e
   WHERE e.id = substr(NEW.title_id, 9)
     AND e.tenant_id = NEW.tenant_id
     AND e.workspace_owner_id = NEW.workspace_owner_id
)
BEGIN
  INSERT OR IGNORE INTO todogreen_financial_payments (
    id, tenant_id, workspace_owner_id, entry_id, amount, paid_at,
    payment_method, reference, notes, created_by, created_at
  ) VALUES (
    'pay-' || NEW.id,
    NEW.tenant_id,
    NEW.workspace_owner_id,
    substr(NEW.title_id, 9),
    NEW.amount,
    NEW.settled_at,
    NEW.method,
    COALESCE(NULLIF(NEW.reference, ''), 'settlement:' || NEW.id),
    NEW.notes,
    NEW.created_by,
    NEW.created_at
  );

  UPDATE todogreen_financial_entries
     SET paid_amount = paid_amount + NEW.amount,
         paid_at = NEW.settled_at,
         payment_method = NEW.method,
         invoice_status = CASE
           WHEN paid_amount + NEW.amount >= amount THEN 'paid'
           ELSE 'partial'
         END,
         revision = revision + 1,
         updated_by = NEW.created_by,
         updated_at = NEW.created_at
   WHERE id = substr(NEW.title_id, 9)
     AND tenant_id = NEW.tenant_id
     AND workspace_owner_id = NEW.workspace_owner_id;
END;
