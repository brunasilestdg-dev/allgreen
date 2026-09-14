// ===== Green On — CRM de eletromobilidade (recarga e energia) =====
//
// Camada pura. O CRM da Green On não é o CRM logístico da To Do Green: o
// funil aqui vai de um lead com interesse em energia até a operação de um
// site de recarga. As etapas refletem esse processo — diagnóstico energético,
// levantamento técnico, projeto elétrico, proposta, instalação,
// comissionamento e operação — porque cada uma tem entregável e responsável
// diferentes, e o motor de reuso do resto do produto (contatos, tarefas,
// documentos) não precisa saber que o funil mudou.

const asText = (value) => String(value ?? "").trim();

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const CLOSED_STAGES = new Set(["Operação", "Perdido"]);

export const GREEN_ON_PIPELINE_STAGES = Object.freeze([
  { id: "lead", name: "Lead", probability: 5, description: "Primeiro contato com interesse em recarga ou energia." },
  { id: "diagnostico", name: "Diagnóstico energético", probability: 15, description: "Entendimento de consumo, perfil e potencial." },
  { id: "levantamento", name: "Levantamento técnico", probability: 30, description: "Visita, medição do padrão, disponibilidade elétrica." },
  { id: "projeto", name: "Projeto", probability: 45, description: "Anteprojeto elétrico, escolha de carregadores e layout." },
  { id: "proposta", name: "Proposta", probability: 60, description: "Escopo e preço formalizados; aprovação pendente." },
  { id: "instalacao", name: "Instalação", probability: 80, description: "Obra civil, elétrica e montagem dos carregadores." },
  { id: "comissionamento", name: "Comissionamento", probability: 92, description: "Testes, homologação e integração com o CSMS." },
  { id: "operacao", name: "Operação", probability: 100, description: "Site ativo, com sessões, faturamento e SLA em curso.", won: true },
  { id: "perdido", name: "Perdido", probability: 0, description: "Cliente desistiu ou não avançou.", lost: true },
]);

export const GREEN_ON_CLIENT_SEGMENTS = Object.freeze([
  "Condomínio",
  "Shopping",
  "Frota corporativa",
  "Concessionária",
  "Posto/hub público",
  "Indústria",
  "Poder público",
  "Outro",
]);

export const GREEN_ON_ENERGY_SOURCES = Object.freeze([
  "Rede",
  "Solar próprio",
  "BESS",
  "Contrato de energia renovável",
  "Não informado",
]);

// Um site (local de recarga) é o centro de gravidade do relacionamento: a
// oportunidade pertence a um site em construção, o contrato ao operacional,
// as sessões acontecem lá. Guardar o site normaliza o cadastro entre CRM,
// billing e telemetria.
export const createGreenOnSite = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  name: asText(input.name),
  clientName: asText(input.clientName),
  segment: GREEN_ON_CLIENT_SEGMENTS.includes(input.segment) ? input.segment : "",
  city: asText(input.city),
  state: asText(input.state).slice(0, 2).toUpperCase(),
  ownerId: asText(input.ownerId),
  energySource: GREEN_ON_ENERGY_SOURCES.includes(input.energySource) ? input.energySource : "",
  contractedDemandKw: Math.max(0, asNumber(input.contractedDemandKw)),
  chargerCount: Math.max(0, Math.round(asNumber(input.chargerCount))),
  createdAt: input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: input.active !== false,
});

