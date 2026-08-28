import {
  GOAL_CADENCES,
  GOAL_CATEGORIES,
  GOAL_DIRECTIONS,
  GOAL_METRICS,
  GOAL_SOURCES,
  GOAL_SCOPES,
  GOAL_UNITS,
  goalMetric,
  goalProgress,
  goalSummary,
  normalizeGoalCriteria,
  validateGoalInput,
} from "../../src/features/logistics/goalsDomain.js";
import { podeNaVertical, TENANT_ID } from "./todogreen-access.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const lower = (value) => clean(value, 200).toLowerCase();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parse = (value, fallback) => {
  try { return JSON.parse(value || ""); } catch { return fallback; }
};
const nowIso = () => new Date().toISOString();
const day = (value) => clean(value, 10);
const month = (value) => day(value).slice(0, 7);
const metricKey = (value) => clean(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

const mapMetricRow = (row) => ({
  id: row.metric_key,
  databaseId: row.id,
  label: row.label,
  description: row.description || "",
  category: row.category,
  unit: row.unit,
  direction: row.direction,
  source: row.source_key,
  sourceLabel: row.source_label,
  measurementMode: row.measurement_mode,
  formula: row.formula || "",
  criteria: normalizeGoalCriteria(parse(row.criteria_json, [])),
  active: Boolean(row.active),
  custom: true,
  revision: number(row.revision, 1),
});

async function customMetrics(env, access, includeInactive = false) {
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_goal_metrics
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND (?=1 OR active=1) ORDER BY category,label`,
  ).bind(TENANT_ID, access.ownerId, includeInactive ? 1 : 0).all();
  return (rows.results || []).map(mapMetricRow);
}

async function metricCatalog(env, access, includeInactive = false) {
  return [...GOAL_METRICS.map((item) => ({ ...item, custom: false, criteria: [] })),
    ...(await customMetrics(env, access, includeInactive))];
}

const ROLE_GOAL_PERMISSIONS = Object.freeze({
  lideranca_comercial: ["goal:read", "goal:create", "goal:update", "goal:checkin", "goal:approve", "goal:close", "goal:manage-team", "goal:export"],
  vendedor: ["goal:read", "goal:checkin"],
  pricing: ["goal:read", "goal:checkin"],
  financeiro: ["goal:read", "goal:checkin", "goal:validate"],
  operacoes: ["goal:read", "goal:checkin", "goal:validate"],
  sustentabilidade: ["goal:read", "goal:checkin", "goal:validate"],
  auditor: ["goal:read", "goal:export"],
});

const goalCan = (access, permission) => {
  if (!access) return false;
  if (["owner", "admin"].includes(access.role)) return true;
  if (podeNaVertical(access, permission)) return true;
  return (ROLE_GOAL_PERMISSIONS[access.role] || []).includes(permission);
};

const managesAllGoals = (access) =>
  goalCan(access, "goal:manage-company") || goalCan(access, "goal:manage-team");

const mapGoalRow = (row, measuredValue = null, sourceDetails = {}) => {
  const currentValue = measuredValue == null ? number(row.current_value) : number(measuredValue);
  const goal = {
    id: row.id,
    parentGoalId: row.parent_goal_id || "",
    title: row.title,
    description: row.description,
    category: row.category,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeLabel: row.scope_label,
    metricKey: row.metric_key,
    unit: row.unit,
    direction: row.direction,
    measurementMode: row.measurement_mode,
    sourceKey: row.source_key,
    sourceLabel: row.source_label,
    formula: row.formula,
    baselineValue: number(row.baseline_value),
    targetValue: number(row.target_value),
    currentValue,
    rangeMin: row.range_min == null ? null : number(row.range_min),
    rangeMax: row.range_max == null ? null : number(row.range_max),
    weight: number(row.weight, 100),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    cadence: row.cadence,
    ownerUserId: row.owner_user_id || "",
    ownerEmail: row.owner_email || "",
    ownerLabel: row.owner_label || "",
    evidenceRequired: Boolean(row.evidence_required),
    thresholds: parse(row.thresholds_json, {}),
    status: row.status,
    approvalStatus: row.approval_status,
    version: number(row.version, 1),
    revision: number(row.revision, 1),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || "",
    closedBy: row.closed_by || "",
    closedAt: row.closed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceDetails,
  };
  return { ...goal, progress: goalProgress(goal) };
};

const filterForScope = (goal, column = "client_id") =>
  goal.scope_type === "client" && goal.scope_id
    ? { sql: ` AND ${column} = ?`, binds: [goal.scope_id] }
    : { sql: "", binds: [] };

async function automaticValue(env, access, row) {
  if (row.measurement_mode !== "automatic")
    return { value: number(row.current_value), details: { mode: "manual" } };
  const start = row.period_start;
  const end = row.period_end;
  const startMonth = month(start);
  const endMonth = month(end);
  const client = filterForScope(row);
  const common = [TENANT_ID, access.ownerId];
  const sourceKey = clean(row.source_key, 100) || goalMetric(row.metric_key).source;
  let result = null;

  if (["financial.revenue", "financial.cost"].includes(sourceKey)) {
    const kind = sourceKey === "financial.revenue" ? "revenue" : "cost";
    result = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS value
         FROM todogreen_financial_entries
        WHERE tenant_id = ? AND workspace_owner_id = ? AND kind = ?
          AND archived_at IS NULL AND status = 'confirmed'
          AND reference_month >= ? AND reference_month <= ?${client.sql}`,
    ).bind(...common, kind, startMonth, endMonth, ...client.binds).first();
  } else if (sourceKey === "financial.margin") {
    const marginClient = filterForScope(row);
    result = await env.DB.prepare(
      `SELECT CASE WHEN revenue = 0 THEN 0 ELSE ((revenue - cost) / revenue) * 100 END AS value
         FROM (
           SELECT
             COALESCE(SUM(CASE WHEN kind='revenue' THEN amount ELSE 0 END),0) AS revenue,
             COALESCE(SUM(CASE WHEN kind='cost' THEN amount ELSE 0 END),0) AS cost
             FROM todogreen_financial_entries
            WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
              AND status = 'confirmed' AND reference_month >= ? AND reference_month <= ?${marginClient.sql}
         )`,
    ).bind(...common, startMonth, endMonth, ...marginClient.binds).first();
  } else if (sourceKey === "opportunities.pipeline") {
    const scope = filterForScope(row);
    result = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN contract_value > 0 THEN contract_value ELSE monthly_value END),0) AS value
         FROM todogreen_opportunities
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          -- Pipeline é o que ainda está em jogo: fechadas (ganha/perdida) não
          -- contam, senão a meta infla e diverge da tela de Oportunidades.
          AND (stage IS NULL OR stage NOT LIKE 'Fechada%')
          AND created_at >= ? AND created_at <= ?${scope.sql}`,
    ).bind(...common, `${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`, ...scope.binds).first();
  } else if (sourceKey === "opportunities.count") {
    const scope = filterForScope(row);
    result = await env.DB.prepare(
      `SELECT COUNT(*) AS value FROM todogreen_opportunities
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND created_at >= ? AND created_at <= ?${scope.sql}`,
    ).bind(...common, `${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`, ...scope.binds).first();
  } else if (sourceKey === "proposals.count") {
    const scope = filterForScope(row);
    result = await env.DB.prepare(
      `SELECT COUNT(*) AS value FROM todogreen_proposals
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND created_at >= ? AND created_at <= ?${scope.sql}`,
    ).bind(...common, `${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`, ...scope.binds).first();
  } else if (sourceKey === "clients.count") {
    result = await env.DB.prepare(
      `SELECT COUNT(*) AS value FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND created_at >= ? AND created_at <= ?`,
    ).bind(...common, `${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`).first();
  } else if (["operations.trips", "operations.deliveries", "operations.packages", "operations.distance", "operations.occupancy"].includes(sourceKey)) {
    const operationMetric = sourceKey.split(".")[1];
    const column = {
      trips: "SUM(CAST(json_extract(fields_json, '$.trips') AS REAL))",
      deliveries: "SUM(CAST(json_extract(fields_json, '$.deliveries') AS REAL))",
      packages: "SUM(CAST(json_extract(fields_json, '$.packages') AS REAL))",
      distance: "SUM(distance_km)",
      occupancy: "AVG(CAST(json_extract(fields_json, '$.occupancyPercent') AS REAL))",
    }[operationMetric];
    const scope = filterForScope(row);
    result = await env.DB.prepare(
      `SELECT COALESCE(${column},0) AS value FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND substr(service_date, 1, 7) >= ? AND substr(service_date, 1, 7) <= ?${scope.sql}`,
    ).bind(...common, startMonth, endMonth, ...scope.binds).first();
  } else if (sourceKey === "esg.green_score") {
    const clientId = row.scope_type === "client" ? row.scope_id : "";
    const scopeSql = clientId ? " AND client_id = ?" : "";
    result = await env.DB.prepare(
      `SELECT COALESCE(AVG(score),0) AS value FROM (
         SELECT score FROM todogreen_green_scores
          WHERE tenant_id = ? AND workspace_owner_id = ? AND calculated_at <= ?${scopeSql}
          ORDER BY calculated_at DESC LIMIT 20
       )`,
    ).bind(TENANT_ID, row.workspace_owner_id, `${end}T23:59:59.999Z`, ...(clientId ? [clientId] : [])).first();
  } else if (sourceKey === "esg.co2_avoided") {
    const clientId = row.scope_type === "client" ? row.scope_id : "";
    result = await env.DB.prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(result_json,'$.impact.co2AvoidedKg') AS REAL)),0) AS value
         FROM pricing_scenarios
        WHERE tenant_id = ? AND workspace_owner_id = ?
          AND created_at >= ? AND created_at <= ?${clientId ? " AND client_id = ?" : ""}`,
    ).bind(...common, `${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`, ...(clientId ? [clientId] : [])).first();
  }

  return {
    value: number(result?.value),
    details: {
      mode: "automatic",
      sourceKey,
      calculatedAt: nowIso(),
      periodStart: start,
      periodEnd: end,
    },
  };
}

async function event(env, access, user, goalId, action, before = {}, after = {}, note = "") {
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO todogreen_goal_events
     (id,tenant_id,workspace_owner_id,goal_id,actor_user_id,actor_label,action,before_json,after_json,note,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, access.ownerId, goalId, user.id,
    clean(user.name || user.email, 160), clean(action, 80), JSON.stringify(before || {}),
    JSON.stringify(after || {}), clean(note, 600), at,
  ).run();
}

async function goalRow(env, access, goalId) {
  return env.DB.prepare(
    `SELECT * FROM todogreen_goals
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(goalId, TENANT_ID, access.ownerId).first();
}

async function userCanSeeGoal(env, access, user, row) {
  if (!row) return false;
  if (managesAllGoals(access) || access.role !== "vendedor") return goalCan(access, "goal:read") || access.permissions?.includes("read");
  if (row.owner_user_id === user.id || lower(row.owner_email) === lower(access.email)) return true;
  const assigned = await env.DB.prepare(
    `SELECT 1 FROM todogreen_goal_assignees
      WHERE goal_id = ? AND status = 'active' AND (user_id = ? OR lower(email) = ?) LIMIT 1`,
  ).bind(row.id, user.id, lower(access.email)).first();
  if (assigned) return true;
  if (row.scope_type === "client" && row.scope_id) {
    const portfolio = await env.DB.prepare(
      `SELECT 1 FROM todogreen_client_assignments
        WHERE tenant_id = ? AND client_id = ? AND status = 'active' AND lower(seller_email) = ? LIMIT 1`,
    ).bind(TENANT_ID, row.scope_id, lower(access.email)).first();
    return Boolean(portfolio);
  }
  return false;
}

async function canCheckin(env, access, user, row) {
  if (managesAllGoals(access)) return true;
  if (!goalCan(access, "goal:checkin")) return false;
  if (row.owner_user_id === user.id || lower(row.owner_email) === lower(access.email)) return true;
  const assigned = await env.DB.prepare(
    `SELECT 1 FROM todogreen_goal_assignees
      WHERE goal_id = ? AND status = 'active' AND role IN ('owner','participant')
        AND (user_id = ? OR lower(email) = ?) LIMIT 1`,
  ).bind(row.id, user.id, lower(access.email)).first();
  return Boolean(assigned);
}

async function enrichedGoal(env, access, row) {
  const measured = await automaticValue(env, access, row);
  return mapGoalRow(row, measured.value, measured.details);
}

async function listGoals(env, access, user, url) {
  const clauses = ["g.tenant_id = ?", "g.workspace_owner_id = ?", "g.archived_at IS NULL"];
  const binds = [TENANT_ID, access.ownerId];
  const status = clean(url.searchParams.get("status"), 30);
  const category = clean(url.searchParams.get("category"), 30);
  const scopeType = clean(url.searchParams.get("scopeType"), 30);
  const owner = clean(url.searchParams.get("ownerUserId"), 100);
  if (status) { clauses.push("g.status = ?"); binds.push(status); }
  if (category) { clauses.push("g.category = ?"); binds.push(category); }
  if (scopeType) { clauses.push("g.scope_type = ?"); binds.push(scopeType); }
  if (owner) { clauses.push("g.owner_user_id = ?"); binds.push(owner); }
  if (access.role === "vendedor" && !managesAllGoals(access)) {
    clauses.push(`(
      g.owner_user_id = ? OR lower(g.owner_email) = ? OR
      EXISTS (SELECT 1 FROM todogreen_goal_assignees ga
               WHERE ga.goal_id = g.id AND ga.status = 'active'
                 AND (ga.user_id = ? OR lower(ga.email) = ?)) OR
      (g.scope_type = 'client' AND EXISTS (
        SELECT 1 FROM todogreen_client_assignments ca
         WHERE ca.tenant_id = g.tenant_id AND ca.client_id = g.scope_id
           AND ca.status = 'active' AND lower(ca.seller_email) = ?
      ))
    )`);
    binds.push(user.id, lower(access.email), user.id, lower(access.email), lower(access.email));
  }
  const rows = await env.DB.prepare(
    `SELECT g.* FROM todogreen_goals g
      WHERE ${clauses.join(" AND ")}
      ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
               g.period_end, g.updated_at DESC LIMIT 200`,
  ).bind(...binds).all();
  const goals = await Promise.all((rows.results || []).map((row) => enrichedGoal(env, access, row)));
  const metrics = await metricCatalog(env, access);
  return json({
    goals,
    summary: goalSummary(goals),
    access: {
      canCreate: goalCan(access, "goal:create"),
      canManageTeam: goalCan(access, "goal:manage-team"),
      canManageCompany: goalCan(access, "goal:manage-company"),
      canManageMetrics: managesAllGoals(access),
      canExport: goalCan(access, "goal:export"),
    },
    catalogs: {
      categories: GOAL_CATEGORIES,
      scopes: GOAL_SCOPES,
      metrics,
      directions: GOAL_DIRECTIONS,
      cadences: GOAL_CADENCES,
      units: GOAL_UNITS,
      sources: GOAL_SOURCES,
    },
  });
}

async function manageMetrics(request, env, access, user, customMetricId = "") {
  if (request.method === "GET") return json({
    metrics: await metricCatalog(env, access, true),
    units: GOAL_UNITS,
    sources: GOAL_SOURCES,
    categories: GOAL_CATEGORIES,
    directions: GOAL_DIRECTIONS,
    canManage: managesAllGoals(access),
  });
  if (!managesAllGoals(access)) return json({ error: "Somente a administração pode configurar indicadores." }, 403);
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const label = clean(body.label, 160);
    const key = metricKey(body.metricKey || label);
    if (label.length < 2 || key.length < 2) return json({ error: "Informe o nome do indicador." }, 400);
    if (GOAL_METRICS.some((item) => item.id === key)) return json({ error: "Esse identificador é reservado por um indicador nativo." }, 409);
    const category = GOAL_CATEGORIES.some((item) => item.id === body.category) ? body.category : "management";
    const unit = GOAL_UNITS.some((item) => item.id === body.unit) ? body.unit : "number";
    const direction = GOAL_DIRECTIONS.some((item) => item.id === body.direction) ? body.direction : "increase";
    const source = GOAL_SOURCES.find((item) => item.id === body.sourceKey) || GOAL_SOURCES[0];
    const at = nowIso();
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO todogreen_goal_metrics
         (id,tenant_id,workspace_owner_id,metric_key,label,description,category,unit,direction,
          measurement_mode,source_key,source_label,formula,criteria_json,active,revision,
          created_by,updated_by,created_at,updated_at,archived_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,NULL)`,
      ).bind(id, TENANT_ID, access.ownerId, key, label, clean(body.description, 1000), category, unit,
        direction, source.mode, source.id, source.label, clean(body.formula, 600),
        JSON.stringify(normalizeGoalCriteria(body.criteria)), user.id, user.id, at, at).run();
    } catch {
      return json({ error: "Já existe um indicador com esse identificador." }, 409);
    }
    const created = await env.DB.prepare("SELECT * FROM todogreen_goal_metrics WHERE id=?").bind(id).first();
    return json({ metric: mapMetricRow(created) }, 201);
  }
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_goal_metrics WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(customMetricId, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Indicador personalizado não encontrado." }, 404);
  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    if (number(body.revision) !== number(row.revision)) return json({ error: "O indicador mudou. Recarregue antes de salvar." }, 409);
    const category = GOAL_CATEGORIES.some((item) => item.id === body.category) ? body.category : row.category;
    const unit = GOAL_UNITS.some((item) => item.id === body.unit) ? body.unit : row.unit;
    const direction = GOAL_DIRECTIONS.some((item) => item.id === body.direction) ? body.direction : row.direction;
    const source = GOAL_SOURCES.find((item) => item.id === body.sourceKey) || GOAL_SOURCES.find((item) => item.id === row.source_key) || GOAL_SOURCES[0];
    const result = await env.DB.prepare(
      `UPDATE todogreen_goal_metrics SET label=?,description=?,category=?,unit=?,direction=?,measurement_mode=?,
       source_key=?,source_label=?,formula=?,criteria_json=?,active=?,revision=revision+1,updated_by=?,updated_at=?
       WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
    ).bind(clean(body.label ?? row.label, 160), clean(body.description ?? row.description, 1000), category, unit,
      direction, source.mode, source.id, source.label, clean(body.formula ?? row.formula, 600),
      JSON.stringify(normalizeGoalCriteria(body.criteria ?? parse(row.criteria_json, []))), body.active === false ? 0 : 1,
      user.id, nowIso(), row.id, TENANT_ID, access.ownerId, row.revision).run();
    if (!result.meta?.changes) return json({ error: "O indicador mudou. Recarregue." }, 409);
    const updated = await env.DB.prepare("SELECT * FROM todogreen_goal_metrics WHERE id=?").bind(row.id).first();
    return json({ metric: mapMetricRow(updated) });
  }
  if (request.method === "DELETE") {
    const at = nowIso();
    await env.DB.prepare(
      `UPDATE todogreen_goal_metrics SET archived_at=?,active=0,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(at, user.id, at, row.id, TENANT_ID, access.ownerId).run();
    return json({ ok: true });
  }
  return json({ error: "Método não permitido." }, 405);
}

