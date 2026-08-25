-- 0059_todogreen_fiscal.sql
-- Módulo fiscal para transportadora: CT-e, MDF-e e NFS-e.
-- Transmissão à SEFAZ desligada por ausência de certificado digital (A1/A3).
-- Convenção: tenant_id + workspace_owner_id em toda linha, revision para
-- concorrência, archived_at em vez de DELETE.

-- ── Perfil fiscal do emitente (a transportadora) ────────────

CREATE TABLE IF NOT EXISTS todogreen_tax_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  razao_social TEXT NOT NULL DEFAULT '',
  nome_fantasia TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  inscricao_municipal TEXT NOT NULL DEFAULT '',
  cnae TEXT NOT NULL DEFAULT '',
  logradouro TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL DEFAULT '',
  municipio TEXT NOT NULL DEFAULT '',
  codigo_municipio TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  cep TEXT NOT NULL DEFAULT '',
  regime_tributario TEXT NOT NULL DEFAULT 'simples'
    CHECK (regime_tributario IN ('simples', 'lucro_presumido', 'lucro_real')),
  simples_anexo TEXT NOT NULL DEFAULT 'III',
  faturamento_12m REAL NOT NULL DEFAULT 0,
  iss_aliquota REAL NOT NULL DEFAULT 2.0,
  icms_aliquota_interna REAL NOT NULL DEFAULT 18.0,
  certificado_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (certificado_status IN ('pendente', 'ativo', 'vencido')),
  certificado_validade TEXT,
  serie_cte INTEGER NOT NULL DEFAULT 1,
  serie_mdfe INTEGER NOT NULL DEFAULT 1,
  serie_nfse INTEGER NOT NULL DEFAULT 1,
  rntrc TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tax_profiles_ws
  ON todogreen_tax_profiles (workspace_owner_id, archived_at, updated_at DESC);

-- ── Documentos fiscais emitidos ─────────────────────────────

CREATE TABLE IF NOT EXISTS todogreen_fiscal_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  doc_type TEXT NOT NULL
    CHECK (doc_type IN ('cte', 'mdfe', 'nfse')),
  numero INTEGER,
  serie INTEGER NOT NULL DEFAULT 1,
  chave_acesso TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN (
      'rascunho','validado','assinado','transmitido',
      'autorizado','rejeitado','cancelado','inutilizado')),
  status_sefaz TEXT,
  motivo_sefaz TEXT,
  protocolo_autorizacao TEXT,
  data_emissao TEXT,
  data_prestacao TEXT,
  tomador_id TEXT,
  remetente_id TEXT,
  destinatario_id TEXT,
  valor_servico REAL NOT NULL DEFAULT 0,
  valor_frete REAL NOT NULL DEFAULT 0,
  valor_seguro REAL NOT NULL DEFAULT 0,
  valor_pedagio REAL NOT NULL DEFAULT 0,
  valor_outros REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  icms_base REAL NOT NULL DEFAULT 0,
  icms_aliquota REAL NOT NULL DEFAULT 0,
  icms_valor REAL NOT NULL DEFAULT 0,
  pis_aliquota REAL NOT NULL DEFAULT 0,
  pis_valor REAL NOT NULL DEFAULT 0,
  cofins_aliquota REAL NOT NULL DEFAULT 0,
  cofins_valor REAL NOT NULL DEFAULT 0,
  iss_aliquota REAL NOT NULL DEFAULT 0,
  iss_valor REAL NOT NULL DEFAULT 0,
  cst_icms TEXT NOT NULL DEFAULT '00',
  cfop TEXT NOT NULL DEFAULT '',
  modal TEXT NOT NULL DEFAULT 'rodoviario'
    CHECK (modal IN (
      'rodoviario','aereo','aquaviario',
      'ferroviario','dutoviario','multimodal')),
  tipo_servico TEXT NOT NULL DEFAULT 'normal'
    CHECK (tipo_servico IN (
      'normal','subcontratacao','redespacho',
      'redespacho_intermediario','multimodal')),
  uf_inicio TEXT NOT NULL DEFAULT '',
  municipio_inicio TEXT NOT NULL DEFAULT '',
  codigo_municipio_inicio TEXT NOT NULL DEFAULT '',
  uf_fim TEXT NOT NULL DEFAULT '',
  municipio_fim TEXT NOT NULL DEFAULT '',
  codigo_municipio_fim TEXT NOT NULL DEFAULT '',
  placa TEXT NOT NULL DEFAULT '',
  uf_veiculo TEXT NOT NULL DEFAULT '',
  rntrc TEXT NOT NULL DEFAULT '',
  motorista_nome TEXT NOT NULL DEFAULT '',
  motorista_cpf TEXT NOT NULL DEFAULT '',
  operation_id TEXT,
  client_id TEXT,
  xml_content TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_ws
  ON todogreen_fiscal_documents (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_type
  ON todogreen_fiscal_documents (workspace_owner_id, doc_type, status);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_chave
  ON todogreen_fiscal_documents (chave_acesso) WHERE chave_acesso IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_operation
  ON todogreen_fiscal_documents (operation_id) WHERE operation_id IS NOT NULL;

-- ── Documentos referenciados (NF-e no CT-e, CT-e no MDF-e) ─

CREATE TABLE IF NOT EXISTS todogreen_fiscal_document_refs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  fiscal_document_id TEXT NOT NULL,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('nfe', 'cte', 'outros')),
  chave_acesso TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  serie TEXT NOT NULL DEFAULT '',
  emitente_cnpj TEXT NOT NULL DEFAULT '',
  emitente_nome TEXT NOT NULL DEFAULT '',
  valor REAL NOT NULL DEFAULT 0,
  peso_kg REAL NOT NULL DEFAULT 0,
  volumes INTEGER NOT NULL DEFAULT 0,
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fiscal_refs_doc
  ON todogreen_fiscal_document_refs (fiscal_document_id);

-- ── Eventos fiscais (audit trail) ───────────────────────────

CREATE TABLE IF NOT EXISTS todogreen_fiscal_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  fiscal_document_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status_anterior TEXT,
  status_novo TEXT NOT NULL,
  detalhes TEXT NOT NULL DEFAULT '',
  protocolo TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fiscal_events_doc
  ON todogreen_fiscal_events (fiscal_document_id, created_at);
