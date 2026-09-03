-- 0087_todogreen_operations_dispatch_coords.sql
--
-- O motor de despacho (portal TMS) precisa de coordenada de coleta e de
-- entrega por operação para montar o problema de roteirização. A operação já
-- guarda `last_position_lat/lng` — mas isso é a posição ATUAL do veículo
-- (telemetria do rastreador), não o destino da entrega. São coisas
-- diferentes: a posição muda a cada sincronização: o destino é fixo desde
-- que a operação foi criada.

ALTER TABLE todogreen_client_operations ADD COLUMN pickup_lat REAL;
ALTER TABLE todogreen_client_operations ADD COLUMN pickup_lng REAL;
ALTER TABLE todogreen_client_operations ADD COLUMN delivery_lat REAL;
ALTER TABLE todogreen_client_operations ADD COLUMN delivery_lng REAL;
