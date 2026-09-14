import { describe, expect, it } from "vitest";
import {
  GREEN_ON_ACCOUNT_STAGES,
  GREEN_ON_ACCOUNT_TIERS,
  GREEN_ON_PESOS_DA_SAUDE,
  GREEN_ON_PIPELINE_STAGES,
  GREEN_ON_RELATIONSHIP_ROLES,
  buildGreenOnCommandCenter,
  calculateGreenOnAccountScore,
  calculateGreenOnRelationshipCoverage,
  createGreenOnAccount,
  createGreenOnContact,
  createGreenOnOpportunity,
  createGreenOnSite,
  greenOnAccountHealth,
  greenOnAccountSummary,
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

  it("os pesos da saúde somam 100 e refletem o vocabulário Green On (energia, eletrificação, regulatório)", () => {
    expect(GREEN_ON_PESOS_DA_SAUDE.reduce((t, p) => t + p.peso, 0)).toBe(100);
    const ids = GREEN_ON_PESOS_DA_SAUDE.map((p) => p.id);
    expect(ids).toContain("energyFit");
    expect(ids).toContain("electrificationMaturity");
    expect(ids).toContain("regulatoryRisk");
  });

  it("papéis de relacionamento incluem gestor de energia e engenharia predial (não é o do TDG)", () => {
    expect(GREEN_ON_RELATIONSHIP_ROLES).toContain("Gestor de energia");
    expect(GREEN_ON_RELATIONSHIP_ROLES).toContain("Engenharia predial");
    expect(GREEN_ON_RELATIONSHIP_ROLES).toContain("Concessionária");
  });

  it("etapas da conta seguem a jornada de infra elétrica e diferem do CRM logístico", () => {
    expect(GREEN_ON_ACCOUNT_STAGES).toContain("Diagnóstico energético");
    expect(GREEN_ON_ACCOUNT_STAGES).toContain("Comissionamento");
    expect(GREEN_ON_ACCOUNT_STAGES).not.toContain("Construção de solução");
  });

  it("conta é criada com stage 'Mapeamento' e tier 'Enterprise' por padrão, UF em maiúsculas", () => {
    const conta = createGreenOnAccount({ legalName: "Shopping X", state: "rj" });
    expect(GREEN_ON_ACCOUNT_TIERS).toContain(conta.tier);
    expect(conta.stage).toBe("Mapeamento");
    expect(conta.tier).toBe("Enterprise");
    expect(conta.state).toBe("RJ");
    expect(conta.active).toBe(true);
  });

  it("nota da conta usa apenas notas informadas e nunca ultrapassa 0-100", () => {
    const zerada = createGreenOnAccount({});
    expect(calculateGreenOnAccountScore(zerada)).toBeGreaterThanOrEqual(0);
    expect(calculateGreenOnAccountScore(zerada)).toBeLessThanOrEqual(100);
    const nota = calculateGreenOnAccountScore({
      strategicPotential: 100,
      energyFit: 100,
      electrificationMaturity: 100,
      relationshipStrength: 100,
      esgFit: 100,
      dataQuality: 100,
      regulatoryRisk: 0, // invertido, então 0 vira 100
    });
    expect(nota).toBe(100);
  });

  it("cobertura de decisores premia trio Decisor econômico + técnico + gestor de energia", () => {
    const contatos = [
      createGreenOnContact({ name: "A", relationshipRole: "Decisor econômico" }),
      createGreenOnContact({ name: "B", relationshipRole: "Decisor técnico" }),
      createGreenOnContact({ name: "C", relationshipRole: "Gestor de energia" }),
    ];
    expect(calculateGreenOnRelationshipCoverage(contatos).score).toBe(100);
    expect(calculateGreenOnRelationshipCoverage(contatos.slice(0, 2)).score).toBe(67);
    expect(calculateGreenOnRelationshipCoverage([]).score).toBe(0);
  });

  it("saúde da conta gera alertas claros e classifica como crítica/atenção/saudável", () => {
    const critica = greenOnAccountHealth(
      createGreenOnAccount({ churnRisk: 80, energyFit: 30 }),
      [],
      [],
    );
    expect(critica.classificacao).toBe("critical");
    expect(critica.alerts.length).toBeGreaterThan(0);

    const atencao = greenOnAccountHealth(
      createGreenOnAccount({ energyFit: 70, dataQuality: 50 }),
      [],
      [],
    );
    expect(atencao.classificacao).toBe("attention");
    expect(atencao.alerts).toContain("Dados insuficientes para dimensionar");

    const saudavel = greenOnAccountHealth(
      createGreenOnAccount({
        strategicPotential: 80,
        energyFit: 80,
        electrificationMaturity: 70,
        relationshipStrength: 80,
        esgFit: 80,
        dataQuality: 80,
        regulatoryRisk: 10,
        nextAction: "Enviar proposta revisada",
      }),
      [
        createGreenOnContact({ name: "A", relationshipRole: "Decisor econômico" }),
        createGreenOnContact({ name: "B", relationshipRole: "Decisor técnico" }),
        createGreenOnContact({ name: "C", relationshipRole: "Gestor de energia" }),
      ],
      [],
    );
    expect(saudavel.classificacao).toBe("healthy");
  });

  it("resumo da conta consolida saúde + contatos ativos + CAPEX em pipeline", () => {
    const account = createGreenOnAccount({ id: "acc-1", legalName: "Cliente Teste" });
    const contatos = [
      createGreenOnContact({ accountId: "acc-1", name: "A", relationshipRole: "Decisor técnico" }),
      createGreenOnContact({ accountId: "acc-1", name: "B", relationshipRole: "Bloqueador" }),
      createGreenOnContact({ accountId: "outra", name: "C" }),
    ];
    const oportunidades = [
      createGreenOnOpportunity({ accountId: "acc-1", stageId: "projeto", capexBRL: 400000, monthlyRevenueBRL: 3000 }),
    ];
    // A propriedade accountId não é criada por createGreenOnOpportunity — anexo manualmente:
    oportunidades[0].accountId = "acc-1";
    const resumo = greenOnAccountSummary(account, contatos, oportunidades);
    expect(resumo.contactsCount).toBe(2);
    expect(resumo.openOpportunities).toBe(1);
    expect(resumo.pipelineCapex).toBe(400000);
  });

  it("command center do CRM agrega contas por classificação e soma pipeline", () => {
    const contas = [
      createGreenOnAccount({ id: "a1", legalName: "A", churnRisk: 80 }),
      createGreenOnAccount({ id: "a2", legalName: "B", energyFit: 70, dataQuality: 40 }),
      createGreenOnAccount({
        id: "a3",
        legalName: "C",
        strategicPotential: 80,
        energyFit: 80,
        electrificationMaturity: 80,
        relationshipStrength: 80,
        esgFit: 80,
        dataQuality: 80,
        regulatoryRisk: 10,
        nextAction: "Reunião agendada",
      }),
    ];
    const contatos = [
      createGreenOnContact({ accountId: "a3", name: "A", relationshipRole: "Decisor econômico" }),
      createGreenOnContact({ accountId: "a3", name: "B", relationshipRole: "Decisor técnico" }),
      createGreenOnContact({ accountId: "a3", name: "C", relationshipRole: "Gestor de energia" }),
    ];
    const painel = buildGreenOnCommandCenter(contas, contatos, []);
    expect(painel.total).toBe(3);
    expect(painel.criticas).toBe(1);
    expect(painel.atencao).toBe(1);
    expect(painel.saudaveis).toBe(1);
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
