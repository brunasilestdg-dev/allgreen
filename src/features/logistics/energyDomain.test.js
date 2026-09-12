import { describe, expect, it } from "vitest";
import { resumoEnergia } from "./energyDomain.js";

const veiculos = [
  { id: "v1", plate: "AAA1A11", prefix: "V-01", energyType: "electric", odometerKm: 10000, energyConsumptionKwhPerKm: 0.3, emissionFactorKgCo2ePerKwh: 0.0385 },
  { id: "v2", plate: "BBB2B22", prefix: "V-02", energyType: "electric", odometerKm: 5000, energyConsumptionKwhPerKm: 1.2, emissionFactorKgCo2ePerKwh: 0.0385 },
  { id: "v3", plate: "CCC3C33", prefix: "V-03", energyType: "diesel", odometerKm: 8000, energyConsumptionKwhPerKm: 0 },
];
const pontos = [
  { id: "p1", tipoCorrente: "DC", potenciaKw: 150, status: "ativo", latitude: -23.5, longitude: -46.6 },
  { id: "p2", tipoCorrente: "AC", potenciaKw: 22, status: "ativo", latitude: -22.9, longitude: -43.2 },
];

describe("resumo de energia da frota", () => {
  it("agrega kWh estimado, custo e emissões, e a rede de recarga", () => {
    const r = resumoEnergia(veiculos, pontos, { energyCostPerKwh: 1 });
    // v1: 10000×0,3 = 3000; v2: 5000×1,2 = 6000; v3 diesel = 0 → 9000 kWh
    expect(r.disponivel).toBe(true);
    expect(r.energiaKwh).toBe(9000);
    expect(r.custoEstimado).toBe(9000); // tarifa R$1/kWh
    expect(r.frota.total).toBe(3);
    expect(r.frota.eletricos).toBe(2);
    expect(r.rede.pontos).toBe(2);
    expect(r.rede.potenciaTotalKw).toBe(172);
  });

  it("top consumidores em ordem, sem os de consumo zero", () => {
    const r = resumoEnergia(veiculos, pontos, { energyCostPerKwh: 1 });
    expect(r.topConsumidores).toHaveLength(2); // o diesel (0 kWh) fica de fora
    expect(r.topConsumidores[0].placa).toBe("BBB2B22"); // 6000 kWh
    expect(r.topConsumidores[1].placa).toBe("AAA1A11"); // 3000 kWh
  });

  it("usa a tarifa padrão do motor quando não vem no argumento", () => {
    const r = resumoEnergia(veiculos, pontos);
    expect(r.energyCostPerKwh).toBe(0.92);
    expect(r.custoEstimado).toBe(9000 * 0.92);
  });

  it("sem frota: indisponível, sem chutar número", () => {
    const r = resumoEnergia([], pontos);
    expect(r.disponivel).toBe(false);
    expect(r.energiaKwh).toBe(0);
    expect(r.custoEstimado).toBe(0);
    // a rede ainda é contada (existe independente da frota)
    expect(r.rede.pontos).toBe(2);
  });
});
