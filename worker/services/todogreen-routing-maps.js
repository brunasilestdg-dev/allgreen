// ===== Gateway interno de geocodificação e traçado =====
//
// A tela nunca fala diretamente com a infraestrutura privada. O Worker escolhe
// Nominatim/OSRM auto-hospedados quando configurados e mantém os endpoints
// públicos apenas como contingência do MVP.

const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org/";
const PUBLIC_OSRM = "https://router.project-osrm.org/";
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

export async function routeTodoGreen(body, env) {
  const coordinates = Array.isArray(body?.coordinates) ? body.coordinates : [];
  if (coordinates.length < 2 || coordinates.length > 500)
    return json({ error: "invalid_coordinates", message: "Informe entre 2 e 500 coordenadas." }, 400);

  const normalized = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) {
      return json({ error: "invalid_coordinates", message: "Coordenada inválida." }, 400);
    }
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return json({ error: "invalid_coordinates", message: "Coordenada inválida." }, 400);
    }
    normalized.push([lon, lat]);
  }

  const configured = Boolean(String(env.TODOGREEN_OSRM_BASE_URL || "").trim());
  const base = cleanBase(env.TODOGREEN_OSRM_BASE_URL, PUBLIC_OSRM);
  const points = normalized.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const suffix = `route/v1/driving/${points}`;
  const query = new URLSearchParams({
    overview: body?.geometry === false ? "false" : "full",
    geometries: body?.geometry === false ? "polyline" : "geojson",
    steps: "false",
  });

  const call = async (targetBase, isPrivate) => {
    const url = `${endpoint(targetBase, suffix)}?${query}`;
    return fetchJson(url, { headers: upstreamHeaders(env, isPrivate) });
  };

  try {
    return json(await call(base, configured), 200);
  } catch {
    if (configured) {
      try {
        return json(await call(PUBLIC_OSRM, false), 200);
      } catch {
        // cai para 502
      }
    }
    return json({ error: "routing_map_unavailable", message: "Traçado rodoviário indisponível." }, 502);
  }
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
