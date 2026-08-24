const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ymd = (value) => String(value || "").slice(0, 10);

export const PROJECT_STATUSES = [
  "Planejamento",
  "Em andamento",
  "Em risco",
  "Bloqueado",
  "Concluído",
  "Cancelado",
];

export const PROJECT_AREAS = [
  "Comercial",
  "Operações",
  "Planejamento",
  "Financeiro",
  "Fiscal",
  "Compras",
  "Estoque",
  "Logística",
  "TI e Dados",
  "Produto",
  "Marketing",
  "RH e Pessoas",
  "Jurídico",
  "ESG e Sustentabilidade",
  "Diretoria",
  "PMO",
  "Outros",
];

export const projectArea = (project = {}) =>
  String(project.area || "Outros").trim() || "Outros";

export const MILESTONE_TYPES = [
  "Entrega",
  "Contratual",
  "Financeiro",
  "Aprovação",
  "Lançamento",
  "Implantação",
  "Pagamento",
  "Interno",
];

export const normalizeMilestone = (milestone = {}) => ({
  id: milestone.id || crypto.randomUUID(),
  title: String(milestone.title || "").trim(),
  type: MILESTONE_TYPES.includes(milestone.type) ? milestone.type : "Entrega",
  plannedDate: ymd(milestone.plannedDate),
  actualDate: ymd(milestone.actualDate),
  ownerId: milestone.ownerId || "",
  ownerName: String(milestone.ownerName || "").trim(),
  linkedTaskIds: [...new Set(milestone.linkedTaskIds || [])],
  status: ["Pendente", "Em risco", "Bloqueado", "Concluído"].includes(
    milestone.status,
  )
    ? milestone.status
    : "Pendente",
  evidence: String(milestone.evidence || "").trim(),
  approvedAt: milestone.approvedAt || null,
  approvedBy: milestone.approvedBy || null,
});

