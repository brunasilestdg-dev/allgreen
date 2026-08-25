-- ===== Integração com o TMS TRACK3R =====
--
-- O TRACK3R (track3r.com.br) é o TMS que a operação usa de verdade: é lá que
-- vivem coleta, entrega, status, ocorrência, embarcador e nota fiscal. A vertical
-- tem a mesma informação pela metade, digitada à mão.
--
-- ATENÇÃO — não confundir com a integração que já existe:
-- `todogreen_tracker_integrations` (0038) é a **Sistemas Tracker**, um
-- fornecedor DIFERENTE, de telemetria: latitude, longitude, ignição, odômetro.
-- São dois sistemas, dois contratos, dois assuntos. O TRACK3R traz o DOCUMENTO
-- (o que foi coletado e entregue); a Sistemas Tracker traz a POSIÇÃO (onde o
-- veículo está). Reaproveitar a mesma tabela juntaria coisas que só têm em comum
-- o fato de serem externas.
--
-- O MODO DE ACESSO AINDA É DESCONHECIDO. Não sabemos se o TRACK3R tem API REST,
-- webhook, ou só a exportação de relatório que aparece no botão "Relatórios
-- Solicitados" da tela. Por isso o desenho SEPARA TRANSPORTE DE MAPEAMENTO:
--
--   • `todogreen_tms_documents` guarda o documento no formato CANÔNICO, junto do
--     payload bruto que o originou. Os três transportes possíveis — arquivo, API
--     e webhook — produzem a MESMA linha aqui.
--   • A regra de mapeamento vive em `field_map_json`, configurável, e em
--     `track3rDomain.js`, testável. Trocar de transporte não reescreve nada.
--
-- Assim o modo ARQUIVO funciona hoje, sem credencial e sem custo, e API e
-- webhook ficam prontos e desligados por ausência de segredo — mesmo padrão do
-- VAPID e da Sistemas Tracker.

CREATE TABLE IF NOT EXISTS todogreen_tms_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'track3r',
  name TEXT NOT NULL DEFAULT 'TRACK3R',
  base_url TEXT NOT NULL DEFAULT '',
  -- O NOME da variável de ambiente, nunca o segredo. Mesmo desenho da 0038: o
  -- banco diz onde procurar a chave, o cofre guarda a chave.
  token_env_key TEXT NOT NULL DEFAULT 'TODOGREEN_TRACK3R_API_TOKEN',
  webhook_secret_env_key TEXT NOT NULL DEFAULT 'TODOGREEN_TRACK3R_WEBHOOK_SECRET',
  auth_header_name TEXT NOT NULL DEFAULT 'authorization',
  -- 'arquivo' funciona sem credencial nenhuma e é o padrão. 'api' e 'webhook'
  -- só ligam quando o segredo existir.
  sync_mode TEXT NOT NULL DEFAULT 'arquivo'
    CHECK (sync_mode IN ('arquivo', 'api', 'webhook')),
  -- Caminhos da API, quando houver. Vazios enquanto o fornecedor não responder.
  collections_path TEXT NOT NULL DEFAULT '',
  invoices_path TEXT NOT NULL DEFAULT '',
  -- De coluna/campo do TRACK3R para campo canônico. É isto que absorve a
  -- diferença entre o CSV do relatório e o JSON da API sem mexer no código.
  field_map_json TEXT NOT NULL DEFAULT '{}',
  polling_interval_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'pronta', 'ativa', 'erro')),
  last_sync_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_tms_integracao_ativa
  ON todogreen_tms_integrations (workspace_owner_id, provider)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- O documento, em formato canônico
