// ===== Provedores de rota (OSRM × Valhalla) — contrato ÚNICO para o backend =====
// Camada PURA e DETERMINÍSTICA. Sem rede, sem banco, sem DOM.
//
// Seções 28–35 da consolidação: cada motor tem função. OSRM roteia leves
// (moto, carro, van sem restrição); Valhalla roteia pesados com truck costing
// (altura, largura, comprimento, peso, eixos, hazmat). A UI NUNCA fala com um
// motor: pede uma rota ao backend, que escolhe com `selectRoutingEngine` e
// traduz a resposta de qualquer motor para UM formato (o que a tela já lê).
//
// Regra crítica (seção 33): pesado sem Valhalla NÃO cai em OSRM perfil de
// carro. A resposta é NO_SAFE_ROUTING_ENGINE, com o que falta configurar.
//
// Este módulo monta a REQUISIÇÃO e normaliza a RESPOSTA; quem faz o fetch é
// `worker/services/routing-providers.js`.

import { decodificarPolyline } from "./routingOptimizationDomain.js";
import {
  ROUTING_ENGINES,
  classifyVehicle,
  requiresRestrictionAware,
  selectRoutingEngine,
} from "./routingEngineSelectionDomain.js";

export const ROUTING_ERRORS = Object.freeze({
  NO_SAFE_ROUTING_ENGINE: "NO_SAFE_ROUTING_ENGINE",
  NO_ROUTING_ENGINE: "NO_ROUTING_ENGINE",
  ROUTING_UNAVAILABLE: "ROUTING_UNAVAILABLE",
  INVALID_COORDINATES: "INVALID_COORDINATES",
});

// Nomes de variável aceitos por motor. O gateway de integrações nasceu com
// `TODOGREEN_*` e a API elétrica com `TDG_*`; aceitar os dois evita que um
// servidor configurado apareça como "não configurado" por causa do prefixo.
export const ROUTING_ENV_KEYS = Object.freeze({
  osrm: ["TODOGREEN_OSRM_BASE_URL", "TDG_OSRM_BASE_URL"],
  valhalla: ["TDG_VALHALLA_BASE_URL", "TODOGREEN_VALHALLA_BASE_URL"],
  token: ["TDG_ROUTING_TOKEN"],
});

export const PUBLIC_OSRM_BASE = "https://router.project-osrm.org/";

const texto = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const positivo = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

export function urlDeBase(raw) {
  const value = texto(raw);
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return "";
  }
}

const primeiraUrl = (env, chaves) => {
  for (const chave of chaves) {
    const base = urlDeBase(env?.[chave]);
    if (base) return { base, envKey: chave };
  }
  return { base: "", envKey: "" };
};

/**
 * Quais motores o backend pode usar AGORA, a partir das variáveis do Worker.
 * OSRM conta como disponível mesmo sem servidor próprio (endpoint público é a
 * contingência declarada — `selfHosted:false`); Valhalla só quando há URL.
 */
export function motoresDisponiveis(env = {}) {
  const osrm = primeiraUrl(env, ROUTING_ENV_KEYS.osrm);
  const valhalla = primeiraUrl(env, ROUTING_ENV_KEYS.valhalla);
  const tokenKey = ROUTING_ENV_KEYS.token.find((k) => texto(env?.[k]));
  const available = [ROUTING_ENGINES.OSRM];
  if (valhalla.base) available.push(ROUTING_ENGINES.VALHALLA);
  return {
    osrm: { configured: Boolean(osrm.base), selfHosted: Boolean(osrm.base), base: osrm.base || PUBLIC_OSRM_BASE, envKey: osrm.envKey, publicFallback: !osrm.base },
    valhalla: { configured: Boolean(valhalla.base), selfHosted: Boolean(valhalla.base), base: valhalla.base, envKey: valhalla.envKey || ROUTING_ENV_KEYS.valhalla[0] },
    token: { configured: Boolean(tokenKey), envKey: tokenKey || ROUTING_ENV_KEYS.token[0] },
    available,
  };
}

const MENSAGEM_SEM_MOTOR_SEGURO = "Veículo pesado ou com restrição física exige o Valhalla (truck costing). Sem ele, o sistema NÃO roteia por perfil de carro — configure TDG_VALHALLA_BASE_URL (infra/tms-routing).";

/**
 * Escolha SEGURA do motor para um veículo com os motores disponíveis.
 * Devolve a seleção de `selectRoutingEngine` mais, quando não há motor
 * seguro, um `error` pronto para a API (código estável + mensagem em pt-BR).
 */
export function selecaoSegura(vehicle = {}, env = {}) {
  const motores = motoresDisponiveis(env);
  const selecao = selectRoutingEngine(vehicle, { available: motores.available });
  if (selecao.engine) return { ...selecao, motores, error: null };
  const semSeguro = selecao.reason === "sem_motor_seguro_para_restricoes";
  return {
    ...selecao,
    motores,
    error: {
      code: semSeguro ? ROUTING_ERRORS.NO_SAFE_ROUTING_ENGINE : ROUTING_ERRORS.NO_ROUTING_ENGINE,
      message: semSeguro ? MENSAGEM_SEM_MOTOR_SEGURO : "Nenhum motor de rota está disponível agora.",
      requiredEngine: selecao.requested,
      requiredEnv: selecao.requested === ROUTING_ENGINES.VALHALLA ? motores.valhalla.envKey : motores.osrm.envKey,
      vehicleClass: selecao.vehicleClass,
      restrictionAware: selecao.restrictionAware,
    },
  };
}