async function detail(env, access, user, row) {
  if (!(await userCanSeeGoal(env, access, user, row))) return json({ error: "Meta não encontrada." }, 404);
  const [checkins, actions, events, assignees, children] = await Promise.all([
    env.DB.prepare(`SELECT id,measured_value AS measuredValue,narrative,risks,blockers,next_steps AS nextSteps,
      evidence_url AS evidenceUrl,evidence_note AS evidenceNote,next_review_at AS nextReviewAt,
      created_by AS createdBy,created_by_label AS createdByLabel,created_at AS createdAt
      FROM todogreen_goal_checkins WHERE goal_id = ? ORDER BY created_at DESC LIMIT 100`).bind(row.id).all(),
    env.DB.prepare(`SELECT id,title,description,owner_user_id AS ownerUserId,owner_email AS ownerEmail,
      owner_label AS ownerLabel,due_at AS dueAt,priority,status,revision,created_at AS createdAt,
      updated_at AS updatedAt,completed_at AS completedAt
      FROM todogreen_goal_actions WHERE goal_id = ? AND archived_at IS NULL ORDER BY status='done',due_at`).bind(row.id).all(),
    env.DB.prepare(`SELECT id,actor_user_id AS actorUserId,actor_label AS actorLabel,action,
      before_json AS beforeJson,after_json AS afterJson,note,created_at AS createdAt
      FROM todogreen_goal_events WHERE goal_id = ? ORDER BY created_at DESC LIMIT 150`).bind(row.id).all(),
    env.DB.prepare(`SELECT id,user_id AS userId,email,label,role,status,created_at AS createdAt
      FROM todogreen_goal_assignees WHERE goal_id = ? AND status='active' ORDER BY role,label,email`).bind(row.id).all(),
    env.DB.prepare(`SELECT child_goal_id AS childGoalId,contribution_weight AS contributionWeight
      FROM todogreen_goal_links WHERE parent_goal_id = ? ORDER BY created_at`).bind(row.id).all(),
  ]);
  return json({
    goal: await enrichedGoal(env, access, row),
    checkins: checkins.results || [],
    actions: actions.results || [],
    events: (events.results || []).map((item) => ({ ...item, before: parse(item.beforeJson, {}), after: parse(item.afterJson, {}) })),
    assignees: assignees.results || [],
    children: children.results || [],
    access: {
      canUpdate: managesAllGoals(access),
      canCheckin: await canCheckin(env, access, user, row),
      canClose: goalCan(access, "goal:close"),
      canApprove: goalCan(access, "goal:approve"),
    },
  });
}

