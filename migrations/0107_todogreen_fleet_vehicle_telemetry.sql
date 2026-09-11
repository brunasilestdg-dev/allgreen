-- Bloco 02/03 (All Green): snapshot de telemetria ELÉTRICA ao vivo no veículo.
--
-- A frota já guarda o dado ESTÁTICO do elétrico (capacidade da bateria, SoH,
-- autonomia nominal — 0031/0053). Faltava o AO VIVO: quanto de carga o veículo
-- tem AGORA (SOC), a autonomia estimada do momento e quando isso foi lido.
--
-- Prepared-and-off, no mesmo padrão do resto da integração da Sistemas Tracker
-- (0038): o adaptador já normaliza SOC/autonomia quando o feed manda, mas hoje
-- a maioria dos rastreadores só manda posição — então as colunas nascem NULL
-- ("sem telemetria elétrica ainda") e só acendem quando a leitura vier. Nenhum
-- veículo existente muda de comportamento; ligar é apontar o field map, não
-- reescrever nada. Aditiva (ALTER ADD COLUMN nullable), molde da 0105.
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN last_soc_percent REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN last_range_km REAL;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN last_telemetry_at TEXT;
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN last_telemetry_source TEXT;
