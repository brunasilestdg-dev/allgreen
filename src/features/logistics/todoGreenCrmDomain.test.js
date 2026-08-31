import { describe, expect, it } from "vitest";
import {
  accountHealth,
  calculateAccountScore,
  calculateRelationshipCoverage,
  buildCrmCommandCenter,
  buildAccountIntelligence,
  calculatePortfolioPotential,
  createTodoGreenAccount,
  createTodoGreenContact,
  crmAccountSummary,
  explicarSaudeDaConta,
  PESOS_DA_SAUDE,
  recommendNextCommercialAction,
  TODO_GREEN_RELATIONSHIP_ROLES,
} from "./todoGreenCrmDomain.js";

describe("To Do Green enterprise CRM", () => {
  it("normalizes an enterprise account without inventing commercial data", () => {
    const account = createTodoGreenAccount({
      legalName: "  Cliente Logística S.A. ",
      tier: "Enterprise",
      temperature: "Morno",
      strategicPotential: 82,
      relationshipStrength: 65,
      operationalFit: 90,
      esgFit: 88,
      dataQuality: 75,
      churnRisk: 20,
    });
    expect(account.legalName).toBe("Cliente Logística S.A.");
    expect(account.tier).toBe("Enterprise");
    expect(account.temperature).toBe("Morno");
    expect(account.contacts).toEqual([]);
    expect(calculateAccountScore(account)).toBeGreaterThanOrEqual(75);
  });

  it("maps multiple stakeholders and identifies missing decision roles", () => {
    const contacts = [
      createTodoGreenContact({ name: "Ana", relationshipRole: "Patrocinador" }),
      createTodoGreenContact({ name: "João", relationshipRole: "Operações" }),
      createTodoGreenContact({ name: "Paula", relationshipRole: "Sustentabilidade" }),
    ];
    const coverage = calculateRelationshipCoverage(contacts);
    expect(coverage.totalContacts).toBe(3);
    expect(coverage.covered).toContain("Quem apoia");
    expect(coverage.missing).toContain("Quem decide");
    expect(coverage.score).toBe(67);
  });

  it("calculates account health with pipeline and operational alerts", () => {
    const account = createTodoGreenAccount({
      id: "account-1",
      tradeName: "Conta Estratégica",
      stage: "Diagnóstico",
      strategicPotential: 90,
      relationshipStrength: 60,
      operationalFit: 85,
      esgFit: 80,
      dataQuality: 45,
      churnRisk: 15,
      nextAction: "Validar rotas",
      nextActionAt: "2020-01-01",
    });
    const contacts = [
      createTodoGreenContact({ accountId: account.id, relationshipRole: "Patrocinador" }),
    ];
    const opportunities = [
      { accountId: account.id, stage: "Diagnóstico", value: 1_000_000, probability: 40 },
    ];
    const health = accountHealth(account, contacts, opportunities);
    expect(health.pipeline).toBe(1_000_000);
    expect(health.weightedPipeline).toBe(400_000);
    expect(health.alerts).toContain("Dados insuficientes para decisão");
    expect(health.alerts).toContain("Próxima ação atrasada");
  });

  it("recommends the next best commercial action from account gaps", () => {
    const account = createTodoGreenAccount({
      id: "account-2",
      nextAction: "Preparar proposta",
      nextActionAt: "2999-01-01",
      dataQuality: 90,
      esgFit: 90,
    });
    const recommendation = recommendNextCommercialAction({
      account,
      contacts: [createTodoGreenContact({ relationshipRole: "Patrocinador" })],
      opportunities: [],
    });
    expect(recommendation).toBe("Mapear e acessar quem decide a contratação logística.");
  });

  it("produces an executive account summary", () => {
    const account = createTodoGreenAccount({
      id: "account-3",
      tradeName: "Cliente A",
      tier: "Estratégica",
      stage: "Proposta",
      strategicPotential: 95,
      relationshipStrength: 80,
      operationalFit: 90,
      esgFit: 85,
      dataQuality: 85,
      churnRisk: 10,
      nextAction: "Reunião de negociação",
      nextActionAt: "2999-01-01",
    });
    const contacts = [
      createTodoGreenContact({ name: "A", relationshipRole: "Decisor econômico" }),
      createTodoGreenContact({ name: "B", relationshipRole: "Decisor técnico" }),
      createTodoGreenContact({ name: "C", relationshipRole: "Patrocinador" }),
      createTodoGreenContact({ name: "D", relationshipRole: "Compras" }),
      createTodoGreenContact({ name: "E", relationshipRole: "Operações" }),
      createTodoGreenContact({ name: "F", relationshipRole: "Sustentabilidade" }),
    ];
    const summary = crmAccountSummary(account, contacts, [
      { accountId: account.id, stage: "Proposta", value: 2_000_000, probability: 60 },
    ]);
    expect(summary.name).toBe("Cliente A");
    expect(summary.coverage).toBe(100);
    expect(summary.weightedPipeline).toBe(1_200_000);
    expect(summary.score).toBeGreaterThanOrEqual(80);
  });

  it("builds a command center ordered by commercial attention", () => {
    const healthy = createTodoGreenAccount({
      id: "healthy",
      tradeName: "Conta saudável",
      nextAction: "Reunião",
      nextActionAt: "2999-01-01",
      strategicPotential: 90,
      relationshipStrength: 90,
      operationalFit: 90,
      esgFit: 90,
      dataQuality: 90,
      contacts: TODO_GREEN_RELATIONSHIP_ROLES.slice(0, 6).map((relationshipRole) =>
        createTodoGreenContact({ relationshipRole }),
      ),
    });
    const critical = createTodoGreenAccount({
      id: "critical",
      tradeName: "Conta atrasada",
      nextAction: "Retomar contato",
      nextActionAt: "2020-01-01",
    });
    const result = buildCrmCommandCenter([healthy, critical], [
      { clientId: "healthy", estagio: "Proposta", value: 1000, probability: 50 },
      { clientId: "critical", estagio: "Fechada ganha", value: 9000, probability: 100 },
    ], new Date("2026-08-10"));
    expect(result.totalAccounts).toBe(2);
    expect(result.openOpportunities).toBe(1);
    expect(result.overdueActions).toBe(1);
    expect(result.accounts[0].name).toBe("Conta atrasada");
  });

  it("builds an account plan, relationship map, white space and objective health alerts", () => {
    const account = createTodoGreenAccount({
      id: "account-strategy",
      potentialAnnual: 3_000_000,
      productPotential: { middleMile: 1_200_000, lastMile: 900_000 },
      geographicExpansion: "Sul e Sudeste",
      lastInteractionAt: "2026-06-01T00:00:00.000Z",
      contractRenewalDate: "2026-09-15",
      accountPlan: { objective: "Abrir operação dedicada", plan30: "Validar malha" },
    });
    const result = buildAccountIntelligence({
      account,
      contacts: [
        createTodoGreenContact({ name: "Ana Compras", relationshipRole: "Compras" }),
        createTodoGreenContact({ name: "Bruno Operação", relationshipRole: "Operações" }),
      ],
      opportunities: [{ accountId: account.id, productId: "middle-mile", stage: "Proposta", updatedAt: "2026-07-01" }],
      now: new Date("2026-08-12T00:00:00.000Z"),
    });
    expect(result.potential.annual).toBe(3_000_000);
    expect(result.relationshipMap.buyers).toEqual(["Ana Compras"]);
    expect(result.relationshipMap.users).toEqual(["Bruno Operação"]);
    expect(result.whiteSpace).toEqual(["Last mile", "Operação dedicada"]);
    expect(result.commercialHealth).toContain("Sem contato há 72 dias");
    expect(result.commercialHealth).toContain("Proposta parada há pelo menos 21 dias");
    expect(result.accountPlan.objective).toBe("Abrir operação dedicada");
  });

  it("mantém contato histórico fora do mapa atual de relacionamento", () => {
    const account = createTodoGreenAccount({ id: "account-history" });
    const result = buildAccountIntelligence({
      account,
      contacts: [{
        id: "old-buyer", name: "Ex Comprador", relationshipRole: "Compras",
        employmentStatus: "former", employmentCheckedAt: "2026-08-13T00:00:00.000Z",
        currentEmploymentVerified: false, active: false,
      }],
      opportunities: [],
    });
    expect(result.relationshipMap.buyers).toEqual([]);
  });

  it("não trata resultado web sem vínculo atual como decisor", () => {
    const coverage = calculateRelationshipCoverage([{
      name: "Contato antigo", relationshipRole: "Quem decide", source: "Pesquisa web",
      active: true, employmentStatus: "unknown", currentEmploymentVerified: false, verifiedBrazil: true,
    }]);
    expect(coverage.totalContacts).toBe(0);
    expect(coverage.missing).toContain("Quem decide");
  });

  it("usa Quem bloqueia e migra o rótulo legado sem perder o contato", () => {
    const legacy = createTodoGreenContact({ name: "Pessoa de risco", relationshipRole: "Quem atravessa" });
    expect(legacy.relationshipRole).toBe("Quem bloqueia");
    const coverage = calculateRelationshipCoverage([
      legacy,
      createTodoGreenContact({ name: "Decisor", relationshipRole: "Quem decide" }),
    ]);
    expect(coverage.blockers).toBe(1);
    expect(coverage.missing).not.toContain("Quem decide");
  });

  it("calcula Share of Wallet apenas quando o gasto logístico do cliente foi informado", () => {
    const withBasis = buildAccountIntelligence({
      account: createTodoGreenAccount({ id: "wallet", ourAnnualRevenue: 2_000_000, customerAnnualLogisticsSpend: 10_000_000 }),
    });
    expect(withBasis.shareOfWallet.percentage).toBe(20);
    expect(withBasis.shareOfWallet.remaining).toBe(8_000_000);
    const withoutBasis = buildAccountIntelligence({ account: createTodoGreenAccount({ id: "wallet-empty", ourAnnualRevenue: 1_000 }) });
    expect(withoutBasis.shareOfWallet.percentage).toBeNull();
    const withoutOurRevenue = buildAccountIntelligence({ account: createTodoGreenAccount({ id: "wallet-no-revenue", customerAnnualLogisticsSpend: 10_000_000 }) });
    expect(withoutOurRevenue.shareOfWallet.percentage).toBeNull();
    expect(withoutOurRevenue.shareOfWallet.status).toBe("missing-our-revenue");
  });

  it("calculates the annual portfolio potential from monthly quantities and tickets", () => {
    const potential = calculatePortfolioPotential(createTodoGreenAccount({
      potentialInputs: {
        middleMileMonthlyTrips: 10,
        middleMileAverageTicket: 5_000,
        lastMileMonthlyDeliveries: 1_000,
        lastMileAverageTicket: 15,
        dedicatedMonthlyVehicles: 2,
        dedicatedMonthlyTicket: 20_000,
      },
    }));
    expect(potential.middleMile).toBe(600_000);
    expect(potential.lastMile).toBe(180_000);
    expect(potential.dedicated).toBe(480_000);
    expect(potential.annual).toBe(1_260_000);
    expect(potential.calculatedProducts).toBe(3);
    expect(potential.method).toContain("quantidade mensal");
  });

  it("does not invent a portfolio potential when calculation inputs are missing", () => {
    const potential = calculatePortfolioPotential(createTodoGreenAccount({
      potentialInputs: { middleMileMonthlyTrips: 10 },
    }));
    expect(potential.annual).toBeNull();
    expect(potential.missing).toBe(true);
    expect(potential.missingByProduct.middleMile).toContain("ticket médio por viagem");
  });

  it("derives a 30/60/90 account plan from CRM gaps without inventing competitors", () => {
    const account = createTodoGreenAccount({ id: "plan-derived", stage: "Prospecção" });
    const intelligence = buildAccountIntelligence({ account, contacts: [], opportunities: [] });
    expect(intelligence.accountPlan.objective).toContain("Middle mile");
    expect(intelligence.accountPlan.plan30).toContain("próxima ação");
    expect(intelligence.accountPlan.plan60).toContain("volumes mensais");
    expect(intelligence.accountPlan.competitors).toBe("");
    expect(intelligence.accountPlan.generated.plan90).toBe(true);
  });
});