async function createGoal(request, env, access, user) {
  if (!goalCan(access, "goal:create")) return json({ error: "Você não pode criar metas." }, 403);
  const body = await request.json().catch(() => ({}));
  const metrics = await metricCatalog(env, access);
  const validation = validateGoalInput(body, metrics);
  if (!validation.valid) return json({ error: validation.errors[0], errors: validation.errors }, 400);
  const metric = goalMetric(body.metricKey, metrics);
  const id = crypto.randomUUID();
  const now = nowIso();
  const measurementMode = body.measurementMode === "manual" || metric.source === "manual" ? "manual" : "automatic";
  const sourceKey = measurementMode === "manual" ? "manual" : metric.source;
  const direction = clean(body.direction || metric.direction || "increase", 20);
  const status = body.status === "active" ? "active" : "draft";
  const ownerEmail = lower(body.ownerEmail);
  const ownerUserId = clean(body.ownerUserId, 100) || null;
  const parentGoalId = clean(body.parentGoalId, 100) || null;
  if (parentGoalId) {
    const parent = await goalRow(env, access, parentGoalId);
    if (!parent) return json({ error: "A meta principal não pertence a este espaço." }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO todogreen_goals
     (id,tenant_id,workspace_owner_id,parent_goal_id,title,description,category,scope_type,scope_id,scope_label,
      metric_key,unit,direction,measurement_mode,source_key,source_label,formula,baseline_value,target_value,
      current_value,range_min,range_max,weight,period_start,period_end,cadence,owner_user_id,owner_email,
      owner_label,evidence_required,thresholds_json,status,approval_status,version,revision,created_by,updated_by,
      created_at,updated_at,archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,NULL)`,
  ).bind(
    id, TENANT_ID, access.ownerId, parentGoalId, clean(body.title, 180), clean(body.description, 3000),
    clean(body.category, 30), clean(body.scopeType, 30), clean(body.scopeId, 120), clean(body.scopeLabel, 200),
    metric.id, clean(body.unit || metric.unit, 30), direction, measurementMode, sourceKey,
    clean(body.sourceLabel || (measurementMode === "manual" ? "Atualização manual controlada" : metric.label), 240),
    clean(body.formula, 600), number(body.baselineValue), number(body.targetValue), number(body.currentValue),
    direction === "range" ? number(body.rangeMin) : null, direction === "range" ? number(body.rangeMax) : null,
    Math.max(0, number(body.weight, 100)), day(body.periodStart), day(body.periodEnd), clean(body.cadence || "monthly", 20),
    ownerUserId, ownerEmail, clean(body.ownerLabel, 180), body.evidenceRequired ? 1 : 0,
    JSON.stringify(body.thresholds || { criteria: metric.criteria || [] }), status, managesAllGoals(access) ? "not_required" : "pending",
    user.id, user.id, now, now,
  ).run();
  if (ownerEmail || ownerUserId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_goal_assignees
       (id,tenant_id,workspace_owner_id,goal_id,user_id,email,label,role,status,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'owner','active',?,?,?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, id, ownerUserId, ownerEmail,
      clean(body.ownerLabel, 180), user.id, now, now).run();
  }
  if (parentGoalId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_goal_links
       (id,tenant_id,workspace_owner_id,parent_goal_id,child_goal_id,contribution_weight,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, parentGoalId, id, number(body.contributionWeight, 100), user.id, now).run();
  }
  const row = await goalRow(env, access, id);
  const created = await enrichedGoal(env, access, row);
  await event(env, access, user, id, "created", {}, created, clean(body.creationNote, 600));
  return json({ goal: created }, 201);
}

async function updateGoal(request, env, access, user, row) {
  if (!managesAllGoals(access) && !goalCan(access, "goal:update")) return json({ error: "Você não pode alterar metas." }, 403);
  const body = await request.json().catch(() => ({}));
  if (number(body.revision) !== number(row.revision))
    return json({ error: "Esta meta foi alterada por outra pessoa. Recarregue antes de salvar.", current: await enrichedGoal(env, access, row) }, 409);
  const before = await enrichedGoal(env, access, row);
  const merged = {
    title: body.title ?? row.title,
    category: body.category ?? row.category,
    scopeType: body.scopeType ?? row.scope_type,
    metricKey: body.metricKey ?? row.metric_key,
    direction: body.direction ?? row.direction,
    periodStart: body.periodStart ?? row.period_start,
    periodEnd: body.periodEnd ?? row.period_end,
    targetValue: body.targetValue ?? row.target_value,
    rangeMin: body.rangeMin ?? row.range_min,
    rangeMax: body.rangeMax ?? row.range_max,
  };
  const metrics = await metricCatalog(env, access, true);
  const validation = validateGoalInput(merged, metrics);
  if (!validation.valid) return json({ error: validation.errors[0], errors: validation.errors }, 400);
  const structuralChanged = [
    [body.targetValue, row.target_value], [body.baselineValue, row.baseline_value],
    [body.periodStart, row.period_start], [body.periodEnd, row.period_end], [body.metricKey, row.metric_key],
  ].some(([incoming, current]) => incoming !== undefined && String(incoming) !== String(current));
  if (structuralChanged && row.status !== "draft" && !clean(body.changeReason, 600))
    return json({ error: "Explique por que a meta iniciada está sendo alterada." }, 400);
  const metric = goalMetric(merged.metricKey, metrics);
  const measurementMode = body.measurementMode === "manual" || metric.source === "manual"
    ? "manual" : body.measurementMode === "automatic" ? "automatic" : row.measurement_mode;
  const now = nowIso();
  const nextVersion = structuralChanged && row.status !== "draft" ? number(row.version, 1) + 1 : number(row.version, 1);
  const updated = await env.DB.prepare(
    `UPDATE todogreen_goals SET
      parent_goal_id=?,title=?,description=?,category=?,scope_type=?,scope_id=?,scope_label=?,metric_key=?,unit=?,
      direction=?,measurement_mode=?,source_key=?,source_label=?,formula=?,baseline_value=?,target_value=?,
      current_value=?,range_min=?,range_max=?,weight=?,period_start=?,period_end=?,cadence=?,owner_user_id=?,
      owner_email=?,owner_label=?,evidence_required=?,thresholds_json=?,status=?,version=?,revision=revision+1,
      updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(
    clean(body.parentGoalId ?? row.parent_goal_id, 100) || null, clean(body.title ?? row.title, 180),
    clean(body.description ?? row.description, 3000), clean(body.category ?? row.category, 30),
    clean(body.scopeType ?? row.scope_type, 30), clean(body.scopeId ?? row.scope_id, 120),
    clean(body.scopeLabel ?? row.scope_label, 200), metric.id, clean(body.unit ?? row.unit ?? metric.unit, 30),
    clean(body.direction ?? row.direction, 20), measurementMode,
    measurementMode === "manual" ? "manual" : metric.source,
    clean(body.sourceLabel ?? row.source_label, 240), clean(body.formula ?? row.formula, 600),
    number(body.baselineValue ?? row.baseline_value), number(body.targetValue ?? row.target_value),
    number(body.currentValue ?? row.current_value), body.rangeMin ?? row.range_min,
    body.rangeMax ?? row.range_max, Math.max(0, number(body.weight ?? row.weight, 100)),
    day(body.periodStart ?? row.period_start), day(body.periodEnd ?? row.period_end), clean(body.cadence ?? row.cadence, 20),
    clean(body.ownerUserId ?? row.owner_user_id, 100) || null, lower(body.ownerEmail ?? row.owner_email),
    clean(body.ownerLabel ?? row.owner_label, 180), body.evidenceRequired === undefined ? row.evidence_required : body.evidenceRequired ? 1 : 0,
    JSON.stringify(body.thresholds ?? parse(row.thresholds_json, {})), clean(body.status ?? row.status, 20), nextVersion,
    user.id, now, row.id, TENANT_ID, access.ownerId, row.revision,
  ).run();
  if (!updated.meta?.changes) return json({ error: "A meta mudou enquanto você editava. Recarregue." }, 409);
  const next = await enrichedGoal(env, access, await goalRow(env, access, row.id));
  await event(env, access, user, row.id, structuralChanged ? "versioned" : "updated", before, next, clean(body.changeReason, 600));
  return json({ goal: next });
}

async function addCheckin(request, env, access, user, row) {
  if (!(await canCheckin(env, access, user, row))) return json({ error: "Você não pode registrar check-in nesta meta." }, 403);
  const body = await request.json().catch(() => ({}));
  if (clean(body.narrative, 3000).length < 3) return json({ error: "Descreva o que mudou desde o último acompanhamento." }, 400);
  if (row.evidence_required && !clean(body.evidenceUrl, 1000) && !clean(body.evidenceNote, 1000))
    return json({ error: "Esta meta exige evidência no check-in." }, 400);
  let measuredValue = number(row.current_value);
  if (row.measurement_mode === "manual") {
    if (!Number.isFinite(Number(body.measuredValue))) return json({ error: "Informe o resultado medido." }, 400);
    measuredValue = Number(body.measuredValue);
  } else {
    measuredValue = (await automaticValue(env, access, row)).value;
  }
  const at = nowIso();
  const goal = mapGoalRow(row, measuredValue);
  const progress = goal.progress;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_goal_checkins
       (id,tenant_id,workspace_owner_id,goal_id,measured_value,narrative,risks,blockers,next_steps,
        evidence_url,evidence_note,next_review_at,created_by,created_by_label,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, row.id, measuredValue,
      clean(body.narrative, 3000), clean(body.risks, 2000), clean(body.blockers, 2000), clean(body.nextSteps, 3000),
      clean(body.evidenceUrl, 1000), clean(body.evidenceNote, 1000), clean(body.nextReviewAt, 30) || null,
      user.id, clean(user.name || user.email, 160), at),
    env.DB.prepare(
      `INSERT INTO todogreen_goal_snapshots
       (id,tenant_id,workspace_owner_id,goal_id,measured_value,attainment_percent,health_status,
        source_key,source_details_json,measured_at,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, row.id, measuredValue,
      progress.attainmentPercent, progress.healthStatus, row.source_key,
      JSON.stringify({ checkin: true, measurementMode: row.measurement_mode }), at, user.id, at),
    ...(row.measurement_mode === "manual" ? [env.DB.prepare(
      `UPDATE todogreen_goals SET current_value=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(measuredValue, user.id, at, row.id, TENANT_ID, access.ownerId)] : []),
  ]);
  await event(env, access, user, row.id, "checkin", { currentValue: number(row.current_value) },
    { currentValue: measuredValue, progress }, clean(body.narrative, 600));
  const nextRow = await goalRow(env, access, row.id);
  return json({ goal: await enrichedGoal(env, access, nextRow) }, 201);
}

