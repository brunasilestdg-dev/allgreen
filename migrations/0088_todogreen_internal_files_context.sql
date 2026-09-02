-- 0088_todogreen_internal_files_context.sql
-- Anexos por contexto (#99): permitir prender arquivos do cofre interno a uma
-- requisição de compra ou a um processo do Jurídico, sem inventar novo
-- armazenamento. O cofre (todogreen_internal_files, 0076) já guarda o arquivo
-- em pedaços base64 no D1, com pastas e versões; só faltava dizer "este arquivo
-- é do documento X".
--
-- Em vez de uma coluna por área (que multiplicaria a cada módulo), um par
-- genérico: context_type ('purchase_request' | 'workflow' | ...) + context_id.
-- Aditivo e nulável — nenhum arquivo existente muda, e o workflow_id legado
-- (usado pelo cofre desde a 0076) continua valendo.

ALTER TABLE todogreen_internal_files ADD COLUMN context_type TEXT;
ALTER TABLE todogreen_internal_files ADD COLUMN context_id TEXT;

CREATE INDEX IF NOT EXISTS idx_todogreen_internal_files_context
  ON todogreen_internal_files (tenant_id, workspace_owner_id, context_type, context_id, created_at);
