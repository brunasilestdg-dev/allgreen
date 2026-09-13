import { describe, expect, it } from "vitest";
import { estimateRouteEnergy, ENERGY_MODEL_VERSION } from "./energyEstimationDomain.js";

// Veículo elétrico de referência (van): 0,42 kWh/km, bateria 100 kWh.
const van = {
  id: "VAN-082",
  category: "van",
  consumptionKwhPerKm: 0.42,
  batteryCapacityKwh: 100,
  socPercent: 80,
  reservePercent: 15,
  curbWeightKg: 2800,
};

describe("estimateRouteEnergy — contrato e validação", () => {
  it("devolve o resultado estruturado versionado com todas as chaves do snapshot", () => {
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100 } });
    expect(r.status).toBe("ok");
    expect(r.calculationVersion).toBe(ENERGY_MODEL_VERSION);
    expect(r.measurementType).toBe("ESTIMATED");
    expect(r.source).toBe("energy-model");
    for (const key of [
      "distanceKm", "durationMinutes", "elevationGainM", "elevationLossM",
      "estimatedEnergyKwh", "initialSoc", "estimatedArrivalSoc", "minimumSoc",
      "reserveSoc", "chargingRequired", "estimatedConsumptionKwhKm", "confidence",
      "assumptions",
    ]) {
      expect(r).toHaveProperty(key);
    }
  });

  it("recusa (invalid) sem distância, sem consumo ou sem bateria — nunca inventa", () => {
    expect(estimateRouteEnergy({ vehicle: van, route: {} }).reason).toBe("route_distance_required");
    expect(estimateRouteEnergy({ vehicle: { ...van, consumptionKwhPerKm: 0 }, route: { distanceKm: 50 } }).reason).toBe("consumption_required");
    expect(estimateRouteEnergy({ vehicle: { ...van, batteryCapacityKwh: 0 }, route: { distanceKm: 50 } }).reason).toBe("battery_capacity_required");
  });
});

describe("estimateRouteEnergy — energia e SOC", () => {
  it("rota plana: energia = km × consumo e SOC de chegada coerente", () => {
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100 } });
    // 100 km × 0,42 = 42 kWh
    expect(r.estimatedEnergyKwh).toBeCloseTo(42, 1);
    // Início 80% de 100 kWh = 80 kWh; chega com 38 kWh = 38%
    expect(r.estimatedArrivalSoc).toBeCloseTo(38, 0);
    expect(r.minimumSoc).toBe(r.estimatedArrivalSoc);
    expect(r.chargingRequired).toBe(false);
  });

  it("sinaliza necessidade de recarga quando o SOC de chegada cai abaixo da reserva", () => {
    // 170 km × 0,42 = 71,4 kWh; sobra 8,6 kWh = 8,6% < 15%
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 170 } });
    expect(r.estimatedArrivalSoc).toBeLessThan(15);
    expect(r.chargingRequired).toBe(true);
  });

  it("SoH degradado reduz a capacidade utilizável e derruba o SOC de chegada", () => {
    const sadio = estimateRouteEnergy({ vehicle: { ...van, sohPercent: 100 }, route: { distanceKm: 120 } });
    const degradado = estimateRouteEnergy({ vehicle: { ...van, sohPercent: 70 }, route: { distanceKm: 120 } });
    expect(degradado.breakdown.usableCapacityKwh).toBeLessThan(sadio.breakdown.usableCapacityKwh);
    expect(degradado.estimatedArrivalSoc).toBeLessThan(sadio.estimatedArrivalSoc);
  });
});

describe("estimateRouteEnergy — elevação (seção 4)", () => {
  it("subida aumenta a energia; a rubrica de subida é positiva", () => {
    const plana = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 50, elevationGainM: 0, elevationLossM: 0 } });
    const morro = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 50, elevationGainM: 800, elevationLossM: 0 } });
    expect(morro.estimatedEnergyKwh).toBeGreaterThan(plana.estimatedEnergyKwh);
    expect(morro.breakdown.climbEnergyKwh).toBeGreaterThan(0);
  });

  it("descida com regeneração recupera energia (regen desligado não recupera)", () => {
    const comRegen = estimateRouteEnergy({ vehicle: { ...van, regenEnabled: true }, route: { distanceKm: 50, elevationGainM: 0, elevationLossM: 800 } });
    const semRegen = estimateRouteEnergy({ vehicle: { ...van, regenEnabled: false }, route: { distanceKm: 50, elevationGainM: 0, elevationLossM: 800 } });
    expect(comRegen.breakdown.regenRecoveredKwh).toBeGreaterThan(0);
    expect(semRegen.breakdown.regenRecoveredKwh).toBe(0);
    expect(comRegen.estimatedEnergyKwh).toBeLessThan(semRegen.estimatedEnergyKwh);
  });

  it("sem elevação informada NÃO inventa: campos ficam null e registra a premissa", () => {
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 50 } });
    expect(r.elevationGainM).toBeNull();
    expect(r.elevationLossM).toBeNull();
    expect(r.assumptions).toContain("elevacao_nao_informada_perfil_plano_assumido");
  });
});

describe("estimateRouteEnergy — carga, temperatura, trânsito", () => {
  it("carga elevada aumenta o consumo quando há penalidade de carga configurada", () => {
    const vazio = estimateRouteEnergy({ vehicle: { ...van, payloadKg: 0, maxPayloadKg: 1500, loadPenaltyPercent: 20 }, route: { distanceKm: 100 } });
    const cheio = estimateRouteEnergy({ vehicle: { ...van, payloadKg: 1500, maxPayloadKg: 1500, loadPenaltyPercent: 20 }, route: { distanceKm: 100 } });
    expect(cheio.estimatedEnergyKwh).toBeGreaterThan(vazio.estimatedEnergyKwh);
    expect(cheio.breakdown.payloadFactor).toBeCloseTo(1.2, 2);
  });

  it("frio e calor extremos elevam o consumo; faixa de conforto é neutra", () => {
    const conforto = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100, temperatureC: 22 } });
    const frio = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100, temperatureC: 0 } });
    expect(conforto.breakdown.temperatureFactor).toBe(1);
    expect(frio.breakdown.temperatureFactor).toBeGreaterThan(1);
    expect(frio.estimatedEnergyKwh).toBeGreaterThan(conforto.estimatedEnergyKwh);
  });

  it("fator de trânsito multiplica o consumo de rodagem", () => {
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100, trafficFactor: 1.5 } });
    expect(r.breakdown.trafficFactor).toBe(1.5);
    expect(r.estimatedEnergyKwh).toBeGreaterThan(42); // acima da rota plana neutra
  });
});

describe("estimateRouteEnergy — confiança e proveniência", () => {
  it("consumo medido + elevação + temperatura + SoH + duração → HIGH", () => {
    const r = estimateRouteEnergy({
      vehicle: { ...van, consumptionMeasured: true, sohPercent: 92 },
      route: { distanceKm: 100, elevationGainM: 100, elevationLossM: 100, temperatureC: 20, durationMinutes: 130 },
    });
    expect(r.confidence).toBe("HIGH");
  });

  it("poucos dados de apoio → MEDIUM; nunca se apresenta como medição", () => {
    const r = estimateRouteEnergy({ vehicle: van, route: { distanceKm: 100 } });
    expect(["MEDIUM", "LOW"]).toContain(r.confidence);
    expect(r.measurementType).toBe("ESTIMATED");
  });
});
