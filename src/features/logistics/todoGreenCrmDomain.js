import { contaComAcaoAtrasada, diaDaData } from "./decisionCenterDomain.js";

const asText = (value) => String(value || "").trim();
const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const CLOSED_STAGES = new Set([
  "Ganho",
  "Perdido",
  "Fechada ganha",
  "Fechada perdida",
  "Cliente ativo",
]);

export const TODO_GREEN_ACCOUNT_TIERS = [
  "Estratégica",
  "Enterprise",
  "Grande conta",
  "Média conta",
  "Parceiro",
];

export const TODO_GREEN_ACCOUNT_TEMPERATURES = ["Quente", "Morno", "Frio"];

export const TODO_GREEN_RELATIONSHIP_ROLES = [
  "Decisor econômico",
  "Decisor técnico",
  "Patrocinador",
  "Influenciador",
  "Usuário",
  "Compras",
  "Jurídico",
  "Financeiro",
  "Operações",
  "Sustentabilidade",
  "Bloqueador",
  "Quem decide",
  "Quem apoia",
  "Quem bloqueia",
  "Usuário operacional",
];

export const normalizeRelationshipRole = (value) =>
  asText(value) === "Quem atravessa" ? "Quem bloqueia" : asText(value);

export const isCurrentRelationshipContact = (contact = {}) => {
  if (!contact.name || contact.active === false || contact.employmentStatus === "former") return false;
  const fromWeb = lowerRole(contact.source).startsWith("pesquisa web");
  if (!fromWeb) return true;
  return contact.currentEmploymentVerified === true && contact.verifiedBrazil === true;
};

export const TODO_GREEN_ACCOUNT_STAGES = [
  "Mapeamento",
  "Prospecção",
  "Diagnóstico",
  "Construção de solução",
  "Proposta",
  "Negociação",
  "Implantação",
  "Cliente ativo",
  "Expansão",
  "Risco",
  "Inativo",
];

export const TODO_GREEN_QUALIFICATION_FIELDS = Object.freeze([
  { key: "currentModel", label: "Modelo logístico atual", type: "textarea" },
  { key: "currentSuppliers", label: "Fornecedores atuais", type: "textarea" },
  { key: "monthlyVolume", label: "Volume mensal", type: "number" },
  { key: "monthlyTrips", label: "Viagens mensais", type: "number" },
  { key: "mainRoutes", label: "Rotas prioritárias", type: "textarea" },
  { key: "vehicleProfile", label: "Perfil de veículos", type: "textarea" },
  { key: "slaRequirements", label: "SLA e janelas", type: "textarea" },
  { key: "painPoints", label: "Dores logísticas", type: "textarea" },
  { key: "procurementModel", label: "Modelo de contratação", type: "textarea" },
  { key: "contractRenewalDate", label: "Renovação contratual", type: "date" },
  { key: "budgetCycle", label: "Ciclo orçamentário", type: "textarea" },
  { key: "customerTarget", label: "Target do cliente", type: "number" },
  { key: "esgMaturity", label: "Maturidade ESG", type: "select" },
  { key: "scope3Pressure", label: "Pressão para reduzir emissões da cadeia logística", type: "select" },
  { key: "electrificationTarget", label: "Meta de eletrificação", type: "textarea" },
  { key: "decisionCriteria", label: "Critérios de decisão", type: "textarea" },
  { key: "knownRisks", label: "Riscos conhecidos", type: "textarea" },
]);

