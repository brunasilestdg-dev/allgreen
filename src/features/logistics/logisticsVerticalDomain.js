import { ALCADAS } from "./dealDeskDomain.js";

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value) => String(value || "").trim();

export const roundMoney = (value, decimals = 2) => {
  const scale = 10 ** decimals;
  return Math.round((n(value) + Number.EPSILON) * scale) / scale;
};

export const TODO_GREEN_TENANT = {
  id: "todogreen",
  slug: "todogreen",
  name: "To Do Green",
  segment: "logistica-sustentavel",
  route: "/todogreen",
  status: "active",
  theme: {
    primary: "#17624f",
    primary2: "#34b78f",
    surface: "#f5f8f4",
    ink: "#10241f",
    graphite: "#23342f",
  },
};

export const TODO_GREEN_ROLES = [
  "owner",
  "admin",
  "lideranca_comercial",
  "vendedor",
  "pricing",
  "produtos",
  "planejamento",
  "financeiro",
  "operacoes",
  "marketing",
  "sustentabilidade",
  "auditor",
  // Papel próprio para folha e cadastro de pessoal. Não cabe em `financeiro`:
  // salário, CPF e dependentes são dado sensível (LGPD), e quem lança uma
  // despesa não precisa ver a remuneração de ninguém.
  "rh",
];

// crm:manage, proposal:manage, operations:manage e finance:manage são exigidas
// por worker/services/todogreen-vertical-records.js para GRAVAR oportunidade,
// proposta, contrato, operação e lançamento financeiro — e não apareciam em
// nenhum papel além de owner/admin. Um vendedor não conseguia criar a própria
// oportunidade; financeiro não conseguia lançar; operações batia em
// "operation:manage" (singular) contra "operations:manage" (plural) exigido
// pela coleção. Confirmado com o formulário real: a tela deixava preencher e
// enviar, o servidor recusava com 403 em silêncio — sem esse mapeamento
// batendo com o que a persistência exige, a vertical parece funcionar para
// quem testa como owner e não funciona para ninguém mais.
export const TODO_GREEN_PERMISSIONS = {
  owner: ["*"],
  admin: ["*"],
  lideranca_comercial: ["read", "crm:manage", "proposal:create", "proposal:manage", "deal:approve", "pricing:simulate", "goal:read", "goal:create", "goal:update", "goal:checkin", "goal:approve", "goal:close", "goal:manage-team", "goal:export", "planner:manage"],
  vendedor: ["read", "crm:manage", "proposal:create", "proposal:manage", "pricing:simulate", "goal:read", "goal:checkin", "planner:manage"],
  pricing: ["read", "pricing:simulate", "pricing:manage", "deal:review", "goal:read", "goal:checkin", "planner:manage"],
  produtos: ["read", "product:manage", "pricing:simulate", "pricing:manage", "deal:review", "goal:read", "goal:checkin", "goal:validate", "planner:manage"],
  planejamento: ["read", "planning:manage", "product:manage", "ciot:manage", "deal:review", "goal:read", "goal:checkin", "goal:validate", "planner:manage"],
  financeiro: ["read", "cost:manage", "revenue:manage", "commission:manage", "finance:manage", "purchase:manage", "fiscal:manage", "ciot:manage", "deal:review", "goal:read", "goal:checkin", "goal:validate", "planner:manage"],
  operacoes: ["read", "operation:manage", "operations:manage", "stock:manage", "purchase:manage", "production:manage", "tms:manage", "ciot:manage", "deal:review", "evidence:manage", "goal:read", "goal:checkin", "goal:validate", "planner:manage"],
  marketing: ["read", "marketing:manage", "evidence:manage", "goal:read", "goal:checkin", "planner:manage"],
  sustentabilidade: ["read", "esg:manage", "deal:review", "audit:read", "evidence:manage", "goal:read", "goal:checkin", "goal:validate", "planner:manage"],
  auditor: ["read", "audit:read", "export:read", "goal:read", "goal:export"],
  // RH lê a vertical e administra pessoal — e nada além disso. Em particular,
  // não recebe `finance:manage`: fechar a folha não é o mesmo que lançar no
  // caixa, e juntar os dois num papel só tiraria a segregação que a auditoria
  // de folha depende.
  rh: ["read", "hr:manage", "goal:read", "goal:checkin", "planner:manage"],
};

// A regra de permissão da vertical, uma só, usada pelo front e pelo worker.
//
// As duas pontas partem de lugares diferentes: o front só conhece o papel (não
// guarda permissão por usuário), enquanto o worker lê a lista explícita gravada
// no vínculo. A diferença é `permissions == null` (front, deriva do papel) vs
// uma lista (worker, ela é a autoridade — mesmo vazia). Ter duas cópias disso
// era o caminho garantido para o front liberar um botão que o worker recusa.
export const verticalPermite = (role, permissions, permissao = "read") => {
  const requested = Array.isArray(permissao) ? permissao : [permissao];
  const grants = permissions == null ? TODO_GREEN_PERMISSIONS[role] || [] : permissions;
  if (grants.includes("*")) return true;
  // owner e admin passam sempre: o papel manda, mesmo que a lista venha vazia.
  if (["owner", "admin"].includes(role)) return true;
  return requested.every((item) => grants.includes(item));
};

// Fachada do front: só tem o papel na mão.
export const hasTodoGreenPermission = (role, permission = "read") =>
  verticalPermite(role, null, permission);

export const TODO_GREEN_PRODUCTION_DATA_POLICY = Object.freeze({
  demoModeFlag: "todoGreenDemoMode",
  source: "real-data-first",
  rule: "Dados seed só podem aparecer quando o modo demonstração estiver explicitamente ativo.",
  blockedInProduction: [
    "Cliente enterprise genérico sem identificação",
    "Receita fictícia não rotulada",
    "Operação de exemplo usada como indicador real",
  ],
});

export const TODO_GREEN_MODULE_AREAS = [
  {
    id: "principal",
    name: "Principal",
    description: "Resumo executivo, pendências e atalhos do ERP.",
  },
  {
    id: "cadastros",
    name: "Cadastros",
    description: "Clientes, motoristas, veículos, tabelas, rotas, parceiros, materiais, depósitos e centros de custo.",
  },
  {
    id: "comercial",
    name: "Comercial",
    description: "Clientes, oportunidades, propostas, preços, aprovações comerciais e comparação de mercado.",
  },
  {
    id: "operacao",
    name: "Operação",
    description: "Fretes, OS, aceite, execução, rota, tracking, CIOT, entregas, frota, energia e produtividade.",
  },
  {
    id: "implantacao",
    name: "Implantação",
    description: "Go-live de cliente com contrato, SLA, operação, faturamento, portal, integrações e responsáveis.",
  },
  {
    id: "produtividade",
    name: "Produtividade",
    description: "Planner, planos com baldes e tarefas, privados ou compartilhados, com prazo, prioridade e progresso.",
  },
  {
    id: "ocorrencias",
    name: "Ocorrências",
    description: "Falhas, atrasos, insucessos, desvios, evidências, tratamento e prevenção.",
  },
  {
    id: "documentos",
    name: "Documentos",
    description: "Contratos, comprovantes, laudos, evidências, anexos, versões e links temporários.",
  },
  {
    id: "financeiro",
    name: "Financeiro",
    description: "CT-e, documentos fiscais, faturamento, títulos, recebíveis, baixas, custos e conciliação.",
  },
  {
    id: "dp",
    name: "DP",
    description: "Documentação, vínculos, vencimentos, dados sensíveis e rotinas trabalhistas.",
  },
  {
    id: "rh",
    name: "RH",
    description: "Pessoas, disponibilidade, escalas, treinamento, capacidade e alocação.",
  },
  {
    id: "qualidade",
    name: "Qualidade",
    description: "SLA, BSC, não conformidades, planos de ação e melhoria contínua.",
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Campanhas, materiais comerciais, marca, relacionamento e evidências para comunicação.",
  },
  {
    id: "comunicacao-interna",
    name: "Comunicação Interna",
    description: "Comunicados, conhecimento, decisões e alinhamentos entre áreas.",
  },
  {
    id: "esg",
    name: "ESG",
    description: "Impacto ambiental, Green Score, emissões da cadeia logística, relatórios e metodologia.",
  },
  {
    id: "juridico",
    name: "Jurídico",
    description: "Contratos, minutas, aprovações, riscos, aditivos e formalizações.",
  },
  {
    id: "suprimentos",
    name: "Suprimentos",
    description: "Compras, requisições, fornecedores, recebimentos e estoque.",
  },
  {
    id: "produtos",
    name: "Produtos",
    description: "Catálogo de produtos logísticos, regras de precificação, SLA, restrições e insumos para aceite.",
  },
  {
    id: "indicadores",
    name: "Indicadores",
    description: "KPIs comerciais, operacionais, financeiros, ESG, qualidade e implantação.",
  },
  {
    id: "administracao",
    name: "Administração",
    description: "Acessos, permissões, integrações, auditoria, configurações e governança.",
  },
];

