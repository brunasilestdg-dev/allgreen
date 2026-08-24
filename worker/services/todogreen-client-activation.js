import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { buildClientActivationReadiness } from "../../src/features/logistics/clientActivationDomain.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const parse = (value, fallback = {}) => {
  try { return JSON.parse(value || ""); } catch { return fallback; }
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const mayRead = (access) => ["*", "clients:read", "clients:manage", "operations:manage", "operation:manage"]
  .some((permission) => podeNaVertical(access, permission));
const mayManage = (access) => ["*", "clients:manage"].some((permission) => podeNaVertical(access, permission));

const clientView = (row) => {
  const fields = parse(row?.fields_json, {});
  return row ? {
    id: row.id,
    name: row.name,
    accountCode: row.account_code || "",
    status: row.status,
    portalEnabled: row.portal_enabled === 1,
    crm: object(fields.crm),
    activation: object(fields.activation),
    revision: row.revision,
  } : null;
};
const contractView = (row) => row ? {
  id: row.id,
  title: row.title,
  status: row.status,
  startDate: row.start_date || "",
  endDate: row.end_date || "",
  signatureStatus: row.signature_status || "pending",
  approvalStatus: row.approval_status || "pending",
  priceTableId: row.price_table_id || "",
  billingDay: row.billing_day || null,
  billingRules: parse(row.billing_rules_json, {}),
  sla: parse(row.sla_json, {}),
  responsibleUserId: row.responsible_user_id || "",
} : null;

async function loadSnapshot(env, access, clientId) {
  const clientRow = await env.DB.prepare(
    `SELECT id,name,account_code,status,portal_enabled,fields_json,revision
       FROM todogreen_clients
      WHERE tenant_id=? AND workspace_owner_id=? AND id=? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId, clientId).first();
  if (!clientRow) return null;

  const contractRow = await env.DB.prepare(
    `SELECT * FROM todogreen_contracts
      WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
      ORDER BY CASE WHEN signature_status='signed' AND approval_status='approved' THEN 0 ELSE 1 END,
               updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, clientId).first();

  const [costCenter, operation, portalUsers, assignments, tracker, scoreWeights, dashboard] = await Promise.all([
    env.DB.prepare(
      `SELECT id,code,name FROM todogreen_cost_centers
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL AND status='ativo'
          AND json_extract(fields_json,'$.clientId')=? ORDER BY updated_at DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, clientId).first(),
    env.DB.prepare(
      `SELECT id,reference,status,contract_id FROM todogreen_client_operations
        WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
          AND lower(status) NOT IN ('cancelada','cancelado','cancelled','canceled')
        ORDER BY updated_at DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, clientId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_client_users
        WHERE tenant_id=? AND client_id=? AND status='active'`,
    ).bind(TENANT_ID, clientId).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_client_assignments
        WHERE tenant_id=? AND client_id=? AND status='active'`,
    ).bind(TENANT_ID, clientId).first(),
    env.DB.prepare(
      `SELECT id,status,last_test_at,last_success_at,last_sync_at FROM todogreen_tracker_integrations
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        ORDER BY updated_at DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId).first(),
    env.DB.prepare(
      `SELECT version FROM todogreen_score_weights
        WHERE tenant_id=? AND status='active' AND effective_from<=datetime('now')
          AND (effective_to IS NULL OR effective_to='' OR effective_to>=datetime('now'))
        ORDER BY effective_from DESC LIMIT 1`,
    ).bind(TENANT_ID).first(),
    env.DB.prepare(
      `SELECT id,name FROM todogreen_dashboards
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL AND status='active'
          AND json_extract(filters_json,'$.clientId')=? ORDER BY updated_at DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, clientId).first(),
  ]);

  const snapshot = {
    client: clientView(clientRow),
    contract: contractView(contractRow),
    costCenter: costCenter || null,
    operation: operation || null,
    portalUsers: Number(portalUsers?.total || 0),
    assignments: Number(assignments?.total || 0),
    trackerIntegration: tracker ? {
      id: tracker.id,
      status: tracker.status,
      lastTestAt: tracker.last_test_at || "",
      lastSuccessAt: tracker.last_success_at || "",
      lastSyncAt: tracker.last_sync_at || "",
    } : null,
    activeScoreWeights: scoreWeights?.version || "",
    dashboard: dashboard || null,
  };
  return { ...snapshot, readiness: buildClientActivationReadiness(snapshot) };
}

