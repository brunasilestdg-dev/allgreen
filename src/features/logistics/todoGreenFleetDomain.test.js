import { describe, expect, it } from "vitest";
import {
  FLEET_ENERGY_DEFAULTS,
  fleetAlerts,
  fleetVehicleMetrics,
  summarizeFleet,
} from "./todoGreenFleetDomain.js";

describe("custo por km da frota não é mais estruturalmente zero", () => {
  it("projeta o custo por km a partir do consumo físico × tarifa + manutenção", () => {
    // Sem custo acumulado, o antigo cálculo dava 0. Agora deriva do consumo real.
    const m = fleetVehicleMetrics({ energyConsumptionKwhPerKm: 0.5, odometerKm: 0, costAccumulated: 0 });
    const esperado = 0.5 * FLEET_ENERGY_DEFAULTS.energyCostPerKwh + FLEET_ENERGY_DEFAULTS.maintenancePerKm;
    expect(m.projectedCostPerKm).toBeCloseTo(esperado, 6);
    expect(m.costPerKm).toBeCloseTo(esperado, 6);
    expect(m.realizedCostPerKm).toBe(0);
  });

  it("usa a tarifa da régua quando informada", () => {
    const m = fleetVehicleMetrics(
      { energyConsumptionKwhPerKm: 1.2 },
      { energyCostPerKwh: 1.0, maintenancePerKm: 0.5 },
    );
    expect(m.energyCostPerKm).toBeCloseTo(1.2, 6);
    expect(m.projectedCostPerKm).toBeCloseTo(1.7, 6);
  });

  it("prefere o custo realizado quando há custo acumulado sobre o hodômetro", () => {
    const m = fleetVehicleMetrics({ energyConsumptionKwhPerKm: 0.5, odometerKm: 1000, costAccumulated: 3000 });
    expect(m.realizedCostPerKm).toBeCloseTo(3, 6);
    expect(m.costPerKm).toBeCloseTo(3, 6);
  });

  it("dispara o alerta de economia negativa quando o custo projetado supera a receita por km", () => {
    const alerts = fleetAlerts({
      energyConsumptionKwhPerKm: 2, // custo projetado alto
      odometerKm: 1000,
      revenueAccumulated: 500, // receita/km = 0,5
    });
    expect(alerts.some((a) => a.code === "negative-unit-economics")).toBe(true);
  });

  it("summarizeFleet aceita a régua sem quebrar", () => {
    const resumo = summarizeFleet(
      [{ energyConsumptionKwhPerKm: 0.4 }, { energyConsumptionKwhPerKm: 0.6 }],
      { energyCostPerKwh: 0.9, maintenancePerKm: 0.4 },
    );
    expect(resumo.total).toBe(2);
  });
});
