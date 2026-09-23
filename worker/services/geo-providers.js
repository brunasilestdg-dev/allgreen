// ===== Elevação e clima para o modelo de energia (ElevationProvider / WeatherProvider) =====
//
// Seções 42–43 e 115 da consolidação. Fontes ABERTAS, processadas/cacheadas
// localmente — nunca pagas por request:
//   • elevação: Valhalla /height (tiles com relevo do mesmo extrato OSM, no
//     mesmo servidor da rota de pesados) — DERIVED;
//   • clima: Open-Meteo (licença aberta) na hora de saída — EXTERNAL.
// Sem fonte: ELEVATION_NOT_AVAILABLE / WEATHER_NOT_AVAILABLE, o modelo de
// energia assume o perfil plano/sem penalidade térmica e DIZ isso (assumption
// + confiança menor). Nada é inventado.
//
// Cache em `todogreen_geo_cache` (migration 0122): a altura de um ponto não
// muda (30 dias); clima vale por hora. `ingestedAt`/`sourceUpdatedAt` viajam
// na resposta para a tela dizer "dado de tal hora".

import { motoresDisponiveis } from "../../src/features/logistics/routingProvidersDomain.js";
import {
  GEO_ERRORS,
  alturasDaRespostaValhalla,
  amostrarGeometria,
  chaveGeo,
  perfilDeElevacao,
  pontoMedio,
  requisicaoAlturaValhalla,
  temperaturaNaSaida,
} from "../../src/features/logistics/geoProvidersDomain.js";

const TTL_ELEVACAO_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_CLIMA_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

const texto = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const unir = (base, sufixo) => new URL(String(sufixo).replace(/^\//, ""), base).toString();

async function lerCache(env, key) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare(
    "SELECT payload_json, source, source_updated_at, ingested_at, expires_at FROM todogreen_geo_cache WHERE cache_key = ?",
  ).bind(key).first().catch(() => null);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    return { payload: JSON.parse(row.payload_json), source: row.source, sourceUpdatedAt: row.source_updated_at, ingestedAt: row.ingested_at };
  } catch {
    return null;
  }
}