-- ---------------------------------------------------------------------------
--
-- Os campos com coluna própria são os que a tela filtra e o relatório soma —
-- exatamente os filtros que a Consulta de Coletas do TRACK3R oferece:
-- unidade de origem, unidade atual, embarcador, embarcador agrupador, serviço,
-- produto, status, ocorrência e número da nota. O resto fica em `payload_json`,
-- porque descartar o que não indexamos faria a auditoria perder a origem.
CREATE TABLE IF NOT EXISTS todogreen_tms_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL DEFAULT '',
  -- Como esta linha chegou. Guardar isso é o que permite responder "esse número
  -- veio da API ou de uma planilha que alguém subiu?".
  origem TEXT NOT NULL DEFAULT 'arquivo'
    CHECK (origem IN ('arquivo', 'api', 'webhook')),
  -- O identificador do documento NO TRACK3R. É por ele que uma atualização de
  -- status encontra o documento que já existe em vez de criar outro.
  external_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'coleta'
    CHECK (kind IN ('coleta', 'entrega', 'transferencia', 'coleta_reversa', 'ocorrencia')),
  -- Embarcador e o grupo dele. O TRACK3R separa os dois ("Embarcador" e
  -- "Embarcador Agrupador"), e o CRM da vertical também — a carteira herdada
  -- traz NUCLEO e GRUPO. Casar por grupo é o que liga "AMAZON DBA" e
  -- "AMAZON RETAIL" à mesma conta.
  shipper_name TEXT NOT NULL DEFAULT '',
  shipper_group TEXT NOT NULL DEFAULT '',
  shipper_document TEXT NOT NULL DEFAULT '',
  -- A conta da vertical com que este documento foi casado. Vazio = ainda não
  -- casado, e é essa a consulta que a tela de conciliação de embarcador abre.
  client_id TEXT NOT NULL DEFAULT '',
  origin_unit TEXT NOT NULL DEFAULT '',
  current_unit TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  occurrence TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_key TEXT NOT NULL DEFAULT '',
  -- Veículo e classe. A classe é o que faz "de moto a carreta" ser legível:
  -- sem ela, custo por km da moto e da carreta cairiam no mesmo balde.
  vehicle_plate TEXT NOT NULL DEFAULT '',
  vehicle_class TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  packages REAL NOT NULL DEFAULT 0,
  weight_kg REAL NOT NULL DEFAULT 0,
  distance_km REAL NOT NULL DEFAULT 0,
  -- Combinado versus realizado, como dois instantes — mesmo desenho da 0045.
  promised_at TEXT,
  occurred_at TEXT,
  -- O payload bruto, para a auditoria poder voltar à origem.
  payload_json TEXT NOT NULL DEFAULT '{}',
  -- Determinístico sobre os campos que identificam o documento. Reimportar o
  -- mesmo relatório é rotina — o do dia seguinte repete os dias anteriores.
  import_hash TEXT NOT NULL,
  -- A operação da vertical que este documento alimentou. Vazio = ainda não
  -- projetado.
  operation_id TEXT NOT NULL DEFAULT '',
  projected_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
-- A dedup. Sem ela, reimportar o relatório do dia seguinte dobraria tudo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_tms_dedup
  ON todogreen_tms_documents (workspace_owner_id, import_hash);
-- O documento do TRACK3R, para uma atualização de status achar o que já existe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_todogreen_tms_externo
  ON todogreen_tms_documents (workspace_owner_id, external_id)
  WHERE external_id <> '';
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_espaco
  ON todogreen_tms_documents (workspace_owner_id, archived_at, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_embarcador
  ON todogreen_tms_documents (workspace_owner_id, shipper_group, shipper_name);
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_sem_conta
  ON todogreen_tms_documents (workspace_owner_id, client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_nota
  ON todogreen_tms_documents (workspace_owner_id, invoice_key)
  WHERE invoice_key <> '';
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_classe
  ON todogreen_tms_documents (workspace_owner_id, vehicle_class, occurred_at DESC)
  WHERE vehicle_class <> '';

-- ---------------------------------------------------------------------------
-- Log de sincronização
-- ---------------------------------------------------------------------------
--
-- Append-only. Uma integração que falha em silêncio é pior que uma integração
-- que não existe: o painel mostra o número de ontem como se fosse de hoje.
CREATE TABLE IF NOT EXISTS todogreen_tms_sync_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  integration_id TEXT NOT NULL DEFAULT '',
  origem TEXT NOT NULL DEFAULT 'arquivo'
    CHECK (origem IN ('arquivo', 'api', 'webhook')),
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'parcial', 'erro')),
  recebidos INTEGER NOT NULL DEFAULT 0,
  importados INTEGER NOT NULL DEFAULT 0,
  repetidos INTEGER NOT NULL DEFAULT 0,
  atualizados INTEGER NOT NULL DEFAULT 0,
  ignorados INTEGER NOT NULL DEFAULT 0,
  -- Os motivos da recusa, agrupados. Dizer "12 ignorados" sem dizer por quê
  -- deixa a pessoa sem ação possível.
  erros_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_tms_runs_espaco
  ON todogreen_tms_sync_runs (workspace_owner_id, created_at DESC);

-- A classe do veículo no cadastro de frota. Até aqui `category` era texto livre;
-- numa operação que vai de moto a carreta, texto livre faz custo por km,
-- unidade de cobrança, habilitação exigida e restrição urbana caírem no mesmo
-- balde. A coluna antiga fica: apagá-la perderia o que já foi digitado.
ALTER TABLE todogreen_fleet_vehicles ADD COLUMN vehicle_class TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_todogreen_fleet_classe
  ON todogreen_fleet_vehicles (workspace_owner_id, vehicle_class)
  WHERE vehicle_class <> '';
