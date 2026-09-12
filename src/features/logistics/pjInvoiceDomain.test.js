import { describe, expect, it } from "vitest";
import {
  STATUS_NOTA_PJ,
  rotuloStatusNotaPj,
  competenciaValida,
  valorEsperadoProporcional,
  conferirNota,
  validarNotaPj,
  podeAprovar,
  podeRecusar,
  podePagar,
  podeReenviar,
} from "./pjInvoiceDomain.js";

describe("Nota PJ — status e competência", () => {
  it("os cinco status oficiais e rótulos", () => {
    expect(STATUS_NOTA_PJ.map((s) => s.id)).toEqual(["em_analise", "aprovada", "recusada", "paga", "cancelada"]);
    expect(rotuloStatusNotaPj("em_analise")).toBe("Em análise");
  });
  it("competência é AAAA-MM", () => {
    expect(competenciaValida("2026-09")).toBe(true);
    expect(competenciaValida("2026-13")).toBe(false);
    expect(competenciaValida("2026-9")).toBe(false);
    expect(competenciaValida("")).toBe(false);
  });
});

describe("Nota PJ — valor esperado proporcional", () => {
  it("sem dias, devolve o salário cheio", () => {
    expect(valorEsperadoProporcional(3000, 0)).toBe(3000);
  });
  it("meio do mês proporcional aos dias", () => {
    // 15 de 30 dias = metade.
    expect(valorEsperadoProporcional(3000, 15, 30)).toBe(1500);
  });
  it("nunca passa do cheio nem fica negativo", () => {
    expect(valorEsperadoProporcional(3000, 45, 30)).toBe(3000);
    expect(valorEsperadoProporcional(0, 10, 30)).toBe(0);
  });
});

describe("Nota PJ — conferência contra o esperado", () => {
  it("bate ao centavo → confere", () => {
    const r = conferirNota({ valor: 3000, valorEsperado: 3000 });
    expect(r.confere).toBe(true);
    expect(r.diferenca).toBe(0);
    expect(r.situacao).toBe("confere");
  });
  it("acima do esperado é sinalizado", () => {
    const r = conferirNota({ valor: 3200, valorEsperado: 3000 });
    expect(r.confere).toBe(false);
    expect(r.diferenca).toBe(200);
    expect(r.situacao).toBe("acima");
  });
  it("abaixo do esperado é sinalizado", () => {
    const r = conferirNota({ valor: 1500, valorEsperado: 3000 });
    expect(r.confere).toBe(false);
    expect(r.diferenca).toBe(-1500);
    expect(r.situacao).toBe("abaixo");
  });
  it("tolerância aceita pequena diferença", () => {
    expect(conferirNota({ valor: 3000.01, valorEsperado: 3000, tolerancia: 0.05 }).confere).toBe(true);
  });
});

describe("Nota PJ — validação da imputação", () => {
  it("exige número, valor > 0 e competência", () => {
    expect(validarNotaPj({ numero: "", valor: 100, competencia: "2026-09" }).valido).toBe(false);
    expect(validarNotaPj({ numero: "NF-1", valor: 0, competencia: "2026-09" }).valido).toBe(false);
    expect(validarNotaPj({ numero: "NF-1", valor: 100, competencia: "set" }).valido).toBe(false);
    expect(validarNotaPj({ numero: "NF-1", valor: 100, competencia: "2026-09" }).valido).toBe(true);
  });
});

describe("Nota PJ — transições", () => {
  it("aprovar/recusar só em análise; pagar só aprovada; reenviar em análise/recusada", () => {
    expect(podeAprovar("em_analise")).toBe(true);
    expect(podeAprovar("aprovada")).toBe(false);
    expect(podeRecusar("em_analise")).toBe(true);
    expect(podePagar("aprovada")).toBe(true);
    expect(podePagar("em_analise")).toBe(false);
    expect(podeReenviar("recusada")).toBe(true);
    expect(podeReenviar("paga")).toBe(false);
  });
});