/**
 * Perfil físico do veículo → costing do Valhalla. Unidades do Valhalla:
 * metros para dimensões, TONELADAS métricas para peso. Só entra o que foi
 * informado; o resto fica com o padrão do motor (registrado em `assumptions`).
 */
export function costingValhalla(vehicle = {}) {
  const classe = classifyVehicle(vehicle);
  const restricao = requiresRestrictionAware(vehicle);
  const categoria = texto(vehicle.category ?? vehicle.classe ?? vehicle.class ?? vehicle.type).toLowerCase();
  const assumptions = [];
  if (!restricao) {
    const costing = ["moto", "motorcycle", "moped"].includes(categoria) ? "motorcycle" : "auto";
    return { costing, costing_options: {}, assumptions, vehicleClass: classe };
  }
  const truck = {};
  const height = positivo(vehicle.heightM ?? vehicle.maxHeightM);
  const width = positivo(vehicle.widthM ?? vehicle.maxWidthM);
  const length = positivo(vehicle.lengthM ?? vehicle.maxLengthM);
  const grossKg = positivo(vehicle.grossWeightKg ?? vehicle.pbtKg ?? vehicle.maxWeightKg)
    ?? ((positivo(vehicle.tareKg) || 0) + (positivo(vehicle.payloadKg) || 0) || null);
  const axles = positivo(vehicle.axles ?? vehicle.axleCount);
  if (height) truck.height = height; else assumptions.push("altura_nao_informada_padrao_valhalla");
  if (width) truck.width = width; else assumptions.push("largura_nao_informada_padrao_valhalla");
  if (length) truck.length = length; else assumptions.push("comprimento_nao_informado_padrao_valhalla");
  if (grossKg) truck.weight = Math.round((grossKg / 1000) * 100) / 100; else assumptions.push("peso_bruto_nao_informado_padrao_valhalla");
  if (axles) {
    truck.axle_count = Math.round(axles);
    if (grossKg) truck.axle_load = Math.round((grossKg / 1000 / axles) * 100) / 100;
  }
  if (vehicle.hazmat === true) truck.hazmat = true;
  return { costing: "truck", costing_options: { truck }, assumptions, vehicleClass: classe };
}

/**
 * Corpo do POST /route do Valhalla. `coordinates` em [lon, lat] (GeoJSON), como
 * o resto do backend já usa. `alternates` > 0 pede rotas alternativas ao motor
 * (seção 83) — normalizadas em `alternatives`.
 */
export function requisicaoValhalla(coordinates = [], vehicle = {}, { language = "pt-BR", alternates = 0 } = {}) {
  const costing = costingValhalla(vehicle);
  return {
    body: {
      locations: coordinates.map(([lon, lat]) => ({ lat, lon, type: "break" })),
      costing: costing.costing,
      costing_options: costing.costing_options,
      units: "kilometers",
      directions_options: { units: "kilometers", language },
      shape_format: "polyline6",
      alternates,
    },
    costing,
  };
}

/**
 * Resposta do Valhalla → formato normalizado. `summary.length` já vem em km
 * (units kilometers); `time` em segundos; `legs[].shape` em polyline6.
 */
function tripValhallaNormalizado(trip, extra = {}) {
  const legs = Array.isArray(trip.legs) ? trip.legs : [];
  const geometry = [];
  for (const leg of legs) {
    for (const [lat, lon] of decodificarPolyline(leg?.shape, 6)) geometry.push([lon, lat]);
  }
  const distanceKm = num(trip.summary.length) ?? 0;
  const durationSeconds = num(trip.summary.time) ?? 0;
  return {
    ok: true,
    engine: ROUTING_ENGINES.VALHALLA,
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    durationMinutes: Math.round(durationSeconds / 60),
    durationSeconds: Math.round(durationSeconds),
    geometry,
    legs: legs.map((leg) => ({
      distanceKm: num(leg?.summary?.length) ?? 0,
      durationSeconds: Math.round(num(leg?.summary?.time) ?? 0),
    })),
    // Nomes/refs das vias (ex.: "BR-116") para o Risk Map casar por rodovia.
    roadRefs: [...new Set(legs.flatMap((leg) => (Array.isArray(leg?.maneuvers) ? leg.maneuvers : []).flatMap((m) => [...(m?.street_names || []), ...(m?.begin_street_names || [])])).map((n) => texto(n, 40)).filter((n) => /^[A-Z]{2,3}-\d{2,4}/.test(n)))],
    warnings: [],
    ...extra,
  };
}

/**
 * Resposta do Valhalla → formato normalizado. `summary.length` já vem em km
 * (units kilometers); `time` em segundos; `legs[].shape` em polyline6.
 * `alternates[]` (quando pedidos) viram `alternatives`, no mesmo formato.
 */
