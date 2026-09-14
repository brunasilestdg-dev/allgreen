// ===== Greenmob — CRM de locação de veículos elétricos =====
//
// Camada pura. A jornada de locação começa quando o cliente descreve a frota
// desejada, passa por cotação/proposta/contrato e vira reserva → entrega →
// locação ativa. Cada etapa aqui tem entregável diferente e prazo próprio,
// por isso o CRM Greenmob NÃO é o CRM da To Do Green apenas com outro nome.

const asText = (value) => String(value ?? "").trim();

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const GREENMOB_PIPELINE_STAGES = Object.freeze([
  { id: "lead", name: "Lead", probability: 5, description: "Interesse manifestado (formulário, indicação, evento)." },
  { id: "perfil-frota", name: "Perfil da frota", probability: 15, description: "Uso, quilometragem, jornada e restrições." },
  { id: "cotacao", name: "Cotação", probability: 30, description: "Simulação de mensalidade e franquia por veículo." },
  { id: "proposta", name: "Proposta", probability: 55, description: "Proposta formal enviada, aguardando decisão." },
  { id: "contrato", name: "Contrato", probability: 75, description: "Contrato em elaboração/assinatura." },
  { id: "reserva", name: "Reserva", probability: 85, description: "Veículos reservados aguardando entrega." },
  { id: "entrega", name: "Entrega", probability: 92, description: "Vistoria e entrega efetiva do(s) veículo(s)." },
  { id: "locacao-ativa", name: "Locação ativa", probability: 100, description: "Contrato em vigência (faturamento mensal em curso).", won: true },
  { id: "renovacao", name: "Renovação", probability: 100, description: "Renovação/upsell em andamento." },
  { id: "devolvido", name: "Devolvido", probability: 100, description: "Contrato encerrado por devolução." },
  { id: "perdido", name: "Perdido", probability: 0, description: "Cliente desistiu ou não avançou.", lost: true },
]);

export const GREENMOB_CLIENT_TYPES = Object.freeze([
  "PJ - Empresa",
  "PJ - Frota corporativa",
  "PJ - Locadora parceira",
  "PF - Motorista de aplicativo",
  "PF - Uso pessoal",
]);

// Motivos de perda focados na jornada de locação (não repetir o do CRM
// logístico da TDG, que trata leilão/RFQ/fretes).
export const GREENMOB_LOSS_REASONS = Object.freeze([
  "Preço da mensalidade",
  "Franquia de km insuficiente",
  "Autonomia do veículo",
  "Prazo de entrega",
  "Escolheu concorrente",
  "Optou por comprar",
  "Sem crédito aprovado",
  "Sem resposta",
  "Outro",
]);

export const createGreenmobLead = (input = {}) => {
  const stage = GREENMOB_PIPELINE_STAGES.find((s) => s.id === input.stageId)
    ? input.stageId
    : "lead";
  return {
    id: input.id || crypto.randomUUID(),
    clientName: asText(input.clientName),
    clientType: GREENMOB_CLIENT_TYPES.includes(input.clientType) ? input.clientType : "PJ - Empresa",
    contactName: asText(input.contactName),
    contactEmail: asText(input.contactEmail),
    contactPhone: asText(input.contactPhone),
    city: asText(input.city),
    state: asText(input.state).slice(0, 2).toUpperCase(),
    fleetSize: Math.max(0, Math.round(asNumber(input.fleetSize))),
    // Uso previsto em km/mês, insumo direto do cálculo de franquia.
    expectedMonthlyKm: Math.max(0, Math.round(asNumber(input.expectedMonthlyKm))),
    // Prazo pretendido em meses (12/24/36 são comuns).
    desiredTermMonths: Math.max(0, Math.round(asNumber(input.desiredTermMonths))),
    // Ticket mensal proposto por veículo, insumo do forecast do funil.
    proposedMonthlyBRL: Math.max(0, asNumber(input.proposedMonthlyBRL)),
    stageId: stage,
    ownerId: asText(input.ownerId),
    expectedStart: asText(input.expectedStart),
    notes: asText(input.notes),
    lossReason: asText(input.lossReason),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const stageById = (stageId) =>
  GREENMOB_PIPELINE_STAGES.find((s) => s.id === stageId) || null;

export const isOpen = (lead) => {
  const stage = stageById(lead?.stageId);
  return !!stage && !stage.won && !stage.lost && stage.id !== "devolvido";
};

export const opportunityProbability = (lead) => {
  const stage = stageById(lead?.stageId);
  return stage ? Number(stage.probability) || 0 : 0;
};

// Receita mensal ponderada do lead: ticket × frota × probabilidade da etapa.
export const weightedMonthlyRevenue = (lead) => {
  const monthly = Math.max(0, asNumber(lead?.proposedMonthlyBRL));
  const fleet = Math.max(1, asNumber(lead?.fleetSize));
  const probability = opportunityProbability(lead);
  return Math.round((monthly * fleet * probability) / 100);
};

// Contrato total ponderado (mensalidade × prazo × frota × probabilidade).
export const weightedContractValue = (lead) => {
  const term = Math.max(0, asNumber(lead?.desiredTermMonths));
  const monthly = Math.max(0, asNumber(lead?.proposedMonthlyBRL));
  const fleet = Math.max(1, asNumber(lead?.fleetSize));
  const probability = opportunityProbability(lead);
  return Math.round((monthly * term * fleet * probability) / 100);
};

export const pipelineSummary = (leads = []) => {
  const openOnes = leads.filter(isOpen);
  const ativos = leads.filter((l) => l.stageId === "locacao-ativa");
  const perdidos = leads.filter((l) => stageById(l.stageId)?.lost);
  const devolvidos = leads.filter((l) => l.stageId === "devolvido");
  return {
    open: openOnes.length,
    ativos: ativos.length,
    perdidos: perdidos.length,
    devolvidos: devolvidos.length,
    frotaEmNegociacao: openOnes.reduce((total, l) => total + asNumber(l.fleetSize), 0),
    forecastMonthlyRevenue: openOnes.reduce((total, l) => total + weightedMonthlyRevenue(l), 0),
    forecastContractValue: openOnes.reduce((total, l) => total + weightedContractValue(l), 0),
  };
};

export const stageMetrics = (leads = []) =>
  GREENMOB_PIPELINE_STAGES.filter((s) => !s.lost).map((stage) => {
    const items = leads.filter((l) => l.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      description: stage.description,
      total: items.length,
      frota: items.reduce((total, l) => total + asNumber(l.fleetSize), 0),
      mrr: items.reduce((total, l) => total + weightedMonthlyRevenue(l), 0),
    };
  });

// Alertas que orientam a próxima ação sem inventar diagnóstico.
export const leadAlerts = (lead, referenceDate = new Date()) => {
  const alerts = [];
  if (!lead?.ownerId) alerts.push("Sem responsável");
  if (isOpen(lead) && !lead?.expectedStart) alerts.push("Sem previsão de início da locação");
  if (isOpen(lead) && !lead?.desiredTermMonths) alerts.push("Prazo do contrato não definido");
  if (isOpen(lead) && !lead?.fleetSize) alerts.push("Tamanho da frota não informado");
  const updated = new Date(lead?.updatedAt || 0).getTime();
  const now = referenceDate.getTime();
  if (updated > 0 && isOpen(lead)) {
    const diasParado = Math.floor((now - updated) / (1000 * 60 * 60 * 24));
    if (diasParado > 14) alerts.push(`Parado há ${diasParado} dias`);
  }
  return alerts;
};
