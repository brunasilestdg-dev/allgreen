-- 0073_workspace_search_keys.sql
--
-- "eu quero ilimitado" — a titular quer que as pesquisas de LinkedIn, notícias,
-- decisores e RFQ deixem de esbarrar em cota. A saída sem cota é uma instância
-- própria de SearXNG (auto-hospedada), que a cascata de `web-search.js` já
-- coloca em primeiro lugar quando `SEARXNG_BASE_URL` existe.
--
-- Só que essa variável vivia no cofre do Worker: para ligá-la era preciso
-- `wrangler secret put` num terminal — exatamente o que quem administra o ERP
-- não tem como fazer. Esta tabela é o "traga sua própria busca": cada espaço
-- guarda a URL do seu SearXNG (e as chaves dos provedores pagos que quiser),
-- e o overlay de `search-keys.js` as injeta no `env` que a cascata recebe.
-- Mesma máquina do `workspace_ai_keys` (0072), mesmo cofre
-- (`WORKSPACE_AI_VAULT_KEY`), mesma regra: o segredo nunca volta para a tela.
--
-- Uma diferença de forma em relação às chaves de IA: o SearXNG se configura por
-- uma URL (não um segredo) mais um token OPCIONAL. Por isso `base_url` é coluna
-- própria e o par cifrado é anulável — provedor com chave não tem URL, e
-- SearXNG sem token não tem segredo a cifrar.

CREATE TABLE IF NOT EXISTS workspace_search_keys (
  id TEXT PRIMARY KEY,
  workspace_owner_id TEXT NOT NULL,
  -- `searxng`, `serper`, `brave`, `tavily`… O mesmo identificador que o
  -- catálogo de `web-search.js` usa, para as duas pontas não divergirem.
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  -- Só o SearXNG usa: a URL da instância. Não é segredo, então fica em claro
  -- para a tela poder reexibir "está apontando para tal endereço".
  base_url TEXT NOT NULL DEFAULT '',
  -- AES-GCM sobre WORKSPACE_AI_VAULT_KEY. Anulável: o SearXNG pode não ter
  -- token, e aí não há o que cifrar. Provedor de chave sempre preenche.
  secret_ciphertext TEXT,
  secret_iv TEXT,
  -- Os primeiros caracteres do segredo, só para reconhecer qual está lá.
  secret_prefix TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  last_test_at TEXT,
  last_test_ok INTEGER NOT NULL DEFAULT 0,
  last_test_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Uma configuração ativa por provedor por espaço. A cascata precisa de
  -- resposta única sobre qual URL/chave vale.
  UNIQUE(workspace_owner_id, provider),
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_search_keys_espaco
  ON workspace_search_keys (workspace_owner_id, status, provider);
