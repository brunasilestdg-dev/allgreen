-- Jurídico como fluxo: o vai-e-volta do documento (Onda A).
--
-- Antes o Jurídico era um registro plano com um dropdown de situação — não
-- havia "mandar pro jurídico", validar/recusar/pedir ajuste, nem o histórico do
-- documento indo e voltando até a conclusão. Esta tabela é a linha do tempo
-- append-only dessa tratativa: cada envio, análise, pedido de ajuste, reenvio,
-- comentário e conclusão vira um evento imutável, com quem fez, a mensagem e o
-- anexo (arquivo por link) OU a solicitação redigida.
CREATE TABLE IF NOT EXISTS todogreen_legal_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  legal_id TEXT NOT NULL,
  -- submissao | reenvio | validado | reprovado | ajuste_solicitado | comentario | conclusao
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  attachment_url TEXT NOT NULL DEFAULT '',
  attachment_name TEXT NOT NULL DEFAULT '',
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todogreen_legal_events_doc
  ON todogreen_legal_events (tenant_id, workspace_owner_id, legal_id, created_at DESC);
