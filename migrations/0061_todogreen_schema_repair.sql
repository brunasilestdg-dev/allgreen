-- Reparo idempotente das migrações 0059 e 0060.
-- O D1 remoto pode registrar uma migração com trigger como processada mesmo
-- quando seu parser interrompe o bloco. Uma nova versão garante o schema e
-- recria o gate com uma forma que não usa CASE dentro do BEGIN do trigger.

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

CREATE TABLE IF NOT EXISTS todogreen_simulator_parameter_sets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global','product','modality','vehicle','region','client','contract')),
  scope_key TEXT NOT NULL DEFAULT 'global',
  parameters_json TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','superseded','archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_owner_id, scope_type, scope_key, version)
);

CREATE INDEX IF NOT EXISTS idx_todogreen_simulator_parameters_active
  ON todogreen_simulator_parameter_sets
    (tenant_id, workspace_owner_id, status, scope_type, scope_key, effective_from DESC);

DROP TRIGGER IF EXISTS trg_todogreen_client_activation_gate;

CREATE TRIGGER trg_todogreen_client_activation_gate
BEFORE UPDATE OF fields_json ON todogreen_clients
WHEN json_extract(NEW.fields_json, '$.stage') = 'Cliente ativo'
 AND COALESCE(json_extract(OLD.fields_json, '$.stage'), '') <> 'Cliente ativo'
BEGIN
  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:contract') WHERE NOT EXISTS (
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
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:cost_center') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_cost_centers cc
     WHERE cc.tenant_id = NEW.tenant_id
       AND cc.workspace_owner_id = NEW.workspace_owner_id
       AND cc.archived_at IS NULL
       AND cc.status = 'ativo'
       AND json_extract(cc.fields_json, '$.clientId') = NEW.id
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:operation') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_client_operations o
     WHERE o.tenant_id = NEW.tenant_id
       AND o.workspace_owner_id = NEW.workspace_owner_id
       AND o.client_id = NEW.id
       AND o.archived_at IS NULL
       AND lower(o.status) NOT IN ('cancelada','cancelado','cancelled','canceled')
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:responsible') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_client_assignments a
     WHERE a.tenant_id = NEW.tenant_id
       AND a.client_id = NEW.id
       AND a.status = 'active'
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:portal') WHERE NEW.portal_enabled <> 1 OR NOT EXISTS (
    SELECT 1
      FROM todogreen_client_users u
     WHERE u.tenant_id = NEW.tenant_id
       AND u.client_id = NEW.id
       AND u.status = 'active'
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:state') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_client_activation_state s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.workspace_owner_id = NEW.workspace_owner_id
       AND s.client_id = NEW.id
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:integration') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_client_activation_state s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.workspace_owner_id = NEW.workspace_owner_id
       AND s.client_id = NEW.id
       AND s.integration_status IN ('ready','not_required')
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:tracking') WHERE
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
    );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:esg') WHERE NOT EXISTS (
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
  );

  SELECT RAISE(ABORT, 'CLIENT_ACTIVATION_BLOCKED:dashboard') WHERE NOT EXISTS (
    SELECT 1
      FROM todogreen_dashboards d
     WHERE d.tenant_id = NEW.tenant_id
       AND d.workspace_owner_id = NEW.workspace_owner_id
       AND d.archived_at IS NULL
       AND d.status = 'active'
       AND json_extract(d.filters_json, '$.clientId') = NEW.id
  );
END;
