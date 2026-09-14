const list = (value) => (Array.isArray(value) ? value : []);

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const byId = (items) => {
  const map = new Map();
  for (const item of list(items)) {
    for (const key of [item?.id, item?.taskId, item?.canonicalTaskId]) {
      const normalized = String(key || "").trim();
      if (normalized && !map.has(normalized)) map.set(normalized, item);
    }
  }
  return map;
};

const firstText = (...values) =>
  values.map((value) => String(value || "").trim()).find(Boolean) || "";

export const TODO_GREEN_TASK_DONE_STATUSES = Object.freeze(["concluido", "done", "completed"]);

export const normalizeTodoGreenTaskStatus = (value) => {
  const status = normalizeText(value);
  if (TODO_GREEN_TASK_DONE_STATUSES.includes(status) || status === "concluida") return "Concluído";
  if (["em andamento", "em_andamento", "doing", "progress", "in progress", "in_progress"].includes(status)) {
    return "Em andamento";
  }
  if (["aguardando", "waiting", "blocked", "bloqueada", "bloqueado"].includes(status)) return "Aguardando";
  return "A fazer";
};

const normalizePriority = (value) => {
  const priority = normalizeText(value);
  if (["urgente", "urgent", "critical", "critica", "critico"].includes(priority)) return "Urgente";
  if (["alta", "high"].includes(priority)) return "Alta";
  if (["baixa", "low"].includes(priority)) return "Baixa";
  return "Média";
};

const priorityRank = (task) => ({ Urgente: 0, Alta: 1, Média: 2, Baixa: 3 }[task.priority] ?? 4);

const taskSort = (a, b) =>
  priorityRank(a) - priorityRank(b) ||
  String(a.due || "9999-12-31").localeCompare(String(b.due || "9999-12-31")) ||
  String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");

const sourceTaskId = (task = {}) => firstText(task.canonicalTaskId, task.taskId, task.id);

const dependencyIdsOf = (task = {}) => {
  const raw = task.dependsOn ?? task.dependencies ?? task.blockedBy ?? [];
  return list(Array.isArray(raw) ? raw : [raw])
    .map((item) => String(item?.id || item?.taskId || item || "").trim())
    .filter(Boolean);
};

const openStatus = (status) => !TODO_GREEN_TASK_DONE_STATUSES.includes(normalizeText(status)) && normalizeText(status) !== "concluida";

