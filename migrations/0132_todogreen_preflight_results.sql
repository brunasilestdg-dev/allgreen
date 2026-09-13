-- 0132 — pré-flight operacional PERSISTIDO e ligado à rota (P2).
--
-- `preflightDomain` (PASS / WARNING / BLOCK + sugestões calculadas) já rodava
-- no `POST /routes/electric-plan`, mas o resultado morria na resposta: nada
-- provava que a rota atribuída ao motorista tinha passado pela checagem, e
-- um WARNING autorizado não deixava rastro de quem autorizou nem por quê.
--
-- Esta tabela é o histórico (só INSERT, como os snapshots de viabilidade) de
-- cada execução: a entrada RESOLVIDA (o que veio do cadastro de motorista,
-- da frota e dos pontos de recarga próprios, o que foi informado pela tela),
-- as checagens, as sugestões, a estimativa de energia e a decisão. A rota
-- (`todogreen_routes`) passa a apontar para o pré-flight que a liberou:
-- `preflight_status` é a régua de publicação — BLOCK não vira rota atribuída.
--
-- `route_fingerprint` amarra o resultado ao par exato (paradas + motorista +
-- veículo): mudou a rota, mudou a assinatura, o pré-flight antigo não serve.
-- Aditivo: rotas anteriores continuam válidas com os campos vazios.

CREATE TABLE IF NOT EXISTS todogreen_preflight_results (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  route_id TEXT NOT NULL DEFAULT '',
  route_fingerprint TEXT NOT NULL,
  driver_id TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  vehicle_id TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PASS','WARNING','BLOCK')),
  blocked INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  input_json TEXT NOT NULL DEFAULT '{}',
  energy_json TEXT,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  override_reason TEXT NOT NULL DEFAULT '',
  overridden_by TEXT NOT NULL DEFAULT '',
  overridden_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Histórico da rota e "último pré-flight deste par", do mais novo ao mais antigo.
CREATE INDEX IF NOT EXISTS idx_tdg_preflight_owner_route
  ON todogreen_preflight_results (workspace_owner_id, route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tdg_preflight_fingerprint
  ON todogreen_preflight_results (workspace_owner_id, route_fingerprint, created_at DESC);

-- A rota guarda qual pré-flight a liberou e com que status (PASS ou WARNING
-- autorizado). Vazio = rota anterior a esta migration ou criada por caminho
-- que ainda não passa pelo gate (despacho automático — ver readiness matrix).
ALTER TABLE todogreen_routes ADD COLUMN preflight_id TEXT NOT NULL DEFAULT '';
ALTER TABLE todogreen_routes ADD COLUMN preflight_status TEXT NOT NULL DEFAULT '';
