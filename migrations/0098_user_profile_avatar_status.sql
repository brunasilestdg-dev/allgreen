-- Perfil da pessoa: foto e status (pedido da titular).
--
-- Foto de perfil é um "lembrete forte que dá pra pular" (não trava o login),
-- e o status é livre — um emoji e/ou uma frase curta, no espírito do Slack.
-- Guardado na própria linha do usuário: é dado da conta, visível para os
-- colegas do espaço (aparece nas listas de pessoas e no cabeçalho).
--
-- A foto é gravada como data URL reduzido no cliente (imagem pequena) — sem
-- blob store separado no núcleo do app, como o resto do cadastro de conta.

ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN status_emoji TEXT;
ALTER TABLE users ADD COLUMN status_text TEXT;
