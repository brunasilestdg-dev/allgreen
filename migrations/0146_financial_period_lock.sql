-- Última defesa do razão: qualquer serviço que escreva diretamente também
-- respeita a competência fechada. A reabertura permanece explícita na tabela
-- de períodos, antes de aceitar um lançamento tardio.
CREATE TRIGGER IF NOT EXISTS trg_tdg_financial_closed_insert
BEFORE INSERT ON todogreen_financial_entries
WHEN EXISTS (
  SELECT 1 FROM todogreen_financial_periods p
   WHERE p.tenant_id = NEW.tenant_id
     AND p.workspace_owner_id = NEW.workspace_owner_id
     AND p.status = 'fechado'
     AND p.reference_month IN (substr(NEW.reference_month,1,7), substr(NEW.competence_date,1,7))
)
BEGIN
  SELECT RAISE(ABORT, 'Competência financeira fechada');
END;

CREATE TRIGGER IF NOT EXISTS trg_tdg_financial_closed_update
BEFORE UPDATE ON todogreen_financial_entries
WHEN (OLD.amount IS NOT NEW.amount
  OR OLD.kind IS NOT NEW.kind
  OR OLD.reference_month IS NOT NEW.reference_month
  OR OLD.competence_date IS NOT NEW.competence_date
  OR OLD.category IS NOT NEW.category
  OR OLD.description IS NOT NEW.description
  OR OLD.status IS NOT NEW.status
  OR OLD.fields_json IS NOT NEW.fields_json
  OR OLD.archived_at IS NOT NEW.archived_at
  OR OLD.workspace_owner_id IS NOT NEW.workspace_owner_id
  OR OLD.tenant_id IS NOT NEW.tenant_id)
 AND (EXISTS (
  SELECT 1 FROM todogreen_financial_periods p
   WHERE p.tenant_id = OLD.tenant_id
     AND p.workspace_owner_id = OLD.workspace_owner_id
     AND p.status = 'fechado'
     AND p.reference_month IN (substr(OLD.reference_month,1,7), substr(OLD.competence_date,1,7))
) OR EXISTS (
  SELECT 1 FROM todogreen_financial_periods p
   WHERE p.tenant_id = NEW.tenant_id
     AND p.workspace_owner_id = NEW.workspace_owner_id
     AND p.status = 'fechado'
     AND p.reference_month IN (substr(NEW.reference_month,1,7), substr(NEW.competence_date,1,7))
))
BEGIN
  SELECT RAISE(ABORT, 'Competência financeira fechada');
END;

CREATE TRIGGER IF NOT EXISTS trg_tdg_financial_closed_delete
BEFORE DELETE ON todogreen_financial_entries
WHEN EXISTS (
  SELECT 1 FROM todogreen_financial_periods p
   WHERE p.tenant_id = OLD.tenant_id
     AND p.workspace_owner_id = OLD.workspace_owner_id
     AND p.status = 'fechado'
     AND p.reference_month IN (substr(OLD.reference_month,1,7), substr(OLD.competence_date,1,7))
)
BEGIN
  SELECT RAISE(ABORT, 'Competência financeira fechada');
END;
