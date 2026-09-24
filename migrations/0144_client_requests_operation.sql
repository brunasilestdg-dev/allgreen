-- Solicitações amarradas a uma encomenda: devolução, alteração de endereço e
-- acareação nascem de UMA operação específica, não do nada. A coluna liga o
-- pedido à operação; vazio segue valendo para os pedidos gerais (nova rota,
-- relatório...), que não pertencem a uma entrega.
ALTER TABLE todogreen_client_requests ADD COLUMN operation_id TEXT NOT NULL DEFAULT '';

-- A tela da encomenda lista os pedidos DELA: busca por operação dentro do
-- espaço do cliente, então o índice cobre o caminho real da consulta.
CREATE INDEX IF NOT EXISTS idx_todogreen_client_requests_operacao
  ON todogreen_client_requests (tenant_id, workspace_owner_id, client_id, operation_id);