export const createTodoGreenAccount = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  legalName: asText(input.legalName),
  tradeName: asText(input.tradeName),
  document: asText(input.document),
  segment: asText(input.segment),
  tier: TODO_GREEN_ACCOUNT_TIERS.includes(input.tier) ? input.tier : "Enterprise",
  temperature: TODO_GREEN_ACCOUNT_TEMPERATURES.includes(input.temperature) ? input.temperature : "",
  stage: TODO_GREEN_ACCOUNT_STAGES.includes(input.stage) ? input.stage : "Mapeamento",
  ownerId: asText(input.ownerId),
  teamIds: Array.isArray(input.teamIds) ? [...new Set(input.teamIds.filter(Boolean))] : [],
  headquarters: asText(input.headquarters),
  sites: Array.isArray(input.sites) ? input.sites : [],
  contacts: Array.isArray(input.contacts) ? input.contacts : [],
  qualification: input.qualification && typeof input.qualification === "object" ? input.qualification : {},
  strategicPotential: clamp(asNumber(input.strategicPotential)),
  relationshipStrength: clamp(asNumber(input.relationshipStrength)),
  operationalFit: clamp(asNumber(input.operationalFit)),
  esgFit: clamp(asNumber(input.esgFit)),
  dataQuality: clamp(asNumber(input.dataQuality)),
  churnRisk: clamp(asNumber(input.churnRisk)),
  nextAction: asText(input.nextAction),
  nextActionAt: asText(input.nextActionAt),
  lastInteractionAt: asText(input.lastInteractionAt),
  contractRenewalDate: asText(input.contractRenewalDate),
  ourAnnualRevenue: asNumber(input.ourAnnualRevenue),
  customerAnnualLogisticsSpend: asNumber(input.customerAnnualLogisticsSpend),
  potentialAnnual: asNumber(input.potentialAnnual),
  productPotential: input.productPotential && typeof input.productPotential === "object" ? input.productPotential : {},
  potentialManual: input.potentialManual && typeof input.potentialManual === "object" ? input.potentialManual : {},
  potentialInputs: input.potentialInputs && typeof input.potentialInputs === "object" ? input.potentialInputs : {},
  geographicExpansion: asText(input.geographicExpansion),
  accountPlan: input.accountPlan && typeof input.accountPlan === "object" ? input.accountPlan : {},
  source: asText(input.source),
  tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(asText).filter(Boolean))] : [],
  createdAt: input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const createTodoGreenContact = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  accountId: asText(input.accountId),
  name: asText(input.name),
  title: asText(input.title),
  department: asText(input.department),
  email: asText(input.email).toLowerCase(),
  phone: asText(input.phone),
  linkedin: asText(input.linkedin),
  relationshipRole: TODO_GREEN_RELATIONSHIP_ROLES.includes(normalizeRelationshipRole(input.relationshipRole))
    ? normalizeRelationshipRole(input.relationshipRole)
    : "Influenciador",
  influence: clamp(asNumber(input.influence)),
  supportLevel: clamp(asNumber(input.supportLevel), -100, 100),
  accessLevel: clamp(asNumber(input.accessLevel)),
  preferredChannel: asText(input.preferredChannel),
  personalNotes: asText(input.personalNotes),
  objections: asText(input.objections),
  priorities: asText(input.priorities),
  lastInteractionAt: asText(input.lastInteractionAt),
  nextAction: asText(input.nextAction),
  nextActionAt: asText(input.nextActionAt),
  active: input.active !== false,
  createdAt: input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// ===== A regra da saúde, escrita uma vez =====
//
// A titular pediu (30/08) que a regra da saúde ficasse CLARA na tela. Ela estava
// só no código: seis pesos aqui, uma média 70/30 ali e três gatilhos de
// classificação em outra função. Agora a régua é dado — a tela lê daqui e
// mostra nota, peso, contribuição e o motivo da classificação, em vez de exibir
// um número que ninguém sabe de onde veio.
export const PESOS_DA_SAUDE = Object.freeze([
  { id: "strategicPotential", rotulo: "Potencial estratégico", peso: 25, invertido: false, ajuda: "Tamanho do que essa conta pode virar para a To Do Green." },
  { id: "relationshipStrength", rotulo: "Força do relacionamento", peso: 20, invertido: false, ajuda: "Quanto acesso e confiança a equipe tem hoje." },
  { id: "operationalFit", rotulo: "Aderência operacional", peso: 20, invertido: false, ajuda: "O quanto a operação dela cabe na nossa malha e frota." },
  { id: "esgFit", rotulo: "Aderência ESG", peso: 15, invertido: false, ajuda: "Metas de descarbonização que a eletrificação atende." },
  { id: "dataQuality", rotulo: "Qualidade dos dados", peso: 10, invertido: false, ajuda: "Se há base suficiente para precificar sem chutar." },
  { id: "churnRisk", rotulo: "Risco de perda", peso: 10, invertido: true, ajuda: "Quanto maior o risco, menor a nota que ele gera." },
]);

