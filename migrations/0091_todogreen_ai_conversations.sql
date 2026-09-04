-- Memória conversacional do Plantû (o assistente interno da vertical).
--
-- Até aqui a conversa vivia só no `useState` da tela: recarregar a página
-- apagava tudo, e o histórico que o modelo via vinha do próprio front a cada
-- pergunta. Esta tabela guarda o diálogo por espaço e por pessoa, para a
-- conversa sobreviver ao reload e o Plantû retomar de onde parou.
--
-- É um LANÇAMENTO imutável (append-only), no mesmo espírito de
-- todogreen_client_operation_events: cada mensagem é uma linha; nada é
-- reescrito. Arquivar (archived_at) em vez de apagar.
--
-- Escopo triplo, como toda tabela da vertical: tenant_id + workspace_owner_id
-- (do vínculo, nunca do corpo) + user_id (a conversa é privada de quem
-- perguntou; ninguém lê a thread do outro).

CREATE TABLE IF NOT EXISTS todogreen_ai_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- Qual assistente gerou a thread. Hoje só 'plantu' (interno); deixa espaço
  -- para o assistente do portal do cliente ganhar memória depois sem migração.
  assistente TEXT NOT NULL DEFAULT 'plantu',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  -- Conta aberta na tela quando a mensagem foi trocada (opcional): dá contexto
  -- sem virar "memória de cliente" (isso é a fase 2, com regra própria).
  client_id TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Leitura sempre por (espaço, pessoa, assistente) em ordem do tempo.
CREATE INDEX IF NOT EXISTS idx_todogreen_ai_messages_thread
  ON todogreen_ai_messages (tenant_id, workspace_owner_id, user_id, assistente, created_at);