const module = (id, name, area, route, config = {}) => ({
  id,
  name,
  area,
  route: `/todogreen/${id}`,
  workspaceRoute: route,
  status: "active",
  version: "1.0.0",
  order: config.order || 100,
  category: config.category || area,
  icon: config.icon || "Boxes",
  description: config.description || "",
  beta: !!config.beta,
  dependencies: config.dependencies || [],
  permissions: config.permissions || ["read"],
  availability: config.availability || "tenant",
  exclusiveTenant: config.exclusiveTenant || "todogreen",
  settings: config.settings || {},
});

export const TODO_GREEN_MODULE_CATALOG = [
  module("dashboard", "Principal", "principal", "/todogreen/dashboard", {
    icon: "Gauge",
    order: 0,
    description: "Resumo executivo, minha fila, indicadores e atalhos do ERP.",
  }),
  module("dashboard-esg", "Dashboard ESG", "esg", "/todogreen/esg", {
    icon: "Leaf",
    order: 1,
    description: "Indicadores mensais e anuais de impacto por cliente, contrato e operação.",
    permissions: ["read", "esg:manage"],
  }),
  module("green-score", "Green Score", "esg", "/todogreen/green-score", {
    icon: "Gauge",
    order: 2,
    description: "Nota proprietária de 0 a 100 com pesos versionados.",
  }),
  module("calculadora-ambiental", "Calculadora Ambiental", "esg", "/todogreen/calculadora-ambiental", {
    icon: "Calculator",
    order: 3,
    description: "Simule CO2 evitado, diesel não consumido e equivalências ambientais.",
  }),
  module("tradutor-esg", "Tradutor ESG", "esg", "/todogreen/tradutor-esg", {
    icon: "Languages",
    order: 4,
    description: "Converte números ambientais em textos auditáveis para propostas e relatórios.",
  }),
  module("escopo-3", "Emissões da cadeia logística", "esg", "/todogreen/escopo-3", {
    icon: "Network",
    order: 5,
    description: "Memória de cálculo para apoiar inventários e governança da cadeia logística.",
  }),
  module("relatorios-esg", "Relatórios ESG", "esg", "/todogreen/relatorios", {
    icon: "FileText",
    order: 6,
    description: "Relatórios executivos, auditoria, memória de cálculo e exportações.",
  }),
  module("metodologia", "Metodologia", "esg", "/todogreen/metodologia", {
    icon: "BookOpen",
    order: 7,
    description: "Fatores, fontes, premissas e versões de metodologia ambiental.",
  }),
  module("cofre-evidencias", "Cofre de Evidências", "esg", "/todogreen/documentos", {
    icon: "Archive",
    order: 8,
    description: "Documentos, fatores, comprovantes, aprovações e histórico de evidências.",
  }),
  module("certificados", "Certificados e declarações", "esg", "/todogreen/relatorios", {
    icon: "Award",
    order: 9,
    description: "Declarações comerciais e materiais de apoio, sem tratar estimativa como certificação oficial.",
  }),
  module("clientes", "Clientes", "comercial", "/todogreen/clientes", { icon: "Users", order: 10 }),
  module("dashboards", "Criar painéis", "indicadores", "/todogreen/dashboards", {
    icon: "BarChart3",
    order: 9,
    description: "Crie visões pessoais ou da equipe com os indicadores mais importantes.",
  }),
  module("contatos", "Contatos", "comercial", "/todogreen/clientes", { icon: "Handshake", order: 11 }),
  module("oportunidades", "Oportunidades", "comercial", "/todogreen/oportunidades", { icon: "TrendingUp", order: 12 }),
  module("pipeline", "Pipeline", "comercial", "/todogreen/oportunidades", { icon: "GitBranch", order: 13 }),
  module("propostas", "Propostas", "comercial", "/todogreen/propostas", { icon: "FileText", order: 14 }),
  module("contratos", "Contratos", "comercial", "/todogreen/propostas", { icon: "FileCheck", order: 15 }),
  module("simulacoes", "Simulações", "comercial", "/todogreen/precificacao", { icon: "SlidersHorizontal", order: 16 }),
  module("precificacao", "Precificação", "comercial", "/todogreen/precificacao", {
    icon: "Calculator",
    order: 17,
    permissions: ["read", "pricing:simulate", "pricing:manage"],
  }),
  module("deal-desk", "Aprovação comercial", "comercial", "/todogreen/deal-desk", {
    icon: "ShieldCheck",
    order: 18,
    permissions: ["read", "deal:approve", "deal:review"],
  }),
  module("metas", "Metas", "comercial", "/todogreen/metas", {
    icon: "Target",
    order: 19,
    description: "Metas por empresa, área, equipe, pessoa, cliente, contrato, produto ou operação, com medição, check-ins, planos de ação e histórico.",
    permissions: ["goal:read", "goal:create", "goal:checkin", "goal:manage-team"],
  }),
  module("performance-comercial", "Performance comercial", "comercial", "/todogreen/performance-comercial", {
    icon: "Activity",
    order: 20,
    description: "Execução da carteira, cobertura de relacionamento, atualização, próximas ações e metas; sem dados de oportunidades.",
    permissions: ["read", "goal:read"],
  }),
  module("playbook-comercial", "Playbook comercial", "comercial", "/todogreen/playbook-comercial", {
    icon: "BookOpen",
    order: 20.5,
    description: "Jornada de venda, critérios de avanço, aprovação comercial e atalhos para execução.",
    permissions: ["read", "crm:manage", "proposal:create", "pricing:simulate"],
  }),
  module("remuneracao", "Remuneração Variável", "comercial", "/todogreen/comissoes", {
    icon: "WalletCards",
    order: 21,
    permissions: ["read", "commission:manage"],
  }),
  module("benchmark", "Benchmark", "comercial", "/todogreen/precificacao", { icon: "BarChart3", order: 21 }),
  module("cadastros", "Cadastros logísticos", "cadastros", "/todogreen/cadastros", {
    icon: "Boxes",
    order: 21.5,
    description: "Clientes, motoristas, veículos, tabelas, rotas e cadastros mestres do ERP.",
  }),
  module("produtos", "Produtos", "produtos", "/todogreen/produtos", {
    icon: "Boxes",
    order: 22,
    description: "Visão de produto para first, middle e last mile: escopo, SLA, unidade de cobrança, premissas e margem alvo.",
    permissions: ["read", "product:manage"],
  }),
  module("produtos-logisticos", "Produtos logísticos", "produtos", "/todogreen/produtos", {
    icon: "Boxes",
    order: 23,
    description: "Catálogo operacional e comercial dos serviços contratados.",
    permissions: ["read", "product:manage"],
  }),
  module("catalogo-produtos", "Catálogo de produtos", "produtos", "/todogreen/produtos", {
    icon: "PackageCheck",
    order: 24,
    description: "Regras, restrições, premissas, indicadores e evidências de cada produto logístico.",
    permissions: ["read", "product:manage"],
  }),
  module("implantacao", "Implantação de cliente", "implantacao", "/todogreen/implantacao", {
    icon: "CheckCircle2",
    order: 24.5,
    description: "Go-live com contrato, operação, financeiro, portal, tracking, ESG e governança.",
  }),
  module("planejamento", "Planejamento operacional", "operacao", "/todogreen/planejamento", {
    icon: "Route",
    order: 25,
    description: "Decisão de aceite da viagem ou OS com capacidade, produto, SLA, risco, margem e janela operacional.",
    permissions: ["read", "planning:manage", "product:manage"],
  }),
  module("aceite-viagens", "Aceite de viagens", "operacao", "/todogreen/ordens-servico", {
    icon: "CheckCircle2",
    order: 26,
    description: "Planejamento/Produtos libera a OS antes da execução, sem depender de Financeiro.",
    permissions: ["read", "planning:manage", "product:manage"],
  }),
  module("ciot", "CIOT", "operacao", "/todogreen/ciot", {
    icon: "FileCheck",
    order: 27,
    description: "Preparação, validação de piso mínimo, payload regulatório, contingência e registro do código CIOT emitido.",
    permissions: ["read", "ciot:manage", "planning:manage", "fiscal:manage"],
  }),
  module("solicitacoes", "Solicitações de clientes", "implantacao", "/todogreen/solicitacoes", {
    icon: "Inbox",
    order: 28,
    description: "Fila do que os clientes pediram pelo portal, ordenada por prazo, com responsável, conversa e histórico.",
  }),
  module("compras", "Compras", "suprimentos", "/todogreen/compras", {
    icon: "ListChecks",
    order: 28.5,
    description: "Requisições, aprovações, pedidos e recebimentos.",
  }),
  module("estoque", "Estoque", "suprimentos", "/todogreen/estoque", {
    icon: "Boxes",
    order: 28.7,
    description: "Saldos, entradas, saídas, transferências e contagens.",
  }),
  module("receita", "Receita", "financeiro", "/todogreen/receita", { icon: "DollarSign", order: 30 }),
  module("forecast", "Forecast", "financeiro", "/todogreen/receita", { icon: "TrendingUp", order: 31 }),
  module("faturamento", "Faturamento e CT-e", "financeiro", "/todogreen/faturamento", { icon: "ReceiptText", order: 32 }),
  module("recebimento", "Recebimento", "financeiro", "/todogreen/titulos", { icon: "CheckCircle2", order: 33 }),
  module("custos", "Custos", "financeiro", "/todogreen/custos", {
    icon: "Sigma",
    order: 34,
    permissions: ["read", "cost:manage"],
  }),
  module("opex", "Despesas da operação", "financeiro", "/todogreen/custos", { icon: "WalletCards", order: 35 }),
  module("margem", "Margem", "financeiro", "/todogreen/custos", { icon: "Gauge", order: 36 }),
  module("rentabilidade", "Rentabilidade", "financeiro", "/todogreen/custos", { icon: "Activity", order: 37 }),
  module("orcamento", "Orçamento", "financeiro", "/todogreen/custos", { icon: "ListChecks", order: 38 }),
  module("centros-custo", "Centros de custo", "financeiro", "/todogreen/rateios", { icon: "Network", order: 39 }),
  module("fiscal", "Fiscal", "financeiro", "/todogreen/fiscal", {
    icon: "ReceiptText",
    order: 39.5,
    description: "CT-e, MDF-e e NFS-e da transportadora: impostos, XML e DACTE, com transmissão à SEFAZ pendente de certificado.",
    permissions: ["read", "fiscal:manage"],
  }),
  module("cte", "CT-e", "financeiro", "/todogreen/fiscal", { icon: "ReceiptText", order: 39.6 }),
  module("mdfe", "MDF-e", "financeiro", "/todogreen/fiscal", { icon: "FileCheck", order: 39.7 }),
  module("nfse", "NFS-e", "financeiro", "/todogreen/fiscal", { icon: "FileText", order: 39.8 }),
  module("operacoes", "Fretes", "operacao", "/todogreen/operacoes", { icon: "Workflow", order: 40 }),
  module("rotas", "Rotas", "operacao", "/todogreen/operacoes", { icon: "Route", order: 42 }),
  module("viagens", "Viagens", "operacao", "/todogreen/operacoes", { icon: "Navigation", order: 43 }),
  module("veiculos", "Veículos e frota", "operacao", "/todogreen/motorista-frota", {
    icon: "Truck",
    order: 44,
    description: "Cadastro operacional de veículos, telemetria, autonomia, custo, disponibilidade e manutenção.",
    permissions: ["read", "fleet:manage", "operations:manage"],
  }),
  module("rastreamento", "TMS Tracker", "operacao", "/todogreen/rastreamento", {
    icon: "Route",
    order: 44.5,
    description: "Receba posições e eventos da frota conectada ao Tracker.",
    permissions: ["read", "fleet:manage", "integration:manage"],
  }),
  module("motoristas", "Motoristas", "operacao", "/todogreen/motorista-frota", {
    icon: "UserRound",
    order: 45,
    description: "Motoristas vinculados às operações, rotas ativas, jornada, produtividade e ocorrências.",
    permissions: ["read", "operations:manage", "fleet:manage"],
  }),
  module("entregas", "Entregas", "operacao", "/todogreen/operacoes", { icon: "PackageCheck", order: 46 }),
  module("pacotes", "Pacotes", "operacao", "/todogreen/operacoes", { icon: "Boxes", order: 47 }),
  module("ocupacao", "Ocupação", "indicadores", "/todogreen/indicadores", { icon: "Gauge", order: 48 }),
  module("produtividade", "Produtividade", "indicadores", "/todogreen/indicadores", { icon: "Activity", order: 49 }),
  module("energia", "Energia", "esg", "/todogreen/esg", { icon: "Zap", order: 50 }),
  module("ocorrencias", "Ocorrências", "ocorrencias", "/todogreen/ocorrencias", { icon: "AlertTriangle", order: 51 }),
  module("dp-rh", "Departamento Pessoal", "dp", "/todogreen/dp", {
    icon: "Users",
    order: 52,
    description: "Administração de pessoal, documentos, dados sensíveis, alocação e rotinas trabalhistas.",
    permissions: ["read", "hr:manage"],
  }),
  module("escalas", "Escalas", "rh", "/todogreen/rh", {
    icon: "ListChecks",
    order: 53,
    description: "Escalas, disponibilidade e alocação de motoristas e equipes por operação.",
    permissions: ["read", "hr:manage", "operations:manage"],
  }),
  module("marketing", "Marketing", "marketing", "/todogreen/marketing", {
    icon: "TrendingUp",
    order: 54,
    description: "Campanhas, narrativa comercial, materiais, relacionamento e comunicação da marca.",
    permissions: ["read", "marketing:manage"],
  }),
  module("campanhas", "Campanhas", "marketing", "/todogreen/marketing", {
    icon: "Target",
    order: 55,
    description: "Planejamento de campanhas por segmento, produto, cliente e objetivo de crescimento.",
    permissions: ["read", "marketing:manage"],
  }),
  module("tarefas", "Projetos e tarefas", "implantacao", "/todogreen/central-trabalho", {
    icon: "ListTodo",
    order: 60,
    description: "Boards, responsáveis, prazos, automações, Kanban, Gantt, workload e entregas entre áreas.",
  }),
  module("planner", "Planner", "produtividade", "/todogreen/planner", {
    icon: "LayoutGrid",
    order: 60.2,
    description: "Planos com baldes e tarefas no estilo Microsoft Planner — privados ou compartilhados, com responsável, prazo, prioridade, progresso e checklist.",
    permissions: ["read", "planner:manage"],
  }),
  module("espaco", "Comunicação interna", "comunicacao-interna", "/todogreen/espaco", {
    icon: "BriefcaseBusiness",
    order: 60.5,
    description: "Comunicados, decisões, bases de conhecimento e alinhamentos internos.",
  }),
  module("documentos", "Documentos", "documentos", "/todogreen/documentos", { icon: "FileText", order: 61 }),
  module("aprovacoes", "Aprovações", "comercial", "/todogreen/deal-desk", { icon: "ShieldCheck", order: 62 }),
  module("notificacoes", "Notificações", "comunicacao-interna", "/todogreen/espaco", { icon: "Bell", order: 63 }),
  module("inbox", "Inbox", "comunicacao-interna", "/todogreen/espaco", { icon: "Inbox", order: 64 }),
  module("relatorios", "Relatórios", "indicadores", "/todogreen/relatorios", { icon: "FileText", order: 65 }),
  module("indicadores", "Indicadores", "indicadores", "/todogreen/indicadores", { icon: "Gauge", order: 65.5 }),
  module("juridico", "Jurídico", "juridico", "/todogreen/juridico", { icon: "FileCheck", order: 65.7 }),
  module("qualidade", "Qualidade", "qualidade", "/todogreen/qualidade", { icon: "CheckCircle2", order: 65.8 }),
  module("auditoria", "Auditoria", "administracao", "/todogreen/auditoria", {
    icon: "History",
    order: 66,
    permissions: ["read", "audit:read"],
  }),
  module("usuarios", "Usuários", "administracao", "/todogreen/acessos", { icon: "Users", order: 67 }),
  module("permissoes", "Permissões", "administracao", "/todogreen/acessos", { icon: "LockKeyhole", order: 68 }),
  module("configuracoes", "Configurações", "administracao", "/todogreen/acessos", { icon: "Settings", order: 69 }),
];

