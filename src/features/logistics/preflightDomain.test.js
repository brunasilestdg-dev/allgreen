import { describe, expect, it } from "vitest";
import { runPreflight, SEVERITY } from "./preflightDomain.js";
import { estimateRouteEnergy } from "./energyEstimationDomain.js";

const vanOk = {
  id: "VAN-082", category: "van", available: true, docsOk: true, maintenanceOk: true,
  capacityKg: 1500, capacityM3: 9, palletCapacity: 8,
  consumptionKwhPerKm: 0.42, batteryCapacityKwh: 100, socPercent: 80, reservePercent: 15,
};
const driverOk = { available: true, licenseValid: true, journeyOk: true, trainingOk: true };

describe("pré-flight — severidades e status geral", () => {
  it("tudo certo em rota curta com estimativa bem sustentada → PASS, não bloqueia", () => {
    // Confiança alta exige dados de apoio (medido, SoH, elevação, temperatura,
    // duração) — senão o pré-flight, corretamente, levanta um WARNING.
    const energyEstimate = estimateRouteEnergy({
      vehicle: { ...vanOk, consumptionMeasured: true, sohPercent: 95 },
      route: { distanceKm: 80, elevationGainM: 50, elevationLossM: 50, temperatureC: 22, durationMinutes: 110 },
    });
    expect(energyEstimate.confidence).toBe("HIGH");
    const r = runPreflight({ vehicle: vanOk, driver: driverOk, load: { weightKg: 500 }, route: { distanceKm: 80 }, energyEstimate });
    expect(r.status).toBe(SEVERITY.PASS);
    expect(r.blocked).toBe(false);
  });

  it("motorista indisponível → BLOCK", () => {
    const r = runPreflight({ vehicle: vanOk, driver: { ...driverOk, available: false } });
    expect(r.blocked).toBe(true);
    expect(r.checks.find((c) => c.id === "driver_available").severity).toBe(SEVERITY.BLOCK);
  });

  it("CNH vencida → BLOCK; treinamento pendente → WARNING (não bloqueia sozinho)", () => {
    expect(runPreflight({ vehicle: vanOk, driver: { ...driverOk, licenseValid: false } }).blocked).toBe(true);
    const w = runPreflight({ vehicle: vanOk, driver: { ...driverOk, trainingOk: false } });
    expect(w.status).toBe(SEVERITY.WARNING);
    expect(w.blocked).toBe(false);
  });

  it("carga acima da capacidade → BLOCK", () => {
    const r = runPreflight({ vehicle: vanOk, driver: driverOk, load: { weightKg: 2000 } });
    expect(r.blocked).toBe(true);
    expect(r.checks.find((c) => c.id === "capacity_weight").severity).toBe(SEVERITY.BLOCK);
  });
});

describe("pré-flight — autonomia e sugestões calculadas (seção 20)", () => {
  it("rota longa sem recarga disponível → BLOCK com sugestões", () => {
    const energyEstimate = estimateRouteEnergy({ vehicle: vanOk, route: { distanceKm: 180 } });
    expect(energyEstimate.chargingRequired).toBe(true);
    const r = runPreflight({
      vehicle: vanOk, driver: driverOk, route: { distanceKm: 180 }, energyEstimate,
      charging: { available: false },
      alternatives: {
        chargers: [{ powerKw: 150 }],
        vehicles: [
          { id: "VAN-104", category: "van", consumptionKwhPerKm: 0.35, batteryCapacityKwh: 140, socPercent: 95, reservePercent: 15 },
        ],
      },
    });
    expect(r.blocked).toBe(true);
    const energyCheck = r.checks.find((c) => c.id === "energy");
    expect(energyCheck.severity).toBe(SEVERITY.BLOCK);
    // Sugestão de troca de veículo é CALCULADA pelo modelo de energia.
    const swap = r.suggestions.find((s) => s.type === "swap_vehicle");
    expect(swap.vehicleId).toBe("VAN-104");
    expect(swap.arrivalSoc).toBeGreaterThan(15);
    // Sugestão de recarga tem minutos calculados pelo déficit e pela potência.
    const charge = r.suggestions.find((s) => s.type === "insert_charge");
    expect(charge.minutes).toBeGreaterThan(0);
    expect(charge.chargeKwh).toBeGreaterThan(0);
  });

  it("rota longa COM recarga disponível → WARNING (decisão autorizada)", () => {
    const energyEstimate = estimateRouteEnergy({ vehicle: vanOk, route: { distanceKm: 180 } });
    const r = runPreflight({
      vehicle: vanOk, driver: driverOk, route: { distanceKm: 180 }, energyEstimate,
      charging: { available: true }, alternatives: { chargers: [{ powerKw: 150 }] },
    });
    expect(r.status).toBe(SEVERITY.WARNING);
    expect(r.blocked).toBe(false);
  });

  it("estimativa de baixa confiança vira WARNING de dados insuficientes", () => {
    // Sem elevação/temperatura/SoH/duração e consumo não-medido → confiança baixa.
    const energyEstimate = estimateRouteEnergy({ vehicle: vanOk, route: { distanceKm: 50 } });
    const r = runPreflight({ vehicle: vanOk, driver: driverOk, route: { distanceKm: 50 }, energyEstimate });
    const conf = r.checks.find((c) => c.id === "energy_confidence");
    if (energyEstimate.confidence === "LOW" || energyEstimate.confidence === "UNKNOWN") {
      expect(conf.severity).toBe(SEVERITY.WARNING);
    }
  });
});