describe("a régua da saúde explicada", () => {
  // A titular pediu a regra clara na tela; a explicação tem que sair do MESMO
  // cálculo, senão a tela ensina uma regra e o número obedece a outra.
  it("os pesos somam 100", () => {
    expect(PESOS_DA_SAUDE.reduce((soma, item) => soma + item.peso, 0)).toBe(100);
  });

  it("a contribuição de cada nota bate com o score das avaliações", () => {
    const conta = {
      id: "c1", strategicPotential: 80, relationshipStrength: 60, operationalFit: 40,
      esgFit: 100, dataQuality: 20, churnRisk: 0, nextAction: "Visitar", nextActionAt: "2999-01-01",
    };
    const explicacao = explicarSaudeDaConta(conta, [], []);
    const soma = explicacao.linhas.reduce((total, linha) => total + linha.contribuicao, 0);
    expect(Math.abs(soma - explicacao.notaDasAvaliacoes)).toBeLessThanOrEqual(1);
    // Risco de perda é invertido: risco zero contribui com o peso inteiro.
    const risco = explicacao.linhas.find((linha) => linha.id === "churnRisk");
    expect(risco.contribuicao).toBe(10);
    expect(explicacao.semAvaliacao).toBe(false);
  });

  it("conta sem nota nenhuma é declarada não avaliada, e não 'ruim'", () => {
    const explicacao = explicarSaudeDaConta({ id: "c2" }, [], []);
    expect(explicacao.semAvaliacao).toBe(true);
    expect(explicacao.linhas.every((linha) => linha.preenchida === false)).toBe(true);
  });

  it("ação atrasada explica a conta crítica com essas palavras", () => {
    const explicacao = explicarSaudeDaConta(
      { id: "c3", nextAction: "Ligar para o diretor", nextActionAt: "2000-01-01" }, [], [],
    );
    expect(explicacao.classificacao).toBe("critical");
    expect(explicacao.motivo).toContain("atrasada");
  });

  it("risco alto também joga a conta para crítica", () => {
    const explicacao = explicarSaudeDaConta(
      { id: "c4", nextAction: "Reunião", nextActionAt: "2999-01-01", churnRisk: 80 }, [], [],
    );
    expect(explicacao.classificacao).toBe("critical");
    expect(explicacao.motivo).toContain("risco de perda");
  });
});
