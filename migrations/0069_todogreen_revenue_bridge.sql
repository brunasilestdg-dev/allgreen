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