export const createGreenOnOpportunity = (input = {}) => {
  const stage = GREEN_ON_PIPELINE_STAGES.find((s) => s.id === input.stageId)
    ? input.stageId
    : "lead";
  return {
    id: input.id || crypto.randomUUID(),
    title: asText(input.title),
    clientName: asText(input.clientName),
    // Vínculo opcional com a conta Green On (para saúde da conta e pipeline
    // ponderado — sem accountId a oportunidade fica "avulsa", ainda visível
    // no funil geral).
    accountId: asText(input.accountId),
    siteId: asText(input.siteId),
    stageId: stage,
    estimatedKw: Math.max(0, asNumber(input.estimatedKw)),
    estimatedChargers: Math.max(0, Math.round(asNumber(input.estimatedChargers))),
    // CAPEX estimado da instalação (obra + equipamentos) em BRL.
    capexBRL: Math.max(0, asNumber(input.capexBRL)),
    // Receita mensal esperada de energia + serviço (BRL).
    monthlyRevenueBRL: Math.max(0, asNumber(input.monthlyRevenueBRL)),
    ownerId: asText(input.ownerId),
    expectedGoLive: asText(input.expectedGoLive),
    notes: asText(input.notes),
    lossReason: asText(input.lossReason),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const stageById = (stageId) =>
  GREEN_ON_PIPELINE_STAGES.find((s) => s.id === stageId) || null;

export const isOpen = (opp) => {
  const stage = stageById(opp?.stageId);
  return !!stage && !stage.won && !stage.lost;
};

export const opportunityProbability = (opp) => {
  const stage = stageById(opp?.stageId);
  return stage ? Number(stage.probability) || 0 : 0;
};

// Ponderação de receita anual esperada: base para forecast simples do funil.
export const weightedAnnualRevenue = (opp) => {
  const monthly = Math.max(0, asNumber(opp?.monthlyRevenueBRL));
  const probability = opportunityProbability(opp);
  return Math.round(((monthly * 12) * probability) / 100);
};

export const pipelineSummary = (opportunities = []) => {
  const openOnes = opportunities.filter(isOpen);
  const won = opportunities.filter((o) => stageById(o.stageId)?.won);
  const lost = opportunities.filter((o) => stageById(o.stageId)?.lost);
  const forecast = openOnes.reduce((total, opp) => total + weightedAnnualRevenue(opp), 0);
  const capex = openOnes.reduce((total, opp) => total + asNumber(opp.capexBRL), 0);
  const chargers = openOnes.reduce((total, opp) => total + asNumber(opp.estimatedChargers), 0);
  return {
    open: openOnes.length,
    won: won.length,
    lost: lost.length,
    forecastAnnualRevenue: forecast,
    pipelineCapex: capex,
    plannedChargers: chargers,
  };
};

// Contagem por etapa preservando a ordem canônica do pipeline; útil para
// desenhar o funil sem inventar etapas nem esconder as vazias — uma etapa
// zerada em "Comissionamento" é uma informação, não um bug de UI.
export const stageMetrics = (opportunities = []) =>
  GREEN_ON_PIPELINE_STAGES.filter((s) => !s.lost).map((stage) => {
    const items = opportunities.filter((opp) => opp.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      description: stage.description,
      total: items.length,
      pipelineCapex: items.reduce((total, opp) => total + asNumber(opp.capexBRL), 0),
      forecastRevenue: items.reduce((total, opp) => total + weightedAnnualRevenue(opp), 0),
      closed: CLOSED_STAGES.has(stage.name) || !!stage.won,
    };
  });

// Alertas simples: oportunidade sem responsável, sem previsão ou parada há
// muito tempo em uma etapa (usa updatedAt como âncora). Trás o "por quê"
// para o card, sem inventar razão.
export const opportunityAlerts = (opp, referenceDate = new Date()) => {
  const alerts = [];
  if (!opp?.ownerId) alerts.push("Sem responsável");
  if (isOpen(opp) && !opp?.expectedGoLive) alerts.push("Sem previsão de entrada em operação");
  const updated = new Date(opp?.updatedAt || 0).getTime();
  const now = referenceDate.getTime();
  if (updated > 0 && isOpen(opp)) {
    const diasParado = Math.floor((now - updated) / (1000 * 60 * 60 * 24));
    if (diasParado > 21) alerts.push(`Parada há ${diasParado} dias`);
  }
  return alerts;
};

// ===== Contas, contatos e saúde — o CRM comercial, versão Green On =====
//
// A titular pediu que o CRM da Green On tenha a mesma profundidade do CRM
// comercial da To Do Green (contas, contatos, papéis, saúde, próxima ação),
// só que independente. Os campos abaixo espelham a estrutura da TDG mas com
// vocabulário próprio: "site de recarga" no lugar de "sede", potencial
// medido em kW/carregadores/MWh no lugar de veículos e SLA, e pontuações
// específicas ao mundo de energia (aderência energética, maturidade de
// eletrificação, risco regulatório).

export const GREEN_ON_ACCOUNT_TIERS = Object.freeze([
  "Estratégica",
  "Enterprise",
  "Grande conta",
  "Média conta",
  "Parceiro",
]);

export const GREEN_ON_ACCOUNT_TEMPERATURES = Object.freeze(["Quente", "Morno", "Frio"]);

export const GREEN_ON_ACCOUNT_STAGES = Object.freeze([
  "Mapeamento",
  "Prospecção",
  "Diagnóstico energético",
  "Levantamento técnico",
  "Projeto",
  "Proposta",
  "Contrato",
  "Instalação",
  "Comissionamento",
  "Cliente ativo",
  "Expansão",
  "Risco",
  "Inativo",
]);

// Papéis de decisão típicos numa venda de infraestrutura de recarga. NÃO é o
// mesmo do CRM logístico: aqui aparecem gestor de energia, engenharia
// predial, condomínio, etc.
export const GREEN_ON_RELATIONSHIP_ROLES = Object.freeze([
  "Decisor econômico",
  "Decisor técnico",
  "Gestor de energia",
  "Engenharia predial",
  "Manutenção",
  "Facilities",
  "Compras",
  "Jurídico",
  "Financeiro",
  "Sustentabilidade",
  "Síndico/Condomínio",
  "Concessionária",
  "Usuário operacional",
  "Bloqueador",
]);

// Notas críticas para a decisão de venda de infra elétrica. Cada peso reflete
// o que costuma travar ou destravar um site: potencial estratégico do local,
// aderência energética (existência de padrão, distância do PT, sombra, etc.),
// maturidade de eletrificação da frota do cliente e a força do relacionamento.
export const GREEN_ON_PESOS_DA_SAUDE = Object.freeze([
  { id: "strategicPotential", rotulo: "Potencial estratégico", peso: 25, invertido: false, ajuda: "Quanto o site pode virar em receita mensal de energia + serviço." },
  { id: "energyFit", rotulo: "Aderência energética", peso: 20, invertido: false, ajuda: "Existe padrão elétrico? Distância do transformador? Disponibilidade de demanda?" },
  { id: "electrificationMaturity", rotulo: "Maturidade de eletrificação", peso: 15, invertido: false, ajuda: "Cliente já tem VE ou frota parcial? Quanto mais adiantado, mais pronto a fechar." },
  { id: "relationshipStrength", rotulo: "Força do relacionamento", peso: 15, invertido: false, ajuda: "Acesso e confiança com os decisores do site." },
  { id: "esgFit", rotulo: "Aderência ESG", peso: 10, invertido: false, ajuda: "Metas de descarbonização declaradas pelo cliente." },
  { id: "dataQuality", rotulo: "Qualidade dos dados", peso: 10, invertido: false, ajuda: "Há consumo, demanda e conta de luz para dimensionar sem chutar." },
  { id: "regulatoryRisk", rotulo: "Risco regulatório", peso: 5, invertido: true, ajuda: "Quanto maior o risco (ANEEL, distribuidora, licenças), menor a nota." },
]);

// Cria uma conta Green On com o formato completo — semelhante à conta TDG,
// porém com campos específicos ao negócio de recarga/energia.
export const createGreenOnAccount = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  legalName: asText(input.legalName),
  tradeName: asText(input.tradeName),
  document: asText(input.document),
  segment: GREEN_ON_CLIENT_SEGMENTS.includes(input.segment) ? input.segment : "",
  tier: GREEN_ON_ACCOUNT_TIERS.includes(input.tier) ? input.tier : "Enterprise",
  temperature: GREEN_ON_ACCOUNT_TEMPERATURES.includes(input.temperature) ? input.temperature : "",
  stage: GREEN_ON_ACCOUNT_STAGES.includes(input.stage) ? input.stage : "Mapeamento",
  ownerId: asText(input.ownerId),
  teamIds: Array.isArray(input.teamIds) ? [...new Set(input.teamIds.filter(Boolean))] : [],
  headquarters: asText(input.headquarters),
  city: asText(input.city),
  state: asText(input.state).slice(0, 2).toUpperCase(),
  sites: Array.isArray(input.sites) ? input.sites : [],
  contacts: Array.isArray(input.contacts) ? input.contacts : [],
  qualification: input.qualification && typeof input.qualification === "object" ? input.qualification : {},
  // Notas (0-100) que alimentam a saúde da conta.
  strategicPotential: clamp(asNumber(input.strategicPotential), 0, 100),
  energyFit: clamp(asNumber(input.energyFit), 0, 100),
  electrificationMaturity: clamp(asNumber(input.electrificationMaturity), 0, 100),
  relationshipStrength: clamp(asNumber(input.relationshipStrength), 0, 100),
  esgFit: clamp(asNumber(input.esgFit), 0, 100),
  dataQuality: clamp(asNumber(input.dataQuality), 0, 100),
  regulatoryRisk: clamp(asNumber(input.regulatoryRisk), 0, 100),
  churnRisk: clamp(asNumber(input.churnRisk), 0, 100),
  nextAction: asText(input.nextAction),
  nextActionAt: asText(input.nextActionAt),
  lastInteractionAt: asText(input.lastInteractionAt),
  contractRenewalDate: asText(input.contractRenewalDate),
  ourAnnualRevenue: Math.max(0, asNumber(input.ourAnnualRevenue)),
  potentialAnnual: Math.max(0, asNumber(input.potentialAnnual)),
  potentialChargers: Math.max(0, Math.round(asNumber(input.potentialChargers))),
  potentialKw: Math.max(0, asNumber(input.potentialKw)),
  source: asText(input.source),
  tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(asText).filter(Boolean))] : [],
  notes: asText(input.notes),
  createdAt: input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: input.active !== false,
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export const createGreenOnContact = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  accountId: asText(input.accountId),
  name: asText(input.name),
  title: asText(input.title),
  department: asText(input.department),
  email: asText(input.email).toLowerCase(),
  phone: asText(input.phone),
  linkedin: asText(input.linkedin),
  relationshipRole: GREEN_ON_RELATIONSHIP_ROLES.includes(input.relationshipRole)
    ? input.relationshipRole
    : "Decisor técnico",
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

