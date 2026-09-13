import { describe, expect, it } from "vitest";
import { buildTodoGreenDecisionCenter, contaComAcaoAtrasada, contasComAcaoAtrasada } from "./decisionCenterDomain.js";

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

  describe("clientes com ação atrasada", () => {
    const centro = (clients, now = new Date("2026-09-13T12:00:00Z")) =>
      buildTodoGreenDecisionCenter({ now, data: { clients } });
    const alerta = (r) => r.alerts.find((a) => a.id === "clients-overdue");

    it("ação marcada para HOJE ainda não está atrasada", () => {
      // O contador comparava timestamp: `new Date("2026-09-13")` é meia-noite
      // UTC, sempre atrás do agora, então a ação do próprio dia já nascia
      // atrasada — e sumia do filtro do CRM, que compara dia. Aviso dizia 2,
      // lista abria vazia.
      expect(alerta(centro([{ id: "c1", name: "Rede Alfa", crm: { nextActionAt: "2026-09-13" } }]))).toBeUndefined();
      expect(alerta(centro([{ id: "c1", name: "Rede Alfa", crm: { nextActionAt: "2026-09-12" } }]))).toBeTruthy();
    });

    it("nomeia as contas e leva ao CRM já filtrado nelas", () => {
      const a = alerta(centro([
        { id: "c1", name: "Rede Alfa", crm: { nextActionAt: "2026-09-01" } },
        { id: "c2", name: "Rede Beta", crm: { nextActionAt: "2026-09-02" } },
      ]));
      expect(a.title).toBe("2 clientes com ação atrasada");
      expect(a.detail).toContain("Rede Alfa, Rede Beta");
      expect(a.route).toBe("/todogreen/clientes?filtro=acao-atrasada");
      expect(a.ids).toEqual(["c1", "c2"]);
    });

    it("uma conta só abre direto na ficha dela", () => {
      const a = alerta(centro([{ id: "c1", name: "Rede Alfa", crm: { nextActionAt: "2026-09-01" } }]));
      expect(a.route).toBe("/todogreen/clientes?client=c1");
    });

    it("resume a partir da quarta conta em vez de listar tudo", () => {
      const a = alerta(centro(["Alfa", "Beta", "Gama", "Delta"].map((nome, i) => (
        { id: `c${i}`, name: nome, crm: { nextActionAt: "2026-09-01" } }
      ))));
      expect(a.detail).toContain("Alfa, Beta, Gama e mais 1");
    });

    it("a mesma régua vale para conta com nextActionAt na raiz (CRM)", () => {
      expect(contaComAcaoAtrasada({ nextActionAt: "2020-01-01" })).toBe(true);
      expect(contaComAcaoAtrasada({ nextActionAt: "2999-01-01" })).toBe(false);
      expect(contaComAcaoAtrasada({})).toBe(false);
      expect(contasComAcaoAtrasada([{ crm: { nextActionAt: "2020-01-01" } }, {}])).toHaveLength(1);
    });
  });

  it("oportunidade sem próximo passo nomeia o negócio e filtra o pipeline", () => {
    const alerta = buildTodoGreenDecisionCenter({
      data: { opportunities: [{ id: "o1", cliente: "Transportes Gama", value: 10_000, stage: "Negociação" }] },
    }).alerts.find((a) => a.id === "opportunities-without-action");
    expect(alerta.detail).toContain("Transportes Gama");
    expect(alerta.route).toBe("/todogreen/oportunidades?filtro=sem-proxima-acao");
    expect(alerta.ids).toEqual(["o1"]);
  });

  it("não inventa alerta quando não há evidência", () => {
    const result = buildTodoGreenDecisionCenter({ data: {}, dashboard: {} });
    expect(result.alerts).toEqual([]);
    expect(result.hasRevenueData).toBe(false);
    expect(result.hasMarginData).toBe(false);
    expect(result.hasImpactData).toBe(false);
  });
});