const costCenterCode = (client) => {
  const source = text(client.accountCode || client.id, 40).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(-14);
  return `CLI-${source || client.id.slice(0, 8).toUpperCase()}`.slice(0, 40);
};

async function prepare(env, access, user, clientId) {
  let snapshot = await loadSnapshot(env, access, clientId);
  if (!snapshot) return null;
  const now = new Date().toISOString();
  const created = [];

  if (!snapshot.costCenter) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_cost_centers
       (id,tenant_id,workspace_owner_id,code,name,parent_id,owner_user_id,status,fields_json,
        revision,created_by,updated_by,created_at,updated_at,archived_at)
       VALUES (?,?,?,?,?,'',?,'ativo',?,1,?,?,?,?,NULL)`,
    ).bind(
      `tdg-client-cc-${clientId}`.slice(0, 120), TENANT_ID, access.ownerId,
      costCenterCode(snapshot.client), `Cliente · ${snapshot.client.name}`.slice(0, 200),
      snapshot.contract?.responsibleUserId || user.id,
      JSON.stringify({ clientId, source: "client_activation" }), user.id, user.id, now, now,
    ).run();
    created.push("costCenter");
  }

  if (!snapshot.dashboard) {
    const widgets = [
      { id: crypto.randomUUID(), title: "Operações", type: "metric", metric: "operacoes", size: "medium" },
      { id: crypto.randomUUID(), title: "Margem", type: "metric", metric: "margem", size: "medium" },
      { id: crypto.randomUUID(), title: "CO₂ evitado", type: "metric", metric: "co2-evitado", size: "medium" },
      { id: crypto.randomUUID(), title: "Green Score", type: "metric", metric: "green-score", size: "medium" },
    ];
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_dashboards
       (id,tenant_id,workspace_owner_id,name,description,visibility,filters_json,widgets_json,
        layout_json,status,revision,created_by,updated_by,created_at,updated_at,archived_at)
       VALUES (?,?,?,?,?,'team',?,?,'{}','active',1,?,?,?,?,NULL)`,
    ).bind(
      `tdg-client-dashboard-${clientId}`.slice(0, 120), TENANT_ID, access.ownerId,
      `Cliente · ${snapshot.client.name}`.slice(0, 200),
      "Painel provisionado pela implantação, com filtro fixado nesta conta.",
      JSON.stringify({ clientId }), JSON.stringify(widgets), user.id, user.id, now, now,
    ).run();
    created.push("dashboard");
  }

  const row = await env.DB.prepare(
    "SELECT portal_enabled,fields_json,revision FROM todogreen_clients WHERE id=? AND tenant_id=? AND workspace_owner_id=?",
  ).bind(clientId, TENANT_ID, access.ownerId).first();
  const fields = parse(row.fields_json, {});
  const activation = { ...object(fields.activation) };
  if (!activation.status) activation.status = "implementation";
  if (snapshot.activeScoreWeights) activation.esgEnabled = true;
  if (snapshot.trackerIntegration && ["ready", "active"].includes(text(snapshot.trackerIntegration.status, 20).toLowerCase()) &&
      (snapshot.trackerIntegration.lastSuccessAt || snapshot.trackerIntegration.lastTestAt))
    activation.integrationStatus = "ready";
  fields.activation = activation;
  await env.DB.prepare(
    `UPDATE todogreen_clients SET portal_enabled=?,fields_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(
    snapshot.portalUsers > 0 ? 1 : Number(row.portal_enabled || 0), JSON.stringify(fields), user.id, now,
    clientId, TENANT_ID, access.ownerId, row.revision,
  ).run();

  snapshot = await loadSnapshot(env, access, clientId);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "client_activation_prepared", resourceType: "client_activation",
    resourceId: clientId, clientId, after: { created, readiness: snapshot.readiness },
  });
  return { snapshot, created };
}

async function configure(env, access, user, clientId, body) {
  const row = await env.DB.prepare(
    "SELECT fields_json,revision FROM todogreen_clients WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(clientId, TENANT_ID, access.ownerId).first();
  if (!row) return null;
  const fields = parse(row.fields_json, {});
  const before = object(fields.activation);
  const activation = { ...before };
  if (Object.prototype.hasOwnProperty.call(body, "integrationStatus")) {
    const value = text(body.integrationStatus, 30).toLowerCase();
    if (!["pending", "ready", "not_required"].includes(value)) throw new Error("Situação de integração inválida.");
    activation.integrationStatus = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "trackingRequired"))
    activation.trackingRequired = body.trackingRequired !== false;
  fields.activation = activation;
  await env.DB.prepare(
    `UPDATE todogreen_clients SET fields_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(JSON.stringify(fields), user.id, new Date().toISOString(), clientId, TENANT_ID, access.ownerId, row.revision).run();
  const snapshot = await loadSnapshot(env, access, clientId);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "client_activation_configured", resourceType: "client_activation",
    resourceId: clientId, clientId, before, after: activation,
  });
  return snapshot;
}

