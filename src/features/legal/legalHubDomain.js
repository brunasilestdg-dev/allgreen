// ===== Jurídico (Legal Hub) — camada de lógica pura =====
// Cobre demandas jurídicas, contratos, processos (judiciais e administrativos),
// prazos, procurações, documentos, riscos, compliance/due diligence, gestão
// societária, escritórios externos, honorários e provisões, fluxo de aprovação,
// pareceres, alertas, templates, dashboard e busca centralizada.
//
// Sem React, sem rede — tudo testável. A camada de UI (`LegalHub.jsx`) só
// compõe estes helpers e passa o `db` que o App já mantém sincronizado.
//
// Princípios que não se quebram (mesmo padrão do restante do app):
// - Datas em AAAA-MM-DD; aritmética em UTC para não oscilar por fuso.
// - `null` significa "sem informação"; nunca confundir com `0`.
// - Situação encerrada = não exige mais tratativa (não some do histórico).
// - Confidencialidade é REGRA DE LEITURA: filtro no acesso, não no dado.

// ---------- Tipos ----------

export const LEGAL_MATTER_TYPES = Object.freeze([
  { id: "consultivo", label: "Consultivo" },
  { id: "contencioso_civel", label: "Contencioso cível" },
  { id: "trabalhista", label: "Trabalhista" },
  { id: "tributario", label: "Tributário" },
  { id: "societario", label: "Societário" },
  { id: "regulatorio", label: "Regulatório" },
  { id: "lgpd_privacidade", label: "LGPD e privacidade" },
  { id: "propriedade_intelectual", label: "Propriedade intelectual" },
  { id: "imobiliario", label: "Imobiliário" },
  { id: "administrativo", label: "Administrativo" },
  { id: "criminal", label: "Criminal" },
  { id: "outro", label: "Outro" },
]);

export const LEGAL_MATTER_STATUSES = Object.freeze([
  { id: "aberto", label: "Aberto", encerrada: false },
  { id: "em_analise", label: "Em análise", encerrada: false },
  { id: "em_andamento", label: "Em andamento", encerrada: false },
  { id: "aguardando_parecer", label: "Aguardando parecer", encerrada: false },
  { id: "aguardando_cliente", label: "Aguardando cliente / área", encerrada: false },
  { id: "aguardando_externo", label: "Aguardando escritório externo", encerrada: false },
  { id: "concluido", label: "Concluído", encerrada: true },
  { id: "arquivado", label: "Arquivado", encerrada: true },
]);

export const LEGAL_RISK_LEVELS = Object.freeze([
  { id: "baixo", label: "Baixo", weight: 1, color: "#0e9d7a" },
  { id: "medio", label: "Médio", weight: 2, color: "#c98a09" },
  { id: "alto", label: "Alto", weight: 3, color: "#c94209" },
  { id: "critico", label: "Crítico", weight: 4, color: "#8b0f19" },
]);

// Restrito = só o próprio jurídico e a diretoria; interno = todo colaborador
// da mesma conta; confidencial = só o dono ou papel juridico=true.
export const LEGAL_CONFIDENTIALITY = Object.freeze([
  { id: "publico", label: "Público (todo o time)", minLevel: 0 },
  { id: "interno", label: "Interno", minLevel: 1 },
  { id: "restrito", label: "Restrito (Jurídico)", minLevel: 2 },
  { id: "confidencial", label: "Confidencial (Diretoria)", minLevel: 3 },
]);

export const LEGAL_CONTRACT_TYPES = Object.freeze([
  { id: "prestacao_servicos", label: "Prestação de serviços" },
  { id: "fornecimento", label: "Fornecimento" },
  { id: "compra_venda", label: "Compra e venda" },
  { id: "locacao", label: "Locação" },
  { id: "distribuicao", label: "Distribuição / Representação" },
  { id: "franquia", label: "Franquia" },
  { id: "sociedade", label: "Sociedade / Acordo de sócios" },
  { id: "nda", label: "NDA / Confidencialidade" },
  { id: "mou", label: "MOU / Carta de intenções" },
  { id: "licenciamento", label: "Licenciamento" },
  { id: "comodato", label: "Comodato" },
  { id: "financeiro", label: "Financeiro / Mútuo" },
  { id: "trabalho", label: "Trabalho / Estágio / PJ" },
  { id: "outro", label: "Outro" },
]);

export const LEGAL_CONTRACT_STATUSES = Object.freeze([
  { id: "rascunho", label: "Rascunho", encerrada: false },
  { id: "em_negociacao", label: "Em negociação", encerrada: false },
  { id: "em_analise", label: "Em análise no Jurídico", encerrada: false },
  { id: "ajuste_solicitado", label: "Ajustes solicitados", encerrada: false },
  { id: "aprovado", label: "Aprovado, aguardando assinatura", encerrada: false },
  { id: "vigente", label: "Vigente (assinado)", encerrada: false },
  { id: "encerrado", label: "Encerrado", encerrada: true },
  { id: "rescindido", label: "Rescindido", encerrada: true },
  { id: "arquivado", label: "Arquivado", encerrada: true },
]);

export const LEGAL_PROCESS_NATURES = Object.freeze([
  { id: "civel", label: "Cível" },
  { id: "trabalhista", label: "Trabalhista" },
  { id: "tributario", label: "Tributário" },
  { id: "administrativo", label: "Administrativo" },
  { id: "regulatorio", label: "Regulatório" },
  { id: "ambiental", label: "Ambiental" },
  { id: "criminal", label: "Criminal" },
  { id: "arbitral", label: "Arbitral" },
  { id: "outro", label: "Outro" },
]);

export const LEGAL_PROCESS_INSTANCES = Object.freeze([
  { id: "primeira", label: "1ª instância" },
  { id: "segunda", label: "2ª instância" },
  { id: "superior", label: "Tribunal superior" },
  { id: "administrativa", label: "Esfera administrativa" },
  { id: "arbitragem", label: "Arbitragem" },
]);

