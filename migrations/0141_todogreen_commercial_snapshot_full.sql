-- Amplia o retrato temporário para espelhar o artefato INTEIRO (não só receita):
-- pipeline (KANBAN), atualizações semanais + FUP (UPDATES) e indicadores
-- operacionais (OPS: OTD, efetividade, ocorrências/waterfall, lead time, SLA por
-- rota, reentrega). Continua sendo ponte temporária até os webhooks do Track3R.
ALTER TABLE todogreen_commercial_snapshots ADD COLUMN kanban_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE todogreen_commercial_snapshots ADD COLUMN updates_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE todogreen_commercial_snapshots ADD COLUMN ops_json TEXT NOT NULL DEFAULT '{}';
