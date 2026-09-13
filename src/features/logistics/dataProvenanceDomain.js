// ===== Proveniência de dados (padrão universal) =====
// Camada PURA. Sem banco, sem rede, sem DOM, sem IA.
//
// Regra do produto (seções 25-27, 53): todo dado CRÍTICO tem de responder:
// qual é o valor? de onde veio? quando foi capturado? é medido ou estimado?
// qual método? qual confiança? qual versão? E nunca apresentar ESTIMATIVA
// como MEDIÇÃO.
//
// Este módulo dá o ENVELOPE canônico e as regras para escolher o melhor dado
// disponível quando há mais de uma fonte para o mesmo fato (energia, tarifa
// ANEEL/ANP, CO2, risco, SOC, elevação, consumo...). É de propósito genérico:
// o mesmo envelope serve o kWh medido por OCPP e a tarifa de referência da
// ANEEL, cada um com sua honestidade.

export const MEASUREMENT_TYPES = Object.freeze({
  MEASURED: "MEASURED",     // medido de fato (OCPP, telemetria, balança)
  INFORMED: "INFORMED",     // informado por humano/contrato
  IMPORTED: "IMPORTED",     // importado de arquivo/cadastro
  EXTERNAL: "EXTERNAL",     // veio de API externa (ANEEL, ANP...)
  DERIVED: "DERIVED",       // derivado de outros dados por regra
  ESTIMATED: "ESTIMATED",   // estimado por modelo
});

export const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", UNKNOWN: "UNKNOWN",
});

// Hierarquia de verdade: maior = mais confiável como ORIGEM. Empata? decide a
// confiança e, por fim, a recência. Medição real ganha de tudo; estimativa e
// derivação ficam por último. (Coerente com as hierarquias tarifárias do
// pedido: contratual > informado > oficial/referência > fallback.)
const TYPE_RANK = {
  MEASURED: 6, INFORMED: 5, IMPORTED: 4, EXTERNAL: 3, DERIVED: 2, ESTIMATED: 1,
};
const CONFIDENCE_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const upper = (v, allowed, fallback) => {
  const s = texto(v).toUpperCase();
  return allowed[s] ? s : fallback;
};

/**
 * Constrói um envelope de proveniência normalizado.
 * `value` pode ser número, string ou null (dado ausente — honestidade: não
 * inventa; fica null com measurementType e confiança coerentes).
 */
export function provenance(value, opts = {}) {
  const measurementType = upper(opts.measurementType, MEASUREMENT_TYPES, MEASUREMENT_TYPES.INFORMED);
  // Se não há valor, a confiança não pode ser HIGH — no máximo o que foi pedido,
  // mas UNKNOWN por padrão.
  let confidence = upper(opts.confidence, CONFIDENCE_LEVELS, CONFIDENCE_LEVELS.UNKNOWN);
  if (value === null || value === undefined || value === "") confidence = CONFIDENCE_LEVELS.UNKNOWN;
  return {
    value: value === undefined ? null : value,
    unit: texto(opts.unit),
    source: texto(opts.source),
    sourceType: texto(opts.sourceType),
    measurementType,
    capturedAt: texto(opts.capturedAt),
    effectiveAt: texto(opts.effectiveAt) || texto(opts.capturedAt),
    confidence,
    method: texto(opts.method),
    assumptions: Array.isArray(opts.assumptions) ? opts.assumptions : [],
    provider: texto(opts.provider),
    providerVersion: texto(opts.providerVersion),
    calculationVersion: texto(opts.calculationVersion),
  };
}

export const isMeasured = (p) => !!p && p.measurementType === MEASUREMENT_TYPES.MEASURED;
export const hasValue = (p) => !!p && p.value !== null && p.value !== undefined && p.value !== "";

// Dado velho: capturado há mais que maxAgeMs. Sem capturedAt não dá para
// afirmar frescor -> considera stale (honestidade: não fingir atualidade).
export function isStale(p, { maxAgeMs, now = Date.now() } = {}) {
  if (!p || !Number.isFinite(Number(maxAgeMs))) return false;
  if (!p.capturedAt) return true;
  const t = Date.parse(p.capturedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > Number(maxAgeMs);
}

// Escolhe a MELHOR proveniência para o mesmo fato entre várias fontes.
// Ordem: tem valor > tipo (hierarquia) > confiança > mais recente.
export function pickBestProvenance(list = []) {
  const candidates = (Array.isArray(list) ? list : []).filter(Boolean);
  if (!candidates.length) return null;
  const score = (p) => [
    hasValue(p) ? 1 : 0,
    TYPE_RANK[p.measurementType] || 0,
    CONFIDENCE_RANK[p.confidence] || 0,
    Date.parse(p.capturedAt || "") || 0,
  ];
  return candidates.reduce((best, cur) => {
    const a = score(cur);
    const b = score(best);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] > b[i]) return cur;
      if (a[i] < b[i]) return best;
    }
    return best;
  });
}

const TYPE_LABEL_PT = {
  MEASURED: "medido", INFORMED: "informado", IMPORTED: "importado",
  EXTERNAL: "externo", DERIVED: "derivado", ESTIMATED: "estimado",
};
const CONF_LABEL_PT = { HIGH: "alta", MEDIUM: "média", LOW: "baixa", UNKNOWN: "desconhecida" };

// Rótulo curto em pt-BR: "72 kWh · OCPP · medido · confiança alta".
export function describeProvenance(p) {
  if (!p) return "sem dado";
  if (!hasValue(p)) return "não informado";
  const partes = [`${p.value}${p.unit ? ` ${p.unit}` : ""}`];
  if (p.source) partes.push(p.source);
  partes.push(TYPE_LABEL_PT[p.measurementType] || "informado");
  partes.push(`confiança ${CONF_LABEL_PT[p.confidence] || "desconhecida"}`);
  return partes.join(" · ");
}

export const __test__ = { TYPE_RANK, CONFIDENCE_RANK };