export const LEGAL_PROCESS_STATUSES = Object.freeze([
  { id: "em_andamento", label: "Em andamento", encerrada: false },
  { id: "aguardando_decisao", label: "Aguardando decisão", encerrada: false },
  { id: "aguardando_pagamento", label: "Aguardando pagamento", encerrada: false },
  { id: "recurso", label: "Em recurso", encerrada: false },
  { id: "acordo", label: "Em acordo", encerrada: false },
  { id: "ganho", label: "Ganho", encerrada: true },
  { id: "perdido", label: "Perdido", encerrada: true },
  { id: "arquivado", label: "Arquivado", encerrada: true },
]);

export const LEGAL_PROCESS_ROLES = Object.freeze([
  { id: "autor", label: "Autor" },
  { id: "reu", label: "Réu" },
  { id: "terceiro", label: "Terceiro / interveniente" },
  { id: "requerente", label: "Requerente" },
  { id: "requerido", label: "Requerido" },
]);

export const LEGAL_PROVISION_LEVELS = Object.freeze([
  { id: "provavel", label: "Provável (provisionar)", pct: 1.0 },
  { id: "possivel", label: "Possível (apenas nota)", pct: 0.5 },
  { id: "remota", label: "Remota", pct: 0 },
]);

export const LEGAL_APPROVAL_STATUSES = Object.freeze([
  { id: "pendente", label: "Pendente" },
  { id: "aprovado", label: "Aprovado" },
  { id: "reprovado", label: "Reprovado" },
  { id: "ajuste_solicitado", label: "Ajustes solicitados" },
]);

// Ações do fluxo de aprovação (quem pode fazer o quê, exigências mínimas).
// `juridico: true` = só um usuário com papel jurídico pode executar.
export const LEGAL_APPROVAL_ACTIONS = Object.freeze({
  submeter: { from: ["rascunho", "ajuste_solicitado"], to: "pendente", label: "Enviar ao Jurídico", requiresContent: true },
  solicitar_ajuste: { from: ["pendente"], to: "ajuste_solicitado", label: "Solicitar ajustes", requiresMessage: true, juridico: true },
  aprovar: { from: ["pendente"], to: "aprovado", label: "Aprovar", juridico: true },
  reprovar: { from: ["pendente"], to: "reprovado", label: "Reprovar", requiresMessage: true, juridico: true },
  comentar: { from: ["rascunho", "pendente", "ajuste_solicitado", "aprovado"], to: null, label: "Comentar", requiresMessage: true },
});

// Vínculos possíveis do jurídico com outras entidades do app.
export const LEGAL_LINK_KINDS = Object.freeze([
  { id: "cliente", label: "Cliente" },
  { id: "fornecedor", label: "Fornecedor" },
  { id: "colaborador", label: "Colaborador" },
  { id: "parceiro", label: "Parceiro" },
  { id: "motorista", label: "Motorista" },
  { id: "area", label: "Área interna" },
  { id: "empresa_grupo", label: "Empresa do grupo" },
  { id: "outro", label: "Outro" },
]);

// ---------- Utilidades ----------

const idsOf = (list) => new Set(list.map((item) => item.id));
const TYPES = idsOf(LEGAL_MATTER_TYPES);
const STATUSES = idsOf(LEGAL_MATTER_STATUSES);
const RISKS = idsOf(LEGAL_RISK_LEVELS);
const CONFS = idsOf(LEGAL_CONFIDENTIALITY);
const CONTRACT_TYPES_SET = idsOf(LEGAL_CONTRACT_TYPES);
const CONTRACT_STATUSES_SET = idsOf(LEGAL_CONTRACT_STATUSES);
const PROCESS_STATUSES_SET = idsOf(LEGAL_PROCESS_STATUSES);
const PROCESS_NATURES_SET = idsOf(LEGAL_PROCESS_NATURES);
const PROVISIONS_SET = idsOf(LEGAL_PROVISION_LEVELS);

const findLabel = (list, id, fallback = "Não informado") =>
  list.find((entry) => entry.id === id)?.label || fallback;

export const labelMatterType = (id) => findLabel(LEGAL_MATTER_TYPES, id);
export const labelMatterStatus = (id) => findLabel(LEGAL_MATTER_STATUSES, id, "Aberto");
export const labelRisk = (id) => findLabel(LEGAL_RISK_LEVELS, id);
export const labelConfidentiality = (id) => findLabel(LEGAL_CONFIDENTIALITY, id, "Interno");
export const labelContractType = (id) => findLabel(LEGAL_CONTRACT_TYPES, id);
export const labelContractStatus = (id) => findLabel(LEGAL_CONTRACT_STATUSES, id, "Rascunho");
export const labelProcessNature = (id) => findLabel(LEGAL_PROCESS_NATURES, id);
export const labelProcessStatus = (id) => findLabel(LEGAL_PROCESS_STATUSES, id, "Em andamento");
export const labelProvision = (id) => findLabel(LEGAL_PROVISION_LEVELS, id, "Remota");

export const matterStatusIsClosed = (id) =>
  LEGAL_MATTER_STATUSES.find((s) => s.id === id)?.encerrada === true;
export const contractStatusIsClosed = (id) =>
  LEGAL_CONTRACT_STATUSES.find((s) => s.id === id)?.encerrada === true;
export const processStatusIsClosed = (id) =>
  LEGAL_PROCESS_STATUSES.find((s) => s.id === id)?.encerrada === true;