export const REGRA_DA_SAUDE = Object.freeze({
  formula: "Saúde = 70% da média ponderada das seis notas + 30% da cobertura de decisores.",
  cobertura: "Cobertura é quanto do trio Quem decide / Quem apoia / Usuário operacional já está mapeado nos contatos ativos: 100%, 67%, 33% ou 0%.",
  classificacao: [
    "Crítica: a próxima ação está atrasada ou o risco de perda é 70 ou mais.",
    "Atenção: existe algum ponto de atenção aberto ou a cobertura de decisores está abaixo de 60%.",
    "Saudável: nenhum ponto de atenção aberto e cobertura de 60% ou mais.",
  ],
  semNota: "Nota em branco conta como zero: conta nova aparece com saúde baixa até alguém avaliar — é falta de avaliação, não diagnóstico ruim.",
});

// Por que a saúde desta conta está nesse número, linha por linha.
export const explicarSaudeDaConta = (account = {}, contacts = [], opportunities = []) => {
  const saude = accountHealth(account, contacts, opportunities);
  const linhas = PESOS_DA_SAUDE.map((item) => {
    const bruta = clamp(asNumber(account[item.id]));
    const efetiva = item.invertido ? 100 - bruta : bruta;
    return {
      ...item,
      nota: bruta,
      contribuicao: Math.round((efetiva * item.peso) / 100),
      preenchida: account[item.id] !== undefined && account[item.id] !== null && account[item.id] !== "",
    };
  });
  const classificacao = crmAttention({
    alerts: saude.alerts,
    coverage: saude.relationshipCoverage.score,
    churnRisk: asNumber(account.churnRisk),
  });
  const motivo = classificacao === "critical"
    ? (saude.overdue
      ? "A próxima ação combinada está atrasada."
      : "O risco de perda registrado está em 70 ou mais.")
    : classificacao === "attention"
      ? (saude.alerts[0] || "A cobertura de decisores está abaixo de 60%.")
      : "Sem pontos de atenção abertos e com o mapa de decisores coberto.";
  return {
    linhas,
    notaDasAvaliacoes: saude.accountScore,
    cobertura: saude.relationshipCoverage.score,
    score: saude.score,
    classificacao,
    motivo,
    alertas: saude.alerts,
    semAvaliacao: linhas.every((linha) => !linha.preenchida),
  };
};

export const calculateAccountScore = (account = {}) => {
  const strategic = clamp(asNumber(account.strategicPotential));
  const relationship = clamp(asNumber(account.relationshipStrength));
  const operational = clamp(asNumber(account.operationalFit));
  const esg = clamp(asNumber(account.esgFit));
  const quality = clamp(asNumber(account.dataQuality));
  const risk = clamp(asNumber(account.churnRisk));
  const score = clamp(
    strategic * 0.25 +
      relationship * 0.2 +
      operational * 0.2 +
      esg * 0.15 +
      quality * 0.1 +
      (100 - risk) * 0.1,
  );
  return Math.round(score);
};

export const calculateRelationshipCoverage = (contacts = []) => {
  const active = contacts.filter(isCurrentRelationshipContact);
  const roles = new Set(active.map((contact) => lowerRole(contact.relationshipRole)));
  const criticalRoles = ["Quem decide", "Quem apoia", "Usuário operacional"];
  const aliases = {
    "Quem decide": ["quem decide", "decisor econômico", "decisor técnico", "compras"],
    "Quem apoia": ["quem apoia", "patrocinador", "influenciador"],
    "Usuário operacional": ["usuário operacional", "usuário", "operações"],
  };
  const covered = criticalRoles.filter((role) => aliases[role].some((alias) => roles.has(alias)));
  const blockers = active.filter((contact) => ["bloqueador", "quem bloqueia", "quem atravessa"].includes(lowerRole(contact.relationshipRole))).length;
  return {
    score: Math.round((covered.length / criticalRoles.length) * 100),
    covered,
    missing: criticalRoles.filter((role) => !covered.includes(role)),
    blockers,
    totalContacts: active.length,
  };
};

