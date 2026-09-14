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
