-- Bloco 03 (All Green): CHECKLIST de pré-viagem do motorista.
--
-- O primeiro gesto do dia de quem dirige: o veículo está apto a rodar? Uma
-- vistoria item a item, no celular, antes de sair. Fica o registro imutável de
-- que o veículo estava (ou não) apto — segurança e prova, na mesma linha do POD
-- que prova a entrega.
--
-- Convenção da vertical (0041): tenant_id + workspace_owner_id em toda linha,
-- revision, archived_at em vez de DELETE, *_json para o payload com coluna
-- própria só para o que é filtrado/somado (motorista, data, status, críticos).
-- O recorte do motorista é o driver_id (0070), como as viagens e as rotas.
CREATE TABLE IF NOT EXISTS todogreen_driver_checklists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  route_id TEXT NOT NULL DEFAULT '',
  service_date TEXT NOT NULL,                -- 'AAAA-MM-DD'
  answers_json TEXT NOT NULL DEFAULT '{}',   -- { itemId: 'ok'|'ressalva'|'problema' }
  status TEXT NOT NULL DEFAULT 'aprovado' CHECK (status IN ('aprovado', 'ressalva', 'reprovado')),
  critical_failed INTEGER NOT NULL DEFAULT 0,
  observation TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);

-- Listagem: as vistorias de um motorista, da mais recente para a mais antiga.
CREATE INDEX IF NOT EXISTS idx_driver_checklist_lista
  ON todogreen_driver_checklists (workspace_owner_id, driver_id, service_date DESC, created_at DESC);