export const accountHealth = (account = {}, contacts = [], opportunities = []) => {
  const accountScore = calculateAccountScore(account);
  const coverage = calculateRelationshipCoverage(contacts);
  const openOpportunities = opportunities.filter(
    (opportunity) =>
      (opportunity.accountId === account.id || opportunity.clientId === account.id) &&
      !CLOSED_STAGES.has(opportunity.stage || opportunity.estagio),
  );
  const pipeline = openOpportunities.reduce((sum, item) => sum + asNumber(item.value), 0);
  const weightedPipeline = openOpportunities.reduce(
    (sum, item) => sum + asNumber(item.value) * clamp(asNumber(item.probability)) / 100,
    0,
  );
  // Mesma régua do aviso de pendências e do filtro "Ações atrasadas": dia
  // anterior a hoje. Com o timestamp cru, a ação marcada para HOJE já entrava
  // como atrasada no contador e sumia do filtro — números que nunca fechavam.
  const overdue = contaComAcaoAtrasada(account);
  const alerts = [];
  if (coverage.score < 50) alerts.push("Mapa de decisores incompleto");
  if (!account.nextAction) alerts.push("Sem próxima ação definida");
  if (overdue) alerts.push("Próxima ação atrasada");
  if (asNumber(account.dataQuality) < 60) alerts.push("Dados insuficientes para decisão");
  if (asNumber(account.churnRisk) >= 60) alerts.push("Risco comercial elevado");
  if (!openOpportunities.length && ["Cliente ativo", "Expansão"].includes(account.stage))
    alerts.push("Sem oportunidade de expansão registrada");
  return {
    score: Math.round(accountScore * 0.7 + coverage.score * 0.3),
    accountScore,
    relationshipCoverage: coverage,
    pipeline,
    weightedPipeline,
    openOpportunities: openOpportunities.length,
    overdue,
    alerts,
  };
};

export const crmAttention = (summary = {}) => {
  const alerts = Array.isArray(summary.alerts) ? summary.alerts : [];
  if (alerts.includes("Próxima ação atrasada") || asNumber(summary.churnRisk) >= 70)
    return "critical";
  if (alerts.length || asNumber(summary.coverage) < 60) return "attention";
  return "healthy";
};

export const buildCrmCommandCenter = (accounts = [], opportunities = [], now = new Date()) => {
  const summaries = accounts.map((account) => {
    const contacts = Array.isArray(account.contacts) ? account.contacts : [];
    const summary = crmAccountSummary(account, contacts, opportunities);
    return {
      ...summary,
      churnRisk: asNumber(account.churnRisk),
      attention: crmAttention({ ...summary, churnRisk: account.churnRisk }),
      nextActionAt: account.nextActionAt || "",
      // Mesma régua do filtro "Ações atrasadas" e do aviso de pendências: dia
      // anterior a hoje. Comparar timestamp fazia o cartão contar a ação de HOJE
      // e a lista, que compara dia, abrir sem ela.
      overdue: contaComAcaoAtrasada(account, diaDaData(now)),
    };
  });
  const open = opportunities.filter(
    (item) => !CLOSED_STAGES.has(item.stage || item.estagio),
  );
  const totalPipeline = summaries.reduce((sum, item) => sum + asNumber(item.pipeline), 0);
  const weightedPipeline = summaries.reduce(
    (sum, item) => sum + asNumber(item.weightedPipeline),
    0,
  );
  return {
    accounts: summaries.sort((a, b) => {
      const order = { critical: 0, attention: 1, healthy: 2 };
      return order[a.attention] - order[b.attention] || b.pipeline - a.pipeline;
    }),
    totalAccounts: accounts.length,
    openOpportunities: open.length,
    totalPipeline,
    weightedPipeline,
    overdueActions: summaries.filter((item) => item.overdue).length,
    relationshipGaps: summaries.filter((item) => item.coverage < 60).length,
  };
};

