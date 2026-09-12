import { describe, expect, it } from "vitest";
import {
  INTERVALO_REVISAO_PADRAO_KM,
  faixaPrevisao,
  kmAteRevisao,
  preverManutencao,
  resumoManutencaoPreditiva,
  taxaKmPorDia,
} from "./predictiveMaintenanceDomain.js";

describe("taxa de km por dia", () => {
  it("deriva o ritmo do span das operações", () => {
    // 300 km em 3 dias (10 a 13) → 100 km/dia.
    const t = taxaKmPorDia([
      { distanciaKm: 100, dataServico: "2026-09-10" },
      { distanciaKm: 200, dataServico: "2026-09-13" },
    ]);
    expect(t).toBe(100);
  });

  it("sem span (um dia só) ou sem km, não estima ritmo", () => {
    expect(taxaKmPorDia([{ distanciaKm: 100, dataServico: "2026-09-10" }])).toBeNull();
    expect(taxaKmPorDia([
      { distanciaKm: 50, dataServico: "2026-09-10" },
      { distanciaKm: 50, dataServico: "2026-09-10" },
    ])).toBeNull();
    expect(taxaKmPorDia([
      { distanciaKm: 0, dataServico: "2026-09-10" },
      { distanciaKm: 0, dataServico: "2026-09-13" },
    ])).toBeNull();
  });
});

describe("km até a revisão", () => {
  it("resto para o próximo marco de km", () => {
    expect(kmAteRevisao(8500)).toBe(1500); // 10000 − 8500
    expect(kmAteRevisao(23000)).toBe(7000); // 10000 − 3000
  });

  it("no marco exato, falta um intervalo inteiro; sem hodômetro, indisponível", () => {
    expect(kmAteRevisao(20000)).toBe(INTERVALO_REVISAO_PADRAO_KM);
    expect(kmAteRevisao(0)).toBeNull();
  });
});

describe("faixa da previsão", () => {
  it("classifica pelo prazo em dias", () => {
    expect(faixaPrevisao(null)).toBe("sem-ritmo");
    expect(faixaPrevisao(5)).toBe("critico");
    expect(faixaPrevisao(20)).toBe("atencao");
    expect(faixaPrevisao(60)).toBe("ok");
  });
});

describe("previsão de manutenção", () => {
  it("sem hodômetro, indisponível", () => {
    const p = preverManutencao({ odometerKm: 0, kmPorDia: 100 });
    expect(p.disponivel).toBe(false);
    expect(p.motivo).toMatch(/hodômetro/i);
  });

  it("prevê a data pelo ritmo de km", () => {
    // odo 9500 → faltam 500 km; 100 km/dia → 5 dias → crítico.
    const p = preverManutencao({ odometerKm: 9500, kmPorDia: 100, hoje: "2026-09-10" });
    expect(p.kmAteRevisao).toBe(500);
    expect(p.diasAteRevisaoPorKm).toBe(5);
    expect(p.dataPrevistaPorKm).toBe("2026-09-15");
    expect(p.faixa).toBe("critico");
    expect(p.origemEfetiva).toBe("km");
  });

  it("sem ritmo, informa o km mas não a data", () => {
    const p = preverManutencao({ odometerKm: 9500, kmPorDia: null, hoje: "2026-09-10" });
    expect(p.disponivel).toBe(true);
    expect(p.kmAteRevisao).toBe(500);
    expect(p.diasAteRevisaoPorKm).toBeNull();
    expect(p.faixa).toBe("sem-ritmo");
    expect(p.mensagem).toMatch(/500 km/);
  });

  it("a data agendada mais próxima vence a prevista por km", () => {
    // km previsto em 15 dias, mas agenda em 3 → vale a agenda.
    const p = preverManutencao({
      odometerKm: 8500, kmPorDia: 100, // 1500 km / 100 = 15 dias
      nextMaintenanceAt: "2026-09-13", hoje: "2026-09-10",
    });
    expect(p.origemEfetiva).toBe("agenda");
    expect(p.diasAteEfetiva).toBe(3);
    expect(p.faixa).toBe("critico");
  });

  it("agenda no passado conta como vencida (0 dias)", () => {
    const p = preverManutencao({
      odometerKm: 5000, kmPorDia: 50,
      nextMaintenanceAt: "2026-09-01", hoje: "2026-09-10",
    });
    expect(p.diasAteEfetiva).toBe(0);
    expect(p.mensagem).toMatch(/hoje ou já vencida/i);
  });
});

describe("resumo da frota", () => {
  it("lista os que pedem atenção, do mais urgente ao menos", () => {
    const veiculos = [
      { id: "v1", prefix: "A1", plate: "AAA1A11", odometerKm: 9800, nextMaintenanceAt: "" }, // 200km
      { id: "v2", prefix: "B2", plate: "BBB2B22", odometerKm: 5000, nextMaintenanceAt: "" }, // 5000km
      { id: "v3", prefix: "C3", plate: "CCC3C33", odometerKm: 0, nextMaintenanceAt: "" }, // indisponível
    ];
    const taxas = { v1: 100, v2: 100 }; // v1: 2 dias (crítico); v2: 50 dias (ok)
    const r = resumoManutencaoPreditiva(veiculos, taxas, { hoje: "2026-09-10" });
    expect(r.total).toBe(3);
    expect(r.comPrevisao).toBe(2); // v3 sem hodômetro
    expect(r.criticos).toBe(1);
    expect(r.atencao[0].id).toBe("v1"); // o mais urgente primeiro
  });
});
