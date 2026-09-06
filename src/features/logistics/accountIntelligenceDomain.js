const lower = (value) => String(value || "").trim().toLowerCase();

const ESG_HIGH = ["logística", "transporte", "varejo", "e-commerce", "indústria", "automot", "alimentos", "bebidas", "farmac", "energia", "mineração", "construção"];
const PROCUREMENT = ["procurement", "compras", "suprimentos", "sourcing", "supply"];
const LOGISTICS = ["logística", "logistica", "transporte", "transportes", "frete", "freight", "distribution", "distribuição", "carrier", "supply chain", "last mile", "middle mile"];
const DECISION_ROLES = ["patrocinador", "decisor econômico", "compras"];

export function assessAccount(account = {}, opportunities = [], interactions = []) {
  const contacts = account.crm?.contacts || [];
  const hasCurrentDecisionEvidence = (contact) => contact.active !== false && contact.employmentStatus !== "former" &&
    (!contact.employmentCheckedAt || contact.currentEmploymentVerified === true);
  const activeContacts = contacts.filter((contact) => contact.active !== false && contact.employmentStatus !== "former");
  const currentDecisionContacts = contacts.filter(hasCurrentDecisionEvidence);
  const profile = lower(`${account.segment || ""} ${account.name || ""} ${account.notes || ""}`);
  const esgMatches = ESG_HIGH.filter((keyword) => profile.includes(keyword));
  const procurementContacts = currentDecisionContacts.filter((contact) => PROCUREMENT.some((keyword) => lower(`${contact.title} ${contact.department} ${contact.relationshipRole}`).includes(keyword)));
  const logisticsProcurementContacts = procurementContacts.filter((contact) => LOGISTICS.some((keyword) => lower(`${contact.title} ${contact.department} ${contact.specialty || ""}`).includes(keyword)));
  const decisionContacts = currentDecisionContacts.filter((contact) => DECISION_ROLES.includes(lower(contact.relationshipRole)));
  const staleContacts = contacts.filter((contact) => contact.active === false);
  const noChannel = contacts.filter((contact) => !contact.email && !contact.phone && !contact.linkedinUrl);

  const namedContact = activeContacts.find((contact) => contact.name)?.name || "o contato cadastrado";
  const completed = new Set(Array.isArray(account.crm?.completedSuggestedActions) ? account.crm.completedSuggestedActions : []);
  const stage = lower(account.crm?.stage);
  const openOpportunities = opportunities.filter((item) => {
    const belongs = !account.id || item.clientId === account.id || item.accountId === account.id;
    const opportunityStage = lower(item.stage || item.estagio);
    return belongs && !["ganho", "perdido", "fechada ganha", "fechada perdida", "cliente ativo"].includes(opportunityStage);
  });
  const opportunitiesWithNextStep = openOpportunities.filter((item) => lower(item.nextStep || item.proximoPasso));
  const staleOpportunities = openOpportunities.filter((item) => {
    const age = item.updatedAt ? Math.floor((Date.now() - Date.parse(item.updatedAt)) / 86400000) : null;
    return age !== null && age >= 21;
  });
  const candidates = [];

  // Follow-ups da conta são evidência explícita. Conversas específicas de
  // outra oportunidade não devem aparecer como recomendação geral da conta.
  const followups = interactions.filter((item) =>
    account.id && item.clientId === account.id && !item.opportunityId &&
    item.id && lower(item.proximoPasso),
  ).sort((a, b) => String(b.ocorridaEm || "").localeCompare(String(a.ocorridaEm || "")));
  for (const interaction of followups) candidates.push({
    key: `interaction-next-step:${interaction.id}`,
    title: interaction.proximoPasso.trim(),
  });

  // Primeiro respeita o que a equipe já registrou. A recomendação não substitui
  // uma ação real por um texto genérico.
  if (account.crm?.nextAction) candidates.push({
    key: `crm-next-action:${lower(account.crm.nextAction).slice(0, 80)}`,
    title: account.crm.nextAction,
  });
  for (const opportunityWithNextStep of opportunitiesWithNextStep) candidates.push({
    key: `opportunity-next-step:${opportunityWithNextStep.id}`,
    title: `${opportunityWithNextStep.nextStep || opportunityWithNextStep.proximoPasso} · ${opportunityWithNextStep.titulo || opportunityWithNextStep.title || "oportunidade aberta"}`,
  });
  for (const staleOpportunity of staleOpportunities) candidates.push({
    key: `resume-stalled-opportunity:${staleOpportunity.id}`,
    title: `Retomar ${staleOpportunity.titulo || staleOpportunity.title || "a oportunidade parada"} e registrar o retorno do cliente.`,
  });
  if (!activeContacts.length) candidates.push({
    key: "map-first-contact",
    title: `Cadastrar um contato real de Logística ou Procurement da conta ${account.name || ""}.`.trim(),
  });
  if (activeContacts.length && !procurementContacts.length) candidates.push({
    key: "request-procurement-referral",
    // Não presumir que o contato cadastrado NÃO é o responsável — só não está
    // marcado como tal. Perguntar se é ele mesmo; e, se não for, pedir a
    // indicação de quem responde. (Pedido da titular.)
    title: `Confirmar com ${namedContact} se é quem responde por fretes e contratação de transportes; se não for, pedir a indicação de quem responde.`,
  });
  if (procurementContacts.length && !logisticsProcurementContacts.length) candidates.push({
    key: "validate-logistics-scope",
    title: `Confirmar com ${procurementContacts[0].name} se sua atuação inclui fretes e contratação de transportes.`,
  });
  if (logisticsProcurementContacts.length && !decisionContacts.length) candidates.push({
    key: "confirm-economic-decision",
    title: `Confirmar com ${logisticsProcurementContacts[0].name} quem é o decisor econômico que aprova preço e contrato.`,
  });
  if (!openOpportunities.length && ["diagnóstico", "construção de solução", "proposta", "negociação"].includes(stage)) candidates.push({
    key: "register-real-opportunity",
    title: "Registrar a oportunidade em negociação com escopo, valor, etapa e próximo passo.",
  });
  const pending = candidates.find((item) => !completed.has(item.key)) || null;

  return {
    esgRelevance: esgMatches.length ? "Alta" : profile ? "A validar" : "Sem dados suficientes",
    esgReason: esgMatches.length
      ? `O perfil menciona ${esgMatches.slice(0, 3).join(", ")}, atividades em que emissões logísticas e cadeia de fornecedores costumam ser materiais.`
      : "Complete segmento, operação logística e compromissos ambientais para a IA avaliar a materialidade ESG sem suposição.",
    procurementContacts,
    logisticsProcurementContacts,
    strongestContacts: [...decisionContacts, ...procurementContacts].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 3),
    staleContacts,
    noChannel,
    nextTask: pending?.title || "Não há próxima ação confiável. Atualize o estágio, a oportunidade ou o último contato.",
    nextTaskKey: pending?.key || "",
    nextTaskCanComplete: Boolean(pending),
  };
}

export const whatsappUrl = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "";
  const international = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${international}`;
};

export const gmailComposeUrl = (address, subject = "") =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(address || "")}&su=${encodeURIComponent(subject)}`;

export const outlookComposeUrl = (address, subject = "") =>
  `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(address || "")}&subject=${encodeURIComponent(subject)}`;