export const buildTodoGreenCanonicalTask = (task = {}, {
  tasks = [],
  projects = [],
  clients = [],
  opportunities = [],
  currentUserId = "",
  today = new Date().toISOString().slice(0, 10),
} = {}) => {
  const taskId = sourceTaskId(task);
  const rawId = firstText(task.id, task.taskId, taskId);
  const allTasksById = byId(tasks);
  const projectsById = byId(projects);
  const opportunitiesById = byId(opportunities);
  const clientsById = byId(clients);
  const opportunity = opportunitiesById.get(String(task.opportunityId || ""));
  const client = clientsById.get(String(task.clientId || opportunity?.clientId || ""));
  const projectRecord = projectsById.get(String(task.projectId || task.plannerPlanId || ""));
  const dependsOn = dependencyIdsOf(task);
  const dependencyTasks = dependsOn.map((id) => allTasksById.get(String(id))).filter(Boolean);
  const dependencyLabels = dependencyTasks.map((item) => firstText(item.title, item.name, item.id));
  const dependencyOpen = dependencyTasks.some((item) => openStatus(item.status));
  const missingDependency = dependsOn.length > dependencyTasks.length;
  const status = normalizeTodoGreenTaskStatus(task.status);
  const priority = normalizePriority(task.priority);
  const due = firstText(task.due, task.dueDate, task.deadline);
  // Responsável explícito: quem foi atribuído à tarefa (CRM/Planner/To Do
  // gravam nesses campos). Só quando NÃO existe responsável cai para ownerId.
  // O CRM cria follow-up com assigneeId = responsável e ownerId = criador; sem
  // essa separação, "Minha tarefa" contava a tarefa também para o criador.
  const explicitAssigneeId = firstText(
    task.assigneeId,
    task.assignedTo,
    task.assigneeUserId,
    task.assignee_user_id,
  );
  const explicitAssigneeIds = list(task.assignees)
    .map((item) => String(item?.id || item?.userId || item || "").trim())
    .filter(Boolean);
  const hasExplicitAssignee = Boolean(explicitAssigneeId || explicitAssigneeIds.length);
  const assigneeId = firstText(explicitAssigneeId, task.ownerId, task.userId);
  const assignee = firstText(task.assignee, task.assigneeLabel, task.ownerName, assigneeId);
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  const responsibleIdentifiers = hasExplicitAssignee
    ? [explicitAssigneeId, ...explicitAssigneeIds, task.assignee, task.assigneeLabel]
    : [assigneeId, assignee, task.ownerId, task.userId];
  const mine = Boolean(
    task.mine ||
    task.assignedToMe ||
    (normalizedCurrentUserId && responsibleIdentifiers.map(String).includes(normalizedCurrentUserId)),
  );
  const blocked = Boolean(task.blocked || dependsOn.length && (dependencyOpen || missingDependency));
  const open = status !== "Concluído";
  const project = firstText(task.project, projectRecord?.name, opportunity?.title, opportunity?.name);
  const clientId = firstText(task.clientId, client?.id, opportunity?.clientId);
  const opportunityId = firstText(task.opportunityId, opportunity?.id);
  const clientLabel = firstText(task.clientLabel, client?.name, client?.company, opportunity?.clientName, project);
  const nextAction = firstText(
    task.nextAction,
    task.nextStep,
    task.proximaAcao,
    blocked ? "Resolver dependência" : "",
    due && due < today ? "Replanejar prazo" : "",
    status === "A fazer" ? "Definir primeira ação" : "Avançar execução",
  );
  const sourceLinks = {
    ...(task.sourceLinks || {}),
    todo: { taskId: rawId },
    ...(task.plannerPlanId || task.plannerTaskId ? {
      planner: { planId: task.plannerPlanId || "", taskId: task.plannerTaskId || rawId },
    } : {}),
    ...(clientId || opportunityId || String(task.source || "").includes("crm") ? {
      crm: { clientId, opportunityId },
    } : {}),
    ...(task.implantationId || String(task.source || "").includes("implant") ? {
      implantation: { implantationId: task.implantationId || "", taskId: rawId },
    } : {}),
  };

  return {
    raw: task,
    id: taskId,
    rawId,
    canonicalId: taskId,
    title: firstText(task.title, task.name, "Tarefa sem título"),
    description: task.description || task.notes || "",
    status,
    priority,
    due,
    assignee,
    assigneeId,
    project,
    projectId: firstText(task.projectId, task.plannerPlanId),
    clientId,
    clientLabel,
    opportunityId,
    dependsOn,
    dependencyLabels,
    blocked,
    nextAction,
    flags: {
      open,
      overdue: Boolean(open && due && due < today),
      dueToday: Boolean(open && due === today),
      blocked: Boolean(open && blocked),
      highPriority: Boolean(open && ["Urgente", "Alta"].includes(priority)),
      mine: Boolean(open && mine),
    },
    sourceLinks,
  };
};

