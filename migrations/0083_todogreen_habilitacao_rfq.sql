-- 0083_todogreen_habilitacao_rfq.sql
-- Central de RFQ e RFI: o acervo de habilitação e o ciclo da cotação.
--
-- Substitui a página HTML solta no computador da titular ("Central de RFQ e RFI
-- v2.0", 15/08/2026) e o índice mestre em planilha.
--
-- REGRA CENTRAL: não existe coluna de status. O semáforo é DERIVADO
-- (`habilitacaoDomain.js#situacaoDoDocumento`), sempre contra a data de hoje.
-- Status gravado é status que envelhece calado: um documento marcado VÁLIDO em
-- agosto continua dizendo VÁLIDO em dezembro, e alguém manda ao comprador uma
-- apólice vencida confiando na etiqueta.

CREATE TABLE IF NOT EXISTS todogreen_habilitacao_documentos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  -- Tipo canônico do catálogo (CARTAO-CNPJ, APOLICE-RCTR-C...). É por ele que o
  -- kit encontra o documento.
  doc_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'societario',
  title TEXT NOT NULL,
  -- Número, apólice, inscrição — o que o comprador confere contra o órgão.
  numero TEXT NOT NULL DEFAULT '',
  orgao TEXT NOT NULL DEFAULT '',
  -- Código da unidade (MATRIZ-SP, F02-SOROCABA-SP, EMPRESA). Metade do acervo é
  -- por filial, e o comprador cruza CNPJ contra ANTT e Receita: mandar o da
  -- matriz onde se pede o da filial trava a homologação.
  unidade TEXT NOT NULL DEFAULT 'EMPRESA',
  cnpj TEXT NOT NULL DEFAULT '',
  issued_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  -- Documento que não vence (contrato social consolidado, código de conduta).
  -- Sem esta marca ele cairia em REEMITIR para sempre.
  permanente INTEGER NOT NULL DEFAULT 0,
  -- Quantos dias um documento SEM validade legal ainda é aceito. A DHL pede
  -- CNPJ e SINTEGRA com consulta de até 2 meses; o padrão do domínio é 90.
  dias_aceitaveis INTEGER NOT NULL DEFAULT 0,
  -- O arquivo mora no cofre interno (todogreen_internal_files) ou num link.
  arquivo_id TEXT NOT NULL DEFAULT '',
  arquivo_url TEXT NOT NULL DEFAULT '',
  arquivo_nome TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_habilitacao_owner
  ON todogreen_habilitacao_documentos (workspace_owner_id, archived_at, updated_at DESC);
-- O acervo é lido por TIPO (é assim que o kit monta) e por VENCIMENTO (é assim
-- que a rotina de segunda-feira filtra).
CREATE INDEX IF NOT EXISTS idx_todogreen_habilitacao_tipo
  ON todogreen_habilitacao_documentos (workspace_owner_id, doc_type, archived_at);
CREATE INDEX IF NOT EXISTS idx_todogreen_habilitacao_validade
  ON todogreen_habilitacao_documentos (workspace_owner_id, archived_at, expires_at);

-- Kits: uma lista de TIPOS, não de arquivos. A prontidão é sempre calculada
-- contra o acervo de hoje — kit que guardasse arquivos ficaria velho junto com
-- eles.
CREATE TABLE IF NOT EXISTS todogreen_habilitacao_kits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  kit_key TEXT NOT NULL DEFAULT '',
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  tipos_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_habilitacao_kits_owner
  ON todogreen_habilitacao_kits (workspace_owner_id, archived_at, updated_at DESC);

-- O ciclo do RFQ, do e-mail ao resultado.
--
-- `pedido` guarda o texto CRU do que o cliente pediu, copiado do e-mail sem
-- resumir, e `enviados_json` a lista exata do que saiu com a data. É o que
-- responde "mandaram o quê mesmo?" três meses depois. `motivo` no fechamento é
-- o que transforma um ano de cotações na única inteligência comercial que essa
-- rotina produz.
CREATE TABLE IF NOT EXISTS todogreen_rfq_pedidos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  opportunity_id TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL,
  -- recebido | montando | enviado | ganho | perdido | sem-resposta
  etapa TEXT NOT NULL DEFAULT 'recebido',
  canal TEXT NOT NULL DEFAULT '',
  solicitante TEXT NOT NULL DEFAULT '',
  pedido TEXT NOT NULL DEFAULT '',
  kit_key TEXT NOT NULL DEFAULT '',
  prazo TEXT NOT NULL DEFAULT '',
  enviado_em TEXT NOT NULL DEFAULT '',
  enviados_json TEXT NOT NULL DEFAULT '[]',
  resultado_em TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todogreen_rfq_owner
  ON todogreen_rfq_pedidos (workspace_owner_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todogreen_rfq_conta
  ON todogreen_rfq_pedidos (workspace_owner_id, client_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_todogreen_rfq_prazo
  ON todogreen_rfq_pedidos (workspace_owner_id, archived_at, etapa, prazo);
