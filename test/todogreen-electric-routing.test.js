import { describe, expect, it } from "vitest";
import { normalizeConnector, planElectricRoute } from "../worker/services/todogreen-electric-routing.js";

const vehicle = {
  id: "BYD-T3-07",
  model: "BYD T3",
  category: "van",
  batteryCapacityKwh: 45,
  socPercent: 40,
  reservePercent: 15,
  consumptionKwhPer100Km: 22,
  connectors: ["Type 2", "CCS 2"],
  maxAcKw: 7,
  maxDcKw: 50,
};

describe("roteirização elétrica To Do Green", () => {
  it("normaliza conectores usados pelas fontes abertas", () => {
    expect(normalizeConnector("Mennekes")).toBe("TYPE_2");
    expect(normalizeConnector("CCS 2")).toBe("CCS2");
    expect(normalizeConnector("CHAdeMO")).toBe("CHADEMO");
  });

  it("mantém a rota sem recarga quando chega acima da reserva", () => {
    const plan = planElectricRoute({
      vehicle: { ...vehicle, socPercent: 80 },
      route: { distanceKm: 70 },
      chargingStations: [],
    });

    expect(plan.status).toBe("feasible_without_charge");
    expect(plan.chargingStops).toEqual([]);
    expect(plan.estimatedFinalSocPercent).toBeGreaterThanOrEqual(15);
  });

  it("prefere a recarga mais rápida mesmo com desvio maior", () => {
    const plan = planElectricRoute({
      vehicle,
      route: { distanceKm: 120, averageSpeedKmh: 60 },
      chargingStations: [
        {
          id: "ac-perto",
          name: "AC perto",
          distanceFromStartKm: 42,
          detourKm: 1,
          connectors: [{ type: "Type 2", powerKw: 7, status: "available" }],
          operational: true,
          openNow: true,
          reliabilityScore: 1,
        },
        {
          id: "dc-rapido",
          name: "CCS rápido",
          distanceFromStartKm: 45,
          detourKm: 4,
          connectors: [{ type: "CCS2", powerKw: 150, status: "available" }],
          operational: true,
          openNow: true,
          reliabilityScore: 1,
        },
      ],
    });

    expect(plan.status).toBe("feasible_with_charge");
    expect(plan.chargingStops[0].stationId).toBe("dc-rapido");
    expect(plan.chargingStops[0].effectivePowerKw).toBe(50);
    expect(plan.recommendation).toContain("CCS rápido");
  });

  it("descarta carregador incompatível e acesso impróprio para carreta", () => {
    const plan = planElectricRoute({
      vehicle: {
        ...vehicle,
        id: "carreta-01",
        model: "Cavalo elétrico",
        category: "carreta",
        socPercent: 35,
      },
      route: { distanceKm: 100 },
      chargingStations: [
        {
          id: "chademo",
          distanceFromStartKm: 25,
          connectors: [{ type: "CHAdeMO", powerKw: 60 }],
          operational: true,
        },
        {
          id: "sem-manejo",
          distanceFromStartKm: 30,
          connectors: [{ type: "CCS2", powerKw: 100 }],
          operational: true,
          heavyVehicleAccess: false,
        },
      ],
    });

    expect(plan.status).toBe("infeasible");
    expect(plan.reason).toBe("no_feasible_charging_station");
    expect(plan.discarded.no_compatible_connector).toBe(1);
    expect(plan.discarded.no_heavy_vehicle_access).toBe(1);
  });

  it("aumenta o consumo quando o veículo sai carregado", () => {
    const empty = planElectricRoute({
      vehicle: {
        ...vehicle,
        socPercent: 80,
        payloadKg: 0,
        maxPayloadKg: 700,
        loadPenaltyPercent: 20,
      },
      route: { distanceKm: 20 },
    });
    const loaded = planElectricRoute({
      vehicle: {
        ...vehicle,
        socPercent: 80,
        payloadKg: 700,
        maxPayloadKg: 700,
        loadPenaltyPercent: 20,
      },
      route: { distanceKm: 20 },
    });

    expect(loaded.adjustedConsumptionKwhPer100Km).toBeGreaterThan(empty.adjustedConsumptionKwhPer100Km);
    expect(loaded.estimatedRangeKm).toBeLessThan(empty.estimatedRangeKm);
  });
});