export const normalizeMatterType = (id) => (TYPES.has(id) ? id : "consultivo");
export const normalizeMatterStatus = (id) => (STATUSES.has(id) ? id : "aberto");
export const normalizeRisk = (id) => (RISKS.has(id) ? id : "medio");
export const normalizeConfidentiality = (id) => (CONFS.has(id) ? id : "interno");
export const normalizeContractType = (id) => (CONTRACT_TYPES_SET.has(id) ? id : "prestacao_servicos");
export const normalizeContractStatus = (id) => (CONTRACT_STATUSES_SET.has(id) ? id : "rascunho");
export const normalizeProcessStatus = (id) => (PROCESS_STATUSES_SET.has(id) ? id : "em_andamento");
export const normalizeProcessNature = (id) => (PROCESS_NATURES_SET.has(id) ? id : "civel");
export const normalizeProvision = (id) => (PROVISIONS_SET.has(id) ? id : "remota");

const onlyDate = (value) => String(value || "").slice(0, 10);

// Dias até uma data (negativo = passou; null = sem data válida). Base UTC.
export const daysUntil = (target, now = Date.now()) => {
  const t = onlyDate(target);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const alvo = Date.parse(`${t}T00:00:00Z`);
  const hoje = Date.parse(`${onlyDate(new Date(now).toISOString())}T00:00:00Z`);
  if (Number.isNaN(alvo) || Number.isNaN(hoje)) return null;
  return Math.round((alvo - hoje) / 86400000);
};

// Nível de urgência a partir dos dias que faltam. Independente do tipo de
// registro — serve para prazo, vigência, procuração, audiência, etc.
export const deadlineUrgency = (days) => {
  if (days === null || days === undefined) return { level: "indefinido", label: "Sem prazo" };
  if (days < 0) return { level: "vencido", label: days === -1 ? "Venceu ontem" : `Vencido há ${Math.abs(days)} dias` };
  if (days === 0) return { level: "vencido", label: "Vence hoje" };
  if (days === 1) return { level: "urgente", label: "Vence amanhã" };
  if (days <= 7) return { level: "urgente", label: `Vence em ${days} dias` };
  if (days <= 30) return { level: "atencao", label: `Vence em ${days} dias` };
  if (days <= 90) return { level: "programado", label: `Vence em ${days} dias` };
  return { level: "tranquilo", label: `Vence em ${days} dias` };
};