export const buildTodoGreenTaskBoard = ({
  db = {},
  verticalData = {},
  businessId = "todogreen",
  currentUserId = "",
  today = new Date().toISOString().slice(0, 10),
} = {}) => {
  const rawTasks = scoped(db.tasks, businessId).filter((task) => task.archived !== true && task.deleted !== true);
  const projects = [...list(db.projects), ...list(verticalData.projects), ...list(verticalData.plannerPlans)];
  const canonicalById = new Map();
  for (const rawTask of rawTasks) {
    const canonical = buildTodoGreenCanonicalTask(rawTask, {
      tasks: rawTasks,
      projects,
      clients: verticalData.clients,
      opportunities: verticalData.opportunities,
      currentUserId,
      today,
    });
    const current = canonicalById.get(canonical.id);
    if (!current) {
      canonicalById.set(canonical.id, canonical);
      continue;
    }
    const currentIsLegacy = current.raw?.canonicalSource === "planner";
    const candidateIsLegacy = canonical.raw?.canonicalSource === "planner";
    const currentUpdatedAt = String(current.raw?.updatedAt || current.raw?.createdAt || "");
    const candidateUpdatedAt = String(canonical.raw?.updatedAt || canonical.raw?.createdAt || "");
    if ((currentIsLegacy && !candidateIsLegacy) || (currentIsLegacy === candidateIsLegacy && candidateUpdatedAt > currentUpdatedAt)) {
      canonicalById.set(canonical.id, canonical);
    }
  }
  const canonicalTasks = [...canonicalById.values()].sort(taskSort);
  const openTasks = canonicalTasks.filter((task) => task.flags.open);
  const byStatus = new Map();
  for (const task of canonicalTasks) {
    const bucket = byStatus.get(task.status) || [];
    bucket.push(task);
    byStatus.set(task.status, bucket);
  }
  const projectMap = new Map();
  for (const task of openTasks) {
    const key = task.projectId || task.project || task.clientLabel || "sem-projeto";
    const current = projectMap.get(key) || {
      id: key,
      name: task.project || task.clientLabel || "Sem projeto",
      clientLabel: task.clientLabel || "",
      open: 0,
      overdue: 0,
      blocked: 0,
      highPriority: 0,
    };
    current.open += 1;
    if (task.flags.overdue) current.overdue += 1;
    if (task.flags.blocked) current.blocked += 1;
    if (task.flags.highPriority) current.highPriority += 1;
    projectMap.set(key, current);
  }

  return {
    tasks: canonicalTasks,
    today: {
      overdue: openTasks.filter((task) => task.flags.overdue),
      dueToday: openTasks.filter((task) => task.flags.dueToday),
      blocked: openTasks.filter((task) => task.flags.blocked),
      highPriority: openTasks.filter((task) => task.flags.highPriority),
      mine: openTasks.filter((task) => task.flags.mine),
      nextActions: openTasks.filter((task) => task.nextAction).slice(0, 8),
    },
    upcoming: openTasks.filter((task) => task.due && task.due > today).slice(0, 12),
    board: Object.fromEntries([...byStatus.entries()].map(([status, items]) => [status, items.sort(taskSort)])),
    projects: [...projectMap.values()].sort((a, b) => b.overdue - a.overdue || b.highPriority - a.highPriority || a.name.localeCompare(b.name, "pt-BR")),
    metrics: {
      total: canonicalTasks.length,
      open: openTasks.length,
      overdue: openTasks.filter((task) => task.flags.overdue).length,
      blocked: openTasks.filter((task) => task.flags.blocked).length,
      highPriority: openTasks.filter((task) => task.flags.highPriority).length,
    },
  };
};


