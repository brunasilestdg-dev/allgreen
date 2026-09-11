import { describe, expect, it } from "vitest";
import {
  dimensionarFrota,
  kmPorVeiculoDia,
  PREMISSAS_DIMENSIONAMENTO_PADRAO,
} from "./fleetSizingDomain.js";

describe("km por veículo por dia (autonomia + janela de recarga)", () => {
  it("um ciclo cabe na janela, com uma recarga para o resto do dia", () => {
    // 200 km úteis, 40 km/h, recarga 1h30, janela 10h.
    // leg0: 200 km em 5h. recarga 1h30 (t=6,5h). resta 3,5h → 140 km. Total 340.
    const r = kmPorVeiculoDia({
      autonomiaUtilKm: 200, velocidadeMediaKmh: 40, tempoRecargaHoras: 1.5, janelaOperacaoHoras: 10,
    });
    expect(r.km).toBeCloseTo(340, 5);
    expect(r.recargas).toBe(1);
    expect(r.horasRecarga).toBeCloseTo(1.5, 5);
    expect(r.horasDirigindo).toBeCloseTo(8.5, 5);
  });

  it("sem precisar recarregar: a demanda cabe numa carga dentro da janela", () => {
    // 500 km úteis, 60 km/h, janela 6h → dirige no máximo 360 km (6h), 0 recargas.
    const r = kmPorVeiculoDia({
      autonomiaUtilKm: 500, velocidadeMediaKmh: 60, tempoRecargaHoras: 1.5, janelaOperacaoHoras: 6,
    });
    expect(r.km).toBeCloseTo(360, 5);
    expect(r.recargas).toBe(0);
  });

  it("dado ausente ou absurdo devolve zero, não NaN", () => {
    expect(kmPorVeiculoDia({ autonomiaUtilKm: 0, velocidadeMediaKmh: 40, janelaOperacaoHoras: 10 }).km).toBe(0);
    expect(kmPorVeiculoDia({ autonomiaUtilKm: 200, velocidadeMediaKmh: 40, janelaOperacaoHoras: 0 }).km).toBe(0);
  });
});

describe("dimensionar a frota elétrica", () => {
  it("divide a demanda pelo km/veículo/dia e soma a reserva", () => {
    // autonomia 200, folga 0% (para bater o exemplo): útil 200 → 340 km/veículo/dia.
    // 1000 km/dia ÷ 340 = 2,94 → 3 veículos; reserva 10% → ceil(3,3)=4.
    const r = dimensionarFrota(
      { kmPorDia: 1000 },
      { autonomiaKm: 200 },
      { folgaAutonomiaPercent: 0 },
    );
    expect(r.disponivel).toBe(true);
    expect(r.resumo.kmPorVeiculoDia).toBeCloseTo(340, 1);
    expect(r.resumo.veiculosPorDemanda).toBe(3);
    expect(r.resumo.veiculosReserva).toBe(1);
    expect(r.resumo.veiculosTotal).toBe(4);
    expect(r.resumo.gargalo).toBe("autonomia");
    expect(r.avisos).toHaveLength(0);
  });

  it("aplica a folga de bateria sobre a autonomia (não descarrega a 0%)", () => {
    const r = dimensionarFrota({ kmPorDia: 300 }, { autonomiaKm: 200 }, { folgaAutonomiaPercent: 15 });
    expect(r.resumo.autonomiaUtilKm).toBeCloseTo(170, 5);
  });

  it("quando um veículo cobre a demanda sem recarregar, o gargalo é a demanda", () => {
    // Autonomia 400 (útil 400), 40 km/h, janela 10h → 400 km sem recarga.
    // Demanda 300 km/dia → 1 veículo, gargalo demanda.
    const r = dimensionarFrota(
      { kmPorDia: 300 },
      { autonomiaKm: 400 },
      { folgaAutonomiaPercent: 0, velocidadeMediaKmh: 40, janelaOperacaoHoras: 10 },
    );
    expect(r.resumo.recargasPorVeiculoDia).toBe(0);
    expect(r.resumo.gargalo).toBe("demanda");
    expect(r.resumo.veiculosPorDemanda).toBe(1);
  });

  it("sem autonomia ou sem demanda: indisponível com aviso, nunca chuta número", () => {
    const semAutonomia = dimensionarFrota({ kmPorDia: 1000 }, { autonomiaKm: 0 });
    expect(semAutonomia.disponivel).toBe(false);
    expect(semAutonomia.resumo.veiculosTotal).toBeNull();
    expect(semAutonomia.avisos.join(" ")).toMatch(/autonomia/i);

    const semDemanda = dimensionarFrota({ kmPorDia: 0 }, { autonomiaKm: 200 });
    expect(semDemanda.disponivel).toBe(false);
    expect(semDemanda.avisos.join(" ")).toMatch(/quilometragem/i);
  });

  it("usa as premissas padrão quando não vêm no argumento", () => {
    const r = dimensionarFrota({ kmPorDia: 500 }, { autonomiaKm: 250 });
    expect(r.premissas.tempoRecargaHoras).toBe(PREMISSAS_DIMENSIONAMENTO_PADRAO.tempoRecargaHoras);
    expect(r.premissas.velocidadeMediaKmh).toBe(40);
  });
});
