-- Alçadas de compras versionadas e auditáveis (por espaço).
--
-- As faixas de aprovação por valor (quem precisa aprovar até quanto) eram
-- CODIFICADAS em PURCHASE_APPROVAL_BANDS. A matriz de prontidão do ERP marcou
-- isso como pendência P1: "faixas ainda são codificadas; devem virar
-- configuração versionada e auditável". Esta tabela guarda a régua do espaço no
-- MESMO molde de todogreen_operation_params (0099): uma linha por espaço, a
-- config inteira em config_json, revision para concorrência otimista, e a
-- edição registrada na trilha de auditoria pelo serviço.
--
-- Sem linha = usa a régua "de fábrica" do código (PURCHASE_APPROVAL_BANDS). A
-- edição fica restrita a owner/admin; o servidor RE-VALIDA cada faixa antes de
-- gravar (normalizarBandas), então config malformada nunca entra.
CREATE TABLE IF NOT EXISTS todogreen_purchase_approval_params (
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_owner_id)
);
