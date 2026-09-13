// ===== Gateway interno de geocodificação e traçado =====
//
// A tela nunca fala diretamente com a infraestrutura privada. O Worker escolhe
// Nominatim/OSRM auto-hospedados quando configurados e mantém os endpoints
// públicos apenas como contingência do MVP.

const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org/";
import { rotearComProvider } from "./routing-providers.js";
import { consultarPedagiosDaRota } from "./todogreen-pedagios.js";
import { riscoDoTracado } from "./todogreen-road-risk.js";
import { rankRouteAlternatives } from "../../src/features/logistics/routeAlternativesDomain.js";

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
/**
 * Risco viário por rota (Risk Map) + ranking de alternativas (seções 14–15,
 * 83). O risco entra como CUSTO — nunca bloqueia; sem índice ingerido, cada
 * rota traz `risk.riskScore = null` e o motivo (RISK_DATA_NOT_AVAILABLE).
 */
// Pedágio por rota (P6 complemento): praças da ANTT que cada traçado cruza
// (mesma consulta da tela) × tarifa média informada pela operação
// (`tollPerPlaza`) — a ANTT não publica tarifa, então sem tarifa o custo fica 0
// e só a CONTAGEM entra na resposta (declarado em `tollNote`). Opt-in por
// `body.tolls === true`: é uma consulta externa a mais por requisição.
async function pedagiosPorRota(rotas, body, { pedagios = consultarPedagiosDaRota } = {}) {
  if (body?.tolls !== true) return rotas.map(() => null);
  return Promise.all(rotas.map(async (r) => {
    const linha = (Array.isArray(r?.geometry?.coordinates) ? r.geometry.coordinates : [])
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map(([lon, lat]) => [Number(lat), Number(lon)]);
    if (linha.length < 2) return null;
    try {
      const resultado = await pedagios(linha);
      return { quantidade: Number(resultado?.quantidade) || 0, pracas: (resultado?.pracas || []).slice(0, 40), fonte: resultado?.fonte || "" };
    } catch (error) {
      return { quantidade: null, pracas: [], erro: String(error?.message || error).slice(0, 120) };
    }
  }));
}

export async function enriquecerComRisco(corpo, body, env, { pedagios } = {}) {
  const rotas = Array.isArray(corpo?.routes) ? corpo.routes : [];
  if (!rotas.length || !env?.DB) return corpo;
  const consumo = Number(body?.vehicle?.energyConsumptionKwhPerKm) || 0;
  const tarifaPorPraca = Math.max(0, Number(body?.vehicle?.tollPerPlaza ?? body?.tollPerPlaza) || 0);
  const [riscos, pedagiosDasRotas] = await Promise.all([
    Promise.all(rotas.map((r) => riscoDoTracado(env, r?.geometry?.coordinates || [], { refs: r?.roadRefs || [] }).catch(() => ({ riskScore: null, reason: "RISK_LOOKUP_FAILED" })))),
    pedagiosPorRota(rotas, body, { pedagios }),
  ]);
  const routes = rotas.map((r, i) => {
    const pedagio = pedagiosDasRotas[i];
    // `Number(null)` é 0 — a falha da consulta tem que continuar null (declarada), nunca virar "zero praças".
    const quantidade = pedagio && pedagio.quantidade !== null && pedagio.quantidade !== undefined && Number.isFinite(Number(pedagio.quantidade)) ? Number(pedagio.quantidade) : null;
    return {
      ...r,
      risk: riscos[i],
      ...(pedagio ? { tolls: { plazas: quantidade, cost: quantidade !== null && tarifaPorPraca > 0 ? Math.round(quantidade * tarifaPorPraca * 100) / 100 : null, perPlaza: tarifaPorPraca || null, list: pedagio.pracas, source: pedagio.fonte || "", error: pedagio.erro || "" } } : {}),
    };
  });
  const candidatas = routes.map((r, i) => ({
    id: i === 0 ? "principal" : `alternativa-${i}`,
    distanceKm: (Number(r.distance) || 0) / 1000,
    durationMinutes: Math.round((Number(r.duration) || 0) / 60),
    energyKwh: consumo > 0 ? Math.round(((Number(r.distance) || 0) / 1000) * consumo * 10) / 10 : 0,
    tollCost: Number(r.tolls?.cost) || 0,
    riskScore: Number.isFinite(Number(r.risk?.riskScore)) ? Number(r.risk.riskScore) : 0,
    riskAvailable: Number.isFinite(Number(r.risk?.riskScore)),
    restrictionsOk: true,
  }));
  const ranking = routes.length > 1 ? rankRouteAlternatives(candidatas) : null;
  const notas = [];
  if (ranking && !candidatas.every((c) => c.riskAvailable)) notas.push("Sem índice de risco ingerido para alguma rota: o critério de risco valeu 0 nela (RISK_DATA_NOT_AVAILABLE), não 'seguro'.");
  if (ranking && body?.tolls === true && tarifaPorPraca <= 0) notas.push("Praças de pedágio contadas, mas sem tarifa média informada: o pedágio valeu 0 no custo total.");
  if (ranking && body?.tolls === true && routes.some((r) => r.tolls?.plazas === null)) notas.push("Consulta de praças de pedágio indisponível para alguma rota: pedágio valeu 0 nela.");
  return {
    ...corpo,
    routes,
    riskAvailable: candidatas.some((c) => c.riskAvailable),
    tollsAvailable: body?.tolls === true && routes.every((r) => r.tolls?.plazas !== null && r.tolls?.plazas !== undefined),
    ranking: ranking ? { ...ranking, nota: notas.join(" ") } : null,
  };
}

export async function routeTodoGreen(body, env) {
  const resultado = await rotearComProvider(
    { coordinates: body?.coordinates, vehicle: body?.vehicle || {}, geometry: body?.geometry !== false, alternatives: Boolean(body?.alternatives) },
    env,
  );
  if (resultado.status !== 200 || body?.risk === false) return json(resultado.body, resultado.status);
  return json(await enriquecerComRisco(resultado.body, body, env), 200);
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
