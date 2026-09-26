-- Mesmo POST reenviado não duplica estoque e passivo. O fingerprint é calculado
-- pelo Worker a partir de pedido, depósito, data, documento e linhas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tdg_receipt_request_fingerprint
ON todogreen_goods_receipts (
  tenant_id, workspace_owner_id, order_id,
  json_extract(fields_json, '$.requestFingerprint')
)
WHERE archived_at IS NULL
  AND json_extract(fields_json, '$.requestFingerprint') IS NOT NULL;
