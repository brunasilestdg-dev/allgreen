import { authenticatedUser } from "./todogreen-work-center.js";
import { resolveTodoGreenAccess } from "./todogreen-access.js";

const TENANT_ID = "todogreen";
const MAX_DASHBOARDS = 30;
const WIDGET_TYPES = new Set(["metric", "bar", "line", "donut", "table"]);
const METRICS = new Set([
  "clientes",
  "pipeline",
  "receita",
  "margem",
  "propostas",
  "operacoes",
  "co2-evitado",
  "green-score",
  "ocupacao",
  "produtividade",
]);

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const parse = (value, fallback) => {
  try { return JSON.parse(value || ""); } catch { return fallback; }
};

const canManageTeam = (access) =>
  ["owner", "admin"].includes(access?.role) ||
  access?.permissions?.includes("*") ||
  access?.permissions?.includes("dashboard:manage");


function normalizeWidgets(input) {
  if (!Array.isArray(input)) throw new Error("Inclua ao menos um indicador no painel.");
  if (input.length < 1 || input.length > 20)
    throw new Error("O painel deve ter entre 1 e 20 indicadores.");
  return input.map((item, index) => {
    const type = clean(item?.type, 20);
    const metric = clean(item?.metric, 40);
    if (!WIDGET_TYPES.has(type)) throw new Error(`Formato inválido no indicador ${index + 1}.`);
    if (!METRICS.has(metric)) throw new Error(`Métrica inválida no indicador ${index + 1}.`);
    return {
      id: clean(item.id, 80) || crypto.randomUUID(),
      title: clean(item.title, 100) || metric,
      type,
      metric,
      size: ["small", "medium", "large"].includes(item.size) ? item.size : "medium",
      filters: item.filters && typeof item.filters === "object" ? item.filters : {},
    };
  });
}

const mapDashboard = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  filters: parse(row.filters_json, {}),
  widgets: parse(row.widgets_json, []),
  layout: parse(row.layout_json, {}),
  revision: row.revision,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function handleTodoGreenDashboards(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sua sessão expirou. Entre novamente." }, 401);
  const url = new URL(request.url);
  const { access, motivo } = await resolveTodoGreenAccess(env, user, url.searchParams.get("owner"));
  // Espaço de outra conta → 404 (não confirmamos que existe); sem vínculo → 403.
  if (!access && motivo === "espaco-nao-autorizado")
    return response({ error: "Este espaço de trabalho não pertence à sua conta." }, 404);
  if (!access) return response({ error: "Você não tem acesso à To Do Green." }, 403);

  const parts = url.pathname.split("/").filter(Boolean);
  const dashboardId = clean(parts[3], 80);
  const teamAccess = canManageTeam(access);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM todogreen_dashboards
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND (created_by = ? OR visibility = 'team' OR ? = 1)
        ORDER BY updated_at DESC LIMIT ?`,
    ).bind(TENANT_ID, access.ownerId, user.id, teamAccess ? 1 : 0, MAX_DASHBOARDS).all();
    return response({
      dashboards: (rows.results || []).map(mapDashboard),
      access: { canCreate: true, canManageTeam: teamAccess },
      availableMetrics: [...METRICS],
      availableTypes: [...WIDGET_TYPES],
    });
  }

  if (!["POST", "PUT", "DELETE"].includes(request.method))
    return response({ error: "Método não permitido." }, 405);

  if (request.method === "DELETE") {
    if (!dashboardId) return response({ error: "Informe o painel." }, 400);
    const current = await env.DB.prepare(
      "SELECT created_by FROM todogreen_dashboards WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL",
    ).bind(dashboardId, TENANT_ID, access.ownerId).first();
    if (!current) return response({ error: "Painel não encontrado." }, 404);
    if (current.created_by !== user.id && !teamAccess)
      return response({ error: "Você não pode excluir este painel." }, 403);
    await env.DB.prepare(
      "UPDATE todogreen_dashboards SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    ).bind(new Date().toISOString(), new Date().toISOString(), user.id, dashboardId).run();
    return response({ ok: true });
  }

  const body = await request.json().catch(() => ({}));
  const name = clean(body.name, 100);
  if (name.length < 2) return response({ error: "Informe o nome do painel." }, 400);
  let widgets;
  try { widgets = normalizeWidgets(body.widgets); }
  catch (error) { return response({ error: error.message }, 400); }
  const visibility = body.visibility === "team" && teamAccess ? "team" : "personal";
  const now = new Date().toISOString();

  if (request.method === "POST") {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_dashboards WHERE tenant_id = ? AND workspace_owner_id = ? AND created_by = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, user.id).first();
    if (Number(count?.total || 0) >= MAX_DASHBOARDS)
      return response({ error: `Limite de ${MAX_DASHBOARDS} painéis por pessoa atingido.` }, 409);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_dashboards
        (id, tenant_id, workspace_owner_id, name, description, visibility,
         filters_json, widgets_json, layout_json, status, revision,
         created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
    ).bind(
      id, TENANT_ID, access.ownerId, name, clean(body.description, 500), visibility,
      JSON.stringify(body.filters || {}), JSON.stringify(widgets), JSON.stringify(body.layout || {}),
      user.id, user.id, now, now,
    ).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_dashboards WHERE id = ?").bind(id).first();
    return response({ dashboard: mapDashboard(row) }, 201);
  }

  if (!dashboardId) return response({ error: "Informe o painel." }, 400);
  const current = await env.DB.prepare(
    "SELECT * FROM todogreen_dashboards WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL",
  ).bind(dashboardId, TENANT_ID, access.ownerId).first();
  if (!current) return response({ error: "Painel não encontrado." }, 404);
  if (current.created_by !== user.id && !teamAccess)
    return response({ error: "Você não pode alterar este painel." }, 403);
  if (Number(body.revision) !== Number(current.revision))
    return response({ error: "Este painel foi alterado por outra pessoa. Recarregue antes de salvar.", current: mapDashboard(current) }, 409);
  await env.DB.prepare(
    `UPDATE todogreen_dashboards SET name = ?, description = ?, visibility = ?,
       filters_json = ?, widgets_json = ?, layout_json = ?, revision = revision + 1,
       updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`,
  ).bind(
    name, clean(body.description, 500), visibility, JSON.stringify(body.filters || {}),
    JSON.stringify(widgets), JSON.stringify(body.layout || {}), user.id, now,
    dashboardId, current.revision,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_dashboards WHERE id = ?").bind(dashboardId).first();
  return response({ dashboard: mapDashboard(row) });
}
