-- 0074_todogreen_workspace_isolation.sql
--
-- Fecha quatro vazamentos de escopo que sobreviveram à adoção de
-- workspace_owner_id:
--   1. o mesmo e-mail só podia existir uma vez em toda a vertical;
--   2. o mesmo usuário só podia participar de um workspace;
--   3. mensagens de solicitações não carregavam o workspace;
--   4. a régua ESG era global para todas as empresas.

CREATE TABLE todogreen_access_emails_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'active',
  permissions_json TEXT NOT NULL DEFAULT '["*"]',
  note TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  revoked_at TEXT,
  last_access_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, workspace_owner_id, email),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO todogreen_access_emails_v2
  (id, tenant_id, workspace_owner_id, email, role, status, permissions_json,
   note, expires_at, revoked_at, last_access_at, created_by, created_at, updated_at)
SELECT id, tenant_id, workspace_owner_id, email, role, status, permissions_json,
       note, expires_at, revoked_at, last_access_at, created_by, created_at, updated_at
  FROM todogreen_access_emails;

DROP TABLE todogreen_access_emails;
ALTER TABLE todogreen_access_emails_v2 RENAME TO todogreen_access_emails;

CREATE INDEX idx_todogreen_access_emails_status
  ON todogreen_access_emails (tenant_id, workspace_owner_id, status, email);
CREATE INDEX idx_todogreen_access_expiry
  ON todogreen_access_emails (tenant_id, workspace_owner_id, status, expires_at);

CREATE TABLE tenant_users_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_owner_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  invited_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, workspace_owner_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO tenant_users_v2
  (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json,
   invited_by, created_at, updated_at)
SELECT id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json,
       invited_by, created_at, updated_at
  FROM tenant_users;

DROP TABLE tenant_users;
ALTER TABLE tenant_users_v2 RENAME TO tenant_users;

CREATE INDEX idx_tenant_users_user
  ON tenant_users (user_id, tenant_id, status);
CREATE INDEX idx_tenant_users_workspace
  ON tenant_users (workspace_owner_id, tenant_id, status);

ALTER TABLE todogreen_client_request_messages
  ADD COLUMN workspace_owner_id TEXT NOT NULL DEFAULT '';

UPDATE todogreen_client_request_messages
   SET workspace_owner_id = COALESCE((
         SELECT r.workspace_owner_id
           FROM todogreen_client_requests r
          WHERE r.tenant_id = todogreen_client_request_messages.tenant_id
            AND r.id = todogreen_client_request_messages.request_id
          LIMIT 1
       ), '')
 WHERE workspace_owner_id = '';

CREATE INDEX idx_todogreen_client_requests_workspace
  ON todogreen_client_requests
    (tenant_id, workspace_owner_id, status, due_at, created_at DESC);
CREATE INDEX idx_todogreen_client_request_messages_workspace
  ON todogreen_client_request_messages
    (tenant_id, workspace_owner_id, request_id, created_at);

-- O gatilho de ativação referencia a tabela de pesos pelo nome. SQLite não
-- permite derrubar a tabela enquanto esse SQL compilado continua ativo.
DROP TRIGGER IF EXISTS trg_todogreen_client_activation_gate;

CREATE TABLE todogreen_score_weights_v2 (
  version TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  methodology TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_owner_id, version)
);

INSERT INTO todogreen_score_weights_v2
  (version, tenant_id, workspace_owner_id, weights_json, methodology, source,
   responsible, effective_from, effective_to, status, created_by, created_at)
SELECT w.version, w.tenant_id,
       COALESCE((
         SELECT t.workspace_owner_id
           FROM tenant_users t
          WHERE t.tenant_id = w.tenant_id
            AND t.user_id = w.created_by
            AND t.status = 'active'
          ORDER BY t.updated_at DESC
          LIMIT 1
       ), w.created_by),
       w.weights_json, w.methodology, w.source, w.responsible,
       w.effective_from, w.effective_to, w.status, w.created_by, w.created_at
  FROM todogreen_score_weights w;

DROP TABLE todogreen_score_weights;
ALTER TABLE todogreen_score_weights_v2 RENAME TO todogreen_score_weights;

CREATE INDEX idx_todogreen_score_weights_active
  ON todogreen_score_weights
    (tenant_id, workspace_owner_id, status, effective_from DESC);

