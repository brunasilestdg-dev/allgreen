-- 0086_todogreen_pricing_parameters_workspace.sql
--
-- Adiciona workspace_owner_id à tabela todogreen_pricing_parameters.
-- Isso fecha o vazamento de escopo onde um novo espaço herdava a régua
-- de preço de outro espaço porque a tabela era global (DAD-01 da auditoria).
--
-- A migração usa o padrão de v2: cria tabela nova, migra dados,
-- troca nomes. Dados legados ficam com espaço vazio ('').

CREATE TABLE todogreen_pricing_parameters_v2 (
  version TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL DEFAULT '',
  parameters_json TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_owner_id, version),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO todogreen_pricing_parameters_v2
  (version, tenant_id, workspace_owner_id, parameters_json, change_summary,
   justification, responsible, effective_from, effective_to,
   status, created_by, created_at)
SELECT version, tenant_id, '', parameters_json, change_summary, justification,
       responsible, effective_from, effective_to,
       status, created_by, created_at
  FROM todogreen_pricing_parameters;

DROP TABLE todogreen_pricing_parameters;
ALTER TABLE todogreen_pricing_parameters_v2 RENAME TO todogreen_pricing_parameters;

CREATE INDEX idx_todogreen_pricing_parameters_active
  ON todogreen_pricing_parameters
    (tenant_id, workspace_owner_id, status, effective_from DESC);