export const TODO_GREEN_WORKSPACE_TOOLS = Object.freeze([
  {
    id: "visao-geral",
    label: "Visão geral",
    description: "Contexto, pendências e acessos rápidos em um só lugar.",
  },
  {
    id: "inteligencia",
    label: "Notícias e inteligência",
    description: "Notícias, RFQs e portais encontrados nas pesquisas reais das contas.",
  },
  {
    id: "contatos",
    label: "Contatos",
    description: "Decisores e canais já registrados na carteira comercial da To Do Green.",
  },
  {
    id: "notas",
    label: "Notas conectadas",
    description: "Cadernos, diário, backlinks, grafo e notas ligadas à carteira do ERP.",
  },
  {
    id: "paginas",
    label: "Páginas e documentos",
    description: "Editor em blocos, arquivos, versões e páginas ligadas à carteira do ERP.",
  },
  {
    id: "automacoes",
    label: "Automações",
    description: "Gatilhos, condições e ações executadas no servidor com histórico.",
  },
  {
    id: "ajuda",
    label: "Central de ajuda",
    description: "Onde encontrar cada rotina e como usar os recursos da To Do Green.",
  },
  {
    id: "estrutura",
    label: "Estrutura",
    description: "Áreas, pastas e listas sem duplicar projetos.",
  },
  {
    // O To Do pessoal do aplicativo geral. Sumiu do alcance quando a vertical
    // virou a casa única ("perdemos o to do", titular 31/08) — e com ele foram
    // os botões de Google Agenda e Gmail que vivem dentro de cada tarefa.
    id: "tarefas",
    label: "To Do",
    description: "Tarefas rápidas com prazo, responsável, Google Agenda e Gmail.",
  },
  {
    id: "visoes",
    label: "Visualizações",
    description: "Gantt, timeline, calendário, workload e gráficos dos mesmos itens do quadro.",
  },
  {
    id: "bases",
    label: "Bases",
    description: "Tabelas relacionais, campos próprios e visões por contexto.",
  },
  {
    id: "processos",
    label: "Processos",
    description: "Solicitações, formulários, etapas, aprovações e SLAs.",
  },
  {
    id: "capacidade",
    label: "Capacidade",
    description: "Pessoas, disponibilidade, alocação, carga e conflitos.",
  },
  {
    id: "quadro-livre",
    label: "Quadro livre",
    description: "Post-its, votação, agrupamento e conversão em tarefas.",
  },
  // ===== Reaproveitado do Seu Funcionário, adaptado à transportadora =====
  // Pedido da titular: tudo o que o app já tem e faz sentido para uma
  // empresa de transporte elétrico entra aqui, operando no negócio To Do
  // Green — nada é recriado, nada do que existia se perde.
  {
    id: "especialistas",
    label: "Especialistas",
    description: "Um especialista de IA por área — os seis da casa e os do app, todos no contexto da transportadora.",
  },
  {
    id: "chat",
    label: "Chat corporativo",
    description: "Conversa interna da equipe: comercial, operação e diretoria no mesmo canal.",
  },
  {
    id: "reunioes",
    label: "Reuniões e atas",
    description: "Pauta, condução, ata e encaminhamentos — da reunião de rota ao comitê comercial.",
  },
  {
    id: "agenda",
    label: "Agenda do dia",
    description: "O dia planejado: compromissos, follow-ups de conta e janelas de operação.",
  },
  {
    id: "orcamentos",
    label: "Orçamentos rápidos",
    description: "Orçamento simples e compartilhável para pedidos fora do fluxo de proposta.",
  },
  {
    id: "diagnostico",
    label: "Identidade do negócio",
    description: "O ERP é exclusivo da To Do Green: segmento fixo de transportadora elétrica, sem setup genérico.",
  },
  {
    id: "marketing",
    label: "Marca e marketing",
    description: "Identidade, campanhas e conteúdo com o argumento ESG da frota elétrica.",
  },
  {
    id: "captacao",
    label: "Captação (formulários)",
    description: "Formulários públicos para captar embarcadores e pedidos de cotação.",
  },
  {
    id: "site",
    label: "Site e presença",
    description: "Página pública da To Do Green a partir de um briefing — presença digital sem agência.",
  },
  {
    id: "agentes",
    label: "Agentes de IA",
    description: "Agentes que executam rotinas inteiras, com as automações que já rodam no espaço.",
  },
  {
    id: "diagramas",
    label: "Diagramas",
    description: "Fluxos de operação, malha e processos desenhados — do briefing ao diagrama.",
  },
  {
    id: "quadro-rapido",
    label: "Quadro rápido",
    description: "Desenho livre para destravar uma rota, uma malha ou uma reunião em segundos.",
  },
  {
    id: "midia",
    label: "Estúdio de mídia",
    description: "Imagens e material visual da marca — frota, ESG e campanhas.",
  },
  {
    id: "laboratorio",
    label: "Laboratório de dados",
    description: "Explore qualquer base do espaço com gráficos e cruzamentos, sem planilha.",
  },
]);

