import { describe, expect, it } from "vitest";
import { calcularScoreMotorista, faixaDoScore, PESOS_SCORE } from "./driverScoreDomain.js";

const entrega = (over = {}) => ({
  entregueEm: "2026-09-11T12:00:00Z",
  prometidoEm: "2026-09-11T14:00:00Z",
  comprovanteRegistrado: true,
  ocorrencias: 0,
  ...over,
});

describe("score do motorista", () => {
  it("sem entregas concluídas, o score é indisponível — não finge zero", () => {
    const r = calcularScoreMotorista([{ entregueEm: "" }, {}]);
    expect(r.disponivel).toBe(false);
    expect(r.nota).toBeNull();
    expect(r.aviso).toMatch(/sem entregas/i);
  });

  it("tudo no prazo, com POD e sem ocorrência → 100 (excelente)", () => {
    const r = calcularScoreMotorista([entrega(), entrega()]);
    expect(r.disponivel).toBe(true);
    expect(r.nota).toBe(100);
    expect(r.faixa).toBe("excelente");
    expect(r.componentes).toHaveLength(3);
  });

  it("entrega atrasada derruba a pontualidade", () => {
    // 1 no prazo, 1 atrasada → pontualidade 50; POD 100; ocorrências 100.
    // 0,4×50 + 0,3×100 + 0,3×100 = 80.
    const r = calcularScoreMotorista([
      entrega(),
      entrega({ entregueEm: "2026-09-11T16:00:00Z" }), // depois do prometido
    ]);
    expect(r.componentes.find((c) => c.chave === "pontualidade").valor).toBe(50);
    expect(r.nota).toBe(80);
    expect(r.faixa).toBe("bom");
  });

  it("entrega sem POD derruba o componente de comprovante", () => {
    const r = calcularScoreMotorista([entrega(), entrega({ comprovanteRegistrado: false })]);
    expect(r.componentes.find((c) => c.chave === "pod").valor).toBe(50);
  });

  it("ocorrências penalizam proporcionalmente, sem passar de zero", () => {
    // 2 entregas, 3 ocorrências → 100 - (3/2)*100 = -50 → clampa em 0.
    const r = calcularScoreMotorista([entrega({ ocorrencias: 2 }), entrega({ ocorrencias: 1 })]);
    expect(r.componentes.find((c) => c.chave === "ocorrencias").valor).toBe(0);
  });

  it("sem prazo prometido, a pontualidade sai da conta e os pesos renormalizam", () => {
    // Sem prometidoEm: só POD (0,3) e ocorrências (0,3) → renormaliza para 50/50.
    // POD 100, ocorrências 100 → nota 100, mas com 2 componentes só.
    const r = calcularScoreMotorista([
      entrega({ prometidoEm: "" }),
      entrega({ prometidoEm: "" }),
    ]);
    expect(r.componentes.map((c) => c.chave).sort()).toEqual(["ocorrencias", "pod"]);
    expect(r.componentes.every((c) => c.pesoEfetivo === 50)).toBe(true);
    expect(r.nota).toBe(100);
  });

  it("as faixas batem nos limites", () => {
    expect(faixaDoScore(85)).toBe("excelente");
    expect(faixaDoScore(70)).toBe("bom");
    expect(faixaDoScore(50)).toBe("atencao");
    expect(faixaDoScore(49)).toBe("critico");
  });

  it("os pesos padrão somam 1", () => {
    const soma = PESOS_SCORE.pontualidade + PESOS_SCORE.pod + PESOS_SCORE.ocorrencias;
    expect(soma).toBeCloseTo(1, 5);
  });
});