export const TODO_GREEN_FEATURE_COUNT = TODO_GREEN_MODULE_CATALOG.length;

const product = (id, name, code, modality, billingUnit, fields, config = {}) => ({
  id,
  name,
  code,
  description: config.description || "",
  modality,
  billingUnit,
  costStructure: config.costStructure || ["vehicle", "team", "energy", "tax", "opex"],
  requiredFields: fields.required || [],
  optionalFields: fields.optional || [],
  pricingRules: config.pricingRules || {},
  distanceBands: config.distanceBands || [],
  weightBands: config.weightBands || [],
  marginRules: config.marginRules || {},
  approvalRules: config.approvalRules || {
    minimumMarginPercent: 18,
    maximumDiscountPercent: 8,
    dataQualityMinimum: 60,
  },
  operationalIndicators: config.operationalIndicators || [],
  environmentalIndicators: ["co2AvoidedKg", "dieselAvoidedL", "reductionPercent", "greenScore"],
  proposalTemplate: config.proposalTemplate || "logistics-standard-v1",
  contractTemplate: config.contractTemplate || "logistics-contract-v1",
  status: "active",
  version: config.version || "1.0.0",
});

export const LOGISTICS_PRODUCTS = [
  product("middle-mile", "Middle Mile", "MM", "line-haul", "viagem", {
    required: ["client", "origin", "destination", "distanceKm", "tripsPerMonth", "vehicleType"],
    optional: ["returnLoaded", "weeklyFrequency", "pallets", "weightKg", "waitingHours", "tollCost", "sla", "customerTargetPrice"],
  }),
  product("middle-mile-spot", "Middle Mile Spot", "MMS", "line-haul-spot", "viagem", {
    required: ["client", "origin", "destination", "distanceKm", "vehicleType"],
    optional: ["returnLoaded", "pallets", "weightKg", "waitingHours", "tollCost", "customerTargetPrice"],
  }),
  product("last-mile", "Last Mile", "LM", "last-mile", "pacote", {
    required: ["client", "city", "packages", "routesPerDay", "daysPerMonth", "kmPerRoute", "vehicleType"],
    optional: ["stops", "successRate", "returnsRate", "weightKg", "density", "sla", "customerTargetPrice"],
  }),
  product("dedicated", "Operação dedicada", "DED", "dedicated", "mensalidade", {
    required: ["client", "vehicles", "vehicleType", "drivers", "hoursPerDay", "daysPerMonth"],
    optional: ["helpers", "reserveVehicle", "supervisionCost", "technologyCost", "trainingCost", "implementationCost", "customerTargetPrice"],
  }),
  product("transfer", "Transferência entre CDs, hubs ou lojas", "TRF", "transfer", "transferência", {
    required: ["origin", "destination", "distanceKm", "frequencyPerMonth", "vehicleType"],
    optional: ["points", "pallets", "weightKg", "waitingHours", "returnLoaded", "customerTargetPrice"],
  }),
  product("store-replenishment", "Abastecimento de lojas", "ABL", "store-replenishment", "loja/visita", {
    required: ["stores", "visitsPerMonth", "kmPerRoute", "vehicleType"],
    optional: ["deliveryWindows", "unloadingHours", "reverseLogistics", "helpers", "customerTargetPrice"],
  }),
  product("supplier-pickup", "Coleta em fornecedores", "CLF", "supplier-pickup", "coleta", {
    required: ["suppliers", "frequencyPerMonth", "distanceKm", "vehicleType"],
    optional: ["waitingHours", "consolidationPercent", "weightKg", "pallets", "customerTargetPrice"],
  }),
  product("fractional-distribution", "Distribuição fracionada", "DFR", "fractional", "entrega", {
    required: ["sharedRouteCost", "allocationPercent", "deliveries", "distanceKm"],
    optional: ["clientsOnRoute", "occupancyPercent", "weightKg", "volumeM3", "customerTargetPrice"],
  }),
  product("bulk", "Operação a granel", "GRN", "bulk", "tonelada", {
    required: ["materialType", "tons", "distanceKm", "tripsPerMonth", "vehicleType"],
    optional: ["cleaningCost", "waitingHours", "lossPercent", "licenseCost", "customerTargetPrice"],
  }),
  product("custom-project", "Projeto logístico personalizado", "PLP", "custom-project", "projeto", {
    required: ["client", "components", "contractMonths"],
    optional: ["initialInvestment", "cashFlowMonths", "services", "sla", "customerTargetPrice"],
  }),
];