async function gravarCache(env, key, kind, payload, { source = "", sourceUpdatedAt = null, ttlMs }) {
  if (!env?.DB) return;
  const agora = Date.now();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO todogreen_geo_cache (cache_key, kind, payload_json, source, source_updated_at, ingested_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(key, kind, JSON.stringify(payload), texto(source, 80), sourceUpdatedAt || null, new Date(agora).toISOString(), new Date(agora + ttlMs).toISOString())
    .run().catch(() => null);
}

async function fetchJson(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(`upstream_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * ElevationProvider: ganho/perda de elevação da geometria [lon, lat].
 * Fonte: Valhalla /height. Sem Valhalla → ELEVATION_NOT_AVAILABLE (honesto).
 */
export async function elevacaoDaRota(env, geometry, { fetcher = fetch } = {}) {
  const motores = motoresDisponiveis(env);
  const amostra = amostrarGeometria(geometry, 100);
  if (amostra.length < 2)
    return { ok: false, reason: GEO_ERRORS.ELEVATION_NOT_AVAILABLE, source: "none", detail: "Geometria insuficiente para o perfil." };

  // A chave do cache inclui a fonte pretendida: a mesma rota calculada pelo
  // Geoapify e pelo Valhalla são entradas distintas. Sem isso, trocar de
  // provedor (ou ligar o Valhalla depois) continuaria servindo o valor do
  // provedor anterior por 30 dias.
  const fonte = String(env?.GEOAPIFY_API_KEY || "").trim()
    ? "geoapify"
    : motores.valhalla.configured
      ? "valhalla"
      : "none";
  const key = chaveGeo("elevation", { shape: amostra, fonte });
  const cached = await lerCache(env, key);
  if (cached) return { ...cached.payload, cached: true, ingestedAt: cached.ingestedAt, sourceUpdatedAt: cached.sourceUpdatedAt };

  // Primário cloud: Geoapify Elevation API. Até 100 pontos = 1 crédito e o
  // resultado é cacheado por 30 dias, então uma rota não consome a cota a cada tela.
  if (String(env?.GEOAPIFY_API_KEY || "").trim()) {
    try {
      const url = `https://api.geoapify.com/v1/geodata/elevation?apiKey=${encodeURIComponent(String(env.GEOAPIFY_API_KEY))}`;
      const data = await fetchJson(fetcher, url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          format: "json",
          units: "metric",
          includeDistance: false,
          locations: amostra,
        }),
      });
      const alturas = (Array.isArray(data?.results) ? data.results : [])
        .map((item) => item?.elevation === null || item?.elevation === undefined ? null : Number(item.elevation));
      const perfil = perfilDeElevacao(alturas);
      if (perfil.ok) {
        const payload = { ...perfil, source: "geoapify-elevation" };
        const ingestedAt = new Date().toISOString();
        await gravarCache(env, key, "elevation", payload, { source: "geoapify-elevation", ttlMs: TTL_ELEVACAO_MS });
        return { ...payload, cached: false, ingestedAt, sourceUpdatedAt: null };
      }
    } catch {
      // Cai para Valhalla somente se ele existir. Sem ele, a função devolve
      // ELEVATION_NOT_AVAILABLE de forma explícita.
    }
  }

  if (!motores.valhalla.configured) {
    return {
      ok: false,
      reason: GEO_ERRORS.ELEVATION_NOT_AVAILABLE,
      source: "none",
      detail: env?.GEOAPIFY_API_KEY
        ? "Geoapify não devolveu elevação e não há Valhalla de contingência."
        : `Sem fonte de elevação: configure GEOAPIFY_API_KEY ou ${motores.valhalla.envKey}.`,
    };
  }

  const req = requisicaoAlturaValhalla(geometry, { max: 100 });
  try {
    const headers = { accept: "application/json", "content-type": "application/json" };
    if (env?.TDG_ROUTING_TOKEN) headers.authorization = `Bearer ${String(env.TDG_ROUTING_TOKEN)}`;
    const data = await fetchJson(fetcher, unir(motores.valhalla.base, "height"), { method: "POST", headers, body: JSON.stringify(req) });
    const alturas = alturasDaRespostaValhalla(data);
    const perfil = perfilDeElevacao(alturas || []);
    if (!perfil.ok) return { ...perfil, source: "valhalla-height", detail: "O Valhalla não devolveu alturas para esta geometria (tiles sem relevo?)." };
    const payload = { ...perfil, source: "valhalla-height" };
    const ingestedAt = new Date().toISOString();
    await gravarCache(env, key, "elevation", payload, { source: "valhalla-height", ttlMs: TTL_ELEVACAO_MS });
    return { ...payload, cached: false, ingestedAt, sourceUpdatedAt: null };
  } catch (erro) {
    return { ok: false, reason: GEO_ERRORS.ELEVATION_NOT_AVAILABLE, source: "valhalla-height", detail: texto(erro?.message || "valhalla_height_indisponivel") };
  }
}

/**
 * WeatherProvider: temperatura na hora de saída no ponto médio da rota (ou
 * na coordenada informada). Fonte: Open-Meteo. Sem dado → WEATHER_NOT_AVAILABLE.
 */