async function activate(env, access, user, clientId) {
  const prepared = await prepare(env, access, user, clientId);
  if (!prepared) return { missing: true };
  if (!prepared.snapshot.readiness.ready) return { blocked: true, ...prepared };

  const row = await env.DB.prepare(
    "SELECT fields_json,revision FROM todogreen_clients WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(clientId, TENANT_ID, access.ownerId).first();
  const fields = parse(row.fields_json, {});
  const before = { crm: object(fields.crm), activation: object(fields.activation) };
  fields.crm = { ...object(fields.crm), stage: "Cliente ativo" };
  fields.activation = { ...object(fields.activation), status: "active", activatedAt: new Date().toISOString(), activatedBy: user.id };
  await env.DB.prepare(
    `UPDATE todogreen_clients SET status='ativo',fields_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(JSON.stringify(fields), user.id, new Date().toISOString(), clientId, TENANT_ID, access.ownerId, row.revision).run();
  const snapshot = await loadSnapshot(env, access, clientId);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "client_activated", resourceType: "client_activation", resourceId: clientId,
    clientId, before, after: { crm: fields.crm, activation: fields.activation, readiness: snapshot.readiness },
  });
  return { snapshot, created: prepared.created };
}

export async function handleTodoGreenClientActivation(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  const clientId = text(url.searchParams.get("clientId"), 120);
  if (!clientId) return json({ error: "Informe o cliente da implantação." }, 400);

  if (request.method === "GET") {
    if (!mayRead(access)) return json({ error: "Seu papel não pode consultar implantações." }, 403);
    const snapshot = await loadSnapshot(env, access, clientId);
    return snapshot ? json(snapshot) : json({ error: "Cliente não encontrado neste espaço." }, 404);
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!mayManage(access)) return json({ error: "Seu papel não pode alterar a implantação." }, 403);

  const body = await request.json().catch(() => ({}));
  const action = text(body.action, 30).toLowerCase();
  try {
    if (action === "prepare") {
      const result = await prepare(env, access, user, clientId);
      return result ? json(result) : json({ error: "Cliente não encontrado neste espaço." }, 404);
    }
    if (action === "configure") {
      const snapshot = await configure(env, access, user, clientId, body);
      return snapshot ? json(snapshot) : json({ error: "Cliente não encontrado neste espaço." }, 404);
    }
    if (action === "activate") {
      const result = await activate(env, access, user, clientId);
      if (result.missing) return json({ error: "Cliente não encontrado neste espaço." }, 404);
      if (result.blocked) return json({ error: "Cliente ainda não pode ser ativado.", ...result }, 409);
      return json(result);
    }
    return json({ error: "Ação de implantação inválida." }, 400);
  } catch (error) {
    const message = text(error?.message || "Não foi possível processar a implantação.", 240);
    if (message.startsWith("CLIENT_ACTIVATION_BLOCKED:"))
      return json({ error: "A ativação foi bloqueada pelo gate de implantação.", code: message }, 409);
    return json({ error: message }, 400);
  }
}