export const PRODUCT_PRICING_BLUEPRINTS = Object.freeze({
  "middle-mile": {
    title: "Middle Mile enterprise",
    pricingUnit: "viagem / contrato recorrente",
    inputGroups: [
      ["Rota", ["origin", "destination", "distanceKm", "returnLoaded", "weeklyFrequency"]],
      ["Carga", ["pallets", "weightKg", "volumeM3", "hazmat", "temperatureControlled"]],
      ["Operação", ["tripsPerMonth", "waitingHours", "tollCost", "vehicleType", "driverShift"]],
      ["Comercial", ["customerTargetPrice", "contractMonths", "sla", "strategicContract"]],
    ],
    requiredEvidence: ["janela de carregamento", "perfil de carga", "rota validada", "SLA esperado"],
    executiveOutputs: ["preço por viagem", "custo por km", "margem mensal", "CO2 evitado por rota", "gatilhos de aprovação"],
  },
  "middle-mile-spot": {
    title: "Middle Mile Spot",
    pricingUnit: "preço por viagem",
    inputGroups: [
      ["Rota", ["origin", "destination", "distanceKm", "returnLoaded"]],
      ["Carga", ["pallets", "weightKg", "volumeM3", "hazmat", "temperatureControlled"]],
      ["Viagem", ["waitingHours", "tollCost", "vehicleType", "driverShift"]],
      ["Negociação", ["customerTargetPrice", "sla", "strategicContract"]],
    ],
    requiredEvidence: ["rota validada", "perfil de carga", "janela de coleta", "valor negociado"],
    executiveOutputs: ["preço por viagem", "custo por km", "margem da viagem", "CO2 evitado por rota", "gatilhos de aprovação"],
  },
  "last-mile": {
    title: "Last Mile e-commerce",
    pricingUnit: "pacote / rota / mês",
    inputGroups: [
      ["Território", ["city", "kmPerRoute", "routesPerDay", "daysPerMonth"]],
      ["Entrega", ["packages", "stops", "successRate", "returnsRate", "density"]],
      ["Frota", ["vehicleType", "drivers", "helpers", "chargingWindow"]],
      ["Comercial", ["customerTargetPrice", "sla", "peakSeasonFactor"]],
    ],
    requiredEvidence: ["histórico de pacotes", "taxa de insucesso", "malha por bairro", "janela de entrega"],
    executiveOutputs: ["custo por pacote", "custo por parada", "custo de insucesso", "volume de equilíbrio", "CO2 evitado por pacote"],
  },
  dedicated: {
    title: "Operação dedicada",
    pricingUnit: "mensalidade por estrutura",
    inputGroups: [
      ["Estrutura", ["vehicles", "drivers", "helpers", "reserveVehicle"]],
      ["Jornada", ["hoursPerDay", "daysPerMonth", "driverShift"]],
      ["Serviços", ["supervisionCost", "technologyCost", "trainingCost", "implementationCost"]],
      ["Contrato", ["contractMonths", "customerTargetPrice", "sla"]],
    ],
    requiredEvidence: ["escala operacional", "SLA contratual", "frota reserva", "custos de implantação"],
    executiveOutputs: ["mensalidade recomendada", "custo por veículo", "custo por dia", "payback de implantação"],
  },
  bulk: {
    title: "Operação a granel",
    pricingUnit: "tonelada / viagem",
    inputGroups: [
      ["Material", ["materialType", "tons", "lossPercent", "licenseCost"]],
      ["Rota", ["distanceKm", "tripsPerMonth", "waitingHours"]],
      ["Preparação", ["cleaningCost", "vehicleType", "riskManagementCost"]],
      ["Comercial", ["customerTargetPrice", "contractMonths", "strategicContract"]],
    ],
    requiredEvidence: ["tipo de material", "licenças", "limpeza exigida", "tempo de espera"],
    executiveOutputs: ["custo por tonelada", "custo de limpeza", "custo de espera", "margem por contrato"],
  },
});

