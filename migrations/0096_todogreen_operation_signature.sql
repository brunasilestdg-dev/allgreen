-- POD do motorista (#120b): a entrega passa a carregar FOTO do canhoto E
-- ASSINATURA de quem recebeu, capturadas no celular (câmera + tela), não mais
-- um link colado. A foto continua indo para proof_url (o gate de faturamento
-- da 0062 já a exige); a assinatura é a segunda evidência e ganha coluna
-- própria — em todogreen_client_operations (onde vive o comprovante universal)
-- e em todogreen_proofs_of_delivery (o POD que o faturamento lê).
--
-- Colunas aditivas e anuláveis: entregas antigas seguem válidas sem assinatura.
ALTER TABLE todogreen_client_operations ADD COLUMN signature_url TEXT;
ALTER TABLE todogreen_client_operations ADD COLUMN signature_hash TEXT;

ALTER TABLE todogreen_proofs_of_delivery ADD COLUMN signature_url TEXT;
ALTER TABLE todogreen_proofs_of_delivery ADD COLUMN signature_hash TEXT;
