import { describe, it, expect } from "vitest";
import {
  peakShavingSummary,
  energyMixKwh,
  renewableShareBess,
  bestBessChargeWindow,
  bessCycleCount,
  chargingLoss,
} from "./energyBessSolarDomain.js";

describe("energyBessSolarDomain", () => {
  it("peakShavingSummary conta ultrapassagens da rede e o alívio de BESS/solar", () => {
    const janelas = [
      { kwGrid: 80, kwSolar: 20, kwBess: 30 },   // total 130, rede 80 → sem ultrapassagem (teto 100)
      { kwGrid: 120, kwSolar: 0, kwBess: 0 },    // ultrapassagem
      { kwGrid: 90, kwSolar: 10, kwBess: 20 },   // sem ultrapassagem
    ];
    const s = peakShavingSummary(janelas, 100);
    expect(s.janelas).toBe(3);
    expect(s.ultrapassagens).toBe(1);
    expect(s.picoRedeKw).toBe(120);
    expect(s.picoLocalKw).toBe(130);
    expect(s.alivioBessSolarKwh).toBe(80);
    expect(s.excedenteRedeKw).toBe(20);
  });

  it("peakShavingSummary sem teto contratado devolve null nos campos que dependem dele", () => {
    const s = peakShavingSummary([{ kwGrid: 5 }], 0);
    expect(s.demandaContratadaKw).toBeNull();
    expect(s.excedenteRedeKw).toBeNull();
    expect(s.ultrapassagens).toBe(0);
  });

  it("energyMixKwh devolve percentuais nulos quando total é zero (sem medição ≠ 0/0/0)", () => {
    const m = energyMixKwh({});
    expect(m.totalKwh).toBe(0);
    expect(m.renovavelPct).toBeNull();
    expect(m.redePct).toBeNull();
  });

  it("energyMixKwh calcula percentuais e renovavelPct = solar + bess por padrão", () => {
    const m = energyMixKwh({ redeKwh: 50, solarKwh: 30, bessKwh: 20 });
    expect(m.totalKwh).toBe(100);
    expect(m.redePct).toBe(50);
    expect(m.solarPct).toBe(30);
    expect(m.bessPct).toBe(20);
    expect(m.renovavelPct).toBe(50);
  });

  it("renewableShareBess reflete a fração de BESS que veio de energia limpa", () => {
    const m = energyMixKwh({ redeKwh: 40, solarKwh: 30, bessKwh: 30 });
    // BESS 60% limpo → renovável = solar(30) + bess(30)*0.6 = 48 → 48%
    expect(renewableShareBess(m, 60)).toBe(48);
    // BESS 0% limpo → renovável = solar apenas → 30%
    expect(renewableShareBess(m, 0)).toBe(30);
    expect(renewableShareBess({ totalKwh: 0 }, 100)).toBeNull();
  });

  it("bestBessChargeWindow escolhe a tarifa mais barata e devolve intervalo com duração pedida", () => {
    const w = bestBessChargeWindow([
      { horaInicio: 12, tarifaReais: 0.9 },
      { horaInicio: 2, tarifaReais: 0.3 },
      { horaInicio: 18, tarifaReais: 1.2 },
    ], 4);
    expect(w.horaInicio).toBe(2);
    expect(w.horaFim).toBe(6);
    expect(w.tarifaReais).toBe(0.3);
    expect(bestBessChargeWindow([], 2)).toBeNull();
  });

  it("bessCycleCount usa MAX(carga,descarga) e devolve null sem capacidade", () => {
    const c = bessCycleCount(
      [{ kwhCarregado: 100, kwhDescarregado: 90 }, { kwhCarregado: 40, kwhDescarregado: 60 }],
      100,
    );
    // sessão 1: max=100; sessão 2: max=60. Total 160. Ciclos = 1.6
    expect(c).toBe(1.6);
    expect(bessCycleCount([{ kwhCarregado: 10 }], 0)).toBeNull();
  });

  it("chargingLoss devolve perda e eficiência efetiva, null com dado faltando", () => {
    const r = chargingLoss({ entregueTomadaKwh: 40, carregadoBateriaKwh: 36 });
    expect(r.perdaKwh).toBe(4);
    expect(r.eficienciaPct).toBe(90);
    expect(chargingLoss({ entregueTomadaKwh: 10 })).toBeNull();
    // bateria >= tomada (por leitura defasada) devolve 0 de perda em vez de negativo
    expect(chargingLoss({ entregueTomadaKwh: 10, carregadoBateriaKwh: 11 })).toEqual({ perdaKwh: 0, eficienciaPct: 100 });
  });
});
