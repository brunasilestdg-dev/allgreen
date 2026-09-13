// ===== RoutingProvider: o backend escolhe e chama o motor (OSRM × Valhalla) =====
//
// A UI pede uma rota; este serviço resolve o motor com a regra pura de
// `routingProvidersDomain` (que reaproveita `routingEngineSelectionDomain`),
// faz o fetch no servidor certo e devolve SEMPRE o mesmo formato. Pesado sem
// Valhalla não roteia por perfil de carro: devolve NO_SAFE_ROUTING_ENGINE.
//
// Estados de saúde (seção 34): CONNECTED (probe ok) · DEGRADED (configurado,
// probe falhou/antigo) · NOT_CONFIGURED (sem URL) · ERROR — derivados por
// `systemHealthDomain` a partir do que `probeValhalla`/`probeOsrm` registram.

import {
  PUBLIC_OSRM_BASE,
  ROUTING_ERRORS,
  motoresDisponiveis,
  normalizarRespostaOsrm,
  normalizarRespostaValhalla,
  requisicaoValhalla,
  respostaCompativelOsrm,
  selecaoSegura,
} from "../../src/features/logistics/routingProvidersDomain.js";

const USER_AGENT = "ToDoGreen-TMS-Routing/2";
const TIMEOUT_MS = 20_000;

const texto = (v, max = 300) => String(v ?? "").trim().slice(0, max);

const cabecalhos = (env, selfHosted, extra = {}) => {
  const headers = { accept: "application/json", "user-agent": USER_AGENT, ...extra };
  if (selfHosted && env?.TDG_ROUTING_TOKEN) headers.authorization = `Bearer ${String(env.TDG_ROUTING_TOKEN)}`;
  return headers;
};