// Saúde da conta — mesma lógica da TDG (média ponderada das notas +
// cobertura de decisores), porém pesos e papéis específicos ao mundo Green On.
export const calculateGreenOnAccountScore = (account = {}) => {
  const pesos = GREEN_ON_PESOS_DA_SAUDE;
  const score = pesos.reduce((total, item) => {
    const bruta = clamp(asNumber(account[item.id]));
    const efetiva = item.invertido ? 100 - bruta : bruta;
    return total + (efetiva * item.peso) / 100;
  }, 0);
  return Math.round(clamp(score));
};

// Cobertura de decisores — três papéis-chave numa venda Green On.
export const calculateGreenOnRelationshipCoverage = (contacts = []) => {
  const ativos = contacts.filter((c) => c && c.active !== false && c.name);
  const papeisPresentes = new Set(ativos.map((c) => c.relationshipRole));
  const chaves = ["Decisor econômico", "Decisor técnico", "Gestor de energia"];
  const cobertos = chaves.filter((papel) => papeisPresentes.has(papel));
  const bloqueadores = ativos.filter((c) => c.relationshipRole === "Bloqueador").length;
  return {
    score: Math.round((cobertos.length / chaves.length) * 100),
    covered: cobertos,
    missing: chaves.filter((papel) => !cobertos.includes(papel)),
    blockers: bloqueadores,
    totalContacts: ativos.length,
  };
};