export function normalizarRespostaValhalla(data = {}) {
  const trip = data?.trip;
  if (!trip || !trip.summary) return { ok: false, reason: texto(data?.error || "valhalla_sem_trip", 200) };
  const principal = tripValhallaNormalizado(trip, { warnings: Array.isArray(data?.warnings) ? data.warnings.map((w) => texto(w?.message || w, 200)) : [] });
  const alternatives = (Array.isArray(data?.alternates) ? data.alternates : [])
    .map((alt) => alt?.trip)
    .filter((t) => t && t.summary)
    .map((t) => tripValhallaNormalizado(t));
  return { ...principal, alternatives };
}

/** Resposta do OSRM (routes[0]) → mesmo formato normalizado. */
function rotaOsrmNormalizada(route) {
  let geometry = [];
  if (route.geometry && typeof route.geometry === "object" && Array.isArray(route.geometry.coordinates)) {
    geometry = route.geometry.coordinates
      .filter((par) => Array.isArray(par) && par.length >= 2)
      .map(([lon, lat]) => [Number(lon), Number(lat)]);
  } else if (typeof route.geometry === "string") {
    geometry = decodificarPolyline(route.geometry, 5).map(([lat, lon]) => [lon, lat]);
  }
  const distanceM = num(route.distance) ?? 0;
  const durationSeconds = num(route.duration) ?? 0;
  return {
    ok: true,
    engine: ROUTING_ENGINES.OSRM,
    distanceKm: Math.round(distanceM) / 1000,
    durationMinutes: Math.round(durationSeconds / 60),
    durationSeconds: Math.round(durationSeconds),
    geometry,
    legs: (Array.isArray(route.legs) ? route.legs : []).map((leg) => ({
      distanceKm: (num(leg?.distance) ?? 0) / 1000,
      durationSeconds: Math.round(num(leg?.duration) ?? 0),
    })),
    roadRefs: [...new Set((Array.isArray(route.legs) ? route.legs : []).flatMap((leg) => (Array.isArray(leg?.steps) ? leg.steps : []).map((s) => texto(s?.ref || "", 40))).flatMap((r) => r.split(/[;,]/)).map((r) => r.trim()).filter((r) => /^[A-Z]{2,3}-\d{2,4}/.test(r)))],
    warnings: [],
  };
}

/** Resposta do OSRM (routes[0]; routes[1..] viram `alternatives`) → formato normalizado. */
export function normalizarRespostaOsrm(data = {}) {
  const routes = Array.isArray(data?.routes) ? data.routes.filter(Boolean) : [];
  if (!routes.length) return { ok: false, reason: texto(data?.code || data?.message || "osrm_sem_rota", 200) };
  return { ...rotaOsrmNormalizada(routes[0]), alternatives: routes.slice(1).map((r) => rotaOsrmNormalizada(r)) };
}

/**
 * O que a tela já lê (formato OSRM: routes[0].distance em METROS, duration em
 * SEGUNDOS, geometry GeoJSON) + o metadado do motor. Assim Valhalla e OSRM
 * chegam iguais ao Leaflet, e a tela ainda sabe dizer "roteado pelo Valhalla
 * (truck)" — a informação no momento da decisão.
 */
const rotaCompativel = (r, selecao) => ({
  distance: Math.round(r.distanceKm * 1000),
  duration: r.durationSeconds,
  geometry: { type: "LineString", coordinates: r.geometry },
  legs: (r.legs || []).map((leg) => ({ distance: Math.round(leg.distanceKm * 1000), duration: leg.durationSeconds })),
  weight_name: selecao.engine === ROUTING_ENGINES.VALHALLA ? "valhalla" : "routability",
  roadRefs: r.roadRefs || [],
});

export function respostaCompativelOsrm(normalizado, selecao = {}, extra = {}) {
  return {
    code: "Ok",
    routes: [rotaCompativel(normalizado, selecao), ...(normalizado.alternatives || []).map((alt) => rotaCompativel(alt, selecao))],
    waypoints: [],
    engine: normalizado.engine,
    profile: selecao.profile || "",
    requestedEngine: selecao.requested || "",
    restrictionAware: Boolean(selecao.restrictionAware),
    fallback: Boolean(selecao.fallback),
    reason: selecao.reason || "",
    vehicleClass: selecao.vehicleClass || "",
    warnings: normalizado.warnings || [],
    ...extra,
  };
}

/** Rótulo em pt-BR do motor/perfil para a tela. */
export function descreverMotor(resposta = {}) {
  const engine = texto(resposta.engine);
  if (!engine) return "";
  const perfil = texto(resposta.profile);
  const nome = engine === ROUTING_ENGINES.VALHALLA ? "Valhalla" : "OSRM";
  const perfilPt = perfil === "truck" ? "caminhão (restrições viárias)" : perfil === "motorcycle" ? "moto" : perfil === "auto" || perfil === "driving" ? "veículo leve" : perfil;
  const contingencia = resposta.fallback ? " · contingência" : "";
  return `${nome}${perfilPt ? ` · ${perfilPt}` : ""}${contingencia}`;
}
