import { describe, expect, it } from "vitest";
import { rankRouteAlternatives, routeMoneyCost, routeTotalCost, DEFAULT_COST_ASSUMPTIONS } from "./routeAlternativesDomain.js";

// Três rotas: A rápida mas arriscada, B equilibrada, C longa mas segura/econômica.
const rotas = [
  { id: "A", distanceKm: 100, durationMinutes: 90, energyKwh: 42, tollCost: 30, riskScore: 80, restrictionsOk: true },
  { id: "B", distanceKm: 110, durationMinutes: 100, energyKwh: 44, tollCost: 20, riskScore: 40, restrictionsOk: true },
  { id: "C", distanceKm: 130, durationMinutes: 130, energyKwh: 40, tollCost: 0, riskScore: 10, restrictionsOk: true },
];

describe("custo com risco embutido (risco como custo)", () => {
  it("moneyCost é puro (não muda com o risco); totalCost sobe com o risco", () => {
    const base = { distanceKm: 100, durationMinutes: 90, energyKwh: 42, tollCost: 0 };
    expect(routeMoneyCost({ ...base, riskScore: 10 })).toBe(routeMoneyCost({ ...base, riskScore: 80 }));
    const seguro = routeTotalCost({ ...base, riskScore: 10 });
    const arriscado = routeTotalCost({ ...base, riskScore: 80 });
    expect(arriscado - seguro).toBeCloseTo(70 * DEFAULT_COST_ASSUMPTIONS.riskCostPerPoint, 5);
  });
});

describe("recomendações por objetivo", () => {
  it("mais rápida = A; menor consumo = C; menor risco = C", () => {
    const r = rankRouteAlternatives(rotas);
    expect(r.recommendations.fastest).toBe("A");
    expect(r.recommendations.greenest).toBe("C");
    expect(r.recommendations.safest).toBe("C");
  });

  it("risco NÃO bloqueia: a rota arriscada A continua disponível e listada", () => {
    const r = rankRouteAlternatives(rotas);
    expect(r.ranked.some((x) => x.id === "A")).toBe(true);
    expect(r.excluded).toHaveLength(0);
  });

  it("menor custo considera o risco: A (rápida/barata mas risco 80) não é a mais barata quando o risco entra", () => {
    const r = rankRouteAlternatives(rotas);
    // totalCost inclui risco → A deixa de ser a de menor custo total.
    expect(r.recommendations.cheapest).not.toBe("A");
  });

  it("com pesos padrão, a equilibrada é decidida por todas as dimensões (transparente)", () => {
    const r = rankRouteAlternatives(rotas);
    // A domina tempo+custo puro+energia; risco (peso 0,3) não a supera sozinho.
    expect(r.recommendations.balanced).toBe("A");
    // O ranking é exposto para o operador comparar.
    expect(r.ranked.map((x) => x.id)).toHaveLength(3);
  });
});

describe("restrições excluem da recomendação (mas listam o motivo)", () => {
  it("rota incompatível não é recomendada, fica em excluded com motivo", () => {
    const comIncompativel = [
      { ...rotas[0], id: "curta", distanceKm: 80, restrictionsOk: false, restrictionReasons: ["height_exceeded"] },
      ...rotas,
    ];
    const r = rankRouteAlternatives(comIncompativel);
    expect(r.excluded.map((x) => x.id)).toContain("curta");
    expect(Object.values(r.recommendations)).not.toContain("curta");
    expect(r.excluded[0].restrictionReasons).toContain("height_exceeded");
  });

  it("nenhuma rota viável → recomendações vazias com motivo", () => {
    const r = rankRouteAlternatives([{ id: "x", restrictionsOk: false }]);
    expect(r.recommendations).toEqual({});
    expect(r.reason).toBe("no_feasible_route");
  });

  it("lista vazia é tratada", () => {
    expect(rankRouteAlternatives([]).ranked).toEqual([]);
  });
});

describe("pesos configuráveis", () => {
  it("zerar o peso do risco muda a escolha equilibrada", () => {
    const comRisco = rankRouteAlternatives(rotas, { weights: { risk: 0.7, time: 0.1, cost: 0.1, energy: 0.1 } });
    const semRisco = rankRouteAlternatives(rotas, { weights: { risk: 0, time: 0.5, cost: 0.3, energy: 0.2 } });
    expect(comRisco.recommendations.balanced).toBe("C"); // risco domina → a mais segura
    expect(semRisco.recommendations.balanced).toBe("A"); // sem risco → a mais rápida/curta
  });
});
