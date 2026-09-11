import { sha256 } from "../auth/credenciais.js";
import { allowed } from "../lib/http.js";
import { TENANT_ID } from "./todogreen-access.js";
import { planElectricRoute } from "./todogreen-electric-routing.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const apiJson = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...cors,
    ...extra,
  },
});

const parseScopes = (value) => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};

async function routingCredential(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token.startsWith("tdg_live_")) return null;
  const row = await env.DB.prepare(
    `SELECT id,workspace_owner_id,client_id,name,scopes_json,rate_limit_per_minute
       FROM todogreen_tms_api_keys
      WHERE tenant_id=? AND key_hash=? AND revoked_at IS NULL`,
  ).bind(TENANT_ID, await sha256(token)).first();
  if (!row) return null;
  const scopes = parseScopes(row.scopes_json);
  if (!scopes.includes("routing:write")) return { forbidden: true, scope: "routing:write" };
  const ceiling = Math.min(600, Math.max(30, Number(row.rate_limit_per_minute || 120)));
  if (!allowed(`tdg-tms-routing:${row.id}`, ceiling)) return { rateLimited: true };
  await env.DB.prepare("UPDATE todogreen_tms_api_keys SET last_used_at=? WHERE id=?")
    .bind(new Date().toISOString(), row.id).run().catch(() => null);
  return row;
}

const validArray = (value) => Array.isArray(value) ? value : [];

function sanitizeOptimizationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "Corpo JSON inválido." };

  const vehicles = validArray(body.vehicles);
  const jobs = validArray(body.jobs);
  const shipments = validArray(body.shipments);

  if (!vehicles.length) return { error: "Informe ao menos um veículo." };
  if (!jobs.length && !shipments.length)
    return { error: "Informe ao menos uma parada em jobs ou shipments." };
  if (vehicles.length > 250)
    return { error: "Máximo de 250 veículos por otimização." };
  if (jobs.length + shipments.length > 5000)
    return { error: "Máximo de 5.000 jobs/shipments por otimização." };

  // Mantemos o formato nativo do VROOM para não perder recursos como
  // capacidade, skills, janelas, breaks e pickup/delivery. Campos de topo são
  // deliberadamente limitados para a API externa não virar um proxy genérico.
  const payload = { vehicles, jobs, shipments };
  const options = body.options && typeof body.options === "object" && !Array.isArray(body.options)
    ? { ...body.options }
    : {};
  if (body.geometry !== undefined && options.g === undefined)
    options.g = Boolean(body.geometry);
  if (Object.keys(options).length) payload.options = options;

  return { payload };
}

function routingEndpoint(env) {
  const raw = String(env.TDG_ROUTING_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function electricPlan(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return apiJson({ error: "invalid_electric_request", message: "Corpo JSON inválido." }, 400);

  const result = planElectricRoute(body);
  if (result.status === "invalid")
    return apiJson({ error: "invalid_electric_request", message: result.reason, plan: result }, 400);

  return apiJson({
    engine: "tdg-electric-routing-v1",
    provider: "native",
    generatedAt: new Date().toISOString(),
    plan: result,
  }, 200, { "x-tdg-routing-engine": "tdg-electric-routing-v1" });
}

export async function optimizeTodoGreenRouting(body, env) {
  const endpoint = routingEndpoint(env);
  if (!endpoint)
    return apiJson({
      error: "routing_not_configured",
      message: "O motor de roteirização auto-hospedado ainda não está conectado ao TMS.",
    }, 503);

  const sanitized = sanitizeOptimizationInput(body);
  if (sanitized.error)
    return apiJson({ error: "invalid_routing_request", message: sanitized.error }, 400);

  const headers = { "content-type": "application/json", "user-agent": "ToDoGreen-TMS-Routing/1" };
  if (env.TDG_ROUTING_TOKEN)
    headers.authorization = `Bearer ${String(env.TDG_ROUTING_TOKEN)}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(sanitized.payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return apiJson({
      error: timeout ? "routing_timeout" : "routing_unavailable",
      message: timeout
        ? "O otimizador excedeu 30 segundos. Reduza o problema ou tente novamente."
        : "O motor de roteirização não respondeu.",
    }, timeout ? 504 : 502);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    return apiJson({
      error: "routing_engine_error",
      message: result?.error || result?.message || `O motor de roteirização respondeu com HTTP ${response.status}.`,
      engineStatus: response.status,
    }, 502);
  }

  return apiJson({
    engine: "vroom",
    provider: "self_hosted",
    generatedAt: new Date().toISOString(),
    ...result,
  }, 200, { "x-tdg-routing-engine": "vroom" });
}

async function optimize(request, env) {
  const body = await request.json().catch(() => null);
  return optimizeTodoGreenRouting(body, env);
}

export async function handlePublicTodoGreenRoutingApi(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return apiJson({ error: "method_not_allowed", message: "Use POST para planejar ou otimizar rotas." }, 405);
  if (!env.DB)
    return apiJson({ error: "service_unavailable", message: "Banco de dados indisponível." }, 503);

  const credential = await routingCredential(request, env);
  if (!credential)
    return apiJson({ error: "unauthorized", message: "Chave TMS ausente, inválida ou revogada." }, 401);
  if (credential.forbidden)
    return apiJson({ error: "forbidden", message: `A chave não possui o escopo ${credential.scope}.` }, 403);
  if (credential.rateLimited)
    return apiJson({ error: "rate_limited", message: "Limite de chamadas por minuto atingido." }, 429, { "retry-after": "60" });

  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/routes/electric-plan")) return electricPlan(request);
  return optimize(request, env);
}
