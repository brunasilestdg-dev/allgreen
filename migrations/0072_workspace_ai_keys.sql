-- 0072_workspace_ai_keys.sql
--
-- "TEM QUE TER O CAMPO INTEGRAÇÕES QUE ME PERMITA integrar com claude, gpt,
-- google, etc" — e a observação seguinte, que é a que importa: a tela de
-- integrações que existia era a do backend (Tracker, TMS, CIOT). A do usuário
-- (`/integracoes`) oferecia planilha, agenda, WhatsApp, JSON e webhooks.
-- Nenhuma delas tinha IA.
--
-- Até aqui os onze provedores (Gemini, Grok, Groq, SambaNova, Cerebras,
-- Mistral, OpenRouter, GitHub Models, Hugging Face, Cloudflare) eram segredos
-- do Worker, no cofre da titular. Isso tem duas consequências: quem usa o
-- produto não consegue trazer a própria conta, e todo consumo de IA sai da
-- conta de quem hospeda.
--
-- Esta tabela é o "traga sua própria chave": cada espaço de trabalho guarda as
-- chaves que quiser, cifradas, e elas passam NA FRENTE das do cofre na cascata
-- do `ai.js`. Quem trouxe a própria conta quer que ela seja usada — não que
-- fique de reserva.
--
-- A chave nunca volta para a tela. O que a tela recebe é o prefixo (`sk-ant-…`)
-- e a data do último teste; para trocar, cadastra de novo. Chave que a
-- interface consegue reexibir é chave que vaza pelo histórico do navegador,
-- por captura de tela e por quem estiver olhando junto.

CREATE TABLE IF NOT EXISTS workspace_ai_keys (
  id TEXT PRIMARY KEY,
  workspace_owner_id TEXT NOT NULL,
  -- `anthropic`, `openai`, `google`, `groq`… O mesmo identificador que o
  -- catálogo de provedores do `ai.js` usa, para as duas pontas não divergirem.
  provider TEXT NOT NULL,
  -- Rótulo de quem cadastrou ("Conta da diretoria", "Cartão do time"). Ajuda
  -- quando a mesma empresa tem mais de uma assinatura.
  label TEXT NOT NULL DEFAULT '',
  -- AES-GCM. A chave do cofre é derivada de WORKSPACE_AI_VAULT_KEY.
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  -- Os primeiros caracteres, só para a pessoa reconhecer qual chave está lá.
  -- Nunca o suficiente para usar.
  secret_prefix TEXT NOT NULL DEFAULT '',
  -- Modelo preferido, quando o provedor tem mais de um e a pessoa escolheu.
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  -- Resultado do último teste de conexão. Guardado porque "cadastrei e não sei
  -- se funciona" é o estado que faz a pessoa desistir da tela.
  last_test_at TEXT,
  last_test_ok INTEGER NOT NULL DEFAULT 0,
  last_test_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Uma chave ativa por provedor por espaço. Duas seriam ambiguidade sobre
  -- qual vale, e a cascata precisa de resposta única.
  UNIQUE(workspace_owner_id, provider),
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_ai_keys_espaco
  ON workspace_ai_keys (workspace_owner_id, status, provider);
