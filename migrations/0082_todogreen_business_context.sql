-- 0082_todogreen_business_context.sql
-- O que a IA sabe sobre o próprio negócio.
--
-- Até aqui esse conhecimento era prompt escrito à mão dentro do código: para
-- corrigir "18.000 t de CO2" era preciso publicar o produto. Aqui vira linha de
-- banco, editável na tela e injetada no prompt na hora da pergunta.
--
-- `sigilo` decide quem vê: publico (pode ir para proposta e portal do cliente),
-- interno (circula dentro da To Do Green) e restrito (dona, administração e
-- financeiro — conta bancária, CPF, documento de pessoa). O padrão é interno:
-- é mais barato liberar depois do que descobrir que vazou.
--
-- `origem` separa o que foi cadastrado do que o assistente aprendeu na conversa
-- e a pessoa confirmou. Aprendizado sem confirmação não existe nesta tabela.
CREATE TABLE IF NOT EXISTS todogreen_business_context (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  -- Chave estável do fato. É por ela que a semente do dossiê reconhece o que
  -- já existe e não duplica ao ser reaplicada.
  fact_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'identidade',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  -- De onde o fato veio. Um assistente que afirma um número sem saber a fonte
  -- é o mesmo que inventa o próximo.
  source TEXT NOT NULL DEFAULT '',
  effective_at TEXT NOT NULL DEFAULT '',
  secrecy TEXT NOT NULL DEFAULT 'interno',
  origin TEXT NOT NULL DEFAULT 'cadastrado',
  -- Fato fixado nunca é cortado quando o dossiê passa do teto do prompt.
  pinned INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_business_context_owner
  ON todogreen_business_context (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_business_context_chave
  ON todogreen_business_context (workspace_owner_id, fact_key, archived_at);