export const recommendNextCommercialAction = ({ account = {}, contacts = [], opportunities = [] } = {}) => {
  const health = accountHealth(account, contacts, opportunities);
  if (!account.nextAction) return "Definir próxima ação, responsável e data.";
  if (health.overdue) return `Executar ação atrasada: ${account.nextAction}`;
  if (health.relationshipCoverage.missing.includes("Quem decide"))
    return "Mapear e acessar quem decide a contratação logística.";
  if (health.relationshipCoverage.missing.includes("Quem apoia"))
    return "Construir patrocinador interno para sustentar a oportunidade.";
  if (asNumber(account.dataQuality) < 60)
    return "Concluir diagnóstico logístico antes de precificar.";
  if (asNumber(account.esgFit) >= 70 && !account.qualification?.electrificationTarget)
    return "Validar metas de eletrificação e redução de emissões da cadeia logística do cliente.";
  if (!health.openOpportunities && ["Cliente ativo", "Expansão"].includes(account.stage))
    return "Abrir oportunidade de expansão por rota, região ou produto.";
  return account.nextAction;
};

// Gravidade dos alertas de uma conta, do mais urgente ao menos. A lista do CRM
// mostra o alerta principal em cada cartão — o PORQUÊ da conta pedir atenção,
// não só a cor. `accountHealth.alerts` empilha na ordem em que detecta; aqui a
// ordem é por severidade, uma só, para o cartão e um eventual relatório
// concordarem sobre qual mostrar primeiro.
const GRAVIDADE_DO_ALERTA = [
  "Próxima ação atrasada",
  "Risco comercial elevado",
  "Sem próxima ação definida",
  "Mapa de decisores incompleto",
  "Dados insuficientes para decisão",
  "Sem oportunidade de expansão registrada",
];

export const alertasOrdenados = (summary = {}) => {
  const alerts = Array.isArray(summary.alerts) ? summary.alerts : [];
  const rank = (a) => {
    const i = GRAVIDADE_DO_ALERTA.indexOf(a);
    return i === -1 ? GRAVIDADE_DO_ALERTA.length : i;
  };
  return [...alerts].sort((a, b) => rank(a) - rank(b));
};

// O alerta principal de uma conta (o mais grave), ou "" quando a conta está
// saudável. Traz junto a severidade para a cor do chip: crítico quando é ação
// atrasada ou risco elevado, senão atenção.
export const alertaPrincipal = (summary = {}) => {
  const [topo] = alertasOrdenados(summary);
  if (!topo) return null;
  const critico = topo === "Próxima ação atrasada" || topo === "Risco comercial elevado";
  return { rotulo: topo, severidade: critico ? "critical" : "attention" };
};

export const crmAccountSummary = (account = {}, contacts = [], opportunities = []) => {
  const health = accountHealth(account, contacts, opportunities);
  return {
    id: account.id,
    name: account.tradeName || account.legalName || "Conta sem nome",
    tier: account.tier,
    stage: account.stage,
    ownerId: account.ownerId,
    score: health.score,
    pipeline: health.pipeline,
    weightedPipeline: health.weightedPipeline,
    contacts: health.relationshipCoverage.totalContacts,
    coverage: health.relationshipCoverage.score,
    alerts: health.alerts,
    nextAction: recommendNextCommercialAction({ account, contacts, opportunities }),
  };
};

const PRODUCT_LABELS = Object.freeze({
  "middle-mile": "Middle mile",
  "last-mile": "Last mile",
  dedicated: "Operação dedicada",
});

const daysSince = (value, now = new Date()) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time)
    ? Math.max(0, Math.floor((now.getTime() - time) / 86400000))
    : null;
};

const contactGroup = (contacts, roles, terms = []) => contacts.filter((contact) => {
  const role = lowerRole(contact.relationshipRole);
  const profile = lowerRole(`${contact.title} ${contact.department} ${contact.specialty}`);
  return roles.includes(role) || terms.some((term) => profile.includes(term));
});

const lowerRole = (value) => asText(value).toLocaleLowerCase("pt-BR");

const canonicalProductId = (value) => {
  const id = lowerRole(value).replace(/[_\s]+/g, "-");
  if (id.includes("middle")) return "middle-mile";
  if (id.includes("last")) return "last-mile";
  if (id.includes("dedic")) return "dedicated";
  return id;
};

const calculatedAnnualPotential = (quantity, averageTicket) => {
  const monthlyQuantity = asNumber(quantity);
  const ticket = asNumber(averageTicket);
  return monthlyQuantity > 0 && ticket > 0 ? monthlyQuantity * ticket * 12 : null;
};