export const getProductPricingBlueprint = (productId) =>
  PRODUCT_PRICING_BLUEPRINTS[productId] || {
    title: "Produto logístico customizado",
    pricingUnit: "unidade configurável",
    inputGroups: [["Premissas", ["distanceKm", "frequencyPerMonth", "customerTargetPrice"]]],
    requiredEvidence: ["escopo operacional", "premissas comerciais", "SLA"],
    executiveOutputs: ["preço recomendado", "margem", "custo por unidade", "impacto ESG"],
  };

import { consumoReferencia } from "./vehicleClassDomain.js";

export const DEFAULT_ENVIRONMENTAL_FACTORS = {
  methodologyVersion: "tdg-env-v2",
  dieselKgCo2ePerLiter: 2.68,
  gasolineKgCo2ePerLiter: 2.12,
  dieselKmPerLiter: 4.2,
  electricKgCo2ePerKwh: 0.0385,
  electricKwhPerKm: 0.30,
  treeKgCo2eYear: 22,
  carKgCo2eYear: 4600,
  flightKgCo2e: 90,
  homeKwhMonth: 152,
};

export const DEFAULT_PRICING_ASSUMPTIONS = {
  taxPercent: 8.65,
  opexPercent: 7,
  commissionPercent: 2.5,
  targetMarginPercent: 26,
  minimumMarginPercent: 18,
  riskPercent: 3,
  adminPercent: 4,
  energyCostPerKwh: 0.92,
  driverDailyCost: 280,
  helperDailyCost: 180,
  vehicleDailyCost: 430,
  maintenancePerKm: 0.42,
  reserveVehiclePercent: 6,
  vehicleMonthlyCost: 0,
  maintenanceMonthly: 0,
  energyCostPerKm: 0,
  electricKwhPerKm: DEFAULT_ENVIRONMENTAL_FACTORS.electricKwhPerKm,
  vehicleInsuranceMonthly: 0,
  licensingMonthly: 0,
  driverDailyCost4h: 0,
  driverDailyCost8h: 0,
  driverHourlyCost: 0,
  supervisionMonthly: 0,
  waitingCostPerHour: 90,
  tollMarkupPercent: 0,
  trackingMonthly: 0,
  cargoInsuranceMonthly: 0,
  contingencyPercent: 0,
};

export const buildCostBreakdown = (inputs = {}, assumptions = {}) => {
  const a = { ...DEFAULT_PRICING_ASSUMPTIONS, ...assumptions };
  const distanceKm = Math.max(0, n(inputs.distanceKm || inputs.kmPerRoute));
  const trips = Math.max(1, n(inputs.tripsPerMonth || inputs.frequencyPerMonth || inputs.routesPerDay * inputs.daysPerMonth || 1));
  const days = Math.max(1, n(inputs.daysPerMonth || inputs.operationDays || Math.ceil(trips / 2)));
  const vehicles = Math.max(1, n(inputs.vehicles || 1));
  const drivers = Math.max(1, n(inputs.drivers || vehicles));
  const helpers = Math.max(0, n(inputs.helpers || inputs.ajudantes || 0));
  const distanceTotal = distanceKm * trips;
  const hours = Math.max(0, n(inputs.hoursPerDay));
  // A classe do veículo entra ANTES da premissa genérica: `a.electricKwhPerKm`
  // já nasce com 0,30 por padrão, então deixá-la na frente faria uma moto
  // consumir como uma van e a diferenciação por classe nunca valeria. Informar
  // `vehicleClass` é escolha explícita de quem calcula — só a entrada direta
  // manda mais que ela.
  const classRef = inputs.vehicleClass ? consumoReferencia(inputs.vehicleClass) : null;
  const electricKwhPerKm = n(
    inputs.electricKwhPerKm
    || classRef?.eletricoKwhPorKm
    || a.electricKwhPerKm
    || DEFAULT_ENVIRONMENTAL_FACTORS.electricKwhPerKm,
  );
  const energy = distanceTotal * (n(a.energyCostPerKm) > 0
    ? n(a.energyCostPerKm)
    : electricKwhPerKm * n(a.energyCostPerKwh));
  const monthlyVehicle = n(a.vehicleMonthlyCost);
  const vehicle = vehicles * (monthlyVehicle > 0 ? monthlyVehicle : days * n(a.vehicleDailyCost));
  const jornadaDriver = hours > 0 && hours <= 4 && n(a.driverDailyCost4h) > 0
    ? n(a.driverDailyCost4h)
    : hours > 0 && hours <= 8 && n(a.driverDailyCost8h) > 0
      ? n(a.driverDailyCost8h)
      : hours > 0 && n(a.driverHourlyCost) > 0
        ? hours * n(a.driverHourlyCost)
        : n(a.driverDailyCost);
  const driver = drivers * days * jornadaDriver;
  const helper = helpers * days * a.helperDailyCost;
  const maintenance = vehicles * n(a.maintenanceMonthly) + distanceTotal * n(a.maintenancePerKm);
  const tolls = n(inputs.tollCost || inputs.pedagios) * trips * (1 + n(a.tollMarkupPercent) / 100);
  const waiting = n(inputs.waitingHours) * n(a.waitingCostPerHour);
  const insurance = n(inputs.insuranceCost || inputs.seguro) + vehicles * (n(a.vehicleInsuranceMonthly) + n(a.cargoInsuranceMonthly));
  const risk = n(inputs.riskManagementCost || inputs.riskCost);
  const technology = n(inputs.technologyCost || inputs.trackingCost) + vehicles * n(a.trackingMonthly);
  const licensing = vehicles * n(a.licensingMonthly);
  const supervision = n(inputs.supervisionCost) || n(a.supervisionMonthly);
  const reserve = inputs.reserveVehicle ? vehicle * n(a.reserveVehiclePercent) / 100 : 0;
  const implementation = n(inputs.implementationCost || 0) / Math.max(1, n(inputs.contractMonths || 12));
  const cleaning = n(inputs.cleaningCost || 0);
  const licenses = n(inputs.licenseCost || 0);
  const shared = n(inputs.sharedRouteCost || 0) * (n(inputs.allocationPercent || 100) / 100);
  const lines = [
    ["vehicle", "Veículo, locação ou depreciação", vehicle],
    ["team", "Motoristas e equipe", driver + helper],
    ["energy", "Energia e recarga", energy],
    ["maintenance", "Manutenção e pneus", maintenance],
    ["tolls", "Pedágios e taxas", tolls],
    ["waiting", "Tempo de espera", waiting],
    ["insurance", "Seguro", insurance],
    ["risk", "Gerenciamento de risco", risk],
    ["technology", "Tecnologia e rastreamento", technology],
    ["licensing", "IPVA e licenciamento", licensing],
    ["supervision", "Supervisão", supervision],
    ["reserve", "Frota reserva", reserve],
    ["implementation", "Implantação rateada", implementation],
    ["cleaning", "Limpeza/preparação", cleaning],
    ["licenses", "Licenças/requisitos", licenses],
    ["shared", "Custo compartilhado alocado", shared],
  ]
    .filter(([, , amount]) => amount > 0)
    .map(([id, label, amount]) => ({ id, label, amount: roundMoney(amount) }));
  const subtotal = lines.reduce((sum, item) => sum + item.amount, 0);
  const contingency = subtotal * n(a.contingencyPercent) / 100;
  if (contingency > 0)
    lines.push({ id: "contingency", label: "Contingência operacional", amount: roundMoney(contingency) });
  return {
    lines,
    directCost: roundMoney(subtotal + contingency),
    drivers: { distanceKm, trips, days, vehicles, drivers, helpers },
  };
};

