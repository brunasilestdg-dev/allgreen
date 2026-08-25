const list = (value) => (Array.isArray(value) ? value : []);

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
  });

  const byMostRecent = (a, b) => String(b.checkedAt || "").localeCompare(String(a.checkedAt || ""));
  return {
    contacts: contacts.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")),
    news: uniqueSources(news).sort(byMostRecent),
    rfqs: uniqueSources(rfqs).sort(byMostRecent),
    supplierLinks: uniqueSources(supplierLinks).sort(byMostRecent),
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
