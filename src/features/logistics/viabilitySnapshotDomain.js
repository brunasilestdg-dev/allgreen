// ===== Snapshot de viabilidade operacional (IMUTÁVEL e VERSIONADO) =====
// Camada PURA. Sem banco, sem rede, sem DOM, sem IA.
//
// Regra do produto (seção 17): uma proposta logística relevante não avança sem
// um snapshot de viabilidade — a fotografia CONGELADA do que foi prometido:
// rota, veículo, energia, autonomia, recarga, risco, custo, CO2, com a fonte e
// a confiança de cada número. Se algo muda, NÃO se sobrescreve: cria-se uma
// NOVA VERSÃO. Assim a proposta enviada ao cliente sempre pode ser auditada
// contra o cenário exato em que foi calculada.
//
// Por que versionar por CONTEÚDO e não por carimbo de tempo: dois recálculos
// idênticos não devem gerar versões novas (ruído e retrabalho); só uma mudança
// REAL de premissa/rota/veículo/energia sobe a versão. O `contentHash` é a
// identidade do conteúdo; `version` é o contador incremental.
//
// Este módulo consome o resultado de `estimateRouteEnergy` (energia/SOC com
// proveniência) — mantendo a mesma honestidade: nada de estimativa vestida de
// medição, nada de número inventado quando falta dado.