export const calculateEnvironmentalImpact = (inputs = {}, factors = {}) => {
  const f = { ...DEFAULT_ENVIRONMENTAL_FACTORS, ...factors };
  const classRef = inputs.vehicleClass ? consumoReferencia(inputs.vehicleClass) : null;
  const distanceKm = Math.max(0, n(inputs.distanceKm || inputs.kmPerRoute) * Math.max(1, n(inputs.tripsPerMonth || inputs.frequencyPerMonth || inputs.routesPerDay * inputs.daysPerMonth || 1)));
  const refKmPerL = n(inputs.referenceKmPerLiter || (classRef?.convencionalKmPorL) || f.dieselKmPerLiter);
  const refKgCO2ePerL = classRef?.convencionalKgCO2ePorL ?? f.dieselKgCo2ePerLiter;
  const referenceLiters = distanceKm / Math.max(0.1, refKmPerL);
  const referenceKg = referenceLiters * refKgCO2ePerL;
  const evKwhPerKm = classRef?.eletricoKwhPorKm ?? f.electricKwhPerKm;
  const electricKwh = n(inputs.energyKwh) || distanceKm * evKwhPerKm;
  const actualKg = electricKwh * f.electricKgCo2ePerKwh;
  const avoidedKg = Math.max(0, referenceKg - actualKg);
  const packages = Math.max(0, n(inputs.packages || inputs.deliveries));
  const tons = Math.max(0, n(inputs.tons || inputs.weightKg / 1000));
  return {
    methodologyVersion: f.methodologyVersion,
    distanceKm: roundMoney(distanceKm, 1),
    referenceEmissionsKg: roundMoney(referenceKg, 2),
    actualEmissionsKg: roundMoney(actualKg, 2),
    co2AvoidedKg: roundMoney(avoidedKg, 2),
    reductionPercent: referenceKg ? roundMoney((avoidedKg / referenceKg) * 100, 1) : 0,
    dieselAvoidedLiters: roundMoney(referenceLiters, 2),
    lowEmissionKm: roundMoney(distanceKm, 1),
    intensityPerPackageKg: packages ? roundMoney(actualKg / packages, 4) : 0,
    intensityPerDeliveryKg: packages ? roundMoney(actualKg / packages, 4) : 0,
    intensityPerTonKg: tons ? roundMoney(actualKg / tons, 4) : 0,
    intensityPerKmKg: distanceKm ? roundMoney(actualKg / distanceKm, 4) : 0,
    equivalences: {
      treesYear: roundMoney(avoidedKg / f.treeKgCo2eYear, 1),
      carsYear: roundMoney(avoidedKg / f.carKgCo2eYear, 2),
      flights: roundMoney(avoidedKg / f.flightKgCo2e, 1),
      homesMonth: roundMoney((electricKwh || 0) / f.homeKwhMonth, 1),
    },
    formula:
      "(distância / consumo diesel referência * fator diesel) - (kWh elétrico * fator elétrico)",
    units: "kgCO2e, litros, km, kWh",
    factors: f,
    dataQuality: n(inputs.dataQuality || 75),
  };
};

export const calculateGreenScore = (impact = {}, metrics = {}, weights = {}) => {
  const w = {
    reduction: 35,
    lowEmissionKm: 20,
    cleanEnergy: 15,
    efficiency: 10,
    targetEvolution: 10,
    dataQuality: 10,
    ...weights,
  };
  const parts = {
    reduction: Math.min(100, n(impact.reductionPercent)),
    lowEmissionKm: Math.min(100, (n(impact.lowEmissionKm) / Math.max(1, n(metrics.lowEmissionKmTarget || 1000))) * 100),
    cleanEnergy: Math.min(100, n(metrics.cleanEnergyPercent ?? 80)),
    efficiency: Math.min(100, (n(metrics.occupancyPercent || 75) + n(metrics.productivityPercent || 75)) / 2),
    targetEvolution: Math.min(100, n(metrics.targetEvolutionPercent || impact.reductionPercent || 0)),
    dataQuality: Math.min(100, n(impact.dataQuality || metrics.dataQuality || 70)),
  };
  const totalWeight = Object.values(w).reduce((sum, item) => sum + n(item), 0) || 1;
  const score = Object.entries(parts).reduce(
    (sum, [key, value]) => sum + value * n(w[key]),
    0,
  ) / totalWeight;
  return {
    score: Math.max(0, Math.min(100, roundMoney(score, 1))),
    weights: w,
    parts,
    version: "green-score-v1",
    disclaimer:
      "Indicador proprietário da To Do Green. Não é certificação oficial e deve ser validado conforme a metodologia aplicada.",
  };
};

