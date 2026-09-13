// ===== Alternativas de rota (risco como CUSTO, não bloqueio) =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM, sem IA.
//
// Seções 14-15: o risco histórico (PRF/ANTT) influencia a rota como CUSTO — não
// bloqueia automaticamente só porque houve acidentes. O operador quer ver
// alternativas concretas e escolher: mais rápida, menor custo, menor risco,
// menor consumo, equilibrada — cada uma com tempo, km, energia, pedágio, risco
// e restrições à vista.
//
// Este módulo recebe rotas CANDIDATAS já medidas (pelo motor de rota + modelo de
// energia + índice de risco) e as ranqueia por objetivo. Não calcula rota nem
// consome rede: é a régua de decisão, testável e explicável.
//
// Uma rota INCOMPATÍVEL com o veículo (restrictionsOk=false — ver
// roadRestrictionDomain) é EXCLUÍDA da recomendação (não dá para mandar o
// veículo por onde ele não passa), mas continua listada com o motivo.

const num = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

export const DEFAULT_COST_ASSUMPTIONS = Object.freeze({
  costPerKm: 2.5,          // R$/km (operacional, fora energia)
  costPerMinute: 1.2,      // R$/min (motorista + oportunidade)
  costPerKwh: 0.92,        // R$/kWh
  riskCostPerPoint: 3.0,   // R$ por ponto de risco (0-100) — risco vira dinheiro
});

// Pesos do objetivo "equilibrado". Risco tem peso relevante (seção 15).
export const DEFAULT_BALANCED_WEIGHTS = Object.freeze({
  time: 0.25, cost: 0.25, energy: 0.2, risk: 0.3,
});

// Custo monetário PURO da rota (operacional + energia + pedágio). Sem risco —
// para o risco não ser contado duas vezes (no custo e no peso de risco).
export function routeMoneyCost(route, assumptions = DEFAULT_COST_ASSUMPTIONS) {
  const a = { ...DEFAULT_COST_ASSUMPTIONS, ...assumptions };
  return num(route.distanceKm) * a.costPerKm
    + num(route.durationMinutes) * a.costPerMinute
    + num(route.energyKwh) * a.costPerKwh
    + num(route.tollCost);
}

// Risco convertido em dinheiro (seção 15: risco influencia como CUSTO).
export function routeRiskCost(route, assumptions = DEFAULT_COST_ASSUMPTIONS) {
  const a = { ...DEFAULT_COST_ASSUMPTIONS, ...assumptions };
  return num(route.riskScore) * a.riskCostPerPoint;
}

// Custo total = dinheiro + risco. É a régua do objetivo "menor custo".
export function routeTotalCost(route, assumptions = DEFAULT_COST_ASSUMPTIONS) {
  return routeMoneyCost(route, assumptions) + routeRiskCost(route, assumptions);
}

const minMax = (values) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return (v) => (span === 0 ? 0 : (v - min) / span); // 0 = melhor, 1 = pior
};

/**
 * Ranqueia rotas candidatas. Devolve recomendações por objetivo e a lista
 * completa (com custo e exclusões). Rotas incompatíveis não são recomendadas.
 * `routes`: [{ id, distanceKm, durationMinutes, energyKwh, tollCost, riskScore,
 *             restrictionsOk }]
 */
export function rankRouteAlternatives(routes = [], options = {}) {
  const assumptions = { ...DEFAULT_COST_ASSUMPTIONS, ...(options.assumptions || {}) };
  const weights = { ...DEFAULT_BALANCED_WEIGHTS, ...(options.weights || {}) };
  const list = (Array.isArray(routes) ? routes : []).map((r) => ({
    id: r.id ?? "",
    distanceKm: num(r.distanceKm),
    durationMinutes: num(r.durationMinutes),
    energyKwh: num(r.energyKwh),
    tollCost: num(r.tollCost),
    riskScore: num(r.riskScore),
    restrictionsOk: r.restrictionsOk !== false,
    restrictionReasons: Array.isArray(r.restrictionReasons) ? r.restrictionReasons : [],
    moneyCost: routeMoneyCost(r, assumptions),
    riskCost: routeRiskCost(r, assumptions),
    totalCost: routeTotalCost(r, assumptions),
  }));

  if (!list.length) return { recommendations: {}, ranked: [], excluded: [] };

  // Só rotas VIÁVEIS entram na recomendação; incompatíveis ficam à parte.
  const feasible = list.filter((r) => r.restrictionsOk);
  const excluded = list.filter((r) => !r.restrictionsOk);
  if (!feasible.length) {
    return { recommendations: {}, ranked: list, excluded, reason: "no_feasible_route" };
  }

  // Normalização para o objetivo equilibrado. Usa o custo PURO (dinheiro) na
  // dimensão de custo e o risco em dimensão separada — sem contar risco 2x.
  const nTime = minMax(feasible.map((r) => r.durationMinutes));
  const nCost = minMax(feasible.map((r) => r.moneyCost));
  const nEnergy = minMax(feasible.map((r) => r.energyKwh));
  const nRisk = minMax(feasible.map((r) => r.riskScore));
  const withScores = feasible.map((r) => ({
    ...r,
    balancedScore: weights.time * nTime(r.durationMinutes)
      + weights.cost * nCost(r.moneyCost)
      + weights.energy * nEnergy(r.energyKwh)
      + weights.risk * nRisk(r.riskScore),
  }));

  const pick = (key, dir = 1) => withScores
    .slice()
    .sort((a, b) => (a[key] - b[key]) * dir || String(a.id).localeCompare(String(b.id)))[0]?.id ?? "";

  const recommendations = {
    fastest: pick("durationMinutes"),
    cheapest: pick("totalCost"), // dinheiro + risco (risco como custo)
    greenest: pick("energyKwh"),
    safest: pick("riskScore"),
    balanced: pick("balancedScore"),
  };

  const ranked = withScores.slice().sort((a, b) => a.balancedScore - b.balancedScore);
  return { recommendations, ranked, excluded };
}

export const __test__ = { minMax };
