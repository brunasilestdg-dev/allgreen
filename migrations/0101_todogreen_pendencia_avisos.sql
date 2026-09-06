-- Estado do aviso de pendências (Onda 2 — "a plataforma fala primeiro").
--
-- O cron avalia a pauta de alta urgência de cada dono e avisa por push/e-mail,
-- mas SÓ o que é novo. Para saber o que já foi avisado, guardamos aqui as chaves
-- estáveis por item concreto (uma por "categoria|conta"). Na primeira avaliação
-- de um espaço a linha é criada com o baseline e NADA é enviado — assim o
-- primeiro disparo não despeja o acúmulo inteiro no celular de ninguém.
--
-- Uma linha por (espaço, usuário). Convenção da vertical: tenant_id +
-- workspace_owner_id em toda linha.
CREATE TABLE IF NOT EXISTS todogreen_pendencia_avisos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chaves_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, user_id)
);