export const centralPricingEngine = (productId, inputs = {}, config = {}) => {
  const productConfig = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
  if (!productConfig) throw new Error("Produto logístico não encontrado.");
  const assumptions = { ...DEFAULT_PRICING_ASSUMPTIONS, ...(config.assumptions || {}) };
  const cost = buildCostBreakdown(inputs, assumptions);
  const directCost = cost.directCost;
  const opex = directCost * (assumptions.opexPercent / 100);
  const admin = directCost * (assumptions.adminPercent / 100);
  const risk = directCost * (assumptions.riskPercent / 100);
  const loadedCost = directCost + opex + admin + risk;
  const minimumMargin = n(productConfig.marginRules.minimumMarginPercent ?? assumptions.minimumMarginPercent) / 100;
  const targetMargin = n(productConfig.marginRules.targetMarginPercent ?? assumptions.targetMarginPercent) / 100;
  const taxRate = n(assumptions.taxPercent) / 100;
  const minimumPrice = loadedCost / Math.max(0.01, 1 - minimumMargin - n(assumptions.commissionPercent) / 100 - taxRate);
  const recommendedPrice = loadedCost / Math.max(0.01, 1 - targetMargin - n(assumptions.commissionPercent) / 100 - taxRate);
  const targetPrice = n(inputs.customerTargetPrice || inputs.targetPrice);
  const selectedPrice = n(inputs.price) || recommendedPrice;
  const commission = selectedPrice * (assumptions.commissionPercent / 100);
  const tax = selectedPrice * taxRate;
  const marginValue = selectedPrice - loadedCost - commission - tax;
  const marginPercent = selectedPrice ? (marginValue / selectedPrice) * 100 : 0;
  const impact = calculateEnvironmentalImpact(inputs, config.environmentalFactors);
  const greenScore = calculateGreenScore(impact, inputs, config.greenScoreWeights);
  const approval = dealDeskTriggers(
    { marginPercent, selectedPrice, minimumPrice, minimumMarginPercent: minimumMargin * 100, targetPrice, inputs },
    productConfig,
  );
  const blueprint = getProductPricingBlueprint(productId);
  return {
    productId,
    productName: productConfig.name,
    version: productConfig.version,
    blueprint,
    inputs: { ...inputs },
    assumptions,
    cost,
    loadedCost: roundMoney(loadedCost),
    tax: roundMoney(tax),
    minimumPrice: roundMoney(minimumPrice),
    recommendedPrice: roundMoney(recommendedPrice),
    selectedPrice: roundMoney(selectedPrice),
    targetPrice: roundMoney(targetPrice),
    commission: roundMoney(commission),
    marginValue: roundMoney(marginValue),
    marginPercent: roundMoney(marginPercent, 1),
    resultMonthly: roundMoney(marginValue),
    resultAnnual: roundMoney(marginValue * 12),
    breakEvenVolume: unitVolume(productConfig, inputs)
      ? roundMoney(loadedCost / Math.max(0.01, selectedPrice / unitVolume(productConfig, inputs)), 1)
      : 0,
    impact,
    greenScore,
    recommendation: commercialRecommendation({
      marginPercent,
      marginValue,
      targetPrice,
      selectedPrice,
      impact,
      greenScore,
      approval,
      inputs,
    }),
    approval,
    traceability: {
      formula: "loadedCost / (1 - margin - commission - tax)",
      calculatedAt: new Date().toISOString(),
      ruleVersion: config.parameterVersion || productConfig.version,
      methodologyVersion: impact.methodologyVersion,
      requiredEvidence: blueprint.requiredEvidence,
    },
  };
};

export const pricingDecisionSummary = (result = {}) => {
  const floor = n(result.minimumPrice);
  const recommended = n(result.recommendedPrice);
  const strategic = Math.max(floor, recommended * 0.95);
  const implementation = n(result.inputs?.implementationCost);
  const monthlyReturn = n(result.marginValue);
  const occupancy = n(result.inputs?.occupancyPercent);
  const paybackMonths = implementation > 0 && monthlyReturn > 0
    ? roundMoney(implementation / monthlyReturn, 1)
    : null;
  const decision = result.approval?.required
    ? "AVANÇAR COM APROVAÇÃO"
    : n(result.marginPercent) >= 18
      ? "AVANÇAR"
      : "REVISAR CONDIÇÃO";
  return {
    decision,
    floor: roundMoney(floor),
    recommended: roundMoney(recommended),
    strategic: roundMoney(strategic),
    marginPercent: n(result.marginPercent),
    paybackMonths,
    capacity: occupancy
      ? occupancy < 60 ? "Capacidade crítica" : `Ocupação de ${roundMoney(occupancy, 1)}%`
      : "Capacidade a validar",
    risk: result.approval?.triggers?.[0] || "Sem gatilho crítico identificado",
    co2AvoidedKg: n(result.impact?.co2AvoidedKg),
    approval: result.approval?.required
      ? result.approval.triggers.join(", ")
      : "Dentro da alçada calculada",
  };
};

const unitVolume = (productConfig, inputs) => {
  if (productConfig.billingUnit === "pacote") return n(inputs.packages);
  if (productConfig.billingUnit === "viagem") return n(inputs.tripsPerMonth);
  if (productConfig.billingUnit === "tonelada") return n(inputs.tons);
  if (productConfig.billingUnit === "entrega") return n(inputs.deliveries);
  return n(inputs.quantity || inputs.frequencyPerMonth || 1);
};

export const productSpecificOutputs = (productId, result = {}) => {
  const i = result.inputs || {};
  const cost = result.cost?.directCost || 0;
  const km = result.impact?.distanceKm || n(i.distanceKm);
  const trips = n(i.tripsPerMonth || i.frequencyPerMonth || 1);
  const packages = n(i.packages || i.deliveries);
  const tons = n(i.tons || i.weightKg / 1000);
  const pallets = n(i.pallets);
  const base = {
    custoTotal: result.loadedCost,
    precoMinimo: result.minimumPrice,
    precoRecomendado: result.recommendedPrice,
    margem: result.marginPercent,
    resultadoMensal: result.resultMonthly,
    resultadoAnual: result.resultAnnual,
    impactoAmbiental: result.impact?.co2AvoidedKg,
  };
  if (["middle-mile", "middle-mile-spot"].includes(productId))
    return {
      ...base,
      custoPorViagem: trips ? roundMoney(cost / trips) : 0,
      custoPorKm: km ? roundMoney(cost / km) : 0,
      custoPorTonelada: tons ? roundMoney(cost / tons) : 0,
      custoPorPallet: pallets ? roundMoney(cost / pallets) : 0,
      impactoRetornoVazio: i.returnLoaded ? 0 : roundMoney((result.loadedCost || 0) * 0.18),
      ocupacaoMinima: 68,
    };
  if (productId === "last-mile")
    return {
      ...base,
      custoPorPacote: packages ? roundMoney(cost / packages) : 0,
      custoPorParada: n(i.stops) ? roundMoney(cost / n(i.stops)) : 0,
      custoDeInsucesso: roundMoney((packages * (100 - n(i.successRate || 92)) / 100) * 4.8),
      volumeEquilibrio: result.breakEvenVolume,
      produtividadeMinima: 82,
    };
  if (productId === "dedicated")
    return {
      ...base,
      custoPorVeiculo: n(i.vehicles) ? roundMoney(cost / n(i.vehicles)) : cost,
      custoPorDia: n(i.daysPerMonth) ? roundMoney(cost / n(i.daysPerMonth)) : cost,
      impactoVeiculoReserva: result.cost?.lines?.find((line) => line.id === "reserve")?.amount || 0,
    };
  if (productId === "bulk")
    return {
      ...base,
      custoPorTonelada: tons ? roundMoney(cost / tons) : 0,
      custoDeLimpeza: roundMoney(n(i.cleaningCost)),
      custoDeEspera: result.cost?.lines?.find((line) => line.id === "waiting")?.amount || 0,
      ocupacao: n(i.occupancyPercent || 76),
    };
  return {
    ...base,
    custoPorKm: km ? roundMoney(cost / km) : 0,
    custoPorUnidade: unitVolume({ billingUnit: "" }, i) ? roundMoney(cost / unitVolume({ billingUnit: "" }, i)) : cost,
  };
};

