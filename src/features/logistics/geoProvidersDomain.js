// ===== Elevação e clima para o modelo de energia — regras PURAS =====
// Sem rede, sem banco, sem DOM. Quem busca é worker/services/geo-providers.js.
//
// Seções 42–43 da consolidação:
//   • ELEVAÇÃO vem de fonte aberta processada localmente (Valhalla /height
//     sobre tiles com relevo, do mesmo extrato OSM) — nunca paga por request;
//     sem fonte, o modelo assume perfil plano e DIZ isso (assumption +
//     confiança menor), em vez de inventar subida.
//   • CLIMA vem do Open-Meteo (licença aberta) na hora de saída; sem fonte →
//     WEATHER_NOT_AVAILABLE, temperatura ausente, confiança reduzida.
//
// Este módulo transforma respostas cruas em números com proveniência e
// calcula o perfil de elevação (ganho/perda) a partir das alturas amostradas.

import { MEASUREMENT_TYPES, CONFIDENCE_LEVELS } from "./dataProvenanceDomain.js";

export const GEO_ERRORS = Object.freeze({
  ELEVATION_NOT_AVAILABLE: "ELEVATION_NOT_AVAILABLE",
  WEATHER_NOT_AVAILABLE: "WEATHER_NOT_AVAILABLE",
});

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, c = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** c;
  return Math.round(n * f) / f;
};

/**
 * Amostra até `max` pontos de uma geometria [lon, lat], preservando extremos.
 * Uma rota de 300 km tem milhares de vértices; o perfil não precisa de todos.
 */
export function amostrarGeometria(geometry = [], max = 200) {
  const pontos = (Array.isArray(geometry) ? geometry : []).filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (pontos.length <= max) return pontos.map(([lon, lat]) => [Number(lon), Number(lat)]);
  const passo = (pontos.length - 1) / (max - 1);
  const saida = [];
  for (let i = 0; i < max; i += 1) {
    const [lon, lat] = pontos[Math.round(i * passo)];
    saida.push([Number(lon), Number(lat)]);
  }
  return saida;
}

/**
 * Ganho e perda acumulados a partir de alturas (m) ao longo da rota. Um
 * `ruidoM` mínimo evita somar oscilação de DEM (1–2 m) como se fosse morro.
 * Alturas nulas (sem dado no tile) são puladas — e contadas como lacuna.
 */
export function perfilDeElevacao(heights = [], { ruidoM = 2 } = {}) {
  const lista = (Array.isArray(heights) ? heights : []).map(num);
  let anterior = null;
  let gain = 0;
  let loss = 0;
  let validos = 0;
  let lacunas = 0;
  let min = null;
  let max = null;
  for (const h of lista) {
    if (h === null) { lacunas += 1; continue; }
    validos += 1;
    min = min === null ? h : Math.min(min, h);
    max = max === null ? h : Math.max(max, h);
    if (anterior !== null) {
      const delta = h - anterior;
      if (delta > ruidoM) gain += delta;
      else if (delta < -ruidoM) loss += -delta;
      else continue; // dentro do ruído: não move o "anterior" (filtro)
    }
    anterior = h;
  }
  if (validos < 2) return { ok: false, reason: GEO_ERRORS.ELEVATION_NOT_AVAILABLE, samples: validos, gaps: lacunas };
  const cobertura = validos / Math.max(1, lista.length);
  return {
    ok: true,
    elevationGainM: round(gain, 0),
    elevationLossM: round(loss, 0),
    minM: round(min, 0),
    maxM: round(max, 0),
    samples: validos,
    gaps: lacunas,
    coverage: round(cobertura, 3),
    // Cobertura baixa (muitos vazios) rebaixa a confiança do número.
    confidence: cobertura >= 0.95 ? CONFIDENCE_LEVELS.HIGH : cobertura >= 0.7 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
    measurementType: MEASUREMENT_TYPES.DERIVED,
  };
}

/** Corpo do POST /height do Valhalla para uma geometria [lon, lat]. */
export function requisicaoAlturaValhalla(geometry = [], { max = 200 } = {}) {
  const amostra = amostrarGeometria(geometry, max);
  return {
    shape: amostra.map(([lon, lat]) => ({ lat, lon })),
    range: false,
    height_precision: 0,
  };
}

/** Resposta do /height → alturas (m), null onde o Valhalla não tem dado. */
export function alturasDaRespostaValhalla(data = {}) {
  const heights = Array.isArray(data?.height) ? data.height : Array.isArray(data?.heights) ? data.heights : null;
  if (!heights) return null;
  return heights.map((h) => (h === null || h === undefined ? null : num(h)));
}

/**
 * Temperatura do Open-Meteo na hora de saída. `hourly.time[]` (ISO local) e
 * `hourly.temperature_2m[]` alinhados; escolhe a hora mais próxima de
 * `departureIso`. Sem hora → `current.temperature_2m`.
 */
export function temperaturaNaSaida(data = {}, departureIso = "") {
  const horas = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
  const temps = Array.isArray(data?.hourly?.temperature_2m) ? data.hourly.temperature_2m : [];
  const alvo = Date.parse(departureIso || "");
  if (Number.isFinite(alvo) && horas.length && temps.length) {
    let melhor = -1;
    let menor = Infinity;
    for (let i = 0; i < horas.length; i += 1) {
      const t = Date.parse(horas[i]);
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(t - alvo);
      if (d < menor) { menor = d; melhor = i; }
    }
    const temp = melhor >= 0 ? num(temps[melhor]) : null;
    if (temp !== null && menor <= 3 * 60 * 60 * 1000) {
      return {
        ok: true,
        temperatureC: round(temp, 1),
        at: horas[melhor],
        method: "hourly_nearest",
        measurementType: MEASUREMENT_TYPES.EXTERNAL,
        confidence: menor <= 60 * 60 * 1000 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      };
    }
  }
  const atual = num(data?.current?.temperature_2m);
  if (atual !== null) {
    return {
      ok: true,
      temperatureC: round(atual, 1),
      at: data?.current?.time || "",
      method: "current",
      measurementType: MEASUREMENT_TYPES.EXTERNAL,
      // Temperatura de agora para uma saída em outra hora: serve, com ressalva.
      confidence: Number.isFinite(alvo) ? CONFIDENCE_LEVELS.LOW : CONFIDENCE_LEVELS.MEDIUM,
    };
  }
  return { ok: false, reason: GEO_ERRORS.WEATHER_NOT_AVAILABLE };
}

/** Chave estável de cache para uma geometria/ponto (sem depender da ordem de chaves). */
export function chaveGeo(kind, payload) {
  const base = JSON.stringify(payload, Object.keys(payload).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i += 1) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${kind}:${(h >>> 0).toString(16).padStart(8, "0")}:${base.length}`;
}

/** Ponto médio de uma geometria [lon, lat] (para clima: uma consulta por rota). */
export function pontoMedio(geometry = []) {
  const pontos = amostrarGeometria(geometry, 1000);
  if (!pontos.length) return null;
  const [lon, lat] = pontos[Math.floor(pontos.length / 2)];
  return { latitude: round(lat, 4), longitude: round(lon, 4) };
}
