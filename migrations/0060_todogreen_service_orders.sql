-- ===== Ordem de serviço: o trabalho que consome material e hora =====
--
-- A vertical já tem duas coisas parecidas, e nenhuma delas serve:
--
--   • `todogreen_fleet_maintenance_orders` (0031) é OS DE FROTA — presa a um
--     veículo, com odômetro e tipo de manutenção. Continua onde está; esta
--     migração não a substitui nem a duplica.
--   • `todogreen_work_items` (0030) é quadro de trabalho: cartão em coluna, para
--     organizar. Não tem material consumido, não tem hora apontada, não tem
--     custo — e é justamente isso que faz uma OS ser OS.
--
-- O que falta é a ordem de serviço genérica: instalação, adequação de veículo,
-- projeto de eletrificação num cliente. Ela tem três coisas que nenhuma das
-- outras duas tem:
--
--   1. MATERIAL: consome do estoque, e o consumo é um movimento de verdade
--      (origin_type = 'ordem_servico'), não um número solto na OS.
--   2. HORA: apontamento de quem trabalhou quanto, que vira custo pela
--      `hourlyCost` do perfil de recurso (capacityDomain.js).
--   3. AVANÇO DERIVADO: o percentual sai dos apontamentos, nunca de um clique.
--      É a mesma regra da jornada de eletrificação — "não marcar etapa como
--      concluída só por clique".
--
-- Por que material e hora são TABELAS e não JSON: os dois precisam ser somados
-- por OS e por período para o custo realizado, e um JSON obrigaria a carregar
-- todas as ordens para responder "quanto essa frente custou este mês?".

CREATE TABLE IF NOT EXISTS todogreen_service_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  document_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  -- A OS pode nascer de uma operação já contratada, e é por aqui que o custo
  -- dela chega ao resultado daquela operação.
  operation_id TEXT NOT NULL DEFAULT '',
  opportunity_id TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT NOT NULL DEFAULT '',
  -- Depósito de onde o material sai. Sem ele, consumir exigiria escolher o
  -- depósito a cada apontamento.
  warehouse_id TEXT NOT NULL DEFAULT '',
  responsible_user_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'servico'
    CHECK (kind IN ('servico', 'instalacao', 'manutencao', 'projeto', 'adequacao')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),
  -- Só decisão de gente. O AVANÇO é derivado dos apontamentos; guardá-lo aqui
  -- deixaria o percentual dizer 100% enquanto as horas dizem outra coisa.
  status TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'em_execucao', 'pausada', 'concluida', 'cancelada')),
  -- O que foi combinado, para comparar com o realizado. Estimativa vazia não é
  -- zero: é "não estimamos", e o relatório precisa distinguir as duas.
  estimated_hours REAL,
  estimated_cost REAL,
  scheduled_start TEXT,
  scheduled_end TEXT,
  started_at TEXT,
  finished_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_service_orders_espaco
  ON todogreen_service_orders (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_service_orders_fila
  ON todogreen_service_orders (workspace_owner_id, status, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_todogreen_service_orders_cliente
  ON todogreen_service_orders (workspace_owner_id, client_id)
  WHERE client_id <> '';

-- ---------------------------------------------------------------------------
-- Material consumido
-- ---------------------------------------------------------------------------
--
-- Esta tabela registra a INTENÇÃO e o vínculo; o efeito no saldo é o movimento
-- em `todogreen_stock_movements` com `origin_type = 'ordem_servico'` e
-- `origin_id` = o id desta linha. Duas fontes para a mesma quantidade
-- divergiriam, então aqui fica o planejado/apontado e lá fica o saldo.
CREATE TABLE IF NOT EXISTS todogreen_service_order_materials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  -- Custo unitário no momento do consumo, copiado do custo médio do estoque.
  -- Recalcular depois faria o custo da OS mudar quando o preço do fornecedor
  -- mudasse, meses após o serviço ter sido feito.
  unit_cost REAL NOT NULL DEFAULT 0,
  -- O movimento de estoque que este consumo gerou. Vazio significa que a baixa
  -- ainda não foi lançada — e é essa a diferença entre planejar e consumir.
  stock_movement_id TEXT NOT NULL DEFAULT '',
  consumed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES todogreen_service_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_so_materials_ordem
  ON todogreen_service_order_materials (order_id, consumed_at);
CREATE INDEX IF NOT EXISTS idx_todogreen_so_materials_item
  ON todogreen_service_order_materials (workspace_owner_id, item_id);

-- ---------------------------------------------------------------------------
-- Hora apontada
-- ---------------------------------------------------------------------------
--
-- Distinto de `db.timeEntries` do monólito, que é hora FATURÁVEL ao cliente.
-- Aqui é hora TRABALHADA na ordem, que gera custo pelo `hourlyCost` do perfil.
-- As duas coisas coexistem: uma hora pode ser trabalhada e não faturável.
CREATE TABLE IF NOT EXISTS todogreen_service_order_time (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  -- Nome livre para quem não tem conta no sistema — terceirizado e prestador
  -- apontam hora e não têm login.
  person_name TEXT NOT NULL DEFAULT '',
  hours REAL NOT NULL CHECK (hours > 0),
  hourly_cost REAL NOT NULL DEFAULT 0,
  worked_on TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Marca se essa hora vai ser cobrada do cliente. Nem toda hora trabalhada é
  -- faturável, e somar as duas coisas inflaria a receita prevista.
  billable INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES todogreen_service_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_so_time_ordem
  ON todogreen_service_order_time (order_id, worked_on);
CREATE INDEX IF NOT EXISTS idx_todogreen_so_time_pessoa
  ON todogreen_service_order_time (workspace_owner_id, user_id, worked_on)
  WHERE user_id <> '';
