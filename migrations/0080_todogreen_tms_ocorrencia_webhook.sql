-- 0080_todogreen_tms_ocorrencia_webhook.sql
-- O receptor de ocorrências do TRACK3R (webhook) grava na mesma tabela de
-- documentos do TMS, mas duas informações dele são filtradas e agrupadas e por
-- isso ganham coluna própria (convenção da 0041: coluna só para o que é
-- filtrado, somado ou ordenado):
--
--   order_ref       a "encomenda" — o identificador da remessa no TRACK3R. É ele
--                   que amarra TODAS as ocorrências da mesma entrega e o que
--                   liga a ocorrência à coleta já importada.
--   occurrence_code o código da ocorrência ("03" = Entregue). Guardado cru
--                   porque a tabela oficial de códigos ainda não foi entregue
--                   pelo fornecedor: quando chegar, ela traduz sem migração.
--
-- Ficam vazias para arquivo e API — só o webhook as preenche.
--
-- Não há UNIQUE em order_ref de propósito: a mesma encomenda tem muitas
-- ocorrências, e o que distingue uma da outra é o import_hash (que já é único
-- por espaço e inclui código e data do evento).
ALTER TABLE todogreen_tms_documents ADD COLUMN order_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_tms_documents ADD COLUMN occurrence_code TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_encomenda
  ON todogreen_tms_documents (workspace_owner_id, order_ref, archived_at);