CREATE TRIGGER trg_todogreen_client_activation_gate
BEFORE UPDATE OF fields_json ON todogreen_clients
WHEN json_extract(NEW.fields_json, '$.stage') = 'Cliente ativo'
 AND COALESCE(json_extract(OLD.fields_json, '$.stage'), '') <> 'Cliente ativo'
BEGIN
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:contract') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_contracts c
     WHERE c.tenant_id=NEW.tenant_id AND c.workspace_owner_id=NEW.workspace_owner_id
       AND c.client_id=NEW.id AND c.archived_at IS NULL
       AND lower(c.status) NOT IN ('draft','cancelled','canceled','expired')
       AND c.signature_status='signed' AND c.approval_status='approved'
       AND c.price_table_id<>'' AND c.billing_day IS NOT NULL
       AND c.billing_rules_json<>'{}' AND c.sla_json<>'{}'
       AND COALESCE(c.responsible_user_id,'')<>''
       AND (c.start_date IS NULL OR c.start_date='' OR c.start_date<=date('now'))
       AND (c.end_date IS NULL OR c.end_date='' OR c.end_date>=date('now'))
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:cost_center') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_cost_centers cc
     WHERE cc.tenant_id=NEW.tenant_id AND cc.workspace_owner_id=NEW.workspace_owner_id
       AND cc.archived_at IS NULL AND cc.status='ativo'
       AND json_extract(cc.fields_json,'$.clientId')=NEW.id
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:operation') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_client_operations o
     WHERE o.tenant_id=NEW.tenant_id AND o.workspace_owner_id=NEW.workspace_owner_id
       AND o.client_id=NEW.id AND o.archived_at IS NULL
       AND lower(o.status) NOT IN ('cancelada','cancelado','cancelled','canceled')
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:responsible') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_client_assignments a
     WHERE a.tenant_id=NEW.tenant_id AND a.client_id=NEW.id AND a.status='active'
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:portal') WHERE NEW.portal_enabled<>1 OR NOT EXISTS (
    SELECT 1 FROM todogreen_client_users u
     WHERE u.tenant_id=NEW.tenant_id AND u.client_id=NEW.id AND u.status='active'
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:state') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_client_activation_state s
     WHERE s.tenant_id=NEW.tenant_id AND s.workspace_owner_id=NEW.workspace_owner_id AND s.client_id=NEW.id
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:integration') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_client_activation_state s
     WHERE s.tenant_id=NEW.tenant_id AND s.workspace_owner_id=NEW.workspace_owner_id
       AND s.client_id=NEW.id AND s.integration_status IN ('ready','not_required')
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:tracking') WHERE
    NOT EXISTS (
      SELECT 1 FROM todogreen_client_activation_state s
       WHERE s.tenant_id=NEW.tenant_id AND s.workspace_owner_id=NEW.workspace_owner_id
         AND s.client_id=NEW.id AND s.tracking_required=0
    ) AND NOT EXISTS (
      SELECT 1 FROM todogreen_tracker_integrations ti
       WHERE ti.tenant_id=NEW.tenant_id AND ti.workspace_owner_id=NEW.workspace_owner_id
         AND ti.archived_at IS NULL AND lower(ti.status) IN ('ready','active')
         AND (ti.last_success_at IS NOT NULL OR ti.last_test_at IS NOT NULL)
    );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:esg') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_client_activation_state s
     WHERE s.tenant_id=NEW.tenant_id AND s.workspace_owner_id=NEW.workspace_owner_id
       AND s.client_id=NEW.id AND s.esg_enabled=1
  ) OR NOT EXISTS (
    SELECT 1 FROM todogreen_score_weights sw
     WHERE sw.tenant_id=NEW.tenant_id AND sw.workspace_owner_id=NEW.workspace_owner_id
       AND sw.status='active' AND sw.effective_from<=datetime('now')
       AND (sw.effective_to IS NULL OR sw.effective_to='' OR sw.effective_to>=datetime('now'))
  );
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:dashboard') WHERE NOT EXISTS (
    SELECT 1 FROM todogreen_dashboards d
     WHERE d.tenant_id=NEW.tenant_id AND d.workspace_owner_id=NEW.workspace_owner_id
       AND d.archived_at IS NULL AND d.status='active'
       AND json_extract(d.filters_json,'$.clientId')=NEW.id
  );
END;
