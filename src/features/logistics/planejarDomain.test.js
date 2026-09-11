import { describe, expect, it } from "vitest";
import {
  planejarCenario,
  estimarCarregadores,
  porteReferencia,
  PORTES_REFERENCIA,
  DIAS_UTEIS_MES_PADRAO,
} from "./planejarDomain.js";

describe("porte de referência", () => {
  it("resolve por id e cai no primeiro quando desconhecido", () => {
    expect(porteReferencia("pesado").id).toBe("pesado");
    expect(porteReferencia("inexistente").id).toBe(PORTES_REFERENCIA[0].id);
  });
});

describe("estimativa de carregadores (derivada dos ciclos)", () => {
  it("noturno é um ponto por veículo; diurno vem das recargas dentro da janela", () => {
    // 4 veículos totais, 3 por demanda, 1 recarga/dia de 1h30, janela 10h.
    // Noturno: 4. Diurno: 3×1×1,5 = 4,5 h ÷ 10 = ceil(0,45) = 1. Máximo = 4.
    const r = estimarCarregadores({
      veiculosTotal: 4, veiculosPorDemanda: 3, recargasPorVeiculoDia: 1,
      tempoRecargaHoras: 1.5, janelaOperacaoHoras: 10,
    });
    expect(r.pontosNoturnos).toBe(4);
    expect(r.pontosDiurnos).toBe(1);
    expect(r.carregadores).toBe(4);
  });

  it("recarga de oportunidade intensa faz o diurno dominar", () => {
    // 10 por demanda, 3 recargas/dia de 1h30 = 45 h ÷ 8 = ceil(5,6) = 6 pontos.
    const r = estimarCarregadores({
      veiculosTotal: 10, veiculosPorDemanda: 10, recargasPorVeiculoDia: 3,
      tempoRecargaHoras: 1.5, janelaOperacaoHoras: 8,
    });
    expect(r.pontosDiurnos).toBe(6);
    expect(r.carregadores).toBe(10); // noturno ainda manda aqui
  });

  it("dado ausente não vira NaN", () => {
    const r = estimarCarregadores({});
    expect(r.carregadores).toBe(0);
    expect(Number.isFinite(r.recargaHorasDia)).toBe(true);
  });
});

describe("planejar cenário (orquestra frota + comparação + carregadores)", () => {
  it("monta a jornada completa a partir de km/dia e porte", () => {
    const r = planejarCenario({
      kmPorDia: 1000,
      porte: "medio",
      valorEletrico: 500000,
      valorDiesel: 280000,
    }, { dimensionamento: { folgaAutonomiaPercent: 0 } });

    expect(r.disponivel).toBe(true);
    expect(r.demanda.kmPorDia).toBe(1000);
    expect(r.demanda.kmMes).toBe(1000 * DIAS_UTEIS_MES_PADRAO);
    expect(r.veiculo.porte).toBe("medio");
    expect(r.veiculo.autonomiaKm).toBe(200); // referência do porte médio
    expect(r.veiculo.referencia).toBe(true);
    expect(r.frota.disponivel).toBe(true);
    expect(r.frota.resumo.veiculosTotal).toBeGreaterThan(0);
    expect(r.carregadores.carregadores).toBeGreaterThan(0);
    expect(r.comparacao.delta.paybackMeses).not.toBeNull();
  });

  it("deriva km/dia de entregas × km por entrega e calcula custo por entrega", () => {
    const r = planejarCenario({
      entregasPorDia: 50,
      kmPorEntrega: 12,
      porte: "leve",
    });
    expect(r.demanda.kmPorDia).toBe(600); // 50 × 12
    expect(r.demanda.entregasPorDia).toBe(50);
    expect(r.custoPorEntrega).not.toBeNull();
    // Elétrico deve custar menos por entrega que diesel nas premissas padrão.
    expect(r.custoPorEntrega.eletrico).toBeLessThan(r.custoPorEntrega.diesel);
    expect(r.custoPorEntrega.economia).toBeCloseTo(
      r.custoPorEntrega.diesel - r.custoPorEntrega.eletrico, 2,
    );
  });

  it("payback é null sem preço de compra — nunca zero inventado", () => {
    const r = planejarCenario({ kmPorDia: 800, porte: "medio" });
    expect(r.comparacao.delta.paybackMeses).toBeNull();
    expect(r.comparacao.disponivel).toBe(true); // economia operacional ainda vale
  });

  it("sem demanda: indisponível, com aviso, sem chutar frota", () => {
    const r = planejarCenario({ porte: "pesado" });
    expect(r.disponivel).toBe(false);
    expect(r.carregadores).toBeNull();
    expect(r.custoPorEntrega).toBeNull();
    expect(r.avisos.join(" ")).toMatch(/quilometragem/i);
  });

  it("autonomia informada substitui a referência e marca referencia=false", () => {
    const r = planejarCenario({ kmPorDia: 500, porte: "leve", autonomiaKm: 320 });
    expect(r.veiculo.autonomiaKm).toBe(320);
    expect(r.veiculo.referencia).toBe(false);
  });
});
