-- Contingência ao convite por e-mail: o admin cria o acesso direto, com uma
-- senha provisória que ele repassa à pessoa por outro canal. Enquanto esta
-- marca estiver ligada, o app obriga a trocar a senha antes de entrar.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
