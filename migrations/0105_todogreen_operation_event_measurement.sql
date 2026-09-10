-- N.2 (núcleo): km e energia como FATO no ledger de eventos.
--
-- Antes, km vivia como campo solto da operação (coluna distance_km + espelho em
-- fields_json) e energia não era capturada em lugar nenhum — só derivada
-- (distância × consumo por classe) no motor ESG. Agora a medição é um fato do
-- EVENTO: qualquer evento pode carregar distância e/ou energia com a sua origem
-- (qualidade do dado). É ortogonal ao `kind` — a mesma disciplina aditiva da
-- 0094 (ALTER ADD COLUMN + índice parcial), sem tocar migração antiga.
--
-- NULL é o discriminante: NULL = "este evento não mede nada" (a esmagadora
-- maioria); um número (inclusive 0) = medição informada. Por isso as colunas do
-- evento são nullable, nunca NOT NULL DEFAULT 0 (que confundiria "não mediu" com
-- "mediu 0"). O vocabulário de *_source é o QUALIDADE do esgEngineDomain
-- (medido/documentado/estimado/presumido), coado no servidor por normalizarQualidade.
ALTER TABLE todogreen_client_operation_events ADD COLUMN distance_km REAL;
ALTER TABLE todogreen_client_operation_events ADD COLUMN distance_source TEXT;
ALTER TABLE todogreen_client_operation_events ADD COLUMN energy_kwh REAL;
ALTER TABLE todogreen_client_operation_events ADD COLUMN energy_source TEXT;

-- "Esta operação tem medição no ledger?" barato, sem varrer a linha do tempo.
-- Índice parcial (SQLite/D1 suportam), mesmo desenho do índice parcial da 0094.
CREATE INDEX IF NOT EXISTS idx_todogreen_operation_events_medicao
  ON todogreen_client_operation_events (operation_id)
  WHERE distance_km IS NOT NULL OR energy_kwh IS NOT NULL;

-- Reflexo na OPERAÇÃO, com proveniência. distance_km já existe (0045) e continua
-- sendo SETado pelo CRUD e pela projeção do TMS exatamente como hoje; o evento só
-- REFLETE quando a operação ainda está sem distância (guarda "se vazio"), nunca
-- soma — ninguém que lê distance_km muda de resultado.
--
-- Energia ganha lar PRÓPRIO na operação (nullable: "vazio" limpo = NULL, sem a
-- ambiguidade do distance_km=0), para o TMS (operação) e o ERP (custo) lerem a
-- energia da mesma fonte. A qualidade da medição refletida acompanha, para o ESG
-- ler a proveniência sem reabrir o ledger.
ALTER TABLE todogreen_client_operations ADD COLUMN energy_kwh REAL;
ALTER TABLE todogreen_client_operations ADD COLUMN distance_km_quality TEXT;
ALTER TABLE todogreen_client_operations ADD COLUMN energy_kwh_quality TEXT;