const unir = (base, sufixo) => new URL(String(sufixo).replace(/^\//, ""), base).toString();

async function fetchJson(fetcher, url, options = {}) {
  const inicio = Date.now();
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await response.json().catch(() => null);
  const latencyMs = Date.now() - inicio;
  if (!response.ok || data === null) {
    const error = new Error(`upstream_http_${response.status}`);
    error.status = response.status;
    error.latencyMs = latencyMs;
    error.body = data;
    throw error;
  }
  return { data, latencyMs };
}

/**
 * Valida e normaliza coordenadas [lon, lat]. Devolve { ok, coordinates } ou
 * { ok:false, error } no formato da API.
 */
export function normalizarCoordenadas(coordinates) {
  const lista = Array.isArray(coordinates) ? coordinates : [];
  if (lista.length < 2 || lista.length > 500)
    return { ok: false, error: { code: ROUTING_ERRORS.INVALID_COORDINATES, message: "Informe entre 2 e 500 coordenadas." } };
  const normalized = [];
  for (const pair of lista) {
    if (!Array.isArray(pair) || pair.length < 2)
      return { ok: false, error: { code: ROUTING_ERRORS.INVALID_COORDINATES, message: "Coordenada inválida." } };
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90)
      return { ok: false, error: { code: ROUTING_ERRORS.INVALID_COORDINATES, message: "Coordenada inválida." } };
    normalized.push([lon, lat]);
  }
  return { ok: true, coordinates: normalized };
}

async function rotearOsrm({ coordinates, geometry }, env, motores, fetcher) {
  const points = coordinates.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const suffix = `route/v1/driving/${points}`;
  const query = new URLSearchParams({
    overview: geometry === false ? "false" : "full",
    geometries: geometry === false ? "polyline" : "geojson",
    steps: "false",
  });
  const chamar = async (base, selfHosted) => fetchJson(fetcher, `${unir(base, suffix)}?${query}`, { headers: cabecalhos(env, selfHosted) });
  try {
    const { data, latencyMs } = await chamar(motores.osrm.base, motores.osrm.selfHosted);
    return { ...normalizarRespostaOsrm(data), latencyMs, selfHosted: motores.osrm.selfHosted, publicFallback: !motores.osrm.selfHosted };
  } catch (erro) {
    // Servidor próprio caiu: o endpoint público é contingência DECLARADA (o
    // campo `publicFallback` viaja na resposta) — só para leves; pesados nunca
    // chegam aqui porque a seleção segura já os mandou ao Valhalla.
    if (motores.osrm.selfHosted) {
      try {
        const { data, latencyMs } = await chamar(PUBLIC_OSRM_BASE, false);
        return { ...normalizarRespostaOsrm(data), latencyMs, selfHosted: false, publicFallback: true, degraded: true };
      } catch {
        // cai no erro abaixo
      }
    }
    return { ok: false, reason: texto(erro?.message || "osrm_indisponivel"), status: erro?.status || 502 };
  }
}

async function rotearValhalla({ coordinates, vehicle }, env, motores, fetcher) {
  const { body, costing } = requisicaoValhalla(coordinates, vehicle);
  try {
    const { data, latencyMs } = await fetchJson(fetcher, unir(motores.valhalla.base, "route"), {
      method: "POST",
      headers: cabecalhos(env, true, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const normalizado = normalizarRespostaValhalla(data);
    if (!normalizado.ok) return { ...normalizado, status: 502, costing };
    return { ...normalizado, latencyMs, selfHosted: true, publicFallback: false, costing };
  } catch (erro) {
    // Valhalla configurado mas fora do ar: NÃO cai para OSRM em pesado (seria
    // a rota insegura que a seção 33 proíbe). Falha honesta, com o motivo.
    const detalhe = texto(erro?.body?.error || erro?.message || "valhalla_indisponivel");
    return { ok: false, reason: detalhe, status: erro?.status === 400 ? 422 : 502, costing };
  }
}

/**
 * Ponto único de roteamento do backend. Devolve `{ status, body }` pronto para
 * a resposta HTTP: 200 com formato OSRM-compatível + metadado do motor; 409
 * quando não há motor SEGURO; 400 coordenadas inválidas; 502 motor fora.
 */
export async function rotearComProvider({ coordinates, vehicle = {}, geometry = true } = {}, env = {}, { fetcher = fetch } = {}) {
  const coords = normalizarCoordenadas(coordinates);
  if (!coords.ok) return { status: 400, body: { error: coords.error.code, code: coords.error.code, message: coords.error.message } };

  const selecao = selecaoSegura(vehicle || {}, env);
  if (selecao.error) {
    return {
      status: 409,
      body: {
        error: selecao.error.code,
        code: selecao.error.code,
        message: selecao.error.message,
        requiredEngine: selecao.error.requiredEngine,
        requiredEnv: selecao.error.requiredEnv,
        vehicleClass: selecao.error.vehicleClass,
        restrictionAware: selecao.error.restrictionAware,
        requestedEngine: selecao.requested,
        availableEngines: selecao.motores.available,
      },
    };
  }

  const resultado = selecao.engine === "valhalla"
    ? await rotearValhalla({ coordinates: coords.coordinates, vehicle }, env, selecao.motores, fetcher)
    : await rotearOsrm({ coordinates: coords.coordinates, geometry }, env, selecao.motores, fetcher);

  if (!resultado.ok) {
    return {
      status: resultado.status || 502,
      body: {
        error: ROUTING_ERRORS.ROUTING_UNAVAILABLE,
        code: ROUTING_ERRORS.ROUTING_UNAVAILABLE,
        message: selecao.engine === "valhalla"
          ? `O Valhalla não respondeu (${resultado.reason}). Pesado não é roteado por outro motor.`
          : "Traçado rodoviário indisponível.",
        engine: selecao.engine,
        reason: resultado.reason,
      },
    };
  }

  return {
    status: 200,
    body: respostaCompativelOsrm(resultado, selecao, {
      selfHosted: Boolean(resultado.selfHosted),
      publicFallback: Boolean(resultado.publicFallback),
      degraded: Boolean(resultado.degraded),
      latencyMs: resultado.latencyMs ?? null,
      costing: resultado.costing ? { costing: resultado.costing.costing, options: resultado.costing.costing_options, assumptions: resultado.costing.assumptions } : undefined,
    }),
  };
}

/** Probe do Valhalla: GET /status (versão, tiles) — sem custo, sem rota. */
export async function probeValhalla(env = {}, { fetcher = fetch } = {}) {
  const motores = motoresDisponiveis(env);
  if (!motores.valhalla.configured) return { provider: "valhalla", ok: false, configured: false, skipped: true, detail: `Configure ${motores.valhalla.envKey}.` };
  try {
    const { data, latencyMs } = await fetchJson(fetcher, unir(motores.valhalla.base, "status"), { headers: cabecalhos(env, true) });
    return { provider: "valhalla", ok: true, configured: true, latencyMs, version: texto(data?.version || ""), tileset: texto(data?.tileset_last_modified || ""), hasElevation: Boolean(data?.has_elevation) };
  } catch (erro) {
    return { provider: "valhalla", ok: false, configured: true, latencyMs: erro?.latencyMs ?? null, detail: texto(erro?.message || "valhalla_indisponivel") };
  }
}

/** Probe do OSRM configurado (rota mínima). */
export async function probeOsrm(env = {}, { fetcher = fetch } = {}) {
  const motores = motoresDisponiveis(env);
  const alvo = motores.osrm.base;
  try {
    const { latencyMs } = await fetchJson(fetcher, `${unir(alvo, "route/v1/driving/-46.6333,-23.5505;-46.6500,-23.5600")}?overview=false`, { headers: cabecalhos(env, motores.osrm.selfHosted) });
    return { provider: "osrm", ok: true, configured: motores.osrm.selfHosted, publicFallback: motores.osrm.publicFallback, latencyMs };
  } catch (erro) {
    return { provider: "osrm", ok: false, configured: motores.osrm.selfHosted, publicFallback: motores.osrm.publicFallback, latencyMs: erro?.latencyMs ?? null, detail: texto(erro?.message || "osrm_indisponivel") };
  }
}
