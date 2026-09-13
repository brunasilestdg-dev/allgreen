-- Métricas por integração (seção 114 da consolidação): latência do último
-- teste/sincronização e volume processado. Aditiva: só acrescenta colunas
-- opcionais ao histórico que já existe (0085). Nada é apagado ou renomeado.
ALTER TABLE todogreen_integration_health_events ADD COLUMN latency_ms INTEGER;
ALTER TABLE todogreen_integration_health_events ADD COLUMN records_processed INTEGER;