export const VIABILITY_SNAPSHOT_SCHEMA_VERSION = "viability-snapshot@1.0.0";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const round = (v, casas = 2) => {
  // null/undefined/"" preservam null — Number(null) seria 0 e mascararia a
  // ausência do dado (e, com ela, o bloqueio de avanço da proposta).
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

// Serialização estável: chaves ordenadas em qualquer profundidade, para que o
// hash dependa só do CONTEÚDO, nunca da ordem de inserção das chaves.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// Hash determinístico e SÍNCRONO (FNV-1a 32-bit em hex). Não é criptográfico —
// serve para IDENTIDADE DE CONTEÚDO (mudou? não mudou?), que é o que o
// versionamento precisa, e roda igual em Worker, Node e teste sem async.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Campos que DEFINEM o conteúdo do snapshot (entram no hash). createdAt,
// createdBy, version e o próprio contentHash NÃO entram — são metadados.
const CONTENT_FIELDS = [
  "opportunityId", "scenarioId", "route", "origin", "destination", "stops",
  "vehicleClass", "referenceVehicle", "vehicleQuantity", "capacityKg",
  "capacityM3", "palletCapacity", "payload", "roadRestrictions", "distanceKm",
  "durationMinutes", "elevationGain", "energyKwh", "autonomy", "initialSoc",
  "arrivalSoc", "chargingRequired", "chargingStops", "chargerReliability",
  "riskScore", "cost", "costPerDelivery", "co2", "avoidedCo2", "dataSources",
  "confidence", "assumptions", "routingEngine", "routingEngineVersion",
  "energyModelVersion",
];

/**
 * Monta o CONTEÚDO do snapshot (sem metadados de versão) a partir das entradas.
 * `energyEstimate` é o retorno de estimateRouteEnergy (opcional, mas é a fonte
 * preferencial dos números de energia/SOC/elevação/confiança).
 */
export function buildViabilitySnapshotContent(input = {}) {
  const energy = input.energyEstimate && input.energyEstimate.status === "ok"
    ? input.energyEstimate
    : null;
  const stops = Array.isArray(input.stops) ? input.stops : [];
  const chargingStops = Array.isArray(input.chargingStops) ? input.chargingStops : [];
  const roadRestrictions = Array.isArray(input.roadRestrictions) ? input.roadRestrictions : [];
  const dataSources = Array.isArray(input.dataSources) ? input.dataSources : [];

  // Energia/SOC vêm do modelo quando disponível; senão do input; senão null.
  const distanceKm = round(num(input.distanceKm) ?? energy?.distanceKm);
  const durationMinutes = round(num(input.durationMinutes) ?? energy?.durationMinutes, 0);
  const energyKwh = round(num(input.energyKwh) ?? energy?.estimatedEnergyKwh);
  const initialSoc = round(num(input.initialSoc) ?? energy?.initialSoc, 1);
  const arrivalSoc = round(num(input.arrivalSoc) ?? energy?.estimatedArrivalSoc, 1);
  const elevationGain = round(num(input.elevationGain) ?? energy?.elevationGainM, 0);
  const chargingRequired = typeof input.chargingRequired === "boolean"
    ? input.chargingRequired
    : (energy ? !!energy.chargingRequired : null);
  const confidence = texto(input.confidence) || energy?.confidence || "UNKNOWN";

  const assumptions = Array.isArray(input.assumptions)
    ? input.assumptions
    : (energy?.assumptions || []);

  return {
    opportunityId: texto(input.opportunityId),
    scenarioId: texto(input.scenarioId),
    route: texto(input.route),
    origin: texto(input.origin),
    destination: texto(input.destination),
    stops,
    vehicleClass: texto(input.vehicleClass),
    referenceVehicle: texto(input.referenceVehicle),
    vehicleQuantity: num(input.vehicleQuantity),
    capacityKg: num(input.capacityKg),
    capacityM3: num(input.capacityM3),
    palletCapacity: num(input.palletCapacity),
    payload: num(input.payload),
    roadRestrictions,
    distanceKm,
    durationMinutes,
    elevationGain,
    energyKwh,
    autonomy: num(input.autonomy),
    initialSoc,
    arrivalSoc,
    chargingRequired,
    chargingStops,
    chargerReliability: num(input.chargerReliability),
    riskScore: num(input.riskScore),
    cost: round(num(input.cost)),
    costPerDelivery: round(num(input.costPerDelivery)),
    co2: round(num(input.co2 ?? input.CO2)),
    avoidedCo2: round(num(input.avoidedCo2 ?? input.avoidedCO2)),
    dataSources,
    confidence,
    assumptions,
    routingEngine: texto(input.routingEngine),
    routingEngineVersion: texto(input.routingEngineVersion),
    energyModelVersion: texto(input.energyModelVersion) || energy?.calculationVersion || "",
  };
}

// Hash apenas dos CAMPOS DE CONTEÚDO, em ordem estável.
export function viabilitySnapshotHash(content = {}) {
  const picked = {};
  for (const key of CONTENT_FIELDS) picked[key] = content[key] ?? null;
  return fnv1a(stableStringify(picked));
}

/**
 * Cria a PRIMEIRA versão de um snapshot (version 1). Imutável por convenção:
 * quem consome nunca deve editar o objeto — para mudar, chame nextVersion.
 */
export function createViabilitySnapshot(input = {}, meta = {}) {
  const content = buildViabilitySnapshotContent(input);
  const contentHash = viabilitySnapshotHash(content);
  return Object.freeze({
    ...content,
    schemaVersion: VIABILITY_SNAPSHOT_SCHEMA_VERSION,
    version: 1,
    contentHash,
    createdAt: texto(meta.createdAt) || new Date().toISOString(),
    createdBy: texto(meta.createdBy),
  });
}

/**
 * Dado o snapshot ANTERIOR e uma nova entrada, decide:
 *  - conteúdo idêntico  → devolve { changed:false, snapshot: <o anterior> }
 *  - conteúdo diferente → devolve { changed:true, snapshot: <nova versão> }
 * A nova versão herda version = anterior.version + 1. NUNCA sobrescreve.
 */
export function nextViabilitySnapshot(previous, input = {}, meta = {}) {
  const content = buildViabilitySnapshotContent(input);
  const contentHash = viabilitySnapshotHash(content);
  if (previous && previous.contentHash === contentHash) {
    return { changed: false, snapshot: previous };
  }
  const previousVersion = previous && Number.isFinite(Number(previous.version))
    ? Number(previous.version)
    : 0;
  const snapshot = Object.freeze({
    ...content,
    schemaVersion: VIABILITY_SNAPSHOT_SCHEMA_VERSION,
    version: previousVersion + 1,
    contentHash,
    previousContentHash: previous ? previous.contentHash : null,
    createdAt: texto(meta.createdAt) || new Date().toISOString(),
    createdBy: texto(meta.createdBy),
  });
  return { changed: true, snapshot };
}

// Uma proposta relevante só avança com um snapshot com os mínimos preenchidos.
// Devolve a lista de faltas (vazia = pode avançar). Não inventa: exige que o
// número exista, não que seja "bom".
export function viabilitySnapshotBlockers(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return ["snapshot_ausente"];
  const faltas = [];
  if (!snapshot.opportunityId) faltas.push("opportunityId");
  if (snapshot.distanceKm === null || snapshot.distanceKm === undefined) faltas.push("distanceKm");
  if (!snapshot.vehicleClass && !snapshot.referenceVehicle) faltas.push("veiculo");
  if (snapshot.energyKwh === null || snapshot.energyKwh === undefined) faltas.push("energyKwh");
  if (snapshot.cost === null || snapshot.cost === undefined) faltas.push("cost");
  return faltas;
}

export const __test__ = { stableStringify, fnv1a, CONTENT_FIELDS };
