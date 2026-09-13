// ===== Digital twin básico do veículo: baseline de consumo OBSERVADO =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem IA.
//
// Seção 44 da consolidação: DATA FIRST. Antes de qualquer modelo preditivo, a
// frota precisa de uma linha de base REAL por veículo — consumo observado por
// viagem (kWh/km) com km, carga, temperatura, motorista, SoH e SOC inicial/
// final. Começamos com médias móveis, percentis e uma correção determinística
// sobre o consumo nominal; nada de ML sem histórico.
//
// O baseline alimenta `estimateRouteEnergy` como `consumptionKwhPerKm` com
// `consumptionMeasured: true` quando a maioria das observações é MEDIDA
// (telemetria/OCPP) — o que sobe a confiança da estimativa com honestidade.

import { MEASUREMENT_TYPES, CONFIDENCE_LEVELS } from "./dataProvenanceDomain.js";

export const BASELINE_VERSION = "vehicle-baseline@1.0.0";
export const MIN_AMOSTRAS = 3;
export const JANELA_PADRAO = 30;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, c = 3) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** c;
  return Math.round(n * f) / f;
};
const percentil = (ordenados, p) => {
  if (!ordenados.length) return null;
  const idx = (ordenados.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return ordenados[lo];
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (idx - lo);
};

/**
 * Energia consumida numa observação. Preferência: kWh medido (OCPP/telemetria);
 * senão derivado do delta de SOC × capacidade utilizável (+ kWh carregados no
 * trajeto). Devolve null quando não dá para calcular — nunca zero.
 */
export function energiaDaObservacao(obs = {}, vehicle = {}) {
  const direto = num(obs.energyKwh);
  if (direto !== null && direto > 0) return { energyKwh: direto, method: "measured_kwh" };
  const socStart = num(obs.socStartPercent);
  const socEnd = num(obs.socEndPercent);
  const capacidade = num(vehicle.batteryCapacityKwh);
  if (socStart === null || socEnd === null || capacidade === null || capacidade <= 0) return null;
  const soh = num(obs.sohPercent ?? vehicle.batterySohPercent ?? vehicle.sohPercent) ?? 100;
  const utilizavel = capacidade * Math.min(100, Math.max(1, soh)) / 100;
  const carregado = Math.max(0, num(obs.chargedKwh) ?? 0);
  const delta = (socStart - socEnd) / 100 * utilizavel + carregado;
  if (!(delta > 0)) return null;
  return { energyKwh: delta, method: "soc_delta" };
}

/** Consumo (kWh/km) de uma observação, ou null. */
export function consumoDaObservacao(obs = {}, vehicle = {}) {
  const distancia = num(obs.distanceKm);
  if (distancia === null || distancia <= 0) return null;
  const energia = energiaDaObservacao(obs, vehicle);
  if (!energia) return null;
  const consumo = energia.energyKwh / distancia;
  // Sanidade física: fora de 0,05–5 kWh/km é erro de digitação/telemetria.
  if (consumo < 0.05 || consumo > 5) return null;
  return { consumptionKwhPerKm: consumo, energyKwh: energia.energyKwh, method: energia.method };
}

/**
 * Baseline do veículo a partir das últimas observações (janela móvel).
 * `status: "insufficient"` quando há menos que MIN_AMOSTRAS válidas — o
 * modelo continua no consumo nominal e a UI diz "sem histórico suficiente".
 */
export function baselineDoVeiculo(observacoes = [], vehicle = {}, { janela = JANELA_PADRAO, minAmostras = MIN_AMOSTRAS } = {}) {
  // Da mais recente para a mais antiga; a janela conta só observações
  // VÁLIDAS (uma telemetria zerada recente não pode encurtar a amostra).
  const ordenadas = (Array.isArray(observacoes) ? observacoes : [])
    .map((o) => ({ ...o, _t: Date.parse(o.observedAt || o.observed_at || "") }))
    .sort((a, b) => (b._t || 0) - (a._t || 0));
  const validas = [];
  for (const o of ordenadas) {
    if (validas.length >= Math.max(1, janela)) break;
    const c = consumoDaObservacao(o, vehicle);
    if (c) validas.push({ ...c, measurementType: String(o.measurementType || o.measurement_type || MEASUREMENT_TYPES.INFORMED).toUpperCase(), observedAt: o.observedAt || o.observed_at || "" });
  }
  const nominal = num(vehicle.energyConsumptionKwhPerKm ?? vehicle.consumptionKwhPerKm ?? vehicle.referenceConsumptionKwhKm);
  if (validas.length < minAmostras) {
    return { status: "insufficient", samples: validas.length, minSamples: minAmostras, nominalKwhPerKm: nominal, version: BASELINE_VERSION };
  }
  const valores = validas.map((v) => v.consumptionKwhPerKm).sort((a, b) => a - b);
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const variancia = valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length;
  const p50 = percentil(valores, 0.5);
  const p90 = percentil(valores, 0.9);
  const medidas = validas.filter((v) => v.measurementType === MEASUREMENT_TYPES.MEASURED).length;
  const measuredShare = medidas / validas.length;
  const measurementType = measuredShare > 0.5 ? MEASUREMENT_TYPES.MEASURED : MEASUREMENT_TYPES.INFORMED;
  const confidence = validas.length >= 10 && measuredShare > 0.5
    ? CONFIDENCE_LEVELS.HIGH
    : validas.length >= 5 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW;
  return {
    status: "ok",
    version: BASELINE_VERSION,
    samples: validas.length,
    windowFrom: validas[validas.length - 1]?.observedAt || "",
    windowTo: validas[0]?.observedAt || "",
    // O consumo de referência é a MEDIANA (robusta a uma viagem atípica); o
    // p90 é o cenário conservador para reserva/recarga.
    consumptionKwhPerKm: round(p50),
    meanKwhPerKm: round(media),
    p50KwhPerKm: round(p50),
    p90KwhPerKm: round(p90),
    stddevKwhPerKm: round(Math.sqrt(variancia)),
    nominalKwhPerKm: nominal,
    // Correção determinística: quanto o real está acima/abaixo do nominal.
    correctionFactor: nominal && nominal > 0 ? round(p50 / nominal) : null,
    measuredShare: round(measuredShare, 2),
    measurementType,
    confidence,
  };
}

/**
 * Veículo para o modelo de energia com o consumo do baseline (quando há).
 * Não mexe em nada quando o baseline é insuficiente.
 */
export function veiculoComBaseline(vehicle = {}, baseline = null) {
  if (!baseline || baseline.status !== "ok" || !baseline.consumptionKwhPerKm) return { vehicle: { ...vehicle }, applied: false };
  return {
    vehicle: {
      ...vehicle,
      consumptionKwhPerKm: baseline.consumptionKwhPerKm,
      consumptionMeasured: baseline.measurementType === MEASUREMENT_TYPES.MEASURED,
    },
    applied: true,
    note: `consumo_do_baseline_${baseline.samples}_viagens_p50_${baseline.consumptionKwhPerKm}kwh_km`,
  };
}