// Saúde consolidada + alertas. Mantém o padrão TDG: alertas curtos, para
// aparecer no card da conta sem ninguém precisar abrir para saber por quê.
export const greenOnAccountHealth = (account = {}, contacts = [], opportunities = []) => {
  const accountScore = calculateGreenOnAccountScore(account);
  const coverage = calculateGreenOnRelationshipCoverage(contacts);
  const abertas = opportunities.filter(
    (opp) => opp.accountId === account.id && isOpen(opp),
  );
  const pipeline = abertas.reduce((total, opp) => total + asNumber(opp.capexBRL), 0);
  const forecast = abertas.reduce((total, opp) => total + weightedAnnualRevenue(opp), 0);
  const alerts = [];
  if (coverage.score < 50) alerts.push("Mapa de decisores incompleto");
  if (!account.nextAction) alerts.push("Sem próxima ação definida");
  if (asNumber(account.dataQuality) < 60) alerts.push("Dados insuficientes para dimensionar");
  if (asNumber(account.energyFit) < 40) alerts.push("Aderência energética baixa — validar padrão");
  if (asNumber(account.regulatoryRisk) >= 70) alerts.push("Risco regulatório alto");
  if (asNumber(account.churnRisk) >= 60) alerts.push("Risco de perda elevado");
  if (
    !abertas.length &&
    ["Cliente ativo", "Expansão"].includes(account.stage)
  ) {
    alerts.push("Cliente ativo sem oportunidade de expansão registrada");
  }
  const classificacao =
    asNumber(account.churnRisk) >= 70 ? "critical"
    : alerts.length || coverage.score < 60 ? "attention"
    : "healthy";
  return {
    score: Math.round(accountScore * 0.7 + coverage.score * 0.3),
    accountScore,
    relationshipCoverage: coverage,
    pipelineCapex: pipeline,
    forecastAnnualRevenue: forecast,
    openOpportunities: abertas.length,
    alerts,
    classificacao,
  };
};

