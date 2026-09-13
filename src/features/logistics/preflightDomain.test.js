import { describe, expect, it } from "vitest";
import { decisaoDoPreflight, routeFingerprint, runPreflight, SEVERITY } from "./preflightDomain.js";
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

describe("pré-flight — alertas honestos (cadastro incompleto)", () => {
  it("sem veículo da frota → WARNING vehicle_unknown (nunca PASS por omissão)", () => {
    const r = runPreflight({ vehicle: { unknown: true }, driver: driverOk });
    expect(r.status).toBe(SEVERITY.WARNING);
    expect(r.checks.find((c) => c.id === "vehicle_unknown").severity).toBe(SEVERITY.WARNING);
  });

  it("CNH sem validade cadastrada → WARNING; motivo próprio de indisponibilidade aparece na checagem", () => {
    const w = runPreflight({ vehicle: vanOk, driver: { ...driverOk, licenseValid: undefined, licenseUnknown: true } });
    expect(w.checks.find((c) => c.id === "driver_license_unknown").severity).toBe(SEVERITY.WARNING);
    const b = runPreflight({ vehicle: vanOk, driver: { available: false, unavailableReason: "Motorista João está \"allocated\"." } });
    expect(b.checks.find((c) => c.id === "driver_available").reason).toMatch(/allocated/);
    const v = runPreflight({ vehicle: { ...vanOk, available: false, unavailableReason: "Veículo em manutenção." }, driver: driverOk });
    expect(v.checks.find((c) => c.id === "vehicle_available").reason).toBe("Veículo em manutenção.");
  });

  it("estimativa de energia que não pôde ser feita → WARNING energy_unknown com o motivo", () => {
    const r = runPreflight({ vehicle: { ...vanOk, batteryCapacityKwh: 0 }, driver: driverOk, energyEstimate: estimateRouteEnergy({ vehicle: { ...vanOk, batteryCapacityKwh: 0 }, route: { distanceKm: 50 } }) });
    const e = r.checks.find((c) => c.id === "energy_unknown");
    expect(e.severity).toBe(SEVERITY.WARNING);
    expect(e.reason).toMatch(/capacidade de bateria/);
    // Sem veículo, a energia já está coberta pelo vehicle_unknown: não duplica.
    const semVeiculo = runPreflight({ vehicle: { unknown: true }, driver: driverOk, energyEstimate: { status: "invalid", reason: "consumption_required" } });
    expect(semVeiculo.checks.some((c) => c.id === "energy_unknown")).toBe(false);
  });
});

describe("assinatura da rota e decisão de publicação", () => {
  const stops = [
    { rotulo: "CD Osasco", lat: -23.53291, lng: -46.79184 },
    { rotulo: "Loja Centro", lat: -23.55052, lng: -46.63331 },
  ];

  it("é determinística, tolera ruído abaixo de ~11 m e muda com parada, ordem, motorista ou veículo", () => {
    const base = routeFingerprint({ stops, driverId: "drv-1", vehicleKey: "abc1d23" });
    expect(base).toBe(routeFingerprint({ stops, driverId: "drv-1", vehicleKey: "ABC1D23" }));
    expect(base).toBe(routeFingerprint({ stops: [{ ...stops[0], lat: -23.532912 }, stops[1]], driverId: "drv-1", vehicleKey: "ABC1D23" }));
    expect(base).not.toBe(routeFingerprint({ stops: [stops[1], stops[0]], driverId: "drv-1", vehicleKey: "ABC1D23" }));
    expect(base).not.toBe(routeFingerprint({ stops, driverId: "drv-2", vehicleKey: "ABC1D23" }));
    expect(base).not.toBe(routeFingerprint({ stops, driverId: "drv-1", vehicleKey: "" }));
    expect(base).not.toBe(routeFingerprint({ stops: [stops[0], { ...stops[1], lat: -23.56 }], driverId: "drv-1", vehicleKey: "ABC1D23" }));
    expect(base).toMatch(/^pf1-[0-9a-f]{16}-4$/);
  });

  it("sem coordenada vale o rótulo normalizado", () => {
    const a = routeFingerprint({ stops: [{ rotulo: " CD  Osasco " }, { rotulo: "Loja" }], driverId: "d" });
    const b = routeFingerprint({ stops: [{ rotulo: "cd osasco" }, { rotulo: "loja" }], driverId: "d" });
    expect(a).toBe(b);
  });

  it("BLOCK nunca publica; WARNING só com justificativa; PASS publica; sem resultado, não", () => {
    expect(decisaoDoPreflight(null).podeSalvar).toBe(false);
    expect(decisaoDoPreflight({ status: SEVERITY.BLOCK }, { justificativa: "tentando mesmo assim" })).toMatchObject({ podeSalvar: false, precisaJustificativa: false });
    expect(decisaoDoPreflight({ status: SEVERITY.WARNING })).toMatchObject({ podeSalvar: false, precisaJustificativa: true });
    expect(decisaoDoPreflight({ status: SEVERITY.WARNING }, { justificativa: "curta" }).podeSalvar).toBe(false);
    expect(decisaoDoPreflight({ status: SEVERITY.WARNING }, { justificativa: "Veículo definido no pátio; rota curta." })).toMatchObject({ podeSalvar: true, precisaJustificativa: true });
    expect(decisaoDoPreflight({ status: SEVERITY.PASS })).toMatchObject({ podeSalvar: true, precisaJustificativa: false });
  });
});
