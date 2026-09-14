import { describe, expect, it } from "vitest";
import {
  GREEN_ON_PIPELINE_STAGES,
  createGreenOnOpportunity,
  createGreenOnSite,
  isOpen,
  operationalSummary,
  opportunityAlerts,
  pipelineSummary,
  stageMetrics,
  weightedAnnualRevenue,
} from "./greenOnCrmDomain.js";

describe("Green On CRM — pipeline de eletromobilidade", () => {
  it("nomeia as oito etapas do processo de energia + a de perda", () => {
    const nomes = GREEN_ON_PIPELINE_STAGES.map((s) => s.name);
    expect(nomes).toEqual([
      "Lead",
      "Diagnóstico energético",
      "Levantamento técnico",
      "Projeto",
      "Proposta",
      "Instalação",
      "Comissionamento",
      "Operação",
      "Perdido",
    ]);
  });

  it("é aberta enquanto não estiver em Operação ou Perdido", () => {
    expect(isOpen(createGreenOnOpportunity({ stageId: "proposta" }))).toBe(true);
    expect(isOpen(createGreenOnOpportunity({ stageId: "operacao" }))).toBe(false);
    expect(isOpen(createGreenOnOpportunity({ stageId: "perdido" }))).toBe(false);
  });

  it("pondera a receita anual pela probabilidade da etapa", () => {
    const op = createGreenOnOpportunity({ stageId: "proposta", monthlyRevenueBRL: 10000 });
    // 10.000/mês × 12 × 60% = 72.000
    expect(weightedAnnualRevenue(op)).toBe(72000);
  });

  it("o resumo do funil separa abertas de ganhas/perdidas e soma CAPEX e forecast", () => {
    const oportunidades = [
      createGreenOnOpportunity({ stageId: "diagnostico", capexBRL: 100000, monthlyRevenueBRL: 1000, estimatedChargers: 2 }),
      createGreenOnOpportunity({ stageId: "instalacao", capexBRL: 300000, monthlyRevenueBRL: 5000, estimatedChargers: 6 }),
      createGreenOnOpportunity({ stageId: "operacao" }),
      createGreenOnOpportunity({ stageId: "perdido" }),
    ];
    const resumo = pipelineSummary(oportunidades);
    expect(resumo.open).toBe(2);
    expect(resumo.won).toBe(1);
    expect(resumo.lost).toBe(1);
    expect(resumo.pipelineCapex).toBe(400000);
    expect(resumo.plannedChargers).toBe(8);
    // 1000×12×15% + 5000×12×80% = 1800 + 48000 = 49800
    expect(resumo.forecastAnnualRevenue).toBe(49800);
  });

  it("as métricas por etapa preservam a ordem canônica sem esconder etapas vazias", () => {
    const oportunidades = [createGreenOnOpportunity({ stageId: "proposta" })];
    const metricas = stageMetrics(oportunidades);
    expect(metricas.map((m) => m.id)).toEqual([
      "lead",
      "diagnostico",
      "levantamento",
      "projeto",
      "proposta",
      "instalacao",
      "comissionamento",
      "operacao",
    ]);
    expect(metricas.find((m) => m.id === "proposta").total).toBe(1);
    expect(metricas.find((m) => m.id === "lead").total).toBe(0);
  });

  it("um alerta é gerado quando falta responsável ou previsão de go-live", () => {
    const opp = createGreenOnOpportunity({ stageId: "projeto" });
    const alertas = opportunityAlerts(opp);
    expect(alertas).toContain("Sem responsável");
    expect(alertas).toContain("Sem previsão de entrada em operação");
  });

  it("marca oportunidade parada há muito tempo (>21 dias)", () => {
    const opp = createGreenOnOpportunity({
      stageId: "projeto",
      ownerId: "u1",
      expectedGoLive: "2030-01-01",
    });
    opp.updatedAt = "2026-08-01T00:00:00.000Z";
    const alertas = opportunityAlerts(opp, new Date("2026-09-13T00:00:00.000Z"));
    expect(alertas.some((a) => a.startsWith("Parada há"))).toBe(true);
  });

  it("um site é criado com estado ativo por padrão e UF normalizada", () => {
    const site = createGreenOnSite({ name: "Site Alfa", state: "sp", clientName: "Cliente" });
    expect(site.active).toBe(true);
    expect(site.state).toBe("SP");
    expect(site.name).toBe("Site Alfa");
  });

  it("o resumo operacional soma potência contratada dos sites ativos e conta sites por status", () => {
    const sites = [
      createGreenOnSite({ contractedDemandKw: 150, active: true }),
      createGreenOnSite({ contractedDemandKw: 100, active: false }),
      createGreenOnSite({ contractedDemandKw: 250, active: true }),
    ];
    const oportunidades = [
      createGreenOnOpportunity({ stageId: "operacao" }),
      createGreenOnOpportunity({ stageId: "instalacao" }),
      createGreenOnOpportunity({ stageId: "comissionamento" }),
    ];
    const resumo = operationalSummary(oportunidades, sites);
    expect(resumo.sitesAtivos).toBe(2);
    expect(resumo.potenciaContratadaKw).toBe(400);
    expect(resumo.sitesEmOperacao).toBe(1);
    expect(resumo.sitesEmConstrucao).toBe(2);
  });
});
