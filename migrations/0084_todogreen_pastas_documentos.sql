-- 0084_todogreen_pastas_documentos.sql
-- Pastas no cofre de documentos: privadas, da área e do espaço.
--
-- O cofre organizava por CLIENTE e por TIPO, e mais nada: quem tinha acesso à
-- vertical via todos os documentos do espaço. Não havia onde guardar a proposta
-- que ainda não é para todo mundo, nem como separar o que é de Financeiro do
-- que é de Operações.
--
-- O vocabulário é o MESMO do Planner (`visibility` private/shared +
-- `members_json`, migração 0077) mais um terceiro valor, `area`, regido por uma
-- permissão. Inventar um segundo vocabulário para a mesma ideia obrigaria quem
-- lê o código a saber os dois.
--
-- A regra que mais importa não é desta tabela e sim da leitura
-- (`pastasDomain.js#podeVerPasta`): só se vê uma pasta quando se vê TODA a
-- linhagem dela. Uma subpasta "do espaço" dentro de uma pasta privada continua
-- invisível — senão bastaria criar uma subpasta para vazar o que o pai protege.

CREATE TABLE IF NOT EXISTS todogreen_document_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  -- Hierarquia. Vazio = raiz. O ciclo é barrado na escrita
  -- (`pastasDomain.js#criaCiclo`): pasta dentro da própria descendência
  -- transforma a árvore em anel, a tela entra em laço e o conteúdo desaparece
  -- das duas pontas.
  parent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  -- private | area | shared. O padrão é o mais restritivo: é mais barato
  -- liberar depois do que descobrir que vazou.
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','area','shared')),
  -- Membros por E-MAIL, não por id de usuário: é o e-mail que se digita ao
  -- convidar, é o que o vínculo da vertical guarda, e é o que continua
  -- funcionando quando a pessoa ainda não abriu o produto pela primeira vez.
  members_json TEXT NOT NULL DEFAULT '[]',
  -- Só para visibility='area': a permissão que rege a pasta.
  area_permission TEXT NOT NULL DEFAULT '',
  -- Dono da pasta privada, carimbado da sessão e nunca do corpo.
  owner_email TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_document_folders_owner
  ON todogreen_document_folders (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_document_folders_pai
  ON todogreen_document_folders (workspace_owner_id, parent_id, archived_at);

-- O arquivo aponta para a pasta. Arquivo SEM pasta continua visível a quem tem
-- acesso ao cofre: é onde está tudo o que já existia, e esconder o acervo antigo
-- numa migração seria o mesmo que apagá-lo.
ALTER TABLE todogreen_internal_files ADD COLUMN folder_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_todogreen_internal_files_pasta
  ON todogreen_internal_files (workspace_owner_id, folder_id, archived_at);
