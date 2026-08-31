-- 0079_todogreen_crm_interactions.sql
-- Interações do comercial: reunião com ata, ligação, e-mail, visita, WhatsApp,
-- proposta enviada e TENTATIVA de contato (a tentativa que não deu certo é
-- informação: é ela que mostra o cliente que não retorna).
--
-- Vale a mesma regra de alcance dos comentários (0078): interação registrada na
-- CONTA (client_id preenchido, opportunity_id vazio) aparece em todas as
-- oportunidades daquela conta; registrada numa OPORTUNIDADE fica só nela, ainda
-- que a oportunidade esteja atrelada ao cliente. A regra mora no dado.
--
-- Colunas próprias só para o que é filtrado, somado ou ordenado (convenção da
-- 0041): tipo, data em que ocorreu e o próximo passo com sua data. Participantes
-- e ata são texto do registro.
CREATE TABLE IF NOT EXISTS todogreen_crm_interactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  opportunity_id TEXT NOT NULL DEFAULT '',
  -- reuniao | ligacao | email | visita | whatsapp | tentativa | proposta | outro
  kind TEXT NOT NULL DEFAULT 'reuniao',
  subject TEXT NOT NULL DEFAULT '',
  -- Ata da conversa, resumo do que foi tratado, o que o cliente pediu.
  notes TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT '',
  next_step_at TEXT NOT NULL DEFAULT '',
  -- Autor carimbado pelo servidor a partir da sessão; o navegador não escolhe.
  author_email TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_crm_interactions_owner
  ON todogreen_crm_interactions (workspace_owner_id, archived_at, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_crm_interactions_client
  ON todogreen_crm_interactions (workspace_owner_id, client_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_todogreen_crm_interactions_opportunity
  ON todogreen_crm_interactions (workspace_owner_id, opportunity_id, archived_at);
