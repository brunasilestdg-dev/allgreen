-- Parâmetros do motor de HC e DRE por tipo de operação, por espaço (tenant).
--
-- Uma linha por espaço: o JSON inteiro da régua (globais, headcount, tipos de
-- operação e modificadores). Editável só por admin/owner na tela; quando não
-- existe linha, a plataforma usa a semente do código (operationParamsSeed.js).
-- `revision` para concorrência otimista (dois PATCH com a mesma revisão → 409).

CREATE TABLE IF NOT EXISTS todogreen_operation_params (
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_owner_id)
);