export const calculatePortfolioPotential = (account = {}) => {
  const inputs = account.potentialInputs || {};
  const registered = account.potentialManual?.products || account.productPotential || {};
  const products = {
    middleMile: {
      calculated: calculatedAnnualPotential(inputs.middleMileMonthlyTrips, inputs.middleMileAverageTicket),
      registered: asNumber(registered.middleMile) || null,
      missing: [
        !asNumber(inputs.middleMileMonthlyTrips) && "viagens mensais",
        !asNumber(inputs.middleMileAverageTicket) && "ticket médio por viagem",
      ].filter(Boolean),
    },
    lastMile: {
      calculated: calculatedAnnualPotential(inputs.lastMileMonthlyDeliveries, inputs.lastMileAverageTicket),
      registered: asNumber(registered.lastMile) || null,
      missing: [
        !asNumber(inputs.lastMileMonthlyDeliveries) && "entregas mensais",
        !asNumber(inputs.lastMileAverageTicket) && "ticket médio por entrega",
      ].filter(Boolean),
    },
    dedicated: {
      calculated: calculatedAnnualPotential(inputs.dedicatedMonthlyVehicles, inputs.dedicatedMonthlyTicket),
      registered: asNumber(registered.dedicated) || null,
      missing: [
        !asNumber(inputs.dedicatedMonthlyVehicles) && "veículos dedicados",
        !asNumber(inputs.dedicatedMonthlyTicket) && "mensalidade média por veículo",
      ].filter(Boolean),
    },
  };
  const productValue = (key) => products[key].calculated ?? products[key].registered;
  const productValues = Object.keys(products).map(productValue).filter((value) => value !== null);
  const calculatedProducts = Object.values(products).filter((item) => item.calculated !== null).length;
  const registeredAnnual = asNumber(account.potentialManual?.annual ?? account.potentialAnnual) || null;
  const productSum = productValues.reduce((sum, value) => sum + value, 0);
  const annual = productValues.length === 3 ? productSum : registeredAnnual || productSum || null;
  return {
    annual,
    middleMile: productValue("middleMile"),
    lastMile: productValue("lastMile"),
    dedicated: productValue("dedicated"),
    geographicExpansion: asText(account.geographicExpansion || account.qualification?.geographicExpansion),
    method: productValues.length === 3 && calculatedProducts
      ? `${calculatedProducts} produto(s) calculado(s) por quantidade mensal × ticket médio × 12`
      : registeredAnnual && calculatedProducts
        ? `Potencial anual informado; ${calculatedProducts} produto(s) calculado(s) por quantidade mensal × ticket médio × 12`
        : productValues.length === 3
        ? "Soma dos potenciais cadastrados por produto"
        : registeredAnnual
          ? "Potencial anual informado manualmente"
          : productValues.length
            ? "Soma parcial dos produtos com dados informados"
          : "Sem base suficiente para cálculo",
    calculatedProducts,
    missing: !annual,
    missingByProduct: Object.fromEntries(Object.entries(products).map(([key, item]) => [key, item.missing])),
  };
};

