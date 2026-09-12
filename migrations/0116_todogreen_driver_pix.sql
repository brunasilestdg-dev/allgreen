-- Chave PIX do motorista para o repasse do GreenPay (via SysPag quando ligado).
--
-- O motorista informa a PRÓPRIA chave no portal dele (self-service, igual à foto
-- da CNH em 0097). O time vê e corrige no cadastro do ERP (todogreen-master-data
-- expõe pix_key/pix_key_type no map/encode). O adaptador SysPag lê pix_key para
-- montar o repasse — nada é pago sem chave (validação em pixDomain).
--
-- Colunas próprias (não fields_json) porque é dado estruturado, filtrável e que
-- a operação edita — mesmo critério da CNH. pix_self_updated_at marca quando foi
-- o próprio motorista que atualizou (a operação distingue do que ela corrigiu).

ALTER TABLE todogreen_drivers ADD COLUMN pix_key TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_drivers ADD COLUMN pix_key_type TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_drivers ADD COLUMN pix_self_updated_at TEXT;
