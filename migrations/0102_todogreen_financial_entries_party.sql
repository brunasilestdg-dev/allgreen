-- Contraparte do lançamento financeiro por REFERÊNCIA, não por texto livre
-- (Onda 3 — costura 4).
--
-- Até aqui o fornecedor/cliente do lançamento era uma string (`counterparty`).
-- "Transportes Alfa" digitado de três jeitos virava três contrapartes, e a
-- conta a pagar gerada por um recebimento não casava com o `supplier_party_id`
-- do pedido que a originou. Agora o lançamento aponta para `todogreen_parties`
-- (cadastro único por CNPJ). O texto continua existindo como rótulo legível; o
-- id é o que concilia.
--
-- Coluna nova é NULL-safe por padrão ('') — lançamentos antigos seguem válidos,
-- só sem vínculo, e podem ser reconciliados depois.
ALTER TABLE todogreen_financial_entries ADD COLUMN party_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_todogreen_financial_entries_party
  ON todogreen_financial_entries (tenant_id, workspace_owner_id, party_id);