async function addAction(request, env, access, user, row) {
  if (!(await canCheckin(env, access, user, row))) return json({ error: "Você não pode criar ações nesta meta." }, 403);
  const body = await request.json().catch(() => ({}));
  const title = clean(body.title, 180);
  if (title.length < 3) return json({ error: "Informe o título da ação." }, 400);
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO todogreen_goal_actions
     (id,tenant_id,workspace_owner_id,goal_id,title,description,owner_user_id,owner_email,owner_label,
      due_at,priority,status,revision,created_by,updated_by,created_at,updated_at,completed_at,archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',1,?,?,?,?,NULL,NULL)`,
  ).bind(id, TENANT_ID, access.ownerId, row.id, title, clean(body.description, 3000),
    clean(body.ownerUserId, 100) || null, lower(body.ownerEmail), clean(body.ownerLabel, 180),
    clean(body.dueAt, 30) || null, ["low","medium","high","critical"].includes(body.priority) ? body.priority : "medium",
    user.id, user.id, at, at).run();
  await event(env, access, user, row.id, "action_created", {}, { id, title }, "");
  return json({ action: { id, title, status: "open", revision: 1 } }, 201);
}

async function updateAction(request, env, access, user, row, actionId) {
  if (!(await canCheckin(env, access, user, row))) return json({ error: "Você não pode alterar ações nesta meta." }, 403);
  const body = await request.json().catch(() => ({}));
  const current = await env.DB.prepare(
    `SELECT * FROM todogreen_goal_actions
      WHERE id=? AND goal_id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(actionId, row.id, TENANT_ID, access.ownerId).first();
  if (!current) return json({ error: "Ação não encontrada." }, 404);
  if (number(body.revision) !== number(current.revision)) return json({ error: "Esta ação foi alterada por outra pessoa." }, 409);
  const status = ["open","in_progress","blocked","done","cancelled"].includes(body.status) ? body.status : current.status;
  const at = nowIso();
  const result = await env.DB.prepare(
    `UPDATE todogreen_goal_actions SET title=?,description=?,owner_user_id=?,owner_email=?,owner_label=?,
      due_at=?,priority=?,status=?,revision=revision+1,updated_by=?,updated_at=?,completed_at=?
      WHERE id=? AND goal_id=? AND revision=?`,
  ).bind(clean(body.title ?? current.title, 180), clean(body.description ?? current.description, 3000),
    clean(body.ownerUserId ?? current.owner_user_id, 100) || null, lower(body.ownerEmail ?? current.owner_email),
    clean(body.ownerLabel ?? current.owner_label, 180), clean(body.dueAt ?? current.due_at, 30) || null,
    ["low","medium","high","critical"].includes(body.priority) ? body.priority : current.priority,
    status, user.id, at, status === "done" ? current.completed_at || at : null,
    actionId, row.id, current.revision).run();
  if (!result.meta?.changes) return json({ error: "A ação mudou enquanto você editava." }, 409);
  await event(env, access, user, row.id, "action_updated", { id: actionId, status: current.status }, { id: actionId, status }, "");
  return json({ ok: true });
}

async function transitionGoal(request, env, access, user, row, transition) {
  const permission = transition === "approve" ? "goal:approve" : "goal:close";
  if (!goalCan(access, permission)) return json({ error: `Você não pode ${transition === "approve" ? "aprovar" : "encerrar"} metas.` }, 403);
  const body = await request.json().catch(() => ({}));
  const at = nowIso();
  if (transition === "approve") {
    await env.DB.prepare(
      `UPDATE todogreen_goals SET approval_status='approved',approved_by=?,approved_at=?,
       status=CASE WHEN status='draft' THEN 'active' ELSE status END,revision=revision+1,updated_by=?,updated_at=?
       WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(user.id, at, user.id, at, row.id, TENANT_ID, access.ownerId).run();
  } else {
    const measured = await automaticValue(env, access, row);
    const progress = goalProgress(mapGoalRow(row, measured.value));
    const status = progress.attainmentRatio >= 1 ? "achieved" : "closed";
    await env.DB.prepare(
      `UPDATE todogreen_goals SET status=?,closed_by=?,closed_at=?,current_value=?,revision=revision+1,
       updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(status, user.id, at, measured.value, user.id, at, row.id, TENANT_ID, access.ownerId).run();
  }
  const next = await enrichedGoal(env, access, await goalRow(env, access, row.id));
  await event(env, access, user, row.id, transition === "approve" ? "approved" : "closed",
    await enrichedGoal(env, access, row), next, clean(body.note, 600));
  return json({ goal: next });
}

export async function handleTodoGreenGoals(request, env, user, access, url) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  if (!goalCan(access, "goal:read") && !access.permissions?.includes("read"))
    return json({ error: "Você não pode consultar metas." }, 403);
  const parts = url.pathname.split("/").filter(Boolean);
  const goalId = clean(parts[3], 100);
  const subresource = clean(parts[4], 40);
  const subresourceId = clean(parts[5], 100);

  if (goalId === "metrics") return manageMetrics(request, env, access, user, subresource || "");

  if (!goalId) {
    if (request.method === "GET") return listGoals(env, access, user, url);
    if (request.method === "POST") return createGoal(request, env, access, user);
    return json({ error: "Método não permitido." }, 405);
  }

  const row = await goalRow(env, access, goalId);
  if (!row || !(await userCanSeeGoal(env, access, user, row))) return json({ error: "Meta não encontrada." }, 404);

  if (!subresource) {
    if (request.method === "GET") return detail(env, access, user, row);
    if (request.method === "PATCH") return updateGoal(request, env, access, user, row);
    if (request.method === "DELETE") {
      if (!managesAllGoals(access)) return json({ error: "Você não pode arquivar metas." }, 403);
      const at = nowIso();
      await env.DB.prepare(
        `UPDATE todogreen_goals SET archived_at=?,updated_at=?,updated_by=?,revision=revision+1
          WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
      ).bind(at, at, user.id, row.id, TENANT_ID, access.ownerId).run();
      await event(env, access, user, row.id, "archived", await enrichedGoal(env, access, row), { archivedAt: at }, "");
      return json({ ok: true });
    }
  }
  if (subresource === "checkins" && request.method === "POST") return addCheckin(request, env, access, user, row);
  if (subresource === "actions" && !subresourceId && request.method === "POST") return addAction(request, env, access, user, row);
  if (subresource === "actions" && subresourceId && request.method === "PATCH")
    return updateAction(request, env, access, user, row, subresourceId);
  if (["approve", "close"].includes(subresource) && request.method === "POST")
    return transitionGoal(request, env, access, user, row, subresource);
  return json({ error: "Recurso de metas não encontrado." }, 404);
}