// Parser BR de dinheiro (aceita "R$ 1.250,50" e "1250.5"). Devolve 0 se lixo.
export const parseMoney = (value) => {
  if (value === "" || value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

export const formatMoneyBR = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const uid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `l-${Math.random().toString(36).slice(2, 10)}`;
};

// ---------- Validações e criação ----------

// Toda entidade jurídica exige um TÍTULO. Sem título, nada é rastreável e o
// dashboard fica cheio de "sem título" — pior do que recusar na entrada.
export const validateMatter = (data = {}) => {
  if (!String(data.title || "").trim()) return "Descreva a demanda no título.";
  return "";
};

export const validateContract = (data = {}) => {
  if (!String(data.title || "").trim()) return "Descreva o contrato no título.";
  return "";
};

export const validateProcess = (data = {}) => {
  if (!String(data.title || "").trim()) return "Descreva o processo no título.";
  return "";
};

export const validatePowerOfAttorney = (data = {}) => {
  if (!String(data.grantor || "").trim() && !String(data.title || "").trim())
    return "Informe o outorgante ou um título para a procuração.";
  return "";
};

export const validateDeadline = (data = {}) => {
  if (!String(data.title || "").trim()) return "Descreva o prazo no título.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate || "")))
    return "Informe a data (AAAA-MM-DD) do prazo.";
  return "";
};

export const validateOffice = (data = {}) => {
  if (!String(data.name || "").trim()) return "Informe o nome do escritório ou advogado.";
  return "";
};

export const validateFee = (data = {}) => {
  if (!String(data.title || "").trim()) return "Descreva o lançamento (honorários, custas ou provisão).";
  if (Number.isNaN(Number(data.amount)) || Number(data.amount) === 0)
    return "Informe o valor do lançamento.";
  return "";
};

const baseTimestamp = () => new Date().toISOString();

export const createMatter = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim(),
  description: String(data.description || "").trim(),
  type: normalizeMatterType(data.type),
  status: normalizeMatterStatus(data.status),
  risk: normalizeRisk(data.risk),
  confidentiality: normalizeConfidentiality(data.confidentiality),
  ownerId: data.ownerId || null,
  responsibleId: data.responsibleId || null,
  externalOfficeId: data.externalOfficeId || null,
  links: Array.isArray(data.links) ? data.links.filter(Boolean) : [],
  amountAtRisk: parseMoney(data.amountAtRisk),
  provision: normalizeProvision(data.provision),
  openedAt: onlyDate(data.openedAt) || onlyDate(new Date().toISOString()),
  dueDate: onlyDate(data.dueDate) || "",
  notes: String(data.notes || ""),
  events: Array.isArray(data.events) ? data.events : [],
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createContract = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim(),
  type: normalizeContractType(data.type),
  status: normalizeContractStatus(data.status),
  risk: normalizeRisk(data.risk),
  confidentiality: normalizeConfidentiality(data.confidentiality),
  counterparty: String(data.counterparty || "").trim(),
  counterpartyDocument: String(data.counterpartyDocument || "").trim(),
  amount: parseMoney(data.amount),
  currency: String(data.currency || "BRL").trim().toUpperCase() || "BRL",
  startDate: onlyDate(data.startDate) || "",
  endDate: onlyDate(data.endDate) || "",
  renewalMode: data.renewalMode === "automatic" ? "automatic" : "manual",
  renewalNoticeDays: Math.max(0, Math.min(365, Number(data.renewalNoticeDays) || 30)),
  approvalStatus: LEGAL_APPROVAL_STATUSES.find((s) => s.id === data.approvalStatus) ? data.approvalStatus : "pendente",
  responsibleId: data.responsibleId || null,
  externalOfficeId: data.externalOfficeId || null,
  links: Array.isArray(data.links) ? data.links.filter(Boolean) : [],
  clauses: Array.isArray(data.clauses) ? data.clauses.filter(Boolean) : [],
  signatures: Array.isArray(data.signatures) ? data.signatures : [],
  events: Array.isArray(data.events) ? data.events : [],
  notes: String(data.notes || ""),
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createProcess = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim(),
  number: String(data.number || "").trim(),
  nature: normalizeProcessNature(data.nature),
  status: normalizeProcessStatus(data.status),
  instance: LEGAL_PROCESS_INSTANCES.find((i) => i.id === data.instance) ? data.instance : "primeira",
  role: LEGAL_PROCESS_ROLES.find((r) => r.id === data.role) ? data.role : "autor",
  risk: normalizeRisk(data.risk),
  provision: normalizeProvision(data.provision),
  amount: parseMoney(data.amount),
  provisionAmount: parseMoney(data.provisionAmount),
  court: String(data.court || "").trim(),
  jurisdiction: String(data.jurisdiction || "").trim(),
  externalOfficeId: data.externalOfficeId || null,
  responsibleId: data.responsibleId || null,
  confidentiality: normalizeConfidentiality(data.confidentiality),
  filedAt: onlyDate(data.filedAt) || "",
  nextHearing: onlyDate(data.nextHearing) || "",
  nextDeadline: onlyDate(data.nextDeadline) || "",
  links: Array.isArray(data.links) ? data.links.filter(Boolean) : [],
  notes: String(data.notes || ""),
  timeline: Array.isArray(data.timeline) ? data.timeline : [],
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createPowerOfAttorney = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim() || `Procuração — ${String(data.attorney || "").trim() || "sem nome"}`,
  grantor: String(data.grantor || "").trim(),
  grantorDocument: String(data.grantorDocument || "").trim(),
  attorney: String(data.attorney || "").trim(),
  attorneyDocument: String(data.attorneyDocument || "").trim(),
  purpose: String(data.purpose || "").trim(),
  powers: Array.isArray(data.powers) ? data.powers.filter(Boolean) : [],
  effectiveFrom: onlyDate(data.effectiveFrom) || onlyDate(new Date().toISOString()),
  expiresAt: onlyDate(data.expiresAt) || "",
  substabelecimento: Boolean(data.substabelecimento),
  status: data.status === "revogada" ? "revogada" : data.status === "expirada" ? "expirada" : "vigente",
  confidentiality: normalizeConfidentiality(data.confidentiality),
  links: Array.isArray(data.links) ? data.links.filter(Boolean) : [],
  notes: String(data.notes || ""),
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createDeadline = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim(),
  kind: String(data.kind || "prazo"), // prazo | audiencia | vencimento | recurso | renovacao
  dueDate: onlyDate(data.dueDate) || "",
  fatal: Boolean(data.fatal),
  responsibleId: data.responsibleId || null,
  matterId: data.matterId || null,
  contractId: data.contractId || null,
  processId: data.processId || null,
  powerOfAttorneyId: data.powerOfAttorneyId || null,
  status: data.status === "cumprido" ? "cumprido" : "pendente",
  notes: String(data.notes || ""),
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createOffice = (data = {}) => ({
  id: uid(),
  name: String(data.name || "").trim(),
  contactName: String(data.contactName || "").trim(),
  email: String(data.email || "").trim(),
  phone: String(data.phone || "").trim(),
  oab: String(data.oab || "").trim(),
  document: String(data.document || "").trim(),
  specialties: Array.isArray(data.specialties) ? data.specialties : [],
  rate: parseMoney(data.rate),
  notes: String(data.notes || ""),
  active: data.active !== false,
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

export const createFee = (data = {}) => ({
  id: uid(),
  title: String(data.title || "").trim(),
  kind: String(data.kind || "honorario"), // honorario | custa | provisao | reembolso | outro
  amount: parseMoney(data.amount),
  dueDate: onlyDate(data.dueDate) || "",
  paidAt: onlyDate(data.paidAt) || "",
  paid: Boolean(data.paid),
  officeId: data.officeId || null,
  matterId: data.matterId || null,
  contractId: data.contractId || null,
  processId: data.processId || null,
  notes: String(data.notes || ""),
  createdAt: baseTimestamp(),
  updatedAt: baseTimestamp(),
});

// ---------- Controle de acesso (confidencialidade) ----------

// Retorna o nível de acesso do usuário atual. Regra decidida no App e passada
// para cá — a domínio não lê identidade nem chama backend.
export const accessLevelFor = ({ role = "colaborador", isOwner = false } = {}) => {
  if (isOwner || role === "admin" || role === "diretor") return 3;
  if (role === "juridico" || role === "gestor") return 2;
  if (role === "colaborador") return 1;
  return 0;
};

export const canRead = (record, viewer = {}) => {
  const level = accessLevelFor(viewer);
  const requirement = LEGAL_CONFIDENTIALITY.find(
    (c) => c.id === (record?.confidentiality || "interno"),
  );
  return level >= (requirement?.minLevel ?? 1);
};

export const filterVisible = (records, viewer = {}) =>
  (records || []).filter((r) => canRead(r, viewer));

// ---------- Dashboard e agregados ----------

// Um dashboard único do jurídico: demandas, contratos, processos, riscos,
// prazos e exposição financeira. Read-only, calculado a cada leitura.
export const legalDashboard = (records = {}, now = Date.now()) => {
  const matters = records.matters || [];
  const contracts = records.contracts || [];
  const processes = records.processes || [];
  const powersOfAttorney = records.powersOfAttorney || [];
  const deadlines = records.deadlines || [];
  const fees = records.fees || [];

  const openMatters = matters.filter((m) => !matterStatusIsClosed(m.status));
  const activeContracts = contracts.filter(
    (c) => !contractStatusIsClosed(c.status) && c.status === "vigente",
  );
  const inNegotiationContracts = contracts.filter((c) =>
    ["em_negociacao", "em_analise", "ajuste_solicitado", "aprovado", "rascunho"].includes(c.status),
  );
  const openProcesses = processes.filter((p) => !processStatusIsClosed(p.status));

  const expiringContracts = contracts
    .filter((c) => c.status === "vigente" && c.endDate)
    .map((c) => ({ ...c, daysToEnd: daysUntil(c.endDate, now) }))
    .filter((c) => c.daysToEnd !== null && c.daysToEnd <= 90)
    .sort((a, b) => (a.daysToEnd ?? 0) - (b.daysToEnd ?? 0));

  const upcomingDeadlines = deadlines
    .filter((d) => d.status !== "cumprido")
    .map((d) => ({ ...d, daysToDue: daysUntil(d.dueDate, now) }))
    .filter((d) => d.daysToDue !== null && d.daysToDue <= 30)
    .sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));

  const expiringPowersOfAttorney = powersOfAttorney
    .filter((p) => p.status === "vigente" && p.expiresAt)
    .map((p) => ({ ...p, daysToExpire: daysUntil(p.expiresAt, now) }))
    .filter((p) => p.daysToExpire !== null && p.daysToExpire <= 60)
    .sort((a, b) => (a.daysToExpire ?? 0) - (b.daysToExpire ?? 0));

  const contingentExposure = openProcesses.reduce((total, p) => {
    const factor = LEGAL_PROVISION_LEVELS.find((l) => l.id === p.provision)?.pct ?? 0;
    return total + Number(p.amount || 0) * factor;
  }, 0);

  const provisionExposure = openProcesses.reduce(
    (total, p) => total + Number(p.provisionAmount || 0),
    0,
  );

  const openFees = fees.filter((f) => !f.paid);
  const feesTotal = openFees.reduce((total, f) => total + Number(f.amount || 0), 0);

  const riskCounts = { baixo: 0, medio: 0, alto: 0, critico: 0 };
  for (const m of openMatters) riskCounts[normalizeRisk(m.risk)] += 1;
  for (const p of openProcesses) riskCounts[normalizeRisk(p.risk)] += 1;
  for (const c of inNegotiationContracts) riskCounts[normalizeRisk(c.risk)] += 1;

  return {
    counts: {
      openMatters: openMatters.length,
      totalMatters: matters.length,
      activeContracts: activeContracts.length,
      inNegotiationContracts: inNegotiationContracts.length,
      totalContracts: contracts.length,
      openProcesses: openProcesses.length,
      totalProcesses: processes.length,
      powersOfAttorney: powersOfAttorney.filter((p) => p.status === "vigente").length,
      openDeadlines: upcomingDeadlines.length,
      openFees: openFees.length,
    },
    exposure: {
      contingent: contingentExposure,
      provisioned: provisionExposure,
      fees: feesTotal,
      total: contingentExposure + provisionExposure + feesTotal,
    },
    riskCounts,
    expiringContracts,
    upcomingDeadlines,
    expiringPowersOfAttorney,
  };
};

// Matriz de risco: eixo probabilidade (baixo/médio/alto/crítico) × exposição
// financeira em faixas. Útil para o gestor decidir onde investir esforço.
export const riskMatrix = (matters = [], processes = []) => {
  const cells = {};
  const ensure = (risk, bucket) => {
    const key = `${risk}|${bucket}`;
    if (!cells[key]) cells[key] = { risk, bucket, count: 0, amount: 0 };
    return cells[key];
  };
  const bucketOf = (amount) => {
    const a = Number(amount || 0);
    if (a <= 0) return "sem";
    if (a < 10000) return "ate10k";
    if (a < 100000) return "ate100k";
    if (a < 1000000) return "ate1M";
    return "acima1M";
  };
  for (const m of matters) {
    if (matterStatusIsClosed(m.status)) continue;
    const cell = ensure(normalizeRisk(m.risk), bucketOf(m.amountAtRisk));
    cell.count += 1;
    cell.amount += Number(m.amountAtRisk || 0);
  }
  for (const p of processes) {
    if (processStatusIsClosed(p.status)) continue;
    const cell = ensure(normalizeRisk(p.risk), bucketOf(p.amount));
    cell.count += 1;
    cell.amount += Number(p.amount || 0);
  }
  return Object.values(cells).sort((a, b) => b.amount - a.amount);
};

// ---------- Alertas e notificações ----------

// Alertas derivados dos registros. Cada alerta traz uma origem para o clique
// da UI abrir o registro certo — nada é gravado, o alerta vive do dado atual.
export const legalAlerts = (records = {}, now = Date.now(), horizonDays = 30) => {
  const alerts = [];
  for (const c of records.contracts || []) {
    if (c.status !== "vigente" || !c.endDate) continue;
    const days = daysUntil(c.endDate, now);
    if (days === null) continue;
    const notice = Number(c.renewalNoticeDays) || 30;
    if (days <= notice) {
      alerts.push({
        id: `contract-end-${c.id}`,
        kind: "contract-end",
        level: days < 0 ? "vencido" : days <= 7 ? "urgente" : "atencao",
        title: `Vigência de contrato: ${c.title}`,
        subtitle: `${c.counterparty || "Contraparte"} · ${deadlineUrgency(days).label}`,
        entityId: c.id,
      });
    }
  }
  for (const d of records.deadlines || []) {
    if (d.status === "cumprido") continue;
    const days = daysUntil(d.dueDate, now);
    if (days === null || days > horizonDays) continue;
    alerts.push({
      id: `deadline-${d.id}`,
      kind: "deadline",
      level: days < 0 ? "vencido" : days <= 3 ? "urgente" : days <= 7 ? "atencao" : "programado",
      title: d.title,
      subtitle: deadlineUrgency(days).label + (d.fatal ? " · FATAL" : ""),
      entityId: d.id,
    });
  }
  for (const p of records.powersOfAttorney || []) {
    if (p.status !== "vigente" || !p.expiresAt) continue;
    const days = daysUntil(p.expiresAt, now);
    if (days === null || days > 60) continue;
    alerts.push({
      id: `poa-${p.id}`,
      kind: "power-of-attorney",
      level: days < 0 ? "vencido" : days <= 15 ? "urgente" : "atencao",
      title: `Procuração ${p.attorney ? `para ${p.attorney}` : ""}`.trim(),
      subtitle: deadlineUrgency(days).label,
      entityId: p.id,
    });
  }
  for (const pr of records.processes || []) {
    if (processStatusIsClosed(pr.status) || !pr.nextHearing) continue;
    const days = daysUntil(pr.nextHearing, now);
    if (days === null || days > 45) continue;
    alerts.push({
      id: `hearing-${pr.id}`,
      kind: "hearing",
      level: days < 0 ? "vencido" : days <= 5 ? "urgente" : "atencao",
      title: `Audiência: ${pr.title}`,
      subtitle: `${pr.number || "sem número"} · ${deadlineUrgency(days).label}`,
      entityId: pr.id,
    });
  }
  // Mais urgente primeiro, depois vencido → urgente → atenção → programado.
  const order = { vencido: 0, urgente: 1, atencao: 2, programado: 3 };
  return alerts.sort(
    (a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9) || a.title.localeCompare(b.title),
  );
};

// ---------- Fluxo de aprovação ----------

export const approvalActionsFor = (status, viewer = {}) => {
  const juridico = accessLevelFor(viewer) >= 2;
  return Object.entries(LEGAL_APPROVAL_ACTIONS)
    .filter(([, action]) => action.from.includes(status) && (!action.juridico || juridico))
    .map(([id, action]) => ({
      id,
      label: action.label,
      requiresMessage: !!action.requiresMessage,
      requiresContent: !!action.requiresContent,
      juridico: !!action.juridico,
    }));
};

export const resolveApprovalAction = (
  status,
  actionId,
  { viewer = {}, hasMessage = false, hasContent = false } = {},
) => {
  const action = LEGAL_APPROVAL_ACTIONS[actionId];
  if (!action) return { ok: false, error: "Ação de aprovação desconhecida." };
  if (action.juridico && accessLevelFor(viewer) < 2)
    return { ok: false, error: "Só o Jurídico pode executar esta ação." };
  if (!action.from.includes(status))
    return {
      ok: false,
      error: `Ação indisponível na situação atual (${labelContractStatus(status)}).`,
    };
  if (action.requiresMessage && !hasMessage)
    return { ok: false, error: "Escreva a mensagem desta ação." };
  if (action.requiresContent && !hasContent && !hasMessage)
    return { ok: false, error: "Envie o conteúdo ou descreva a solicitação." };
  return { ok: true, nextStatus: action.to };
};

// ---------- Templates ----------

// Templates auditáveis. Placeholders entre {{...}} são substituídos por
// `fillLegalTemplate`. Nunca prometer aconselhamento jurídico — todos trazem o
// aviso explícito de que exigem revisão do responsável.
export const LEGAL_TEMPLATES = Object.freeze([
  {
    id: "nda_bilateral",
    label: "NDA — Termo de Confidencialidade Bilateral",
    kind: "nda",
    body:
      "TERMO DE CONFIDENCIALIDADE BILATERAL\n\n" +
      "Pelo presente instrumento, {{parte_1}} (CNPJ {{cnpj_1}}) e {{parte_2}} (CNPJ {{cnpj_2}}), a seguir denominadas em conjunto \"Partes\", firmam o presente termo, comprometendo-se a manter em sigilo todas as informações trocadas em razão de {{finalidade}}, pelo prazo de {{prazo_meses}} meses contados da assinatura.\n\n" +
      "1. As informações confidenciais compreendem, exemplificativamente, dados técnicos, comerciais, financeiros, estratégicos e operacionais das Partes.\n" +
      "2. As Partes se comprometem a não divulgar, ceder ou comercializar as informações a terceiros sem autorização prévia e por escrito.\n" +
      "3. Em caso de descumprimento, a parte infratora responderá por perdas e danos.\n\n" +
      "{{cidade}}, {{data}}.\n\n" +
      "_________________________       _________________________\n" +
      "{{parte_1}}                     {{parte_2}}\n\n" +
      "AVISO: minuta padrão. Não constitui aconselhamento jurídico e exige revisão do Jurídico antes da assinatura.",
  },
  {
    id: "notificacao_extrajudicial",
    label: "Notificação Extrajudicial",
    kind: "notificacao",
    body:
      "NOTIFICAÇÃO EXTRAJUDICIAL\n\n" +
      "{{cidade}}, {{data}}.\n\n" +
      "Ao(À) Sr.(a) {{destinatario}}\n" +
      "{{endereco}}\n\n" +
      "Prezado(a),\n\n" +
      "Vimos por meio desta notificar V.Sa. sobre {{assunto}}, solicitando providências no prazo de {{prazo_dias}} dias, contados do recebimento desta, sob pena das medidas cabíveis.\n\n" +
      "Aguardamos manifestação no prazo estipulado.\n\n" +
      "Atenciosamente,\n{{remetente}}\n\n" +
      "AVISO: modelo. Deve ser revisto pelo Jurídico e adequado ao caso concreto.",
  },
  {
    id: "procuracao_ad_negotia",
    label: "Procuração ad negotia",
    kind: "procuracao",
    body:
      "PROCURAÇÃO\n\n" +
      "Outorgante: {{outorgante}} (CPF/CNPJ {{doc_outorgante}}).\n" +
      "Outorgado(a): {{outorgado}} (CPF/CNPJ {{doc_outorgado}}), OAB {{oab}}.\n\n" +
      "Poderes: representar o(a) outorgante junto a {{orgaos}}, com poderes para {{poderes}}, podendo requerer, assinar, receber e {{substabelece}}, no prazo de validade de {{validade}}.\n\n" +
      "{{cidade}}, {{data}}.\n\n" +
      "_________________________\n{{outorgante}}\n\n" +
      "AVISO: modelo. Requer conferência de poderes com o Jurídico.",
  },
  {
    id: "parecer_juridico",
    label: "Parecer Jurídico",
    kind: "parecer",
    body:
      "PARECER JURÍDICO {{numero_parecer}}\n\n" +
      "Consulente: {{consulente}}\nAssunto: {{assunto}}\nData: {{data}}\n\n" +
      "1. RELATÓRIO\n{{relatorio}}\n\n" +
      "2. FUNDAMENTAÇÃO\n{{fundamentacao}}\n\n" +
      "3. CONCLUSÃO\n{{conclusao}}\n\n" +
      "{{cidade}}, {{data}}.\n{{responsavel}}\nOAB {{oab}}",
  },
  {
    id: "clausula_lgpd",
    label: "Cláusula LGPD (proteção de dados)",
    kind: "clausula",
    body:
      "CLÁUSULA — PROTEÇÃO DE DADOS PESSOAIS (LGPD)\n\n" +
      "As Partes obrigam-se a tratar os dados pessoais eventualmente compartilhados em decorrência deste contrato em estrita observância à Lei nº 13.709/2018 (LGPD), utilizando-os exclusivamente para as finalidades relacionadas ao objeto contratual.\n" +
      "A parte controladora garantirá a existência de bases legais adequadas para o tratamento, e a operadora tratará os dados conforme instruções documentadas, adotando medidas técnicas e administrativas para prevenir incidentes de segurança.\n" +
      "As Partes comprometem-se a notificar-se em até {{prazo_notificacao}} horas úteis, contadas do conhecimento de qualquer incidente que envolva dados pessoais.",
  },
]);

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const fillLegalTemplate = (body, context = {}) => {
  let out = String(body || "");
  for (const [key, value] of Object.entries(context || {})) {
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, "g"), String(value ?? `[${key}]`));
  }
  out = out.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => `[${k}]`);
  return out;
};

