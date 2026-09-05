-- CNH do motorista subida pelo próprio app, disponível à operação.
-- O motorista tira a foto da CNH no portal; a operação/frota passa a ver a
-- imagem e a validade (que já existia em cnh_expires_at). Guardamos só a URL
-- do cofre de arquivos (o binário fica no file-vault), mais o carimbo de
-- quando o motorista atualizou por conta própria — para a operação saber que
-- veio dele, não do cadastro manual.
ALTER TABLE todogreen_drivers ADD COLUMN cnh_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_drivers ADD COLUMN cnh_self_updated_at TEXT;