export const dealDeskTriggers = (summary = {}, productConfig = {}) => {
  const triggers = [];
  const approval = productConfig.approvalRules || {};
  if (n(summary.marginPercent) < n(summary.minimumMarginPercent ?? approval.minimumMarginPercent ?? 18))
    triggers.push("Margem abaixo do mínimo");
  if (n(summary.targetPrice) && n(summary.targetPrice) < n(summary.minimumPrice))
    triggers.push("Target incompatível com preço mínimo");
  if (n(summary.inputs?.discountPercent) > n(approval.maximumDiscountPercent || 8))
    triggers.push("Desconto acima do limite");
  if (n(summary.inputs?.dataQuality) < n(approval.dataQualityMinimum || 60))
    triggers.push("Dados insuficientes ou pouco confiáveis");
  if (summary.inputs?.newRegion) triggers.push("Nova região");
  if (summary.inputs?.strategicContract) triggers.push("Contrato estratégico");
  if (n(summary.inputs?.occupancyPercent) && n(summary.inputs.occupancyPercent) < 60)
    triggers.push("Baixa ocupação");
  // Margem saudável não dispensa revisão quando o contrato é grande o
  // bastante para superar a alçada mais baixa sozinho — sem isso, um negócio
  // grande com preço "correto" nunca passaria por ninguém além de quem vendeu.
  const primeiraAlcada = ALCADAS[0];
  if (primeiraAlcada && n(summary.selectedPrice) > primeiraAlcada.valorMaximoContrato)
    triggers.push("Receita relevante acima de alçada");
  return {
    required: triggers.length > 0,
    triggers,
    flow: triggers.length
      ? ["Comercial", "Liderança comercial", "Precificação/Financeiro", "Operações", "Sustentabilidade", "Aprovador final"]
      : [],
  };
};

export const commercialRecommendation = ({
  marginPercent,
  marginValue,
  targetPrice,
  selectedPrice,
  impact,
  greenScore,
  approval,
  inputs,
}) => {
  const reasons = [];
  if (approval?.required) reasons.push(`Requer aprovação comercial: ${approval.triggers.join(", ")}.`);
  if (n(marginPercent) >= 26) reasons.push("Margem acima do alvo comercial.");
  if (n(marginPercent) < 18) reasons.push("Margem abaixo do piso interno.");
  if (n(targetPrice) && n(selectedPrice) > n(targetPrice)) reasons.push("Preço recomendado acima do target informado.");
  if (n(impact?.co2AvoidedKg) > 0) reasons.push("Gera impacto ESG mensurável para proposta e relatórios.");
  if (n(greenScore?.score) >= 70) reasons.push("Green Score estimado saudável.");
  if (n(inputs?.dataQuality) < 60) reasons.push("Qualidade dos dados precisa ser melhorada.");
  let decision = "Aceitar";
  if (approval?.required) decision = "Enviar para aprovação comercial";
  else if (n(marginPercent) < 18) decision = "Renegociar preço";
  else if (n(targetPrice) && n(selectedPrice) > n(targetPrice) * 1.15) decision = "Renegociar escopo";
  else if (n(marginValue) < 0) decision = "Rejeitar";
  else if (n(inputs?.dataQuality) < 60) decision = "Solicitar mais informações";
  return {
    decision,
    reasons: reasons.length ? reasons : ["Premissas dentro dos parâmetros configurados."],
  };
};

export const createPricingScenarioSnapshot = (productId, inputs, context = {}, config = {}) => {
  const result = centralPricingEngine(productId, inputs, config);
  return Object.freeze({
    id: context.id || `scenario-${Date.now()}`,
    tenantId: context.tenantId || TODO_GREEN_TENANT.id,
    productId,
    clientId: context.clientId || inputs.clientId || "",
    opportunityId: context.opportunityId || inputs.opportunityId || "",
    createdBy: context.userId || "",
    createdAt: context.createdAt || new Date().toISOString(),
    ruleVersion: result.traceability.ruleVersion,
    inputs: { ...inputs },
    formulas: result.traceability,
    parameters: result.assumptions,
    result,
    approvals: result.approval,
    justification: text(context.justification),
  });
};

export const summarizeTodoGreenDashboard = (data = {}) => {
  const scenarios = Array.isArray(data.pricingScenarios) ? data.pricingScenarios : [];
  const revenue = Array.isArray(data.revenueEntries) ? data.revenueEntries : [];
  const operations = Array.isArray(data.operations) ? data.operations : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const now = (data.today || new Date().toISOString()).slice(0, 10);
  const contracted = scenarios.reduce((sum, item) => sum + n(item.result?.selectedPrice), 0);
  const cost = scenarios.reduce((sum, item) => sum + n(item.result?.loadedCost), 0);
  const co2 = scenarios.reduce((sum, item) => sum + n(item.result?.impact?.co2AvoidedKg), 0);
  const diesel = scenarios.reduce((sum, item) => sum + n(item.result?.impact?.dieselAvoidedLiters), 0);
  const green = scenarios.length
    ? scenarios.reduce((sum, item) => sum + n(item.result?.greenScore?.score), 0) / scenarios.length
    : 0;
  return {
    receitaPrevista: roundMoney(contracted),
    receitaRealizada: roundMoney(revenue.reduce((sum, item) => sum + n(item.amount), 0)),
    custoTotal: roundMoney(cost),
    margemContribuicao: roundMoney(contracted - cost),
    margemOperacionalPercent: contracted ? roundMoney(((contracted - cost) / contracted) * 100, 1) : 0,
    clientes: new Set(scenarios.map((item) => item.clientId).filter(Boolean)).size,
    oportunidadesAbertas: scenarios.filter((item) => item.status !== "won" && item.status !== "lost").length,
    propostasEnviadas: scenarios.length,
    propostasAprovadas: scenarios.filter((item) => !item.result?.approval?.required).length,
    propostasAbaixoMargem: scenarios.filter((item) => n(item.result?.marginPercent) < 18).length,
    entregas: operations.reduce((sum, item) => sum + n(item.deliveries), 0),
    pacotes: operations.reduce((sum, item) => sum + n(item.packages), 0),
    viagens: operations.reduce((sum, item) => sum + n(item.trips), 0),
    quilometragem: operations.reduce((sum, item) => sum + n(item.distanceKm), 0),
    ocupacao: operations.length
      ? roundMoney(operations.reduce((sum, item) => sum + n(item.occupancyPercent), 0) / operations.length, 1)
      : 0,
    co2Evitado: roundMoney(co2),
    dieselNaoConsumido: roundMoney(diesel),
    reducaoEmissoesPercent: scenarios.length
      ? roundMoney(scenarios.reduce((sum, item) => sum + n(item.result?.impact?.reductionPercent), 0) / scenarios.length, 1)
      : 0,
    greenScore: roundMoney(green, 1),
    comissoesPrevistas: roundMoney(contracted * 0.025),
    aprovacoesPendentes: scenarios.filter((item) => item.result?.approval?.required).length,
    tarefasAtrasadas: tasks.filter((task) => task.due && task.due < now && task.status !== "Concluído").length,
    inboxNaoLido: n(data.inboxUnread),
    demoData: data.demoData === true,
    dataPolicy: TODO_GREEN_PRODUCTION_DATA_POLICY.source,
  };
};

export const esgTranslator = (co2Kg, factors = {}) => {
  const f = { ...DEFAULT_ENVIRONMENTAL_FACTORS, ...factors };
  const value = Math.max(0, n(co2Kg));
  return {
    input: { co2Kg: value, unit: "kgCO2e" },
    equivalents: {
      treesYear: roundMoney(value / f.treeKgCo2eYear, 1),
      carsYear: roundMoney(value / f.carKgCo2eYear, 2),
      dieselLiters: roundMoney(value / f.dieselKgCo2ePerLiter, 1),
      flights: roundMoney(value / f.flightKgCo2e, 1),
    },
    proposalText: `Estimativa de ${roundMoney(value / 1000, 2)} tCO2e evitadas na cadeia logística, sujeita à validação conforme metodologia e fatores informados.`,
    reportText: `Memória de cálculo: CO2 evitado dividido pelos fatores de equivalência da metodologia ${f.methodologyVersion}.`,
    disclaimer: "Estimativa operacional. Não substitui certificação oficial.",
    factors: f,
    formula: "equivalente = kgCO2e evitado / fator",
  };
};
