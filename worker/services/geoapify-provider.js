// ===== Geoapify: geocodificação e roteamento cloud =====
//
// O Worker da Cloudflare continua sendo o backend. A chave fica apenas em
// GEOAPIFY_API_KEY no cofre do Worker e nunca vai para o navegador.
//
// Este adaptador normaliza Geoapify para os contratos que a UI já usa:
// - geocoding -> formato semelhante ao Nominatim
// - routing -> formato semelhante ao OSRM
//
// Sem chave ou em falha, os chamadores mantêm as contingências atuais.

const BASE = "https://api.geoapify.com/v1";
const TIMEOUT_MS = 15_000;
const USER_AGENT = "ToDoGreen-TMS-Geoapify/1";

const texto = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const classe = (vehicle = {}) => texto(
  vehicle.vehicleClass ?? vehicle.category ?? vehicle.classe ?? vehicle.class ?? vehicle.type,
  80,
).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replaceAll(" ", "_");

export function modoGeoapify(vehicle = {}) {
  const c = classe(vehicle);
  if (["moto", "motorcycle"].includes(c)) return "motorcycle";
  if (["moped", "scooter"].includes(c)) return "scooter";
  if (["van", "furgao", "furgão", "vuc"].includes(c)) return "light_truck";
  if (["tres_quartos", "3/4", "34"].includes(c)) return "medium_truck";
  if (["toco"].includes(c)) return "truck";
  if (["truck", "bitruck", "carreta", "semi", "cavalo", "bitrem", "rodotrem"].includes(c)) return "heavy_truck";

  const grossKg = numero(vehicle.grossWeightKg ?? vehicle.pbtKg ?? vehicle.maxWeightKg);
  const heightM = numero(vehicle.heightM ?? vehicle.maxHeightM);
  if ((grossKg && grossKg > 7_500) || (heightM && heightM > 4.0)) return "heavy_truck";
  if ((grossKg && grossKg > 3_500) || (heightM && heightM > 3.2)) return "medium_truck";
  if (grossKg || heightM) return "light_truck";
  return "drive";
}

async function fetchJson(url, options = {}, { fetcher = fetch } = {}) {
  const startedAt = Date.now();
  const response = await fetcher(url, {
    ...options,
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(texto(data?.message || data?.error || `geoapify_http_${response.status}`, 220));
    error.status = response.status;
    throw error;
  }
  return { data, latencyMs: Date.now() - startedAt, status: response.status };
}

export async function geocodificarGeoapify(query, env = {}, { limit = 5, fetcher = fetch } = {}) {
  const key = texto(env?.GEOAPIFY_API_KEY, 300);
  if (!key) throw new Error("GEOAPIFY_API_KEY_NOT_CONFIGURED");
  const q = texto(query, 500);
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    text: q,
    format: "json",
    limit: String(Math.min(10, Math.max(1, Number(limit) || 5))),
    filter: "countrycode:br",
    lang: "pt",
    apiKey: key,
  });
  const { data, latencyMs } = await fetchJson(`${BASE}/geocode/search?${params}`, {}, { fetcher });
  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    latencyMs,
    items: results
      .map((item) => {
        const lat = numero(item?.lat);
        const lon = numero(item?.lon);
        if (lat === null || lon === null) return null;
        return {
          lat: String(lat),
          lon: String(lon),
          display_name: texto(
            item?.formatted || item?.address_line2 || item?.address_line1 || item?.name,
            300,
          ),
          provider: "geoapify",
          place_id: texto(item?.place_id || item?.result_type || "", 160),
        };
      })
      .filter(Boolean),
  };
}

const flattenGeometry = (geometry) => {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "LineString") {
    return geometry.coordinates
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map(([lon, lat]) => [Number(lon), Number(lat)]);
  }
  if (geometry.type === "MultiLineString") {
    const out = [];
    for (const line of geometry.coordinates) {
      for (const p of Array.isArray(line) ? line : []) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const pair = [Number(p[0]), Number(p[1])];
        if (out.length && out[out.length - 1][0] === pair[0] && out[out.length - 1][1] === pair[1]) continue;
        out.push(pair);
      }
    }
    return out;
  }
  return [];
};

export function normalizarRotaGeoapify(data = {}, { mode = "drive" } = {}) {
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  if (!feature) return null;
  const properties = feature.properties || {};
  const distance = numero(properties.distance);
  const duration = numero(properties.time);
  const geometry = flattenGeometry(feature.geometry);
  if (distance === null || duration === null || geometry.length < 2) return null;

  const legs = (Array.isArray(properties.legs) ? properties.legs : []).map((leg) => ({
    distance: Math.round(numero(leg?.distance) || 0),
    duration: Math.round(numero(leg?.time) || 0),
  }));

  return {
    code: "Ok",
    routes: [{
      distance: Math.round(distance),
      duration: Math.round(duration),
      geometry: { type: "LineString", coordinates: geometry },
      legs,
      roadRefs: [],
    }],
    waypoints: [],
    engine: "geoapify",
    provider: "geoapify",
    profile: mode,
    requestedEngine: "geoapify",
    restrictionAware: ["light_truck", "medium_truck", "truck", "heavy_truck", "long_truck", "truck_dangerous_goods"].includes(mode),
    fallback: false,
    publicFallback: false,
    vehicleClass: "",
    warnings: [],
  };
}

export async function rotearGeoapify({ coordinates = [], vehicle = {}, geometry = true } = {}, env = {}, { fetcher = fetch } = {}) {
  const key = texto(env?.GEOAPIFY_API_KEY, 300);
  if (!key) throw new Error("GEOAPIFY_API_KEY_NOT_CONFIGURED");
  const points = Array.isArray(coordinates) ? coordinates : [];
  if (points.length < 2 || points.length > 100) throw new Error("GEOAPIFY_INVALID_COORDINATES");

  const waypoints = points.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) throw new Error("GEOAPIFY_INVALID_COORDINATES");
    const lon = numero(pair[0]);
    const lat = numero(pair[1]);
    if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90)
      throw new Error("GEOAPIFY_INVALID_COORDINATES");
    // Geoapify usa latitude,longitude por padrão.
    return `${lat},${lon}`;
  }).join("|");

  const mode = modoGeoapify(vehicle);
  const params = new URLSearchParams({
    waypoints,
    mode,
    units: "metric",
    lang: "pt",
    apiKey: key,
  });
  // O padrão já é GeoJSON. Explicitamos para manter o adaptador estável.
  params.set("format", "geojson");
  if (geometry === false) {
    // A Geoapify ainda retorna geometria; o backend pode ignorá-la. Não pedimos
    // details/elevation por padrão para preservar a cota gratuita.
  }

  const { data, latencyMs } = await fetchJson(`${BASE}/routing?${params}`, {}, { fetcher });
  const normalized = normalizarRotaGeoapify(data, { mode });
  if (!normalized) throw new Error("GEOAPIFY_ROUTE_NOT_FOUND");
  return { ...normalized, latencyMs };
}

export async function probeGeoapify(env = {}, { fetcher = fetch } = {}) {
  const result = await geocodificarGeoapify("Avenida Paulista 1000, São Paulo SP", env, { limit: 1, fetcher });
  return {
    provider: "geoapify",
    ok: Array.isArray(result.items) && result.items.length > 0,
    configured: Boolean(env?.GEOAPIFY_API_KEY),
    latencyMs: result.latencyMs,
  };
}
