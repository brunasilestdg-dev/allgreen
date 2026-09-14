import { describe, expect, it } from "vitest";
import {
  GREENMOB_PIPELINE_STAGES,
  createGreenmobLead,
  isOpen,
  leadAlerts,
  pipelineSummary,
  stageMetrics,
  weightedContractValue,
  weightedMonthlyRevenue,
} from "./greenmobCrmDomain.js";

describe("Greenmob CRM — pipeline de locação", () => {
  it("nomeia as etapas do processo de locação (Lead → devolução) + Perdido", () => {
    const nomes = GREENMOB_PIPELINE_STAGES.map((s) => s.name);
    expect(nomes).toEqual([
      "Lead",
      "Perfil da frota",
      "Cotação",
      "Proposta",
      "Contrato",
      "Reserva",
      "Entrega",
      "Locação ativa",
      "Renovação",
      "Devolvido",
      "Perdido",
    ]);
  });

  it("é aberto enquanto não estiver em Locação ativa, Devolvido ou Perdido", () => {
    expect(isOpen(createGreenmobLead({ stageId: "cotacao" }))).toBe(true);
    expect(isOpen(createGreenmobLead({ stageId: "locacao-ativa" }))).toBe(false);
    expect(isOpen(createGreenmobLead({ stageId: "devolvido" }))).toBe(false);
    expect(isOpen(createGreenmobLead({ stageId: "perdido" }))).toBe(false);
  });

  it("pondera a receita mensal pelo tamanho da frota e pela probabilidade", () => {
    const lead = createGreenmobLead({
      stageId: "proposta",
      proposedMonthlyBRL: 3000,
      fleetSize: 5,
    });
    // 3000 × 5 × 55% = 8250
    expect(weightedMonthlyRevenue(lead)).toBe(8250);
  });

  it("calcula o valor total ponderado do contrato (mensal × prazo × frota × prob.)", () => {
    const lead = createGreenmobLead({
      stageId: "contrato",
      proposedMonthlyBRL: 3000,
      fleetSize: 5,
      desiredTermMonths: 24,
    });
    // 3000 × 24 × 5 × 75% = 270000
    expect(weightedContractValue(lead)).toBe(270000);
  });

  it("resumo do funil separa abertos, ativos, devolvidos e perdidos", () => {
    const leads = [
      createGreenmobLead({ stageId: "cotacao", fleetSize: 2, proposedMonthlyBRL: 2500, desiredTermMonths: 12 }),
      createGreenmobLead({ stageId: "contrato", fleetSize: 5, proposedMonthlyBRL: 3000, desiredTermMonths: 24 }),
      createGreenmobLead({ stageId: "locacao-ativa" }),
      createGreenmobLead({ stageId: "devolvido" }),
      createGreenmobLead({ stageId: "perdido" }),
    ];
    const resumo = pipelineSummary(leads);
    expect(resumo.open).toBe(2);
    expect(resumo.ativos).toBe(1);
    expect(resumo.devolvidos).toBe(1);
    expect(resumo.perdidos).toBe(1);
    expect(resumo.frotaEmNegociacao).toBe(7);
  });

  it("stageMetrics preserva as etapas da jornada em ordem, sem incluir Perdido", () => {
    const metricas = stageMetrics([]);
    expect(metricas.map((m) => m.id)).toEqual([
      "lead",
      "perfil-frota",
      "cotacao",
      "proposta",
      "contrato",
      "reserva",
      "entrega",
      "locacao-ativa",
      "renovacao",
      "devolvido",
    ]);
  });

  it("alertas sinalizam campos essenciais faltando e lead parado", () => {
    const lead = createGreenmobLead({ stageId: "cotacao" });
    const alertas = leadAlerts(lead);
    expect(alertas).toContain("Sem responsável");
    expect(alertas).toContain("Sem previsão de início da locação");
    expect(alertas).toContain("Prazo do contrato não definido");
    expect(alertas).toContain("Tamanho da frota não informado");
  });
});
