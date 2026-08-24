export const ERP_HOME_WIDGETS = Object.freeze([
  { id: "metrics", label: "Indicadores da minha área" },
  { id: "queue", label: "Minha fila e pendências" },
  { id: "responsibilities", label: "Minhas responsabilidades" },
  { id: "shortcuts", label: "Atalhos de trabalho" },
]);

export const ERP_SHORTCUTS = Object.freeze([
  { id: "clients", label: "Clientes", route: "/todogreen/clientes", area: "commercial" },
  { id: "opportunities", label: "Oportunidades", route: "/todogreen/oportunidades", area: "commercial" },
  { id: "pricing", label: "Simular preço", route: "/todogreen/precificacao", area: "commercial" },
  { id: "proposals", label: "Propostas e contratos", route: "/todogreen/propostas", area: "commercial" },
  { id: "deal-desk", label: "Aprovações", route: "/todogreen/deal-desk", area: "commercial" },
  { id: "products", label: "Produtos logísticos", route: "/todogreen/produtos", area: "products" },
  { id: "parameters", label: "Parâmetros do simulador", route: "/todogreen/parametros-simulador", area: "products" },
  { id: "planning", label: "Planejamento", route: "/todogreen/planejamento", area: "planning" },
  { id: "service-orders", label: "Ordens de serviço", route: "/todogreen/ordens-servico", area: "planning" },
  { id: "ciot", label: "CIOT", route: "/todogreen/ciot", area: "planning" },
  { id: "operations", label: "Operações", route: "/todogreen/operacoes", area: "operations" },
  { id: "tracking", label: "Rastreamento", route: "/todogreen/rastreamento", area: "operations" },
  { id: "stock", label: "Estoque", route: "/todogreen/estoque", area: "operations" },
  { id: "billing", label: "Faturamento", route: "/todogreen/faturamento", area: "finance" },
  { id: "receivables", label: "Contas a receber", route: "/todogreen/receita", area: "finance" },
  { id: "costs", label: "Custos e margem", route: "/todogreen/custos", area: "finance" },
  { id: "people", label: "DP/RH", route: "/todogreen/rh", area: "hr" },
  { id: "goals", label: "Metas", route: "/todogreen/metas", area: "hr" },
  { id: "marketing", label: "Marketing", route: "/todogreen/marketing", area: "marketing" },
  { id: "esg", label: "Central ESG", route: "/todogreen/central-esg", area: "esg" },
  { id: "documents", label: "Documentos e evidências", route: "/todogreen/documentos", area: "esg" },
  { id: "workspace", label: "Espaço de trabalho", route: "/todogreen/espaco", area: "management" },
  { id: "projects", label: "Projetos", route: "/todogreen/central-trabalho", area: "management" },
  { id: "reports", label: "Relatórios", route: "/todogreen/relatorios", area: "management" },
]);