const normalizedUrl = (value) => String(value || "").trim().replace(/[?#].*$/, "").replace(/\/$/, "");

const trustedContact = (contact = {}) => {
  if (!contact.name || contact.active === false || contact.employmentStatus === "former") return false;
  const source = String(contact.source || "").trim().toLowerCase();
  if (!source.startsWith("pesquisa web")) return true;
  return contact.verifiedBrazil === true &&
    contact.currentEmploymentVerified === true &&
    Number(contact.researchVersion || 0) >= 9 &&
    String(contact.country || "").trim().toLowerCase() === "brasil";
};

const sourcedItems = (client, report, field, kind) =>
  list(report?.[field]).map((item) => ({
    ...item,
    kind,
    clientId: client.id,
    clientName: client.name || client.company || "Conta sem nome",
    checkedAt: report.checkedAt || client.updatedAt || "",
  }));

const uniqueSources = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizedUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const buildTodoGreenWorkspaceIntelligence = ({ clients = [] } = {}) => {
  const contacts = [];
  const news = [];
  const rfqs = [];
  const supplierLinks = [];
  const decisors = [];

  list(clients).forEach((client) => {
    list(client.crm?.contacts).filter(trustedContact).forEach((contact) => {
      contacts.push({
        ...contact,
        clientId: client.id,
        clientName: client.name || client.company || "Conta sem nome",
      });
    });

    const report = Number(client.crm?.intelligence?.version || 0) >= 9
      ? client.crm.intelligence
      : null;
    if (!report) return;
    news.push(
      ...sourcedItems(client, report, "companyNews", "company"),
      ...sourcedItems(client, report, "segmentNews", "segment"),
    );
    rfqs.push(...sourcedItems(client, report, "openRfqs", "rfq"));
    supplierLinks.push(...sourcedItems(client, report, "supplierLinks", "supplier"));
    // Decisores já achados na pesquisa POR CONTA (procurementPeople): a aba
    // "LinkedIn e decisores" do hub ficava vazia porque só a busca com empresa
    // digitada os populava. Aqui reaproveitamos o que a carteira já pesquisou.
    decisors.push(
      ...list(report.procurementPeople).map((pessoa) => ({
        kind: "decisors",
        clientId: client.id,
        clientName: client.name || client.company || "Conta sem nome",
        company: client.name || client.company || "",
        title: pessoa.name || pessoa.title || "",
        url: pessoa.url || "",
        snippet: pessoa.snippet || "",
        provider: pessoa.provider || "",
        checkedAt: report.checkedAt || client.updatedAt || "",
      })),
    );
  });

  const byMostRecent = (a, b) => String(b.checkedAt || "").localeCompare(String(a.checkedAt || ""));
  return {
    contacts: contacts.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")),
    news: uniqueSources(news).sort(byMostRecent),
    rfqs: uniqueSources(rfqs).sort(byMostRecent),
    supplierLinks: uniqueSources(supplierLinks).sort(byMostRecent),
    decisors: uniqueSources(decisors).sort(byMostRecent),
  };
};

export const isTodoGreenWorkspaceRecord = (record = {}, businessId = "todogreen") =>
  record.businessId === businessId ||
  record.tenantId === businessId ||
  String(record.source || "").startsWith("todogreen");

const scoped = (items, businessId) =>
  list(items).filter((item) => isTodoGreenWorkspaceRecord(item, businessId));

export const buildTodoGreenWorkspaceSummary = ({
  db = {},
  verticalData = {},
  businessId = "todogreen",
  today = new Date().toISOString().slice(0, 10),
} = {}) => {
  const tasks = scoped(db.tasks, businessId);
  const processes = scoped(db.processes, businessId);
  const processIds = new Set(processes.map((item) => item.id));
  const cases = list(db.processCases).filter(
    (item) => isTodoGreenWorkspaceRecord(item, businessId) || processIds.has(item.processId),
  );
  const openCases = cases.filter((item) => !["done", "completed", "cancelled"].includes(item.status));
  const opportunities = list(verticalData.opportunities);
  const intelligence = buildTodoGreenWorkspaceIntelligence({ clients: verticalData.clients });
  const openOpportunities = opportunities.filter(
    (item) => !["won", "lost", "closed", "ganha", "perdida"].includes(String(item.status || "").toLowerCase()),
  );

  return {
    clients: list(verticalData.clients).length,
    contacts: intelligence.contacts.length,
    news: intelligence.news.length,
    rfqs: intelligence.rfqs.length,
    supplierLinks: intelligence.supplierLinks.length,
    openOpportunities: openOpportunities.length,
    overdueTasks: tasks.filter(
      (item) => item.due && item.due < today && !["Concluído", "done", "completed"].includes(item.status),
    ).length,
    openTasks: tasks.filter(
      (item) => !["Concluído", "done", "completed"].includes(item.status),
    ).length,
    notes: scoped(db.notes, businessId).length,
    pages: scoped(db.documents, businessId).length,
    bases: scoped(db.databases, businessId).length,
    processes: processes.length,
    openCases: openCases.length,
    workNodes: scoped(db.workNodes, businessId).length,
    resources: scoped(db.resourceProfiles, businessId).length,
    boards: scoped(db.boards, businessId).length,
  };
};

export const linkedEntityFor = (type, record = {}) => {
  if (!record.id) return null;
  const isClient = type === "client";
  const name = String(record.name || record.title || record.company || "").trim();
  return {
    type: isClient ? "client" : "opportunity",
    id: record.id,
    name: name || (isClient ? "Cliente" : "Oportunidade"),
    route: isClient
      ? `/todogreen/clientes?client=${encodeURIComponent(record.id)}`
      : `/todogreen/oportunidades?opportunity=${encodeURIComponent(record.id)}`,
  };
};

export const findLinkedNote = (notes, entity) =>
  list(notes).find((note) =>
    list(note.linkedEntities).some(
      (linked) => linked.type === entity?.type && linked.id === entity?.id,
    ),
  ) || null;

export const findLinkedDocument = (documents, entity) =>
  list(documents).find((document) =>
    list(document.linkedEntities).some(
      (linked) => linked.type === entity?.type && linked.id === entity?.id,
    ),
  ) || null;