export async function climaNaRota(env, { geometry, latitude, longitude, departureIso = "" } = {}, { fetcher = fetch } = {}) {
  const ponto = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    ? { latitude: Math.round(Number(latitude) * 1e4) / 1e4, longitude: Math.round(Number(longitude) * 1e4) / 1e4 }
    : pontoMedio(geometry);
  if (!ponto) return { ok: false, reason: GEO_ERRORS.WEATHER_NOT_AVAILABLE, source: "none", detail: "Sem coordenada para consultar o clima." };
  if (String(env?.TDG_WEATHER_DISABLED || "") === "1") return { ok: false, reason: GEO_ERRORS.WEATHER_NOT_AVAILABLE, source: "none", detail: "Clima desligado por configuração (TDG_WEATHER_DISABLED)." };

  const saida = Date.parse(departureIso || "");
  const horaBucket = Number.isFinite(saida) ? new Date(Math.floor(saida / 3.6e6) * 3.6e6).toISOString() : `now:${new Date(Math.floor(Date.now() / 3.6e6) * 3.6e6).toISOString()}`;
  const key = chaveGeo("weather", { lat: Math.round(ponto.latitude * 100) / 100, lon: Math.round(ponto.longitude * 100) / 100, hora: horaBucket });
  const cached = await lerCache(env, key);
  if (cached) return { ...cached.payload, cached: true, ingestedAt: cached.ingestedAt, sourceUpdatedAt: cached.sourceUpdatedAt };

  try {
    const params = new URLSearchParams({
      latitude: String(ponto.latitude),
      longitude: String(ponto.longitude),
      current: "temperature_2m",
      hourly: "temperature_2m",
      timezone: "America/Sao_Paulo",
      forecast_days: "3",
    });
    const data = await fetchJson(fetcher, `${OPEN_METEO}?${params}`, { headers: { accept: "application/json" } });
    const leitura = temperaturaNaSaida(data, departureIso);
    if (!leitura.ok) return { ...leitura, source: "open-meteo", detail: "Open-Meteo sem temperatura para o ponto/hora." };
    const payload = { ...leitura, source: "open-meteo", latitude: ponto.latitude, longitude: ponto.longitude };
    const sourceUpdatedAt = texto(data?.current?.time || "", 40) || null;
    const ingestedAt = new Date().toISOString();
    await gravarCache(env, key, "weather", payload, { source: "open-meteo", sourceUpdatedAt, ttlMs: TTL_CLIMA_MS });
    return { ...payload, cached: false, ingestedAt, sourceUpdatedAt };
  } catch (erro) {
    return { ok: false, reason: GEO_ERRORS.WEATHER_NOT_AVAILABLE, source: "open-meteo", detail: texto(erro?.message || "open_meteo_indisponivel") };
  }
}

/**
 * Enriquecimento da rota para o modelo de energia: preenche elevação e
 * temperatura QUANDO o chamador não informou (o informado vence — é INFORMED).
 * Devolve a rota enriquecida, a proveniência de cada campo e os avisos
 * honestos (ELEVATION_NOT_AVAILABLE / WEATHER_NOT_AVAILABLE).
 */
export async function enriquecerRotaComGeo(env, route = {}, { geometry = null, departureIso = "", fetcher = fetch } = {}) {
  const rota = { ...route };
  const provenance = [];
  const warnings = [];
  const temGeometria = Array.isArray(geometry) && geometry.length >= 2;

  const elevacaoInformada = rota.elevationGainM !== undefined && rota.elevationGainM !== null && rota.elevationGainM !== "";
  if (!elevacaoInformada && temGeometria) {
    const elev = await elevacaoDaRota(env, geometry, { fetcher });
    if (elev.ok) {
      rota.elevationGainM = elev.elevationGainM;
      rota.elevationLossM = elev.elevationLossM;
      provenance.push({ id: "elevation", field: "elevationGainM", source: elev.source, measurementType: elev.measurementType, confidence: elev.confidence, samples: elev.samples, coverage: elev.coverage, cached: Boolean(elev.cached), ingestedAt: elev.ingestedAt || null });
    } else {
      warnings.push({ code: elev.reason, detail: elev.detail || "", source: elev.source || "" });
    }
  } else if (elevacaoInformada) {
    provenance.push({ id: "elevation", field: "elevationGainM", source: "informed", measurementType: "INFORMED" });
  }

  const temperaturaInformada = rota.temperatureC !== undefined && rota.temperatureC !== null && rota.temperatureC !== "";
  if (!temperaturaInformada && (temGeometria || (Number.isFinite(Number(route.latitude)) && Number.isFinite(Number(route.longitude))))) {
    const clima = await climaNaRota(env, { geometry, latitude: route.latitude, longitude: route.longitude, departureIso }, { fetcher });
    if (clima.ok) {
      rota.temperatureC = clima.temperatureC;
      provenance.push({ id: "weather", field: "temperatureC", source: clima.source, measurementType: clima.measurementType, confidence: clima.confidence, method: clima.method, at: clima.at || "", cached: Boolean(clima.cached), ingestedAt: clima.ingestedAt || null, sourceUpdatedAt: clima.sourceUpdatedAt || null });
    } else {
      warnings.push({ code: clima.reason, detail: clima.detail || "", source: clima.source || "" });
    }
  } else if (temperaturaInformada) {
    provenance.push({ id: "weather", field: "temperatureC", source: "informed", measurementType: "INFORMED" });
  }

  return { route: rota, provenance, warnings };
}
