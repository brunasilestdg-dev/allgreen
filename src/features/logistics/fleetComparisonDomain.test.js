import { describe, expect, it } from "vitest";
import { compararDieselEletrico, PREMISSAS_COMPARACAO_PADRAO } from "./fleetComparisonDomain.js";

describe("comparar diesel × elétrico", () => {
  it("põe os dois lado a lado: custo operacional, CO₂ e payback", () => {
    // 5000 km/mês com os padrões.
    // Elétrico: 1500 kWh → energia 1380 + manut 2100 = 3480; CO₂ 57,75 kg.
    // Diesel: 1190,48 l → combustível 7142,86 + manut 3600 = 10742,86; CO₂ 3190,48 kg.
    const r = compararDieselEletrico(
      { kmMes: 5000, valorEletrico: 800000, valorDiesel: 500000 },
    );
    expect(r.disponivel).toBe(true);
    expect(r.eletrico.operacionalMes).toBeCloseTo(3480, 1);
    expect(r.eletrico.co2Mes).toBeCloseTo(57.8, 1);
    expect(r.diesel.operacionalMes).toBeCloseTo(10742.86, 1);
    expect(r.diesel.litrosMes).toBeCloseTo(1190.5, 1);

    expect(r.delta.economiaOperacionalMes).toBeCloseTo(7262.86, 1);
    expect(r.delta.economiaOperacionalAno).toBeCloseTo(87154.29, 0);
    expect(r.delta.co2EvitadoMesKg).toBeCloseTo(3132.7, 1);
    expect(r.delta.co2EvitadoAnoKg).toBeCloseTo(37592.7, 0);

    // Payback: 300.000 de CAPEX extra ÷ 7262,86/mês = 41,3 meses.
    expect(r.delta.capexDelta).toBe(300000);
    expect(r.delta.paybackMeses).toBeCloseTo(41.3, 1);
    expect(r.avisos).toHaveLength(0);
  });

  it("sem km, indisponível com aviso — não inventa comparação", () => {
    const r = compararDieselEletrico({ kmMes: 0 });
    expect(r.disponivel).toBe(false);
    expect(r.avisos.join(" ")).toMatch(/quilometragem/i);
  });

  it("sem os valores de compra, a economia vale mas o payback fica indisponível", () => {
    const r = compararDieselEletrico({ kmMes: 5000 });
    expect(r.delta.economiaOperacionalMes).toBeGreaterThan(0);
    expect(r.delta.paybackDisponivel).toBe(false);
    expect(r.delta.paybackMeses).toBeNull();
    expect(r.avisos.join(" ")).toMatch(/valor de compra/i);
  });

  it("elétrico não custa mais na compra: paga na hora (payback zero)", () => {
    const r = compararDieselEletrico({ kmMes: 5000, valorEletrico: 500000, valorDiesel: 500000 });
    expect(r.delta.capexDelta).toBe(0);
    expect(r.delta.paybackMeses).toBe(0);
  });

  it("premissas ruins que zeram a economia: payback nulo e avisa", () => {
    // Diesel baratíssimo e sem manutenção → elétrico não economiza.
    const r = compararDieselEletrico(
      { kmMes: 5000, valorEletrico: 800000, valorDiesel: 500000 },
      { precoDieselLitro: 0.1, manutencaoDieselPorKm: 0 },
    );
    expect(r.delta.economiaOperacionalMes).toBeLessThanOrEqual(0);
    expect(r.delta.paybackMeses).toBeNull();
    expect(r.avisos.join(" ")).toMatch(/sem economia/i);
  });

  it("usa os padrões quando as premissas não vêm", () => {
    const r = compararDieselEletrico({ kmMes: 1000 });
    expect(r.premissas.precoDieselLitro).toBe(PREMISSAS_COMPARACAO_PADRAO.precoDieselLitro);
    expect(r.premissas.eletricoKwhPorKm).toBe(0.3);
  });
});
