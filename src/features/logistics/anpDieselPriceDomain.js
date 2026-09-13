// ===== Preço do diesel (ANP) com hierarquia para o TCO =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM, sem IA.
//
// Seção 9: o TCO/payback (elétrico x diesel) não pode depender de preço fixo
// escondido no código. O preço deve vir da MELHOR fonte disponível, nesta
// hierarquia, e mostrar SEMPRE a origem e a data:
//
//   contratual do cliente
//     > preço de frota informado
//       > ANP municipal
//         > ANP estadual
//           > ANP regional
//             > ANP nacional
//               > fallback configurado
//
// A ingestão periódica da ANP (cron) alimenta os níveis municipal/estadual/
// regional/nacional; enquanto a fonte não está conectada, o resolvedor cai para
// o próximo nível disponível e marca a proveniência — nunca finge preço atual
// nem apresenta estimativa como medição (seções 14, 53).

import { provenance, MEASUREMENT_TYPES, CONFIDENCE_LEVELS, isStale } from "./dataProvenanceDomain.js";

// Ordem da hierarquia (índice menor = mais forte).
export const DIESEL_PRICE_TIERS = Object.freeze([
  "contractual",   // preço de contrato do cliente
  "fleet",         // preço de frota informado
  "anp_municipal",
  "anp_state",
  "anp_region",
  "anp_national",
  "fallback",
]);

const TIER_META = {
  contractual: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.HIGH, source: "contrato" },
  fleet: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.HIGH, source: "frota" },
  anp_municipal: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.HIGH, source: "ANP município" },
  anp_state: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.MEDIUM, source: "ANP estado" },
  anp_region: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.MEDIUM, source: "ANP região" },
  anp_national: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.LOW, source: "ANP nacional" },
  fallback: { measurementType: MEASUREMENT_TYPES.DERIVED, confidence: CONFIDENCE_LEVELS.LOW, source: "fallback configurado" },
};

const price = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Resolve o preço do diesel pela hierarquia. `inputs` traz, por nível, um
 * objeto { price, date } (ou só um número). Devolve o envelope de proveniência
 * do nível escolhido + o tier + os níveis que foram pulados por não ter valor.
 *
 * @param {object} inputs  ex.: { contractual:{price,date}, anp_municipal:{...}, ... }
 * @param {object} options { staleMs, now } — marca o preço como stale se velho.
 */
export function resolveDieselPrice(inputs = {}, options = {}) {
  const skipped = [];
  for (const tier of DIESEL_PRICE_TIERS) {
    const raw = inputs[tier];
    const value = price(typeof raw === "object" && raw !== null ? raw.price : raw);
    if (value === null) {
      if (raw !== undefined) skipped.push({ tier, reason: "sem_valor" });
      continue;
    }
    const meta = TIER_META[tier];
    const capturedAt = typeof raw === "object" && raw !== null ? (raw.date || raw.capturedAt || "") : "";
    const env = provenance(value, {
      unit: "R$/L",
      source: meta.source,
      sourceType: tier.startsWith("anp") ? "gov_api" : (tier === "fallback" ? "config" : "informed"),
      measurementType: meta.measurementType,
      confidence: meta.confidence,
      capturedAt,
      method: `hierarquia_diesel:${tier}`,
      provider: tier.startsWith("anp") ? "ANP" : "",
    });
    const stale = isStale(env, { maxAgeMs: options.staleMs, now: options.now });
    return {
      resolved: true,
      tier,
      priceRs: value,
      stale,
      provenance: env,
      skipped,
    };
  }
  return { resolved: false, tier: null, priceRs: null, stale: false, provenance: null, skipped, reason: "sem_preco_disponivel" };
}

// Comparação elétrico x diesel por km, para o TCO (seção 9). Não inventa: exige
// os dois custos por km; devolve economia e % ou marca o que falta.
export function dieselVsElectricPerKm({ dieselPrice, dieselConsumptionLPerKm, energyPricePerKwh, energyConsumptionKwhPerKm } = {}) {
  const dp = price(dieselPrice);
  const dc = Number(dieselConsumptionLPerKm);
  const ep = price(energyPricePerKwh);
  const ec = Number(energyConsumptionKwhPerKm);
  const faltando = [];
  if (dp === null) faltando.push("dieselPrice");
  if (!(dc > 0)) faltando.push("dieselConsumptionLPerKm");
  if (ep === null) faltando.push("energyPricePerKwh");
  if (!(ec > 0)) faltando.push("energyConsumptionKwhPerKm");
  if (faltando.length) return { comparable: false, faltando };

  const dieselPerKm = dp * dc;
  const electricPerKm = ep * ec;
  const savingPerKm = dieselPerKm - electricPerKm;
  const savingPercent = dieselPerKm > 0 ? (savingPerKm / dieselPerKm) * 100 : 0;
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    comparable: true,
    dieselPerKm: round(dieselPerKm),
    electricPerKm: round(electricPerKm),
    savingPerKm: round(savingPerKm),
    savingPercent: Math.round(savingPercent * 10) / 10,
    electricCheaper: savingPerKm > 0,
  };
}