export const createProjectRecord = (input = {}, context = {}, existing = {}) => {
  const now = new Date().toISOString();
  const requestedArea = String(input.area ?? existing.area ?? "Outros").trim();
  return {
    ...existing,
    id: existing.id || input.id || crypto.randomUUID(),
    name: String(input.name || existing.name || "").trim(),
    area: requestedArea || "Outros",
    description: String(input.description || "").trim(),
    objective: String(input.objective || "").trim(),
    justification: String(input.justification || "").trim(),
    scope: String(input.scope || "").trim(),
    deliverables: String(input.deliverables || "").trim(),
    successCriteria: String(input.successCriteria || "").trim(),
    sponsor: String(input.sponsor || "").trim(),
    manager: String(input.manager || "").trim(),
    startDate: ymd(input.startDate),
    dueDate: ymd(input.dueDate),
    actualEndDate: ymd(input.actualEndDate),
    status: PROJECT_STATUSES.includes(input.status)
      ? input.status
      : "Planejamento",
    priority: ["Baixa", "Média", "Alta", "Crítica"].includes(input.priority)
      ? input.priority
      : "Média",
    budgetPlanned: Math.max(0, asNumber(input.budgetPlanned)),
    costActual: Math.max(0, asNumber(input.costActual)),
    hoursPlanned: Math.max(0, asNumber(input.hoursPlanned)),
    hoursActual: Math.max(0, asNumber(input.hoursActual)),
    workdays:
      Array.isArray(input.workdays) && input.workdays.length
        ? [...new Set(input.workdays.map(Number))].filter(
            (day) => day >= 0 && day <= 6,
          )
        : [1, 2, 3, 4, 5],
    holidays: (Array.isArray(input.holidays)
      ? input.holidays
      : String(input.holidays || "").split(/[\n,;]/)
    )
      .map((date) => ymd(String(date).trim()))
      .filter((validDate) => /^\d{4}-\d{2}-\d{2}$/.test(validDate)),
    milestones: (input.milestones || []).map(normalizeMilestone).filter((m) => m.title),
    risks: Array.isArray(input.risks) ? input.risks : existing.risks || [],
    issues: Array.isArray(input.issues) ? input.issues : existing.issues || [],
    decisions: Array.isArray(input.decisions)
      ? input.decisions
      : existing.decisions || [],
    changeRequests: Array.isArray(input.changeRequests)
      ? input.changeRequests
      : existing.changeRequests || [],
    businessId: context.businessId || existing.businessId || null,
    ownerId: context.ownerId || existing.ownerId || null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
};

export const normalizeGovernanceItem = (item = {}, kind = "risk") => ({
  id: item.id || crypto.randomUUID(),
  kind,
  title: String(item.title || "").trim(),
  description: String(item.description || "").trim(),
  ownerName: String(item.ownerName || "").trim(),
  severity: ["Baixa", "Média", "Alta", "Crítica"].includes(item.severity)
    ? item.severity
    : "Média",
  status: String(item.status || "Aberto"),
  dueDate: ymd(item.dueDate),
  createdAt: item.createdAt || new Date().toISOString(),
  closedAt: item.closedAt || null,
});

export const milestoneState = (milestone, tasks = [], today = ymd(new Date().toISOString())) => {
  const linked = (tasks || []).filter((task) =>
    (milestone?.linkedTaskIds || []).includes(task.id),
  );
  const blocked = linked.some(
    (task) => task.status !== "Concluído" && (task.blocked || task.blockReason),
  );
  const allDone = linked.length > 0 && linked.every((task) => task.status === "Concluído");
  const completed = milestone?.status === "Concluído" || !!milestone?.actualDate || allDone;
  const overdue = !completed && milestone?.plannedDate && milestone.plannedDate < today;
  const atRisk =
    !completed &&
    !overdue &&
    milestone?.plannedDate &&
    milestone.plannedDate <=
      new Date(`${today}T12:00:00Z`).toISOString().slice(0, 10);
  return {
    status: completed
      ? "Concluído"
      : blocked || milestone?.status === "Bloqueado"
        ? "Bloqueado"
        : overdue
          ? "Atrasado"
          : milestone?.status === "Em risco" || atRisk
            ? "Em risco"
            : "Pendente",
    completed,
    overdue,
    blocked,
  };
};

export const projectMetrics = (
  project,
  tasks = [],
  today = ymd(new Date().toISOString()),
) => {
  const projectTasks = (tasks || []).filter(
    (task) =>
      task.projectId === project?.id ||
      (!task.projectId && task.project && task.project === project?.name),
  );
  const completedTasks = projectTasks.filter((task) => task.status === "Concluído");
  const taskProgress = projectTasks.length
    ? Math.round((completedTasks.length / projectTasks.length) * 100)
    : 0;
  const milestoneStates = (project?.milestones || []).map((milestone) => ({
    milestone,
    ...milestoneState(milestone, projectTasks, today),
  }));
  const completedMilestones = milestoneStates.filter((item) => item.completed).length;
  const milestoneProgress = milestoneStates.length
    ? Math.round((completedMilestones / milestoneStates.length) * 100)
    : null;
  const progress =
    milestoneProgress == null
      ? taskProgress
      : projectTasks.length
        ? Math.round((taskProgress + milestoneProgress) / 2)
        : milestoneProgress;
  const overdueTasks = projectTasks.filter(
    (task) => task.status !== "Concluído" && task.due && task.due < today,
  ).length;
  const overdueMilestones = milestoneStates.filter((item) => item.overdue).length;
  const blockedMilestones = milestoneStates.filter((item) => item.blocked).length;
  const openRisks = (project?.risks || []).filter(
    (item) => !["Encerrado", "Mitigado", "Cancelado"].includes(item.status),
  );
  const openIssues = (project?.issues || []).filter(
    (item) => !["Resolvido", "Encerrado", "Cancelado"].includes(item.status),
  );
  const criticalGovernance = [...openRisks, ...openIssues].filter((item) =>
    ["Alta", "Crítica"].includes(item.severity),
  ).length;
  const plannedBudget = asNumber(project?.budgetPlanned);
  const actualCost = asNumber(project?.costActual);
  const plannedHours = asNumber(project?.hoursPlanned);
  const actualHours =
    asNumber(project?.hoursActual) ||
    projectTasks.reduce((sum, task) => sum + asNumber(task.timeSpent), 0);
  const health =
    project?.status === "Bloqueado" || blockedMilestones
      ? "Bloqueado"
      : overdueMilestones ||
          overdueTasks ||
          criticalGovernance ||
          (plannedBudget > 0 && actualCost > plannedBudget)
        ? "Em risco"
        : project?.status === "Concluído" || progress === 100
          ? "Concluído"
          : "Saudável";
  return {
    progress,
    health,
    taskProgress,
    milestoneProgress,
    tasks: projectTasks.length,
    completedTasks: completedTasks.length,
    overdueTasks,
    milestones: milestoneStates.length,
    completedMilestones,
    overdueMilestones,
    blockedMilestones,
    openRisks: openRisks.length,
    openIssues: openIssues.length,
    criticalGovernance,
    budgetVariance: plannedBudget - actualCost,
    hoursVariance: plannedHours - actualHours,
    nextMilestones: milestoneStates
      .filter((item) => !item.completed)
      .sort((a, b) =>
        String(a.milestone.plannedDate || "9999").localeCompare(
          String(b.milestone.plannedDate || "9999"),
        ),
      )
      .slice(0, 3),
  };
};