-- NPS de cliente (Portal — ACOMPANHAR).
--
-- A voz do cliente vira número que fecha ciclo. Depois da entrega o cliente dá
-- uma nota de 0 a 10; a plataforma classifica (promotor, neutro, detrator) e
-- calcula o NPS. A regra que dá sentido ao indicador está na ponta: toda nota
-- de DETRATOR abre uma ocorrência com responsável e prazo (a mesma
-- todogreen_client_requests, type='ocorrencia') — NPS que não trata detrator é
-- enquete, não gestão. O elo é `incident_request_id`.
--
-- Convenção da vertical (cabeçalho da 0041): tenant_id + workspace_owner_id em
-- toda linha; client_id vem SEMPRE da sessão, nunca do corpo — é o que sustenta
-- o isolamento por cliente no portal, como na 0040. A CLASSE é gravada no
-- momento da resposta porque é a régua vigente daquele instante; o NPS em si
-- (agregado) nunca é gravado — é SUM/derivação na leitura, e sem respostas é
-- `null`, não 0 (npsDomain).

CREATE TABLE IF NOT EXISTS todogreen_client_nps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  -- A operação avaliada, quando a pesquisa nasce de uma entrega específica.
  -- Opcional: o cliente também pode avaliar o serviço em geral.
  operation_id TEXT,
  -- Nota de 0 a 10. Fora da faixa não entra (validado no domínio antes de gravar).
  nota INTEGER NOT NULL,
  -- promotor | neutro | detrator — a classe da régua vigente no instante da resposta.
  classe TEXT NOT NULL,
  -- Por que a nota, quando detrator. Alimenta o ranking de causas de insatisfação.
  motivo TEXT NOT NULL DEFAULT '',
  comentario TEXT NOT NULL DEFAULT '',
  -- A ponte que fecha o ciclo: a ocorrência aberta para um detrator.
  incident_request_id TEXT,
  respondido_por TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- O portal lê por cliente e data (a última avaliação, a série do cliente);
-- a equipe lê a série do espaço para o NPS agregado e as causas.
CREATE INDEX IF NOT EXISTS idx_todogreen_client_nps_cliente
  ON todogreen_client_nps (tenant_id, workspace_owner_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_client_nps_espaco
  ON todogreen_client_nps (tenant_id, workspace_owner_id, created_at DESC);
