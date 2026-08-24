-- Cliente ativo deixa de ser apenas um rótulo de CRM.
-- O estado da implantação fica fora de fields_json para sobreviver a qualquer
-- edição comercial do cliente, que normaliza o CRM e descarta chaves desconhecidas.

CREATE TABLE IF NOT EXISTS todogreen_client_activation_state (
  client_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'implementation'
    CHECK (status IN ('implementation','active')),
  integration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (integration_status IN ('pending','ready','not_required')),
  tracking_required INTEGER NOT NULL DEFAULT 1,
  esg_enabled INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  activated_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES todogreen_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todogreen_client_activation_scope
  ON todogreen_client_activation_state (tenant_id, workspace_owner_id, status, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_todogreen_client_activation_gate
BEFORE UPDATE OF fields_json ON todogreen_clients
WHEN json_extract(NEW.fields_json, '$.stage') = 'Cliente ativo'
 AND COALESCE(json_extract(OLD.fields_json, '$.stage'), '') <> 'Cliente ativo'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_contracts c
     WHERE c.tenant_id = NEW.tenant_id
       AND c.workspace_owner_id = NEW.workspace_owner_id
       AND c.client_id = NEW.id
       AND c.archived_at IS NULL
       AND lower(c.status) NOT IN ('draft','cancelled','canceled','expired')
       AND c.signature_status = 'signed'
       AND c.approval_status = 'approved'
       AND c.price_table_id <> ''
       AND c.billing_day IS NOT NULL
       AND c.billing_rules_json <> '{}'
       AND c.sla_json <> '{}'
       AND COALESCE(c.responsible_user_id, '') <> ''
       AND (c.start_date IS NULL OR c.start_date = '' OR c.start_date <= date('now'))
       AND (c.end_date IS NULL OR c.end_date = '' OR c.end_date >= date('now'))
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:contract') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_cost_centers cc
     WHERE cc.tenant_id = NEW.tenant_id
       AND cc.workspace_owner_id = NEW.workspace_owner_id
       AND cc.archived_at IS NULL
       AND cc.status = 'ativo'
       AND json_extract(cc.fields_json, '$.clientId') = NEW.id
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:cost_center') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_client_operations o
     WHERE o.tenant_id = NEW.tenant_id
       AND o.workspace_owner_id = NEW.workspace_owner_id
       AND o.client_id = NEW.id
       AND o.archived_at IS NULL
       AND lower(o.status) NOT IN ('cancelada','cancelado','cancelled','canceled')
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:operation') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_client_assignments a
     WHERE a.tenant_id = NEW.tenant_id
       AND a.client_id = NEW.id
       AND a.status = 'active'
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:responsible') END;

  SELECT CASE WHEN NEW.portal_enabled <> 1 OR NOT EXISTS (
    SELECT 1
      FROM todogreen_client_users u
     WHERE u.tenant_id = NEW.tenant_id
       AND u.client_id = NEW.id
       AND u.status = 'active'
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:portal') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_client_activation_state s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.workspace_owner_id = NEW.workspace_owner_id
       AND s.client_id = NEW.id
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:state') END;

  SELECT CASE WHEN
    NOT EXISTS (
      SELECT 1
        FROM todogreen_client_activation_state s
       WHERE s.tenant_id = NEW.tenant_id
         AND s.workspace_owner_id = NEW.workspace_owner_id
         AND s.client_id = NEW.id
         AND s.integration_status = 'not_required'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM todogreen_tracker_integrations ti
       WHERE ti.tenant_id = NEW.tenant_id
         AND ti.workspace_owner_id = NEW.workspace_owner_id
         AND ti.archived_at IS NULL
         AND lower(ti.status) IN ('ready','active')
         AND (ti.last_success_at IS NOT NULL OR ti.last_test_at IS NOT NULL)
    )
  THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:integration') END;

  SELECT CASE WHEN
    NOT EXISTS (
      SELECT 1
        FROM todogreen_client_activation_state s
       WHERE s.tenant_id = NEW.tenant_id
         AND s.workspace_owner_id = NEW.workspace_owner_id
         AND s.client_id = NEW.id
         AND s.tracking_required = 0
    )
    AND NOT EXISTS (
      SELECT 1
        FROM todogreen_tracker_integrations ti
       WHERE ti.tenant_id = NEW.tenant_id
         AND ti.workspace_owner_id = NEW.workspace_owner_id
         AND ti.archived_at IS NULL
         AND lower(ti.status) IN ('ready','active')
         AND (ti.last_success_at IS NOT NULL OR ti.last_test_at IS NOT NULL)
    )
  THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:tracking') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_client_activation_state s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.workspace_owner_id = NEW.workspace_owner_id
       AND s.client_id = NEW.id
       AND s.esg_enabled = 1
  ) OR NOT EXISTS (
    SELECT 1
      FROM todogreen_score_weights sw
     WHERE sw.tenant_id = NEW.tenant_id
       AND sw.status = 'active'
       AND sw.effective_from <= datetime('now')
       AND (sw.effective_to IS NULL OR sw.effective_to = '' OR sw.effective_to >= datetime('now'))
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:esg') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM todogreen_dashboards d
     WHERE d.tenant_id = NEW.tenant_id
       AND d.workspace_owner_id = NEW.workspace_owner_id
       AND d.archived_at IS NULL
       AND d.status = 'active'
       AND json_extract(d.filters_json, '$.clientId') = NEW.id
  ) THEN RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:dashboard') END;
END;
