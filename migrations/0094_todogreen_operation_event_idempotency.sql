-- Idempotência da fila offline do motorista (#132): o app do motorista guarda a
-- entrega/coleta/ocorrência quando está sem sinal e reenvia depois, com uma
-- chave estável (idempotencyKey) por gesto. Sem dedup no servidor, um reenvio
-- (ou o botão "Reenviar", ou o evento "online") gravava o MESMO evento duas
-- vezes na linha do tempo — e disparava a notificação ao cliente de novo.
-- A chave fica na própria linha do evento; o índice único (parcial, só quando a
-- chave existe) garante um evento por (espaço, operação, chave).
ALTER TABLE todogreen_client_operation_events ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_operation_events_idem
  ON todogreen_client_operation_events (tenant_id, workspace_owner_id, operation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
