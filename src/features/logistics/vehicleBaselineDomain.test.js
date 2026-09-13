import { describe, expect, it } from "vitest";
import {
  baselineDoVeiculo,
  consumoDaObservacao,
  energiaDaObservacao,
  veiculoComBaseline,
} from "./vehicleBaselineDomain.js";

const VAN = { batteryCapacityKwh: 80, batterySohPercent: 95, energyConsumptionKwhPerKm: 0.3 };

describe("energia e consumo de uma observação", () => {
  it("prefere kWh medido; senão deriva do delta de SOC × capacidade utilizável (+ recarga no trajeto)", () => {
    expect(energiaDaObservacao({ energyKwh: 31.2 }, VAN)).toEqual({ energyKwh: 31.2, method: "measured_kwh" });
    // 95% SoH → 76 kWh utilizáveis; 90→50% = 40% → 30,4 kWh; + 5 carregados = 35,4
    const derivado = energiaDaObservacao({ socStartPercent: 90, socEndPercent: 50, chargedKwh: 5 }, VAN);
    expect(derivado.method).toBe("soc_delta");
    expect(derivado.energyKwh).toBeCloseTo(35.4, 5);
  });

  it("sem dado suficiente devolve null — nunca zero", () => {
    expect(energiaDaObservacao({ socStartPercent: 90 }, VAN)).toBeNull();
    expect(energiaDaObservacao({ socStartPercent: 50, socEndPercent: 60 }, VAN)).toBeNull();
    expect(consumoDaObservacao({ energyKwh: 30, distanceKm: 0 }, VAN)).toBeNull();
  });

  it("recusa consumo fisicamente absurdo (erro de digitação/telemetria)", () => {
    expect(consumoDaObservacao({ energyKwh: 900, distanceKm: 10 }, VAN)).toBeNull();
    expect(consumoDaObservacao({ energyKwh: 0.1, distanceKm: 100 }, VAN)).toBeNull();
    expect(consumoDaObservacao({ energyKwh: 33, distanceKm: 100 }, VAN).consumptionKwhPerKm).toBeCloseTo(0.33, 5);
  });
});

describe("baseline do veículo (médias móveis, percentis, correção determinística)", () => {
  const obs = (i, kwh, km, tipo = "INFORMED") => ({ observedAt: `2026-09-${String(i).padStart(2, "0")}T08:00:00.000Z`, energyKwh: kwh, distanceKm: km, measurementType: tipo });

  it("com menos que o mínimo de amostras é 'insufficient' e mantém o nominal", () => {
    const b = baselineDoVeiculo([obs(1, 30, 100), obs(2, 32, 100)], VAN);
    expect(b).toMatchObject({ status: "insufficient", samples: 2, minSamples: 3, nominalKwhPerKm: 0.3 });
    expect(veiculoComBaseline(VAN, b)).toMatchObject({ applied: false });
  });

  it("calcula mediana, p90, desvio e fator de correção sobre o nominal", () => {
    const lista = [obs(1, 30, 100), obs(2, 34, 100), obs(3, 33, 100), obs(4, 36, 100), obs(5, 32, 100)];
    const b = baselineDoVeiculo(lista, VAN);
    expect(b.status).toBe("ok");
    expect(b.samples).toBe(5);
    expect(b.p50KwhPerKm).toBeCloseTo(0.33, 5);
    expect(b.consumptionKwhPerKm).toBeCloseTo(0.33, 5);
    expect(b.p90KwhPerKm).toBeGreaterThan(b.p50KwhPerKm);
    expect(b.correctionFactor).toBeCloseTo(1.1, 5);
    expect(b.confidence).toBe("MEDIUM");
    expect(b.measurementType).toBe("INFORMED");
    expect(b.windowTo).toBe("2026-09-05T08:00:00.000Z");
  });

  it("maioria MEDIDA marca o baseline como MEASURED e, com 10+, confiança alta", () => {
    const lista = Array.from({ length: 12 }, (_, i) => obs(i + 1, 30 + (i % 3), 100, i < 8 ? "MEASURED" : "INFORMED"));
    const b = baselineDoVeiculo(lista, VAN);
    expect(b).toMatchObject({ status: "ok", samples: 12, measurementType: "MEASURED", confidence: "HIGH" });
    expect(b.measuredShare).toBeCloseTo(0.67, 2);
    const aplicado = veiculoComBaseline(VAN, b);
    expect(aplicado.applied).toBe(true);
    expect(aplicado.vehicle.consumptionMeasured).toBe(true);
    expect(aplicado.vehicle.consumptionKwhPerKm).toBe(b.consumptionKwhPerKm);
  });

  it("a janela móvel usa só as observações mais recentes e ignora as inválidas", () => {
    const lista = [
      ...Array.from({ length: 5 }, (_, i) => obs(i + 1, 50, 100)), // antigas, mais altas
      ...Array.from({ length: 5 }, (_, i) => obs(i + 10, 30, 100)), // recentes
      { observedAt: "2026-09-20T08:00:00.000Z", energyKwh: 0, distanceKm: 100 }, // inválida (zero)
    ];
    const b = baselineDoVeiculo(lista, VAN, { janela: 5 });
    expect(b.samples).toBe(5);
    expect(b.p50KwhPerKm).toBeCloseTo(0.3, 5);
  });
});
