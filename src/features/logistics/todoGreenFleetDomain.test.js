import { describe, expect, it } from "vitest";
import {
  FLEET_ENERGY_DEFAULTS,
  atualizacoesDePosicao,
  consolidarEconomiaFrota,
  fleetAlerts,
  fleetVehicleMetrics,
  normalizePlate,
  sugerirStatusVeiculo,
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

describe("economia real da frota por placa", () => {
  const vehicles = [
    { id: "v1", prefix: "TG-001", plate: "ABC-1D23", status: "in-operation", revenueAccumulated: 5000, costAccumulated: 2000 },
    { id: "v2", prefix: "TG-002", plate: "XYZ9K88", status: "available" },
  ];

  it("soma a manutenção por veículo e cruza com o km real das operações por placa", () => {
    const eco = consolidarEconomiaFrota(
      vehicles,
      { v1: { total: 800, abertas: 1, ordens: 3, downtimeHoras: 12 } },
      { ABC1D23: { operacoes: 10, kmTotal: 2000, entregues: 9 } }, // placa normalizada (sem hífen)
    );
    const v1 = eco.find((e) => e.vehicleId === "v1");
    expect(v1.manutencao.total).toBe(800);
    expect(v1.manutencao.abertas).toBe(1);
    expect(v1.operacoes.kmTotal).toBe(2000);
    // 800 / 2000 = 0,40 por km
    expect(v1.manutencaoPorKm).toBe(0.4);
    expect(v1.margemDeclarada).toBe(3000);
  });

  it("sem km de operação, o custo por km é null (não zero)", () => {
    const eco = consolidarEconomiaFrota(vehicles, { v2: { total: 300, abertas: 0, ordens: 1, downtimeHoras: 0 } }, {});
    const v2 = eco.find((e) => e.vehicleId === "v2");
    expect(v2.manutencao.total).toBe(300);
    expect(v2.manutencaoPorKm).toBe(null);
    expect(v2.operacoes.operacoes).toBe(0);
  });

  it("veículo sem manutenção nem operação zera sem quebrar", () => {
    const eco = consolidarEconomiaFrota([{ id: "v3", plate: "" }], {}, {});
    expect(eco[0].manutencao.total).toBe(0);
    expect(eco[0].manutencaoPorKm).toBe(null);
  });

  it("normalizePlate ignora máscara e caixa", () => {
    expect(normalizePlate("abc-1d23")).toBe("ABC1D23");
    expect(normalizePlate("ABC1D23")).toBe("ABC1D23");
  });
});

describe("status operacional sugerido do veículo", () => {
  it("manutenção aberta sugere 'maintenance' e pesa mais que operação", () => {
    const s = sugerirStatusVeiculo({ manutencaoAbertas: 1, operacoesAtivas: 3, statusAtual: "available" });
    expect(s.status).toBe("maintenance");
    expect(s.motivo).toMatch(/manuten/i);
  });

  it("operação em curso sugere 'in-operation'", () => {
    const s = sugerirStatusVeiculo({ manutencaoAbertas: 0, operacoesAtivas: 2, statusAtual: "available" });
    expect(s.status).toBe("in-operation");
  });

  it("sem sinal não sugere nada (respeita o status manual)", () => {
    expect(sugerirStatusVeiculo({ manutencaoAbertas: 0, operacoesAtivas: 0, statusAtual: "reserved" })).toBe(null);
  });

  it("não sugere quando já bate com o status atual", () => {
    expect(sugerirStatusVeiculo({ manutencaoAbertas: 1, operacoesAtivas: 0, statusAtual: "maintenance" })).toBe(null);
  });

  it("a consolidação carrega o status sugerido por veículo", () => {
    const eco = consolidarEconomiaFrota(
      [{ id: "v1", plate: "ABC1D23", status: "available" }],
      { v1: { total: 0, abertas: 1, ordens: 1, downtimeHoras: 0 } },
      { ABC1D23: { operacoes: 1, kmTotal: 100, entregues: 0, ativas: 1 } },
    );
    expect(eco[0].statusSugerido.status).toBe("maintenance");
    expect(eco[0].operacoes.ativas).toBe(1);
  });
});

describe("ponte rastreador → operação", () => {
  const posicoes = { ABC1D23: { latitude: -23.5, longitude: -46.6, recordedAt: "2026-08-28T12:00:00Z" } };

  it("carimba a operação sem posição e a que tem posição mais velha", () => {
    const ups = atualizacoesDePosicao(
      [
        { id: "o1", vehiclePlate: "abc-1d23", lastPositionAt: "" },
        { id: "o2", vehiclePlate: "ABC1D23", lastPositionAt: "2026-08-28T09:00:00Z" },
      ],
      posicoes,
    );
    expect(ups.map((u) => u.operationId).sort()).toEqual(["o1", "o2"]);
    expect(ups[0].latitude).toBe(-23.5);
    expect(ups[0].recordedAt).toBe("2026-08-28T12:00:00Z");
  });

  it("não regride: leitura igual ou mais velha que a atual é ignorada", () => {
    expect(atualizacoesDePosicao([{ id: "o1", vehiclePlate: "ABC1D23", lastPositionAt: "2026-08-28T12:00:00Z" }], posicoes)).toEqual([]);
    expect(atualizacoesDePosicao([{ id: "o1", vehiclePlate: "ABC1D23", lastPositionAt: "2026-08-29T00:00:00Z" }], posicoes)).toEqual([]);
  });

  it("placa sem posição no tracker não gera atualização", () => {
    expect(atualizacoesDePosicao([{ id: "o1", vehiclePlate: "XYZ9K88", lastPositionAt: "" }], posicoes)).toEqual([]);
  });

  it("coordenada não numérica é descartada", () => {
    const ups = atualizacoesDePosicao(
      [{ id: "o1", vehiclePlate: "ABC1D23", lastPositionAt: "" }],
      { ABC1D23: { latitude: null, longitude: "x", recordedAt: "2026-08-28T12:00:00Z" } },
    );
    expect(ups).toEqual([]);
  });
});
