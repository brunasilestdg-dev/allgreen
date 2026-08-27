import { describe, expect, it } from "vitest";
import {
  fatiasDaRosca,
  maiorValor,
  pontosDaLinha,
  serieDoIndicador,
} from "./dashboardChartsDomain.js";

const dados = {
  financial: [
    { tipo: "revenue", valor: 1000, mesReferencia: "2026-06", clientId: "c1" },
    { tipo: "revenue", valor: 500, mesReferencia: "2026-06", clientId: "c2" },
    { tipo: "revenue", valor: 2000, mesReferencia: "2026-07", clientId: "c1" },
    { tipo: "cost", valor: 800, mesReferencia: "2026-06" },
    { tipo: "cost", valor: 1200, mesReferencia: "2026-07" },
    { tipo: "revenue", valor: 999, mesReferencia: "" }, // mês inválido: ignorado
  ],
  opportunities: [
    { estagio: "Mapeamento" }, { estagio: "Mapeamento" }, { estagio: "Proposta" }, { estagio: "Fechamento" },
  ],
  proposals: [
    { situacao: "draft" }, { situacao: "sent" }, { situacao: "sent" },
  ],
  operations: [
    { mesReferencia: "2026-06", entregas: 10 }, { mesReferencia: "2026-07", entregas: 25 },
  ],
};

describe("série do indicador", () => {
  it("receita vira série mensal somada, sem o mês inválido", () => {
    const r = serieDoIndicador("receita", dados, 3500);
    expect(r.unidade).toBe("R$");
    expect(r.serie).toEqual([
      { rotulo: "jun", chave: "2026-06", valor: 1500 },
      { rotulo: "jul", chave: "2026-07", valor: 2000 },
    ]);
    // Sem distribuição própria, a rosca reaproveita a série (qualquer tipo funciona).
    expect(r.distribuicao).toEqual(r.serie);
  });

  it("margem é receita menos custo, mês a mês", () => {
    const r = serieDoIndicador("margem", dados);
    expect(r.serie).toEqual([
      { rotulo: "jun", chave: "2026-06", valor: 700 },
      { rotulo: "jul", chave: "2026-07", valor: 800 },
    ]);
  });

  it("pipeline vira distribuição por estágio, da maior fatia para a menor", () => {
    const r = serieDoIndicador("pipeline", dados);
    expect(r.distribuicao[0]).toEqual({ rotulo: "Mapeamento", valor: 2 });
    expect(r.distribuicao.map((d) => d.rotulo)).toContain("Fechamento");
  });

  it("indicador sem série natural não quebra: devolve valor e listas vazias", () => {
    const r = serieDoIndicador("green-score", dados, 82);
    expect(r.valor).toBe(82);
    expect(r.serie).toEqual([]);
    expect(r.distribuicao).toEqual([]);
  });

  it("clientes distintos por mês", () => {
    const r = serieDoIndicador("clientes", dados, 2);
    expect(r.serie).toEqual([
      { rotulo: "jun", chave: "2026-06", valor: 2 },
      { rotulo: "jul", chave: "2026-07", valor: 1 },
    ]);
  });
});

describe("geometria dos gráficos", () => {
  it("maiorValor nunca é zero (barra não divide por zero)", () => {
    expect(maiorValor([])).toBe(1);
    expect(maiorValor([{ valor: 5 }, { valor: 12 }])).toBe(12);
  });

  it("pontos da linha mapeiam a série para 0..100, y invertido", () => {
    const pts = pontosDaLinha([{ valor: 0 }, { valor: 100 }]);
    expect(pts[0]).toMatchObject({ x: 0, y: 100 });
    expect(pts[1]).toMatchObject({ x: 100, y: 0 });
  });

  it("série vazia não gera pontos", () => {
    expect(pontosDaLinha([])).toEqual([]);
  });

  it("fatias da rosca acumulam até 100%", () => {
    const fatias = fatiasDaRosca([{ rotulo: "A", valor: 3 }, { rotulo: "B", valor: 1 }]);
    expect(fatias[0]).toMatchObject({ rotulo: "A", percentual: 75, inicio: 0, fim: 75 });
    expect(fatias[1]).toMatchObject({ rotulo: "B", percentual: 25, inicio: 75, fim: 100 });
  });

  it("distribuição toda zero não gera fatias", () => {
    expect(fatiasDaRosca([{ rotulo: "A", valor: 0 }])).toEqual([]);
  });
});