export const buildAccountIntelligence = ({ account = {}, contacts = [], opportunities = [], now = new Date() } = {}) => {
  const accountOpportunities = opportunities.filter((item) =>
    item.accountId === account.id || item.clientId === account.id,
  );
  const open = accountOpportunities.filter((item) =>
    !CLOSED_STAGES.has(item.stage || item.estagio),
  );
  const usedProducts = new Set(accountOpportunities.map((item) => canonicalProductId(item.productId || item.produto)).filter(Boolean));
  const qualification = account.qualification || {};
  const potential = calculatePortfolioPotential(account);
  const lastContactDays = daysSince(account.lastInteractionAt, now);
  const renewalDays = account.contractRenewalDate
    ? Math.ceil((Date.parse(account.contractRenewalDate) - now.getTime()) / 86400000)
    : null;
  const stalledProposal = open.find((item) => {
    const stage = lowerRole(item.stage || item.estagio);
    const age = daysSince(item.updatedAt || item.createdAt, now);
    return stage.includes("proposta") && age !== null && age >= 21;
  });
  const withoutNextStep = open.filter((item) => !asText(item.nextStep || item.proximoPasso));
  const health = [];
  if (lastContactDays === null) health.push("Último contato não registrado");
  else if (lastContactDays >= 30) health.push(`Sem contato há ${lastContactDays} dias`);
  if (stalledProposal) health.push("Proposta parada há pelo menos 21 dias");
  if (renewalDays !== null && renewalDays >= 0 && renewalDays <= 90)
    health.push(`Contrato vence em ${renewalDays} dias`);
  if (withoutNextStep.length)
    health.push(`${withoutNextStep.length} oportunidade(s) sem próxima ação`);
  if (!health.length) health.push("Nenhum alerta comercial objetivo com os dados atuais");

  const currentRelationshipContacts = contacts.filter(isCurrentRelationshipContact);
  const buyers = contactGroup(currentRelationshipContacts, ["compras", "decisor econômico", "quem decide"], ["procurement", "compras", "suprimentos", "sourcing"]);
  const influencers = contactGroup(currentRelationshipContacts, ["influenciador", "patrocinador", "decisor técnico", "quem apoia"]);
  const blockers = contactGroup(currentRelationshipContacts, ["bloqueador", "quem bloqueia", "quem atravessa"]);
  const users = contactGroup(currentRelationshipContacts, ["usuário", "operações"], ["operações", "logística", "transportes"]);
  const uniqueNames = (items) => [...new Set(items.map((item) => item.name).filter(Boolean))];
  if (blockers.length) health.push(`${blockers.length} contato(s) mapeado(s) como bloqueio político da conta`);
  const plan = account.accountPlan || {};
  const whiteSpace = Object.entries(PRODUCT_LABELS)
    .filter(([id]) => !usedProducts.has(id))
    .map(([, label]) => label);
  const nextBestAction = recommendNextCommercialAction({ account, contacts, opportunities });
  const customerSpend = asNumber(account.customerAnnualLogisticsSpend);
  const ourRevenue = asNumber(account.ourAnnualRevenue);
  const ourRevenueProvided = ourRevenue > 0;
  const shareOfWallet = customerSpend > 0 && ourRevenueProvided ? {
    percentage: Math.round(Math.min(100, (ourRevenue / customerSpend) * 100) * 10) / 10,
    remaining: Math.max(0, customerSpend - ourRevenue),
    ourRevenue,
    customerSpend,
    status: "calculated",
  } : {
    percentage: null,
    remaining: null,
    ourRevenue,
    customerSpend: null,
    status: customerSpend > 0 ? "missing-our-revenue" : "missing-customer-spend",
  };
  const objective = asText(plan.objective) || (whiteSpace.length
    ? `Qualificar expansão da conta em ${whiteSpace[0]}.`
    : "Consolidar a operação atual e proteger a renovação da conta.");
  const barriers = asText(plan.barriers) || health
    .filter((item) => item !== "Nenhum alerta comercial objetivo com os dados atuais")
    .join("; ");
  const plan30 = asText(plan.plan30) || nextBestAction;
  const plan60 = asText(plan.plan60) || (potential.missing
    ? "Completar volumes mensais e tickets médios para dimensionar o potencial."
    : whiteSpace.length
      ? `Validar demanda, rotas e decisores para ${whiteSpace[0]}.`
      : "Revisar satisfação, SLA e oportunidades de eficiência da operação atual.");
  const plan90 = asText(plan.plan90) || (open.length
    ? "Revisar avanço do pipeline, proposta, margem e próxima decisão do cliente."
    : "Registrar uma oportunidade somente após confirmar escopo, valor e decisores.");

  return {
    potential,
    shareOfWallet,
    relationshipMap: {
      buyers: uniqueNames(buyers),
      influencers: uniqueNames(influencers),
      blockers: uniqueNames(blockers),
      users: uniqueNames(users),
    },
    whiteSpace,
    commercialHealth: health,
    accountPlan: {
      objective,
      barriers,
      competitors: asText(plan.competitors || qualification.currentSuppliers),
      plan30,
      plan60,
      plan90,
      generated: {
        objective: !asText(plan.objective),
        barriers: !asText(plan.barriers) && Boolean(barriers),
        plan30: !asText(plan.plan30),
        plan60: !asText(plan.plan60),
        plan90: !asText(plan.plan90),
      },
    },
  };
};
