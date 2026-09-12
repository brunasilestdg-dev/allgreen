import { describe, expect, it } from "vitest";
import {
  calcularScoreMotorista,
  compararScoreMotorista,
  faixaDoScore,
  PESOS_SCORE,
} from "./driverScoreDomain.js";

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

  it("os cinco pesos somam 1 e o trio de entrega guarda a proporção 4:3:3", () => {
    const soma = PESOS_SCORE.pontualidade + PESOS_SCORE.pod + PESOS_SCORE.ocorrencias
      + PESOS_SCORE.conformidade + PESOS_SCORE.cuidado;
    expect(soma).toBeCloseTo(1, 5);
    // Sem jornada/vistoria, o trio renormaliza de volta para 0,4/0,3/0,3 — por
    // isso a proporção tem de ser exatamente 4:3:3.
    expect(PESOS_SCORE.pontualidade / PESOS_SCORE.ocorrencias).toBeCloseTo(4 / 3, 5);
    expect(PESOS_SCORE.pod / PESOS_SCORE.ocorrencias).toBeCloseTo(1, 5);
  });
});

describe("componentes de jornada e vistoria (aprofundamento)", () => {
  const entregaOk = () => ({
    entregueEm: "2026-09-11T12:00:00Z",
    prometidoEm: "2026-09-11T14:00:00Z",
    comprovanteRegistrado: true,
    ocorrencias: 0,
  });

  it("jornada conforme e vistoria aprovada entram como 100 — nota segue 100", () => {
    const r = calcularScoreMotorista([entregaOk()], {
      temJornada: true,
      conformidade: { conforme: true, alertas: [] },
      vistoria: { completo: true, status: "aprovado" },
    });
    expect(r.componentes.map((c) => c.chave).sort()).toEqual(
      ["conformidade", "cuidado", "ocorrencias", "pod", "pontualidade"],
    );
    expect(r.componentes.find((c) => c.chave === "conformidade").valor).toBe(100);
    expect(r.componentes.find((c) => c.chave === "cuidado").valor).toBe(100);
    expect(r.nota).toBe(100);
  });

  it("alerta crítico de jornada derruba o componente de conformidade", () => {
    const r = calcularScoreMotorista([entregaOk()], {
      temJornada: true,
      conformidade: { conforme: false, alertas: [{ gravidade: "critica" }] },
    });
    // 100 − 40 = 60 no componente de conformidade.
    expect(r.componentes.find((c) => c.chave === "conformidade").valor).toBe(60);
  });

  it("vistoria com ressalva vale 70; reprovada, 30", () => {
    const comRessalva = calcularScoreMotorista([entregaOk()], { vistoria: { completo: true, status: "ressalva" } });
    expect(comRessalva.componentes.find((c) => c.chave === "cuidado").valor).toBe(70);
    const reprovada = calcularScoreMotorista([entregaOk()], { vistoria: { completo: true, status: "reprovado" } });
    expect(reprovada.componentes.find((c) => c.chave === "cuidado").valor).toBe(30);
  });

  it("sem jornada e vistoria incompleta, os componentes novos não entram (comportamento antigo preservado)", () => {
    const r = calcularScoreMotorista([entregaOk()], {
      temJornada: false,
      conformidade: { conforme: true, alertas: [] }, // sem turnos → não é sinal
      vistoria: { completo: false, status: "incompleto" },
    });
    expect(r.componentes.map((c) => c.chave).sort()).toEqual(["ocorrencias", "pod", "pontualidade"]);
    expect(r.nota).toBe(100);
  });
});

describe("comparação com os pares", () => {
  it("sem outros motoristas, não inventa percentil", () => {
    const c = compararScoreMotorista(80, []);
    expect(c.posicao).toBeNull();
    expect(c.texto).toMatch(/ainda não há/i);
  });

  it("posiciona a nota na régua do time", () => {
    // Minha 80 contra [50, 70, 90] → 2 abaixo de 3 = 67%; 1 à frente; mediana 70.
    const c = compararScoreMotorista(80, [50, 70, 90]);
    expect(c.posicao).toBe(67);
    expect(c.melhores).toBe(1);
    expect(c.mediana).toBe(70);
    expect(c.total).toBe(3);
  });

  it("melhor do time é dito sem rodeio", () => {
    const c = compararScoreMotorista(95, [50, 70, 90]);
    expect(c.melhores).toBe(0);
    expect(c.texto).toMatch(/à frente de toda a equipe/i);
  });
});