export const ERP_HOME_AREAS = Object.freeze([
  {
    id: "commercial", label: "Comercial", functionLabel: "Novos Negócios e Comercial",
    metrics: ["pipeline", "forecast", "opportunities", "margin"],
    shortcuts: ["clients", "opportunities", "pricing", "proposals", "deal-desk"],
    responsibilities: [
      "Avançar oportunidades com próxima ação e responsável definidos.",
      "Transformar escopo validado em simulação, proposta e contrato rastreáveis.",
      "Proteger margem e levar exceções para aprovação antes do envio ao cliente.",
    ],
    routeTerms: ["clientes", "oportunidades", "precificacao", "propostas", "deal-desk"],
  },
  {
    id: "products", label: "Produtos e Precificação", functionLabel: "Produtos e Precificação",
    metrics: ["scenarios", "margin", "approvals", "products"],
    shortcuts: ["products", "parameters", "pricing", "planning", "deal-desk"],
    responsibilities: [
      "Governar produtos, escopo, SLA e unidade de cobrança.",
      "Manter custos e parâmetros versionados por modelo operacional.",
      "Validar viabilidade e premissas antes do aceite da operação.",
    ],
    routeTerms: ["produtos", "parametros", "precificacao", "planejamento", "deal-desk"],
  },
  {
    id: "planning", label: "Planejamento", functionLabel: "Planejamento e Aceite",
    metrics: ["trips", "operations", "occupancy", "approvals"],
    shortcuts: ["planning", "service-orders", "ciot", "operations", "tracking"],
    responsibilities: [
      "Validar capacidade, janela, rota, produto e condição comercial.",
      "Liberar somente ordens com dados e documentos suficientes.",
      "Preparar CIOT e handoff para Operações sem perder rastreabilidade.",
    ],
    routeTerms: ["planejamento", "ordens-servico", "ciot", "operacoes"],
  },
  {
    id: "operations", label: "Operações", functionLabel: "Execução Operacional",
    metrics: ["operations", "trips", "occupancy", "deliveries"],
    shortcuts: ["operations", "tracking", "service-orders", "stock", "ciot"],
    responsibilities: [
      "Executar a operação conforme OS, SLA e janela contratada.",
      "Registrar ocorrências, evidências e marcos da viagem no mesmo fluxo.",
      "Controlar frota, capacidade, estoque e rastreamento da execução.",
    ],
    routeTerms: ["operacoes", "rastreamento", "estoque", "ordens-servico"],
  },
  {
    id: "finance", label: "Financeiro", functionLabel: "Financeiro e Faturamento",
    metrics: ["revenue", "cost", "margin", "billing"],
    shortcuts: ["billing", "receivables", "costs", "ciot", "reports"],
    responsibilities: [
      "Conferir operação elegível antes de faturar.",
      "Controlar títulos, recebimentos, custos e competência.",
      "Conectar resultado financeiro a cliente, contrato e operação.",
    ],
    routeTerms: ["faturamento", "receita", "custos", "titulos", "rateios"],
  },
  {
    id: "hr", label: "DP/RH", functionLabel: "Pessoas e Escalas",
    metrics: ["tasks", "operations", "trips", "goals"],
    shortcuts: ["people", "goals", "planning", "operations", "projects"],
    responsibilities: [
      "Manter motoristas, documentos, disponibilidade e escalas atualizados.",
      "Acompanhar metas, treinamento e capacidade humana da operação.",
      "Proteger dados pessoais e respeitar a segregação de acesso.",
    ],
    routeTerms: ["rh", "metas", "planejamento", "operacoes"],
  },
  {
    id: "marketing", label: "Marketing", functionLabel: "Marketing e Marca",
    metrics: ["clients", "opportunities", "impact", "tasks"],
    shortcuts: ["marketing", "clients", "documents", "reports", "projects"],
    responsibilities: [
      "Transformar provas operacionais e ESG em materiais verificáveis.",
      "Apoiar campanhas por segmento, produto e estágio da conta.",
      "Manter mensagens, evidências e entregáveis conectados ao Comercial.",
    ],
    routeTerms: ["marketing", "clientes", "documentos", "relatorios"],
  },
  {
    id: "esg", label: "ESG", functionLabel: "Sustentabilidade e Evidências",
    metrics: ["impact", "greenScore", "distance", "operations"],
    shortcuts: ["esg", "documents", "reports", "operations", "products"],
    responsibilities: [
      "Manter fatores, metodologia e evidências ambientais auditáveis.",
      "Validar indicadores antes de uso comercial ou reporte ao cliente.",
      "Conectar impacto ambiental à operação e ao contrato que o gerou.",
    ],
    routeTerms: ["central-esg", "documentos", "relatorios", "operacoes"],
  },
  {
    id: "management", label: "Gestão", functionLabel: "Gestão do ERP",
    metrics: ["revenue", "margin", "operations", "tasks"],
    shortcuts: ["workspace", "projects", "reports", "goals", "deal-desk"],
    responsibilities: [
      "Priorizar decisões e remover bloqueios entre áreas.",
      "Acompanhar resultado, capacidade, risco e execução do plano.",
      "Garantir responsáveis, prazos e rastreabilidade das decisões.",
    ],
    routeTerms: [],
  },
]);

const ROLE_AREA = Object.freeze({
  owner: "commercial", admin: "commercial", lideranca_comercial: "commercial", vendedor: "commercial",
  pricing: "products", produtos: "products", planejamento: "planning", financeiro: "finance",
  operacoes: "operations", marketing: "marketing", sustentabilidade: "esg", rh: "hr", auditor: "management",
});

const uniqueKnown = (values, known) => [...new Set(Array.isArray(values) ? values : [])].filter((id) => known.has(id));

export const homeArea = (id) => ERP_HOME_AREAS.find((item) => item.id === id) || ERP_HOME_AREAS[0];

export const normalizeHomePreferences = (role, saved = {}) => {
  const area = homeArea(saved.areaId || ROLE_AREA[role] || "commercial");
  const widgetIds = uniqueKnown(saved.widgetIds, new Set(ERP_HOME_WIDGETS.map((item) => item.id)));
  const shortcutIds = uniqueKnown(saved.shortcutIds, new Set(ERP_SHORTCUTS.map((item) => item.id)));
  return {
    areaId: area.id,
    functionLabel: String(saved.functionLabel || area.functionLabel).trim().slice(0, 80),
    widgetIds: widgetIds.length ? widgetIds : ERP_HOME_WIDGETS.map((item) => item.id),
    shortcutIds: shortcutIds.length ? shortcutIds : area.shortcuts,
  };
};

export const tasksForCollaborator = (tasks = [], user = {}) => {
  const id = String(user.id || "");
  const name = String(user.name || "").trim().toLowerCase();
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => !/(conclu|feito|done|finaliz|cancel)/i.test(String(task.status || "")))
    .filter((task) => {
      const ids = [task.assigneeId, task.ownerId, ...(task.assignees || []).map((item) => item.userId)].filter(Boolean).map(String);
      const names = [task.assignee, task.responsible, ...(task.assignees || []).map((item) => item.name)].filter(Boolean).map((value) => String(value).trim().toLowerCase());
      return (id && ids.includes(id)) || (name && names.includes(name));
    })
    .sort((a, b) => String(a.due || a.dueDate || "9999").localeCompare(String(b.due || b.dueDate || "9999")));
};

export const alertsForArea = (alerts = [], areaId) => {
  const area = homeArea(areaId);
  if (!area.routeTerms.length) return alerts;
  return alerts.filter((alert) => area.routeTerms.some((term) => String(alert.route || "").includes(term)));
};
