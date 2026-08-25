export const TODO_GREEN_WORK_CENTER = {
  id: "central-trabalho",
  name: "Central de Implantação",
  route: "/todogreen/central-trabalho",
  description: "Execução integrada de implantações de clientes, projetos, processos, aprovações, operações e rotinas da To Do Green.",
};

export const WORK_CENTER_OBJECT_TYPES = [
  "tarefa",
  "projeto",
  "processo",
  "aprovacao",
  "documento",
  "cliente",
  "contrato",
  "rfq",
  "cotacao",
  "oportunidade",
  "implantacao",
  "operacao",
  "rota",
  "viagem",
  "veiculo",
  "motorista",
  "entrega",
  "auditoria",
  "nao-conformidade",
  "plano-de-acao",
  "risco",
  "objetivo",
  "indicador",
  "reuniao",
];

export const WORK_CENTER_FIELD_TYPES = [
  "text",
  "long-text",
  "number",
  "currency",
  "percentage",
  "status",
  "priority",
  "person",
  "team",
  "date",
  "timeline",
  "duration",
  "checkbox",
  "tags",
  "file",
  "formula",
  "dependency",
  "progress",
  "location",
  "url",
  "email",
  "phone",
  "dropdown",
  "rating",
  "record-id",
  "relation",
  "mirror",
  "lookup",
  "rollup",
  "approval",
  "button",
  "signature",
  "ai",
  "json",
  "qr-code",
  "barcode",
];

export const WORK_CENTER_VIEWS = [
  "table",
  "list",
  "kanban",
  "calendar",
  "timeline",
  "gantt",
  "dashboard",
  "map",
  "gallery",
  "workload",
  "form",
  "pivot",
  "roadmap",
  "organization-chart",
];

export const WORK_CENTER_RESOURCE_TYPES = [
  "person",
  "team",
  "vehicle",
  "driver",
  "machine",
  "room",
  "equipment",
  "supplier",
  "partner",
  "contract",
  "budget",
];

export const WORK_CENTER_PERMISSION_SCOPES = [
  "company",
  "business-unit",
  "department",
  "team",
  "project",
  "board",
  "view",
  "column",
  "item",
  "field",
  "automation",
  "dashboard",
  "document",
  "action",
];

export const WORK_CENTER_AUTOMATION_TRIGGERS = [
  "item-created",
  "item-updated",
  "status-changed",
  "date-reached",
  "date-overdue",
  "field-changed",
  "approval-decided",
  "form-submitted",
  "dependency-completed",
  "sla-at-risk",
  "threshold-reached",
  "schedule",
];

export const WORK_CENTER_AUTOMATION_ACTIONS = [
  "create-item",
  "create-subitem",
  "update-field",
  "change-status",
  "change-priority",
  "assign-person",
  "assign-team",
  "move-item",
  "duplicate-item",
  "create-task",
  "create-project",
  "create-document",
  "create-approval",
  "create-opportunity",
  "create-proposal",
  "create-contract",
  "create-operation",
  "create-pricing-scenario",
  "create-esg-calculation",
  "publish-client-portal",
  "send-email",
  "research-client",
  "prepare-whatsapp",
  "send-notification",
  "call-ai",
  "run-webhook",
];

export const WORK_CENTER_AI_SPECIALISTS = {
  commercial: "Especialista em Contas e Vendas",
  pricing: "Especialista em Precificação Logística",
  finance: "Especialista Financeiro",
  operations: "Especialista em Operações Logísticas",
  supplyChain: "Especialista em Supply Chain",
  esg: "Especialista ESG",
  legal: "Especialista Jurídico",
  projects: "Especialista em Projetos",
  data: "Especialista em Dados",
  people: "Especialista em Pessoas",
};

export const WORK_CENTER_AI_ACTIONS = [
  "summarize",
  "identify-risks",
  "suggest-deadline",
  "suggest-owner",
  "generate-subitems",
  "predict-delay",
  "calculate-margin",
  "identify-bottlenecks",
  "generate-action-plan",
  "compare-projects",
  "create-documentation",
  "classify-item",
  "extract-fields",
  "recommend-next-action",
];