// Resumo de conta para renderizar cards — mesma ideia do accountSummary da TDG,
// só que com métricas Green On (potência estimada, número de sites).
export const greenOnAccountSummary = (account = {}, contacts = [], opportunities = []) => {
  const saude = greenOnAccountHealth(account, contacts, opportunities);
  const contatosAtivos = contacts.filter((c) => c && c.active !== false && c.accountId === account.id);
  return {
    id: account.id,
    legalName: account.legalName || account.tradeName,
    tradeName: account.tradeName,
    tier: account.tier,
    stage: account.stage,
    temperature: account.temperature,
    city: account.city,
    state: account.state,
    ownerId: account.ownerId,
    nextAction: account.nextAction,
    nextActionAt: account.nextActionAt,
    contactsCount: contatosAtivos.length,
    ...saude,
  };
};

// Painel do CRM: consolida todas as contas em números que a liderança olha.
export const buildGreenOnCommandCenter = (accounts = [], contacts = [], opportunities = []) => {
  const contatosPorConta = new Map();
  for (const contato of contacts) {
    const lista = contatosPorConta.get(contato.accountId) || [];
    lista.push(contato);
    contatosPorConta.set(contato.accountId, lista);
  }
  const resumos = accounts.map((account) =>
    greenOnAccountSummary(account, contatosPorConta.get(account.id) || [], opportunities),
  );
  const criticas = resumos.filter((r) => r.classificacao === "critical").length;
  const atencao = resumos.filter((r) => r.classificacao === "attention").length;
  const saudaveis = resumos.filter((r) => r.classificacao === "healthy").length;
  return {
    total: resumos.length,
    criticas,
    atencao,
    saudaveis,
    pipelineCapex: resumos.reduce((t, r) => t + r.pipelineCapex, 0),
    forecast: resumos.reduce((t, r) => t + r.forecastAnnualRevenue, 0),
    resumos,
  };
};

// KPI de operação (sites em operação vs em construção). Alimenta o dashboard
// da vertical; separado do pipeline para deixar claro o que é "vendendo" e
// o que é "operando".
export const operationalSummary = (opportunities = [], sites = []) => {
  const activeSites = sites.filter((s) => s.active !== false);
  const emOperacao = opportunities.filter((o) => stageById(o.stageId)?.won).length;
  const emConstrucao = opportunities.filter((o) => {
    const stage = stageById(o.stageId);
    return stage && ["instalacao", "comissionamento"].includes(stage.id);
  }).length;
  const potenciaContratada = activeSites.reduce((total, s) => total + asNumber(s.contractedDemandKw), 0);
  return {
    sitesAtivos: activeSites.length,
    sitesEmOperacao: emOperacao,
    sitesEmConstrucao: emConstrucao,
    potenciaContratadaKw: potenciaContratada,
  };
};
