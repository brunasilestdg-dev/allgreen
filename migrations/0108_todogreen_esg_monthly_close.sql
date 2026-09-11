-- Bloco 08 (All Green): FECHAMENTO mensal de ESG.
--
-- O relatório sob demanda já existe; faltava o fechamento — congelar o mês num
-- retrato só, na moldura GLEC / ISO 14083 (emissão de transporte por atividade,
-- tonelada-quilômetro, well-to-wheel). Como o fechamento da folha e do período
-- financeiro: um snapshot imutável do que valia naquele mês, com a versão da
-- metodologia carimbada, para o número não "andar" depois.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id em toda linha,
-- revision, archived_at em vez de DELETE. O resumo inteiro (totais + atividade
-- GLEC + metodologia) vive em summary_json; só o que é filtrado/somado ganha
-- coluna própria (mês, cliente, qualidade, versão).
CREATE TABLE IF NOT EXISTS todogreen_esg_monthly_closes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  period_month TEXT NOT NULL,               -- 'AAAA-MM'
  summary_json TEXT NOT NULL DEFAULT '{}',
  methodology_version TEXT NOT NULL DEFAULT '',
  data_quality INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'fechado' CHECK (status IN ('fechado', 'reaberto')),
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- Um mês fecha UMA vez por cliente (refechar atualiza o mesmo registro).
CREATE UNIQUE INDEX IF NOT EXISTS idx_esg_monthly_close_unico
  ON todogreen_esg_monthly_closes (tenant_id, workspace_owner_id, client_id, period_month)
  WHERE archived_at IS NULL;

-- Listagem: os fechamentos de um cliente, do mais recente para o mais antigo.
CREATE INDEX IF NOT EXISTS idx_esg_monthly_close_lista
  ON todogreen_esg_monthly_closes (workspace_owner_id, client_id, period_month DESC);