export function createWorkCenterObject(input = {}, context = {}) {
  const now = new Date().toISOString();
  const type = WORK_CENTER_OBJECT_TYPES.includes(input.type) ? input.type : "tarefa";
  return {
    id: input.id || crypto.randomUUID(),
    type,
    title: String(input.title || "Novo item").trim(),
    description: String(input.description || ""),
    status: input.status || "novo",
    priority: input.priority || "media",
    boardId: input.boardId || "",
    parentId: input.parentId || null,
    businessId: input.businessId || context.businessId || null,
    ownerId: input.ownerId || context.ownerId || null,
    assigneeIds: Array.isArray(input.assigneeIds) ? input.assigneeIds : [],
    observerIds: Array.isArray(input.observerIds) ? input.observerIds : [],
    approverIds: Array.isArray(input.approverIds) ? input.approverIds : [],
    fields: input.fields && typeof input.fields === "object" ? input.fields : {},
    relations: Array.isArray(input.relations) ? input.relations : [],
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    comments: Array.isArray(input.comments) ? input.comments : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    audit: Array.isArray(input.audit) ? input.audit : [],
    createdAt: input.createdAt || now,
    updatedAt: now,
    archivedAt: input.archivedAt || null,
  };
}

export function validateWorkCenterField(field = {}) {
  const errors = [];
  if (!field.id) errors.push("field.id is required");
  if (!field.label) errors.push("field.label is required");
  if (!WORK_CENTER_FIELD_TYPES.includes(field.type)) errors.push("field.type is invalid");
  return { valid: errors.length === 0, errors };
}

export function evaluateAutomationRule(rule = {}, item = {}, event = {}) {
  const triggerMatches = rule.trigger === event.type;
  if (!triggerMatches) return false;
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  return conditions.every((condition) => {
    const current = item.fields?.[condition.field] ?? item[condition.field];
    if (condition.operator === "equals") return current === condition.value;
    if (condition.operator === "not-equals") return current !== condition.value;
    if (condition.operator === "contains") return String(current || "").includes(String(condition.value || ""));
    if (condition.operator === "greater-than") return Number(current) > Number(condition.value);
    if (condition.operator === "less-than") return Number(current) < Number(condition.value);
    if (condition.operator === "is-empty") return current === "" || current == null;
    if (condition.operator === "is-not-empty") return current !== "" && current != null;
    return false;
  });
}

export function buildWorkCenterAiRequest({ action, specialist, item, boardContext, instruction }) {
  const safeAction = WORK_CENTER_AI_ACTIONS.includes(action) ? action : "recommend-next-action";
  const specialistName = WORK_CENTER_AI_SPECIALISTS[specialist] || WORK_CENTER_AI_SPECIALISTS.projects;
  return {
    endpoint: "/api/ai",
    specialist: specialistName,
    prompt: [
      `Ação: ${safeAction}.`,
      `Contexto do quadro: ${boardContext || "Central de Implantação To Do Green"}.`,
      `Item: ${JSON.stringify(item || {})}.`,
      instruction ? `Instrução adicional: ${instruction}.` : "",
      "Responda com recomendações objetivas, rastreáveis e sem inventar dados ausentes.",
    ].filter(Boolean).join("\n"),
  };
}

export function summarizeWorkCenter(items = []) {
  const active = items.filter((item) => !item.archivedAt);
  const overdue = active.filter((item) => item.fields?.dueDate && item.fields.dueDate < new Date().toISOString().slice(0, 10) && item.status !== "concluido");
  const blocked = active.filter((item) => item.status === "bloqueado" || item.dependencies?.some((dependency) => dependency.status === "pending"));
  const approvals = active.filter((item) => item.type === "aprovacao" && item.status === "pendente");
  return {
    total: active.length,
    overdue: overdue.length,
    blocked: blocked.length,
    pendingApprovals: approvals.length,
    byType: active.reduce((acc, item) => ({ ...acc, [item.type]: (acc[item.type] || 0) + 1 }), {}),
    byStatus: active.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}),
  };
}
