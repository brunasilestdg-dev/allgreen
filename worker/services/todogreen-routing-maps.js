// ===== Gateway interno de geocodificação e traçado =====
//
// A tela nunca fala diretamente com a infraestrutura privada. O Worker escolhe
// Nominatim/OSRM auto-hospedados quando configurados e mantém os endpoints
// públicos apenas como contingência do MVP.

const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org/";
import { rotearComProvider } from "./routing-providers.js";

const USER_AGENT = "ToDoGreen-TMS-Routing/1";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const cleanBase = (raw, fallback) => {
  const value = String(raw || "").trim() || fallback;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return fallback;
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return fallback;
  }
};

const endpoint = (base, suffix) => new URL(suffix.replace(/^\//, ""), base).toString();

const upstreamHeaders = (env, selfHosted) => {
  const headers = { accept: "application/json", "user-agent": USER_AGENT };
  if (selfHosted && env.TDG_ROUTING_TOKEN)
    headers.authorization = `Bearer ${String(env.TDG_ROUTING_TOKEN)}`;
  return headers;
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(`upstream_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function geocodeTodoGreen(body, env) {
  const query = String(body?.q || "").trim();
  if (query.length < 3) return json([]);
  const limit = Math.min(10, Math.max(1, Number(body?.limit) || 5));

  const configured = Boolean(String(env.TODOGREEN_NOMINATIM_BASE_URL || "").trim());
  const base = cleanBase(env.TODOGREEN_NOMINATIM_BASE_URL, PUBLIC_NOMINATIM);
  const url = new URL(endpoint(base, "search"));
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("q", query);

  try {
    const data = await fetchJson(url, {
      headers: upstreamHeaders(env, configured),
    });
    return json(data, 200);
  } catch (error) {
    // Configuração própria caiu: tenta o público apenas como contingência do
    // MVP. Em escala, basta remover este fallback e manter somente o host.
    if (configured) {
      try {
        const fallback = new URL(endpoint(PUBLIC_NOMINATIM, "search"));
        fallback.search = url.search;
        const data = await fetchJson(fallback, {
          headers: upstreamHeaders(env, false),
        });
        return json(data, 200);
      } catch {
        // cai para resposta 502 abaixo
      }
    }
    return json({ error: "geocode_unavailable", message: "Geocodificação indisponível." }, 502);
  }
}

// Traçado: o backend escolhe o motor pelo veículo (seções 28–35). Pesado sem
// Valhalla recebe NO_SAFE_ROUTING_ENGINE (409) — nunca uma rota de carro. A
// resposta mantém o formato OSRM que a tela já lê + o metadado do motor.
export async function routeTodoGreen(body, env) {
  const resultado = await rotearComProvider(
    { coordinates: body?.coordinates, vehicle: body?.vehicle || {}, geometry: body?.geometry !== false },
    env,
  );
  return json(resultado.body, resultado.status);
}

export async function handleTodoGreenRoutingMaps(request, env) {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed", message: "Use POST." }, 405);

  const path = new URL(request.url).pathname;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid_json", message: "Corpo JSON inválido." }, 400);

  if (path.endsWith("/maps/geocode")) return geocodeTodoGreen(body, env);
  if (path.endsWith("/maps/route")) return routeTodoGreen(body, env);
  return json({ error: "not_found" }, 404);
}
