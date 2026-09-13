-- 0133 — preferências do radar de mercado por espaço (P5 complemento).
--
-- Os sinais (`todogreen_market_signals`) são públicos e compartilhados pelo
-- tenant; o que muda de espaço para espaço é o que cada operação PROCURA:
-- termos do PNCP, termos do GDELT e as UFs de foco (bônus no score e filtro
-- padrão da tela). Até aqui os termos eram constantes do código
-- (`TERMOS_PNCP`/`TERMOS_GDELT`) — bons como padrão, ruins como única opção.
--
-- Uma linha por espaço (mesmo padrão de `todogreen_energy_profiles`): listas
-- em JSON, com limite de tamanho no serviço. Vazio = usa o padrão do código.
-- O cron continua tenant-wide: sincroniza a UNIÃO dos termos de todos os
-- espaços + os padrões (com teto), para nenhum espaço ficar sem cobertura.

CREATE TABLE IF NOT EXISTS todogreen_market_radar_prefs (
  workspace_owner_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  termos_pncp_json TEXT NOT NULL DEFAULT '[]',
  termos_gdelt_json TEXT NOT NULL DEFAULT '[]',
  ufs_foco_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