// Extrai chaves de placeholder ({{chave}}) presentes no template, únicas.
export const legalTemplateFields = (body) => {
  const found = new Set();
  const re = /\{\{\s*([\w-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(body || "")))) found.add(m[1]);
  return [...found];
};

// ---------- Compliance / due diligence ----------

export const DUE_DILIGENCE_CATEGORIES = Object.freeze([
  { id: "societaria", label: "Documentação societária" },
  { id: "trabalhista", label: "Trabalhista" },
  { id: "tributaria", label: "Tributária" },
  { id: "ambiental", label: "Ambiental" },
  { id: "regulatoria", label: "Regulatória" },
  { id: "contratos", label: "Contratos relevantes" },
  { id: "propriedade_intelectual", label: "Propriedade intelectual" },
  { id: "processual", label: "Processos judiciais e administrativos" },
  { id: "financeira", label: "Financeira" },
  { id: "lgpd", label: "LGPD e privacidade" },
]);

export const CHECK_STATUSES = Object.freeze([
  { id: "pendente", label: "Pendente" },
  { id: "solicitado", label: "Solicitado" },
  { id: "recebido", label: "Recebido, em análise" },
  { id: "conforme", label: "Conforme" },
  { id: "nao_conforme", label: "Não conforme" },
  { id: "nao_aplicavel", label: "Não aplicável" },
]);

// Score de conformidade: conformes / (total - não aplicáveis). Devolve `null`
// (não `0`) quando não há check aplicável — para não confundir "vazio" com "0%".
export const complianceScore = (checks = []) => {
  const applicable = checks.filter((c) => c.status !== "nao_aplicavel");
  if (applicable.length === 0) return null;
  const okay = applicable.filter((c) => c.status === "conforme").length;
  return okay / applicable.length;
};

export const complianceGaps = (checks = []) =>
  (checks || []).filter((c) => c.status === "nao_conforme" || c.status === "pendente");

// ---------- Busca centralizada ----------

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const scoreMatch = (text, query) => {
  if (!query) return 0;
  const t = normalize(text);
  const q = normalize(query);
  if (!t || !q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(` ${q}`)) return 60;
  if (t.includes(q)) return 40;
  return 0;
};

// Retorna itens do jurídico que casam com `query`, mais relevantes primeiro.
// Aplica ao final o filtro por confidencialidade (visão do usuário).
export const searchLegal = (records = {}, query, viewer = {}) => {
  const q = String(query || "").trim();
  if (!q) return [];
  const results = [];
  const push = (kind, r, fields) => {
    const bestScore = Math.max(0, ...fields.map((f) => scoreMatch(f, q)));
    if (bestScore > 0) results.push({ kind, id: r.id, title: r.title || r.name || "Sem título", score: bestScore, record: r });
  };
  for (const m of records.matters || []) push("matter", m, [m.title, m.description, m.notes, m.number]);
  for (const c of records.contracts || []) push("contract", c, [c.title, c.counterparty, c.counterpartyDocument, c.notes]);
  for (const p of records.processes || []) push("process", p, [p.title, p.number, p.court, p.notes]);
  for (const p of records.powersOfAttorney || [])
    push("power-of-attorney", p, [p.title, p.grantor, p.attorney, p.purpose]);
  for (const d of records.deadlines || []) push("deadline", d, [d.title, d.notes]);
  for (const o of records.offices || []) push("office", o, [o.name, o.contactName, o.email, o.oab]);
  const visible = results.filter((r) => canRead(r.record, viewer));
  return visible.sort((a, b) => b.score - a.score).slice(0, 50);
};

// ---------- Relatórios e indicadores ----------

// Indicadores globais para relatório do Jurídico. Cada um traz UM número
// principal + um contexto — sem inventar "meta" que ninguém definiu.
export const legalReports = (records = {}, now = Date.now()) => {
  const dashboard = legalDashboard(records, now);
  const contracts = records.contracts || [];
  const processes = records.processes || [];
  const matters = records.matters || [];

  const contractsSigned30 = contracts.filter((c) => {
    const signAt = onlyDate(c.updatedAt) || c.startDate;
    const days = daysUntil(signAt, now);
    return c.status === "vigente" && days !== null && days >= -30 && days <= 0;
  }).length;

  const matterAverageAgeDays = (() => {
    const open = matters.filter((m) => !matterStatusIsClosed(m.status));
    if (open.length === 0) return null;
    const total = open.reduce((sum, m) => {
      const days = daysUntil(m.openedAt, now);
      return sum + (days === null ? 0 : Math.max(0, -days));
    }, 0);
    return Math.round(total / open.length);
  })();

  const processWinRate = (() => {
    const decided = processes.filter((p) => p.status === "ganho" || p.status === "perdido");
    if (decided.length === 0) return null;
    return decided.filter((p) => p.status === "ganho").length / decided.length;
  })();

  return {
    dashboard,
    contractsSigned30,
    matterAverageAgeDays,
    processWinRate,
  };
};

// ---------- Eventos (linha do tempo) ----------

// Cria um evento imutável associado a uma entidade (matter/contract/process/poa).
// Os eventos vivem embutidos na própria entidade (evita coleção separada em
// v0; se crescer demais, migra-se para tabela relacional depois).
export const appendLegalEvent = (record, event = {}) => {
  const created = {
    id: uid(),
    kind: String(event.kind || "note"),
    message: String(event.message || "").trim(),
    author: String(event.author || "").trim(),
    attachmentUrl: String(event.attachmentUrl || "").trim(),
    attachmentName: String(event.attachmentName || "").trim(),
    createdAt: baseTimestamp(),
  };
  const list = Array.isArray(record?.events) ? record.events : [];
  return {
    ...record,
    events: [...list, created],
    updatedAt: baseTimestamp(),
  };
};

export const summarizeEventTimeline = (record) => {
  const list = Array.isArray(record?.events) ? record.events : [];
  const last = list[list.length - 1] || null;
  return {
    total: list.length,
    lastEvent: last,
  };
};

// ---------- Fluxo IA ----------

// Prompt determinístico para a IA gerar resumo/comparação/cláusulas/prazos.
// A UI passa isso ao endpoint /api/ai — o domínio garante o formato certo.
export const buildLegalAiPrompt = (mode, payload = {}) => {
  const rules =
    "Instruções obrigatórias:\n" +
    "- Trabalhe SÓ com o texto fornecido; não use conhecimento externo.\n" +
    "- Diga 'não consta' quando o texto não trouxer a informação — nunca invente.\n" +
    "- Escreva em português do Brasil, de forma objetiva e sem opinar.\n" +
    "- Cite trechos entre aspas quando a resposta depender de uma passagem específica.\n";
  if (mode === "resumo") {
    return (
      "Você é um assistente jurídico. Resuma o documento abaixo em até 8 linhas, listando as PARTES, o OBJETO, VIGÊNCIA, MULTAS/RESCISÃO e PRAZOS explícitos.\n\n" +
      rules +
      "\n---\nDOCUMENTO:\n" +
      String(payload.text || "").slice(0, 18000)
    );
  }
  if (mode === "comparar") {
    return (
      "Compare os dois documentos abaixo. Aponte as DIFERENÇAS RELEVANTES em cláusulas, prazos, multas, objeto e responsabilidades. Devolva em formato JSON: {\"iguais\": [\"...\"], \"diferentes\": [{\"tema\": \"...\", \"documento_a\": \"...\", \"documento_b\": \"...\"}], \"ausentes_em_a\": [\"...\"], \"ausentes_em_b\": [\"...\"]}.\n\n" +
      rules +
      "\n---\nDOCUMENTO A:\n" +
      String(payload.textA || "").slice(0, 9000) +
      "\n---\nDOCUMENTO B:\n" +
      String(payload.textB || "").slice(0, 9000)
    );
  }
  if (mode === "clausulas") {
    return (
      "Identifique as principais CLÁUSULAS do documento abaixo. Devolva em JSON: {\"clausulas\": [{\"titulo\": \"...\", \"resumo\": \"...\", \"riscos\": [\"...\"]}]}.\n\n" +
      rules +
      "\n---\nDOCUMENTO:\n" +
      String(payload.text || "").slice(0, 18000)
    );
  }
  if (mode === "prazos") {
    return (
      "Extraia todos os PRAZOS, DATAS-LIMITE e VENCIMENTOS mencionados. Devolva em JSON: {\"prazos\": [{\"o_que\": \"...\", \"quando\": \"AAAA-MM-DD ou descrição\", \"trecho\": \"...\"}]}. Prefira datas absolutas. Se só houver prazo relativo (ex.: '30 dias após assinatura'), preserve o texto.\n\n" +
      rules +
      "\n---\nDOCUMENTO:\n" +
      String(payload.text || "").slice(0, 18000)
    );
  }
  return rules;
};

// Parser tolerante das respostas da IA aos modos acima. Cerca de segurança:
// nunca invocar `eval`, nunca confiar no shape — sempre coagir.
export const parseLegalAiResponse = (mode, raw) => {
  const asObject = (() => {
    try {
      const cleaned = String(raw || "")
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();
      const match = cleaned.match(/\{[\s\S]*\}$/);
      const source = match ? match[0] : cleaned;
      return JSON.parse(source);
    } catch {
      return null;
    }
  })();
  if (!asObject) return null;
  if (mode === "clausulas") {
    return { clauses: Array.isArray(asObject.clausulas) ? asObject.clausulas : [] };
  }
  if (mode === "prazos") {
    return { deadlines: Array.isArray(asObject.prazos) ? asObject.prazos : [] };
  }
  if (mode === "comparar") {
    return {
      same: Array.isArray(asObject.iguais) ? asObject.iguais : [],
      different: Array.isArray(asObject.diferentes) ? asObject.diferentes : [],
      missingInA: Array.isArray(asObject.ausentes_em_a) ? asObject.ausentes_em_a : [],
      missingInB: Array.isArray(asObject.ausentes_em_b) ? asObject.ausentes_em_b : [],
    };
  }
  return asObject;
};
