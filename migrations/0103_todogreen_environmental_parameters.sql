-- Régua ESG editável: fatores de CO₂ + pesos do Green Score (Onda A).
--
-- Antes, os fatores de emissão eram constante no código (DEFAULT_ENVIRONMENTAL_
-- FACTORS) e os pesos do Green Score, apesar de terem tabela, nem chegavam ao
-- motor — o simulador oficial rodava o ESG inteiro em padrão de fábrica, sem
-- ninguém poder ajustar. Aqui a régua vira dado versionado, no mesmo molde da
-- régua de preço (todogreen_pricing_parameters): cada mudança é uma versão nova,
-- com responsável, justificativa e vigência; nunca reescreve o passado.
--
-- Segurança: coluna nova, tabela nova, tudo opcional. Sem régua ativa, o motor
-- usa os defaults — comportamento idêntico ao de hoje.
CREATE TABLE IF NOT EXISTS todogreen_environmental_parameters (
  version TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL DEFAULT '',
  -- Fatores de emissão/conversão (kg CO2e por litro/kWh, km/l, equivalências).
  factors_json TEXT NOT NULL DEFAULT '{}',
  -- Pesos do Green Score (reduction, lowEmissionKm, cleanEnergy, ...).
  green_score_weights_json TEXT NOT NULL DEFAULT '{}',
  change_summary TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todogreen_environmental_parameters_active
  ON todogreen_environmental_parameters (tenant_id, workspace_owner_id, status, effective_from DESC);
