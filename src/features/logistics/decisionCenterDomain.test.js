import { describe, expect, it } from "vitest";
import { buildTodoGreenDecisionCenter } from "./decisionCenterDomain.js";

describe("centro de decisão To Do Green", () => {
  it("calcula pipeline e forecast somente com oportunidades abertas", () => {
    const result = buildTodoGreenDecisionCenter({
      data: { opportunities: [
        { value: 100_000, probability: 50, stage: "Proposta", nextStep: "Reunião" },
        { value: 40_000, probability: 100, stage: "Ganho" },
      ] },
    });
    expect(result.pipeline).toBe(100_000);
    expect(result.forecast).toBe(50_000);
  });

  it("gera apenas alertas que levam a uma ação", () => {
    const result = buildTodoGreenDecisionCenter({
      now: new Date("2026-08-13T12:00:00Z"),
      dashboard: { aprovacoesPendentes: 2 },
      data: {
        clients: [{ id: "1", crm: { nextActionAt: "2026-08-01" } }],
        opportunities: [{ id: "o1", value: 200_000, stage: "Diagnóstico" }],
        contracts: [{ id: "c1", endAt: "2026-09-01" }],
        operations: [{ id: "op1", incidents: 1 }],
      },
    });
    expect(result.alerts).toHaveLength(5);
    expect(result.alerts.every((item) => item.route && item.action)).toBe(true);
  });

  describe("janela de renovação de contrato", () => {
    const em = (data, extra = {}) => buildTodoGreenDecisionCenter({
      now: new Date("2026-08-13T12:00:00Z"),
      data: { contracts: [{ id: "c1", ...extra }] },
      ...data,
    });
    const alerta = (r) => r.alerts.find((a) => a.id === "contracts-expiring");

    it("acende para o campo real do contrato (fimEm), não só o alias inglês", () => {
      // fimEm ~19 dias à frente — antes o alerta lia endAt/endDate e nunca via
      // o contrato real, ficando morto em produção.
      expect(alerta(em({}, { fimEm: "2026-09-01" }))).toBeTruthy();
    });

    it("respeita a antecedência combinada: avisa aos 120 dias, não só aos 90", () => {
      // Fim daqui a 100 dias, aviso exigido de 120 → já está na janela hoje.
      expect(alerta(em({}, { fimEm: "2026-11-21", antecedenciaAvisoDias: 120 }))).toBeTruthy();
      // Sem a antecedência, o padrão de 90 dias ainda não pegaria 100 dias fora.
      expect(alerta(em({}, { fimEm: "2026-11-21" }))).toBeUndefined();
    });

    it("usa a data de aviso combinada quando ela existe", () => {
      expect(alerta(em({}, { fimEm: "2027-06-01", avisoRenovacaoEm: "2026-08-01" }))).toBeTruthy();
    });

    it("contrato sem renovação não gera aviso", () => {
      expect(alerta(em({}, { fimEm: "2026-09-01", renovacao: "none" }))).toBeUndefined();
    });

    it("contrato já vencido sai deste alerta (é outro problema)", () => {
      expect(alerta(em({}, { fimEm: "2026-07-01" }))).toBeUndefined();
    });
  });

  it("não inventa alerta quando não há evidência", () => {
    const result = buildTodoGreenDecisionCenter({ data: {}, dashboard: {} });
    expect(result.alerts).toEqual([]);
    expect(result.hasRevenueData).toBe(false);
    expect(result.hasMarginData).toBe(false);
    expect(result.hasImpactData).toBe(false);
  });
});
