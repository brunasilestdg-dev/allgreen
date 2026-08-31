import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Archive,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Calculator,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  FileCheck,
  FileText,
  Gauge,
  GitBranch,
  Handshake,
  History,
  Inbox,
  Languages,
  Leaf,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Network,
  PackageCheck,
  Plus,
  Landmark,
  ReceiptText,
  Route,
  Search,
  Settings,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Trash2,
  Truck,
  UserRound,
  Users,
  WalletCards,
  Workflow,
  Zap,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  LOGISTICS_PRODUCTS,
  TODO_GREEN_MODULE_AREAS,
  TODO_GREEN_MODULE_CATALOG,
  TODO_GREEN_PRODUCTION_DATA_POLICY,
  TODO_GREEN_PERMISSION_CATALOG,
  TODO_GREEN_PERMISSIONS,
  TODO_GREEN_ROLES,
  DEFAULT_PRICING_ASSUMPTIONS,
  TODO_GREEN_TENANT,
  centralPricingEngine,
  createPricingScenarioSnapshot,
  esgTranslator,
  getProductPricingBlueprint,
  hasTodoGreenPermission,
  productSpecificOutputs,
  pricingDecisionSummary,
  summarizeTodoGreenDashboard,
} from "./logisticsVerticalDomain.js";
import {
  NIVEIS,
  cenarioConfirmado,
  premissasDaSimulacao,
  registroDaConfirmacao,
  situacaoDoResultado,
} from "./pricingPremisesDomain.js";
import { liberacaoDaProposta } from "./dealDeskDomain.js";
import { useVerticalRecords } from "./useVerticalRecords.js";
import { inputsDePrecificacaoDaOportunidade } from "./electrificationJourneyDomain.js";
import { buildTodoGreenDecisionCenter } from "./decisionCenterDomain.js";
import { cenariosAbaixoDoPiso, resumoDeMargem } from "./marginDomain.js";
import { operacoesCriticas, resumoDeOcupacao } from "./operationsEfficiencyDomain.js";
import {
  agruparModulosPorTela,
  grupoAtendeBusca,
  ordenarPorRelevancia,
  resumirAssuntos,
} from "./moduleGroupingDomain.js";
import Semente from "./Semente.jsx";
import ErpHome from "./ErpHome.jsx";
import { comRotulo } from "./rotulosDomain.js";
import { calcularDistancia, resumoDaDistancia } from "./distanciaRodoviariaDomain.js";

const EsgCenter = lazy(() => import("./EsgCenter.jsx"));
const PricingParametersPanel = lazy(() => import("./PricingParametersPanel.jsx"));
const PricingPerformancePanel = lazy(() => import("./PricingPerformancePanel.jsx"));
const DashboardBuilderPage = lazy(() => import("./pages/DashboardBuilderPage.jsx"));
const GoalsPage = lazy(() => import("./pages/GoalsPage.jsx"));
const SalesPerformancePage = lazy(() => import("./pages/SalesPerformancePage.jsx"));
const ClientsPage = lazy(() => import("./pages/ClientsPage.jsx"));
const TrackerPage = lazy(() => import("./pages/TrackerPage.jsx"));
const StockPage = lazy(() => import("./pages/StockPage.jsx"));
const ErpRegistriesPage = lazy(() => import("./pages/ErpRegistriesPage.jsx"));
const PurchasingPage = lazy(() => import("./pages/PurchasingPage.jsx"));
const FiscalPage = lazy(() => import("./pages/FiscalPage.jsx"));
const TreasuryPage = lazy(() => import("./pages/TreasuryPage.jsx"));
const PeoplePage = lazy(() => import("./pages/PeoplePage.jsx"));
const PlannerPage = lazy(() => import("./pages/PlannerPage.jsx"));
const SobreONegocioPage = lazy(() => import("./pages/SobreONegocioPage.jsx"));
const CentralRfqPage = lazy(() => import("./pages/CentralRfqPage.jsx"));
const AvancosDaSemanaPage = lazy(() => import("./pages/AvancosDaSemanaPage.jsx"));
const OpportunitiesPage = lazy(() => import("./pages/OpportunitiesPage.jsx"));
const ClientRequestsPage = lazy(() => import("./pages/ClientRequestsPage.jsx"));
const ReportsPage = lazy(() => import("./pages/ReportsPage.jsx"));
const TripViabilityPage = lazy(() => import("./pages/TripViabilityPage.jsx"));
const DealDeskPage = lazy(() => import("./pages/DealDeskPage.jsx"));
const DocumentVaultPage = lazy(() => import("./pages/DocumentVaultPage.jsx"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage.jsx"));
const TodoGreenWorkspace = lazy(() => import("./TodoGreenWorkspace.jsx"));
const TodoGreenIntelligenceHub = lazy(() => import("./TodoGreenIntelligenceHub.jsx"));
const TodoGreenGuides = lazy(() => import("./TodoGreenGuides.jsx"));
const FinancePage = lazy(() => import("./pages/FinancePage.jsx"));
const OperationsPage = lazy(() => import("./pages/OperationsPage.jsx"));
const OccurrencesPage = lazy(() => import("./pages/OccurrencesPage.jsx"));
const GovernancePage = lazy(() => import("./pages/GovernancePage.jsx"));
const TransactionalSpinePage = lazy(() => import("./pages/TransactionalSpinePage.jsx"));
const EnterpriseAreaPage = lazy(() => import("./pages/EnterpriseAreaPage.jsx"));
const RasciMatrixPage = lazy(() => import("./pages/RasciMatrixPage.jsx"));
const FluxosPage = lazy(() => import("./pages/FluxosPage.jsx"));
const ErpManualPage = lazy(() => import("./pages/ErpManualPage.jsx"));
const ClientActivationPage = lazy(() => import("./ClientActivationPage.jsx"));
const DriverFleetCenterPage = lazy(() => import("./pages/DriverFleetCenterPage.jsx"));

const iconMap = {
  Activity,
  AlertTriangle,
  Archive,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Calculator,
  CheckCircle2,
  DollarSign,
  FileCheck,
  FileText,
  Gauge,
  GitBranch,
  Handshake,
  History,
  Inbox,
  Languages,
  Leaf,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Network,
  PackageCheck,
  Landmark,
  ReceiptText,
  Route,
  Settings,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Trash2,
  Truck,
  UserRound,
  Users,
  WalletCards,
  Workflow,
  Zap,
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const outputLabels = {
  custoTotal: "Custo mensal da operação",
  precoMinimo: "Menor preço recomendado",
  precoRecomendado: "Preço recomendado",
  margem: "Margem estimada",
  resultadoMensal: "Resultado mensal estimado",
  resultadoAnual: "Resultado anual estimado",
  impactoAmbiental: "CO₂ evitado",
  custoPorVeiculo: "Custo mensal por veículo",
  custoPorDia: "Custo por dia",
  impactoVeiculoReserva: "Custo do veículo reserva",
};

const formatOutputValue = (key, value) => {
  if (typeof value !== "number") return value;
  if (["margem", "ocupacao", "ocupacaoMinima", "produtividadeMinima"].includes(key)) return `${number.format(value)}%`;
  if (key === "impactoAmbiental") return `${number.format(value / 1000)} t`;
  return BRL.format(value);
};

const friendlyCommercialText = (value) =>
  String(value || "")
    .replace(/Encaminhar ao Deal Desk/gi, "Enviar para aprovação comercial")
    .replace(/Deal Desk/gi, "aprovação comercial")
    .replace(/target/gi, "valor esperado pelo cliente")
    .replace(/parâmetros/gi, "dados da operação");

const IMPLEMENTED_MODULE_IDS = new Set([
  "dashboard",
  "dashboard-esg",
  "green-score",
  "calculadora-ambiental",
  "tradutor-esg",
  "escopo-3",
  "relatorios-esg",
  "metodologia",
  "cofre-evidencias",
  "clientes",
  "contatos",
  "oportunidades",
  "pipeline",
  "propostas",
  "contratos",
  "simulacoes",
  "precificacao",
  "deal-desk",
  "implantacao",
  "produtos",
  "catalogo-produtos",
  "planejamento",
  "aceite-viagens",
  "ciot",
  "receita",
  "forecast",
  "faturamento",
  "recebimento",
  "custos",
  "opex",
  "margem",
  "rentabilidade",
  "operacoes",
  "produtos-logisticos",
  "rotas",
  "viagens",
  "veiculos",
  "motorista-frota",
  "entregas",
  "ocupacao",
  "produtividade",
  "energia",
  "ocorrencias",
  "relatorios",
  "auditoria",
  "usuarios",
  "permissoes",
  "configuracoes",
  "dashboards",
  "metas",
  "performance-comercial",
  "playbook-comercial",
  "rastreamento",
  "solicitacoes",
  "estoque",
  "compras",
  "cadastros",
  "dp-rh",
  "motoristas",
  "escalas",
  "qualidade",
  "marketing",
  "campanhas",
  "comunicacao-interna",
  "juridico",
  "indicadores",
  "administracao",
  "fiscal",
  "tesouraria",
  "cte",
  "mdfe",
  "nfse",
  "planner",
  "rasci",
  "fluxos",
  "manual",
  "comissoes",
  "espaco",
  "visualizacoes",
  "agentes-funcoes",
]);

const MODULE_IMPLEMENTATION = Object.freeze({
  dashboard: {
    title: "Principal",
    navLabel: "Principal",
    route: "/todogreen/dashboard",
    area: "principal",
    status: "functional",
    description: "Indicadores, pendências e atalhos do ERP.",
  },
  dashboards: {
    title: "Painéis personalizados",
    navLabel: "Meus painéis",
    route: "/todogreen/dashboards",
    area: "indicadores",
    status: "functional",
    description: "Criação de painéis pessoais ou compartilhados com indicadores escolhidos por cada usuário.",
  },
  espaco: {
    title: "Workspace To Do Green",
    navLabel: "Visão geral",
    route: "/todogreen/espaco",
    area: "espaco-trabalho",
    status: "functional",
    description: "Projetos, tarefas, conhecimento, visualizações e agentes no mesmo espaço de trabalho.",
  },
  visualizacoes: {
    title: "Visualizações do trabalho",
    navLabel: "Visualizações e gráficos",
    route: "/todogreen/visualizacoes",
    area: "espaco-trabalho",
    status: "functional",
    description: "Lista, Gantt, timeline, calendário, workload e gráficos alimentados pela mesma base de projetos e tarefas.",
  },
  "agentes-funcoes": {
    title: "Agentes e funções",
    navLabel: "Agentes e funções",
    route: "/todogreen/agentes",
    area: "espaco-trabalho",
    status: "functional",
    description: "Agentes herdados do Seu Funcionário, suas funções, execuções e aprovações.",
  },
  avancos: {
    title: "Avanços da semana",
    navLabel: "Avanços da semana",
    route: "/todogreen/avancos",
    area: "espaco-trabalho",
    status: "functional",
    permission: ["crm:manage", "clients:manage", "audit:read"],
    description: "As oportunidades com movimento concreto nos últimos sete dias, com o avanço escrito por quem trabalhou nelas.",
  },
  metas: {
    title: "Metas e acompanhamento",
    navLabel: "Metas",
    route: "/todogreen/metas",
    area: "comercial",
    status: "functional",
    permission: "goal:read",
    description: "Metas com medição, check-ins e planos de ação.",
  },
  "performance-comercial": {
    title: "Performance comercial",
    navLabel: "Performance",
    route: "/todogreen/performance-comercial",
    area: "comercial",
    status: "functional",
    permission: ["crm:manage", "clients:manage"],
    description: "Execução da carteira e atingimento de metas, sem misturar oportunidades, pipeline ou faturamento.",
  },
  "playbook-comercial": {
    title: "Playbook comercial",
    navLabel: "Playbook",
    route: "/todogreen/playbook-comercial",
    area: "comercial",
    status: "functional",
    description: "Jornada de venda, critérios de avanço e atalhos comerciais.",
  },
  clientes: {
    title: "Clientes e contatos",
    navLabel: "Clientes",
    route: "/todogreen/clientes",
    area: "comercial",
    status: "functional",
    permission: ["crm:manage", "clients:manage", "clients:read"],
    description: "Cadastro de cliente, segmento, decisor, maturidade ESG, dores logísticas e próximo passo comercial.",
  },
  oportunidades: {
    title: "Oportunidades e pipeline",
    navLabel: "Oportunidades",
    route: "/todogreen/oportunidades",
    area: "comercial",
    status: "functional",
    permission: "crm:manage",
    description: "Criação de oportunidades por produto logístico, estágio, valor estimado, probabilidade e prioridade.",
  },
  propostas: {
    title: "Propostas e contratos",
    navLabel: "Propostas",
    route: "/todogreen/propostas",
    area: "comercial",
    status: "functional",
    permission: ["proposal:create", "proposal:manage", "deal:review", "deal:approve"],
    description: "Geração de proposta textual com preço, premissas, ROI ambiental, ressalvas e aprovações necessárias.",
  },
  precificacao: {
    title: "Precificação e aprovação comercial",
    navLabel: "Precificação",
    route: "/todogreen/precificacao",
    area: "comercial",
    status: "functional",
    permission: ["pricing:simulate", "pricing:manage"],
    description: "Calculadoras por produto, margem, custo, target, gatilhos de aprovação e evidências obrigatórias.",
  },
  implantacao: {
    title: "Implantação de cliente",
    navLabel: "Implantação",
    route: "/todogreen/implantacao",
    area: "implantacao",
    status: "functional",
    permission: ["clients:manage", "clients:read", "operations:manage", "planning:manage"],
    description: "Go-live do cliente: contrato, operação, SLA e portal.",
  },
  produtos: {
    title: "Produtos logísticos",
    navLabel: "Produtos",
    route: "/todogreen/produtos",
    area: "produtos",
    status: "functional",
    permission: "product:manage",
    description: "Catálogo de first, middle e last mile com escopo, SLA, unidade de cobrança, premissas e restrições por produto.",
  },
  planejamento: {
    title: "Planejamento operacional",
    navLabel: "Liberação de OS",
    route: "/todogreen/planejamento",
    area: "operacao",
    status: "functional",
    permission: ["planning:manage", "operations:manage"],
    description: "Decide aceite de viagem ou OS com capacidade, produto, SLA, risco, margem e janela operacional.",
  },
  "aceite-viagens": {
    title: "Aceito esta viagem?",
    navLabel: "Aceito esta viagem?",
    route: "/todogreen/aceite-viagens",
    area: "operacao",
    status: "functional",
    permission: ["planning:manage", "operations:manage"],
    description: "Simulador de aceite: custos obrigatórios, margem calculada e decisão registrada antes de virar OS.",
  },
  ciot: {
    title: "CIOT",
    navLabel: "CIOT",
    route: "/todogreen/ciot",
    area: "operacao",
    status: "functional",
    permission: "ciot:manage",
    description: "Emissão de CIOT com piso mínimo e protocolo.",
  },
  ocorrencias: {
    title: "Ocorrências e exceções operacionais",
    navLabel: "Ocorrências",
    route: "/todogreen/ocorrencias",
    area: "operacao",
    status: "functional",
    permission: ["operations:manage", "tms:manage", "evidence:manage"],
    description: "Atrasos, insucessos, reentregas e eventos críticos ligados à operação.",
  },
  comissoes: {
    title: "Comissões",
    navLabel: "Comissões",
    route: "/todogreen/comissoes",
    area: "financeiro",
    status: "functional",
    permission: ["commission:manage", "finance:manage", "audit:read"],
    description: "Comissão por lançamento, com baixa e estorno pelo mesmo razão.",
  },
  rasci: {
    title: "Matriz RASCI",
    navLabel: "RASCI",
    route: "/todogreen/rasci",
    area: "administracao",
    status: "functional",
    description: "Quem executa, aprova, apoia, consulta e é informado em cada área — numa aba só.",
  },
  fluxos: {
    title: "Fluxos entre áreas",
    navLabel: "Fluxos",
    route: "/todogreen/fluxos",
    area: "administracao",
    status: "functional",
    description: "Como o trabalho passa de uma área para a outra, do produto ao caixa — numa aba só.",
  },
  manual: {
    title: "Manual do ERP",
    navLabel: "Manual",
    route: "/todogreen/manual",
    area: "administracao",
    status: "functional",
    description: "O que cada módulo faz e a permissão que exige; gerado do catálogo, sempre atual.",
  },
  esg: {
    title: "ESG, Green Score e emissões da cadeia logística",
    navLabel: "ESG operacional",
    route: "/todogreen/esg",
    area: "esg",
    status: "functional",
    permission: ["esg:manage", "audit:read", "deal:review"],
    description: "CO2 evitado, diesel não consumido, equivalências, metodologia e textos comerciais auditáveis.",
  },
  regua: {
    title: "Parâmetros de preço",
    navLabel: "Parâmetros de preço",
    route: "/todogreen/parametros-simulador",
    area: "commercial",
    status: "functional",
    permission: "pricing:manage",
    description: "Custo de veículo, motorista, energia e margem que a precificação usa — com versão e fonte.",
  },
  "central-esg": {
    title: "Central ESG",
    navLabel: "Central ESG",
    route: "/todogreen/central-esg",
    area: "esg",
    status: "functional",
    permission: ["esg:manage", "audit:read", "deal:review"],
    description: "Calcula e grava o impacto com memória de cálculo, apura o Green Score com a régua em vigor e guarda a explicação de cada variação.",
  },
  solicitacoes: {
    title: "Solicitações de clientes",
    navLabel: "Solicitações",
    route: "/todogreen/solicitacoes",
    area: "implantacao",
    status: "functional",
    permission: ["clients:manage", "crm:manage", "operations:manage"],
    description: "Entrada do cliente antes do aceite, com prazo, produto provável, responsável, conversa e histórico.",
  },
  operacoes: {
    title: "Fretes e execução operacional",
    navLabel: "Fretes",
    route: "/todogreen/operacoes",
    area: "operacao",
    status: "functional",
    permission: ["operations:manage", "planning:manage", "tms:manage"],
    description: "Ficha operacional do frete com OS, execução, rota, entregas, documentos, fiscal, financeiro, SLA e histórico.",
  },
  "ordens-servico": {
    title: "Fretes, OS e aceite",
    navLabel: "OS e aceite",
    route: "/todogreen/ordens-servico",
    area: "operacao",
    status: "functional",
    permission: ["operations:manage", "planning:manage"],
    description: "Planejamento e Produtos liberam o frete; Operação executa; Financeiro só entra quando há elegibilidade de faturamento.",
  },
  rastreamento: {
    title: "TMS Tracker",
    navLabel: "TMS Tracker",
    route: "/todogreen/rastreamento",
    area: "operacao",
    status: "functional",
    permission: ["tms:manage", "operations:manage"],
    description: "Configuração, teste e sincronização segura de posições e eventos da frota em modo somente leitura.",
  },
  cadastros: {
    title: "Cadastros logísticos",
    navLabel: "Cadastros",
    route: "/todogreen/cadastros",
    area: "cadastros",
    status: "functional",
    permission: ["clients:manage", "crm:manage", "stock:manage", "purchase:manage", "finance:manage", "fleet:manage", "hr:manage", "operations:manage", "planning:manage"],
    description: "Clientes, motoristas, veículos, tabelas, rotas, materiais, depósitos, parceiros, centros de custo e plano de contas.",
  },
  estoque: {
    title: "Estoque",
    navLabel: "Estoque",
    route: "/todogreen/estoque",
    area: "suprimentos",
    status: "functional",
    permission: "stock:manage",
    description: "Saldos, entradas, saídas, transferências e contagens.",
  },
  compras: {
    title: "Suprimentos",
    navLabel: "Suprimentos",
    route: "/todogreen/compras",
    area: "suprimentos",
    status: "functional",
    permission: "purchase:manage",
    description: "Requisições, aprovações, pedidos e recebimentos.",
  },
  tesouraria: {
    title: "Tesouraria, conciliação e fechamento",
    navLabel: "Tesouraria",
    route: "/todogreen/tesouraria",
    area: "financeiro",
    status: "functional",
    permission: "finance:manage",
    description: "Extrato OFX, conciliação, saldo por conta, cobrança com aging e fechamento de competência.",
  },
  fiscal: {
    title: "Fiscal — CT-e, MDF-e e NFS-e",
    navLabel: "Fiscal",
    route: "/todogreen/fiscal",
    area: "financeiro",
    status: "functional",
    permission: "fiscal:manage",
    description: "CT-e, MDF-e e NFS-e; SEFAZ aguarda certificado.",
  },
  receita: {
    title: "Receita, forecast e faturamento",
    navLabel: "Receita",
    route: "/todogreen/receita",
    area: "financeiro",
    status: "functional",
    permission: ["revenue:manage", "finance:manage", "audit:read"],
    description: "Entradas financeiras por cliente/produto, forecast, faturamento, recebimento e comissão prevista.",
  },
  faturamento: {
    title: "Faturamento, CT-e e recebíveis",
    navLabel: "Faturamento",
    route: "/todogreen/faturamento",
    area: "financeiro",
    status: "functional",
    permission: ["revenue:manage", "finance:manage", "fiscal:manage"],
    description: "Fila de OS concluída, conferência fiscal, CT-e/documento, fechamento, título a receber e rastreabilidade.",
  },
  titulos: {
    title: "Títulos e baixas",
    navLabel: "Títulos e baixas",
    route: "/todogreen/titulos",
    area: "financeiro",
    status: "functional",
    permission: ["finance:manage", "revenue:manage", "cost:manage"],
    description: "Contas a pagar e receber com competência, vencimento, saldo, parcelas e liquidações rastreáveis.",
  },
  rateios: {
    title: "Rateio de custos",
    navLabel: "Rateio de custos",
    route: "/todogreen/rateios",
    area: "financeiro",
    status: "functional",
    permission: ["finance:manage", "cost:manage"],
    description: "Distribuição integral do custo por OS, operação, cliente, contrato, veículo, fornecedor e centro de custo.",
  },
  custos: {
    title: "Custos, margem e rateios",
    navLabel: "Custo e margem",
    route: "/todogreen/custos",
    area: "financeiro",
    status: "functional",
    permission: ["cost:manage", "finance:manage", "audit:read"],
    description: "Centro de custos operacional, custo por categoria, margem e comparação contra receita/simulações, sem decidir aceite.",
  },
  rh: {
    title: "RH",
    navLabel: "RH",
    route: "/todogreen/rh",
    area: "rh",
    status: "functional",
    permission: "hr:manage",
    description: "Pessoas, motoristas, escalas, documentos, alocação, dados sensíveis e rotinas trabalhistas.",
  },
  "dp-rh": {
    title: "Departamento Pessoal",
    navLabel: "DP",
    route: "/todogreen/dp",
    area: "dp",
    status: "functional",
    permission: "hr:manage",
    description: "Administração de pessoal, documentação, alocação e rotinas trabalhistas separadas do Financeiro.",
  },
  "motorista-frota": {
    title: "Frota e motoristas",
    navLabel: "Veículos e motoristas",
    route: "/todogreen/motorista-frota",
    area: "operacao",
    status: "functional",
    permission: ["fleet:manage", "operations:manage", "hr:manage"],
    description: "Gestão operacional de frota, motoristas, telemetria disponível, custo, bateria, manutenção e alertas.",
  },
  marketing: {
    title: "Inteligência de mercado",
    navLabel: "Mercado",
    route: "/todogreen/marketing",
    area: "marketing",
    status: "functional",
    permission: "market:read",
    description: "Pesquisa de notícias, RFQs e possíveis decisores no mercado inteiro, com fonte e classificação.",
  },
  relatorios: {
    title: "Relatórios executivos",
    navLabel: "Relatórios",
    route: "/todogreen/relatorios",
    area: "gestao",
    status: "functional",
    description: "Resumo comercial, financeiro, operacional e ESG pronto para comitê, proposta ou prestação de contas.",
  },
  metodologia: {
    title: "Metodologia e premissas",
    navLabel: "Metodologia",
    route: "/todogreen/metodologia",
    area: "esg",
    status: "functional",
    description: "Fatores ambientais, fórmulas, versão, governança, disclaimer e evidências exigidas por produto.",
  },
  documentos: {
    title: "Documentos",
    navLabel: "Documentos",
    route: "/todogreen/documentos",
    area: "documentos",
    status: "functional",
    description:
      "Notas, telemetria, contratos, comprovantes e laudos que sustentam os números. Cada arquivo entra com impressão digital do conteúdo e sai por link temporário.",
  },
  "deal-desk": {
    title: "Aprovação de condição comercial",
    navLabel: "Aprovações",
    route: "/todogreen/deal-desk",
    area: "comercial",
    status: "functional",
    description:
      "Pedido, alçada, prazo, versão, comentários, decisão e histórico imutável. Enquanto pende, a proposta daquela simulação não sai.",
  },
  auditoria: {
    title: "Auditoria e governança",
    navLabel: "Auditoria",
    route: "/todogreen/auditoria",
    area: "administracao",
    status: "functional",
    description: "Permissões por papel, rastreabilidade de cálculo, bloqueios e fluxo de aprovação.",
  },
  acessos: {
    title: "Acessos",
    navLabel: "Acessos",
    route: "/todogreen/acessos",
    area: "administracao",
    status: "functional",
    // Quem não gerencia acessos não vê a aba. A checagem é o papel do vínculo,
    // não a presença da palavra "admin" em algum lugar da tela.
    permission: "access:manage",
    description: "Gestão de e-mails autorizados e perfis de acesso.",
  },
  integracoes: {
    title: "Integrações de IA, busca e automação",
    navLabel: "Integrações",
    route: "/todogreen/integracoes",
    area: "administracao",
    status: "functional",
    permission: "integration:manage",
    description: "Estado da cascata de IA, pesquisa web e automações autohospedadas, sem expor credenciais.",
  },
  qualidade: {
    title: "Qualidade",
    navLabel: "Qualidade",
    route: "/todogreen/qualidade",
    area: "qualidade",
    status: "functional",
    permission: ["audit:read", "operations:manage", "evidence:manage"],
    description: "SLA, BSC, auditoria de execução, não conformidades, planos de ação e melhoria contínua.",
  },
  juridico: {
    title: "Jurídico",
    navLabel: "Jurídico",
    route: "/todogreen/juridico",
    area: "juridico",
    status: "functional",
    permission: ["proposal:manage", "deal:review", "deal:approve", "audit:read"],
    description: "Contratos, minutas, riscos jurídicos, aprovações e documentos formais vinculados à operação.",
  },
  indicadores: {
    title: "Indicadores",
    navLabel: "KPIs por área",
    route: "/todogreen/indicadores",
    area: "indicadores",
    status: "functional",
    description: "KPIs comerciais, operacionais, financeiros, ESG, qualidade, implantação e produtividade por área.",
  },
  administracao: {
    title: "Administração",
    navLabel: "Governança",
    route: "/todogreen/administracao",
    area: "administracao",
    status: "functional",
    permission: ["access:manage", "integration:manage", "audit:read"],
    description: "Acessos, permissões, auditoria, integrações, configurações e governança da vertical.",
  },
  "central-rfq": {
    title: "Central de RFQ e RFI",
    navLabel: "RFQ e RFI",
    route: "/todogreen/central-rfq",
    area: "comercial",
    status: "functional",
    // Ler é aberto a quem responde cotação; cadastrar documento oficial exige
    // `compliance:manage`, checado no servidor.
    description: "Acervo de habilitação com semáforo de validade, kits conferidos antes de enviar e o ciclo do RFQ do e-mail ao resultado.",
  },
  "sobre-o-negocio": {
    title: "Sobre o negócio",
    navLabel: "Sobre o negócio",
    route: "/todogreen/sobre-o-negocio",
    area: "administracao",
    status: "functional",
    // Ler é aberto a quem entra na vertical: um vendedor precisa saber a
    // história da casa para responder um RFI sem inventar. Editar exige
    // `business:teach`, checado no servidor — a tela só esconde o botão.
    description: "O dossiê que a IA lê antes de responder: identidade, proposta, operação, números com fonte, habilitação e o que ela aprendeu.",
  },
  planner: {
    title: "Planner",
    navLabel: "Planner",
    route: "/todogreen/planner",
    area: "produtividade",
    status: "functional",
    permission: "planner:manage",
    description: "Planos com tarefas, prazo, prioridade e checklist.",
  },
});

// A taxonomia de áreas é a da titular (mensagem de 30/08): cada área da
// empresa na frente e, dentro dela, as funcionalidades. Nenhuma página saiu —
// só mudou de estante. Áreas pedidas sem tela própria moram na mais próxima:
// Cultura Organizacional → Recursos Humanos; Melhoria Contínua → Qualidade;
// Notícias → Workspace (hub de notícias e inteligência).
const PRIMARY_NAVIGATION = Object.freeze([
  // Workspace primeiro (pedido de 30/08): é a mesa de trabalho — planner,
  // projetos e implantações moram aqui. Implantação é um TIPO de projeto,
  // por isso vive dentro deste grupo sem perder o nome próprio.
  // `jornadasInternas`: o menu não repete o que o Workspace já mostra dentro.
  { id: "espaco-trabalho", label: "Workspace", route: "/todogreen/espaco", pages: ["espaco", "central-trabalho", "visualizacoes", "agentes-funcoes", "avancos", "planner", "implantacao", "solicitacoes"], jornadasInternas: ["central-trabalho", "visualizacoes", "agentes-funcoes"] },
  { id: "principal", label: "Principal", route: "/todogreen/dashboard", pages: ["dashboard"] },
  // Planejamento decide o que entra; Operação executa o que foi aceito. Antes
  // as duas coisas moravam na mesma área e "Planejamento" aparecia dentro de
  // Operação enquanto uma OUTRA aba chamada Planejamento (que era, na verdade,
  // indicadores) existia no menu. Um nome, um lugar.
  { id: "operations", label: "Operação", route: "/todogreen/operacoes", pages: ["operacoes", "ordens-servico", "ocorrencias", "rastreamento"], extras: [["Cadastro · Bases e unidades", "/todogreen/cadastros?secao=operationalUnits"], ["Cadastro · Rotas padrão", "/todogreen/cadastros?secao=routes"]] },
  { id: "planejamento", label: "Planejamento", route: "/todogreen/planejamento", pages: ["planejamento", "aceite-viagens"] },
  { id: "esg", label: "ESG", route: "/todogreen/central-esg", pages: ["central-esg", "esg", "metodologia"] },
  { id: "marketing", label: "Marketing", route: "/todogreen/marketing", pages: ["marketing"] },
  { id: "commercial", label: "Comercial", route: "/todogreen/clientes", pages: ["clientes", "oportunidades", "precificacao", "regua", "propostas", "central-rfq", "deal-desk", "metas", "performance-comercial", "playbook-comercial"], extras: [["Cadastro · Tabelas de preço", "/todogreen/cadastros?secao=priceTables"]] },
  { id: "compliance", label: "Compliance", route: "/todogreen/auditoria", pages: ["auditoria", "fiscal", "rasci", "manual", "fluxos"] },
  { id: "juridico", label: "Jurídico", route: "/todogreen/juridico", pages: ["juridico"] },
  { id: "indicadores", label: "Indicadores", route: "/todogreen/indicadores", pages: ["indicadores", "dashboards", "relatorios"] },
  // Cada cadastro mora na área dona do dado (atalhos "Cadastro · ..." no
  // segundo nível): materiais/depósitos/fornecedores em Compras, contas no
  // Financeiro, veículos/motoristas na Frota, colaboradores no DP, tabelas
  // de preço no Comercial, bases/rotas na Operação. A página completa
  // continua em Administração como o "ver tudo".
  { id: "suprimentos", label: "Compras", route: "/todogreen/compras", pages: ["compras", "estoque"], extras: [["Cadastro · Materiais", "/todogreen/cadastros?secao=items"], ["Cadastro · Depósitos", "/todogreen/cadastros?secao=warehouses"], ["Cadastro · Fornecedores e parceiros", "/todogreen/cadastros?secao=parties"]] },
  { id: "frota", label: "Frota", route: "/todogreen/motorista-frota", pages: ["motorista-frota", "ciot"], extras: [["Cadastro · Veículos", "/todogreen/cadastros?secao=vehicles"], ["Cadastro · Motoristas", "/todogreen/cadastros?secao=drivers"]] },
  { id: "qualidade", label: "Qualidade", route: "/todogreen/qualidade", pages: ["qualidade"] },
  { id: "finance", label: "Financeiro", route: "/todogreen/faturamento", pages: ["faturamento", "titulos", "rateios", "receita", "custos", "comissoes", "tesouraria"], extras: [["Cadastro · Centros de custo", "/todogreen/cadastros?secao=costCenters"], ["Cadastro · Plano de contas", "/todogreen/cadastros?secao=accounts"], ["Cadastro · Contas bancárias", "/todogreen/cadastros?secao=bankAccounts"]] },
  { id: "dp", label: "Departamento Pessoal", route: "/todogreen/dp-rh", pages: ["dp-rh"], extras: [["Cadastro · Colaboradores", "/todogreen/cadastros?secao=employees"]] },
  { id: "rh", label: "Recursos Humanos", route: "/todogreen/rh", pages: ["rh"] },
  { id: "products", label: "Produtos", route: "/todogreen/produtos", pages: ["produtos"] },
  { id: "documentos", label: "Documentos", route: "/todogreen/documentos", pages: ["documentos"] },
  { id: "administracao", label: "Administração", route: "/todogreen/administracao", pages: ["administracao", "integracoes", "acessos", "sobre-o-negocio"], extras: [["Cadastro · Dados da empresa", "/todogreen/cadastros?secao=companyProfiles"]] },
]);

// Cada cadastro no galho da sua área (regra da titular). O atalho já nascia na
// área certa, mas abrir "Cadastro · Veículos" jogava a pessoa em Administração
// › Cadastros com as sete abas de todas as áreas na cara — e um segundo clique
// em outro cadastro não trocava de seção. Este mapa devolve a área dona da
// seção: o menu fica onde estava, a trilha diz de onde é e a tela abre só os
// cadastros daquela área.
const AREA_DO_CADASTRO = Object.freeze({
  operationalUnits: "operations",
  routes: "operations",
  priceTables: "commercial",
  items: "suprimentos",
  warehouses: "suprimentos",
  parties: "suprimentos",
  vehicles: "frota",
  drivers: "frota",
  costCenters: "finance",
  accounts: "finance",
  bankAccounts: "finance",
  employees: "dp",
  companyProfiles: "administracao",
});

export const secaoDaRota = (rota = "") => {
  try {
    return new URLSearchParams(String(rota).split("?")[1] || "").get("secao") || "";
  } catch {
    return "";
  }
};

const MANAGEMENT_TOOLS = Object.freeze([
  {
    id: "projects",
    label: "Projetos e tarefas",
    title: "Projetos e tarefas",
    description: "Quadros, responsáveis, prazos, automações e acompanhamento das entregas da To Do Green.",
    route: "/todogreen/central-trabalho",
    permission: "",
  },
  {
    id: "integracoes",
    label: "Integrações",
    title: MODULE_IMPLEMENTATION.integracoes.title,
    description: MODULE_IMPLEMENTATION.integracoes.description,
    route: "/todogreen/integracoes",
    permission: "integration:manage",
  },
  {
    id: "acessos",
    label: "Usuários e acessos",
    title: "Usuários e acessos",
    description: MODULE_IMPLEMENTATION.acessos.description,
    route: "/todogreen/acessos",
    permission: "access:manage",
  },
]);

const navigationModules = (ids = []) => {
  const seenRoutes = new Set();
  return ids
    .map((id) => [id, MODULE_IMPLEMENTATION[id]])
    .filter(([, module]) => {
      if (!module?.route || seenRoutes.has(module.route)) return false;
      seenRoutes.add(module.route);
      return true;
    });
};

const navigationFor = (page, secao = "") => {
  if (page === "cadastros") {
    const area = PRIMARY_NAVIGATION.find((item) => item.id === AREA_DO_CADASTRO[secao]);
    if (area) return area;
  }
  return PRIMARY_NAVIGATION.find((item) => item.pages.includes(page)) || PRIMARY_NAVIGATION[0];
};

// A permissão de uma tela sai do MESMO config que o menu usa para escondê-la.
// Sem isto, esconder o botão não protege a tela: quem digita a URL, volta no
// histórico ou atualiza a página passa direto pela filtragem do menu e o
// conteúdo restrito renderiza assim mesmo. A regra de quem entra é do papel,
// não da presença do botão.
export const permissaoDaPagina = (page) => {
  const ferramenta = MANAGEMENT_TOOLS.find((item) => item.id === page);
  if (ferramenta) return ferramenta.permission || "";
  return MODULE_IMPLEMENTATION[page]?.permission || "";
};

// Uma tela pode servir a mais de uma área. Neste catálogo, lista significa
// alternativas (qualquer uma libera), e não a exigência cumulativa usada em
// operações críticas do domínio.
const podeAcessarFuncionalidade = (role, permissions, required) => {
  if (!required || (Array.isArray(required) && required.length === 0)) return true;
  const alternatives = Array.isArray(required) ? required : [required];
  return alternatives.some((permission) => hasTodoGreenPermission(role, permission, permissions));
};

// A trilha (breadcrumb) vem do mesmo config do menu: a área da navegação
// primária, a tela do módulo (ou da ferramenta de administração). Menu e trilha
// lendo a mesma fonte nunca discordam sobre onde a pessoa está.
export const trilhaDaPagina = (page, secao = "") => {
  const area = navigationFor(page, secao);
  const modulo = MODULE_IMPLEMENTATION[page];
  const ferramenta = MANAGEMENT_TOOLS.find((item) => item.id === page);
  const trilha = [{ label: "To Do Green", route: "/todogreen/dashboard" }];
  if (area && area.id !== "principal" && area.route)
    trilha.push({ label: area.label, route: area.route });
  const atual = modulo
    ? { label: modulo.navLabel, route: modulo.route }
    : ferramenta
      ? { label: ferramenta.label, route: ferramenta.route }
      : null;
  if (atual && atual.route !== trilha[trilha.length - 1].route)
    trilha.push(atual);
  return trilha;
};

// O nome que a aba já usa para cada tela. É ele que dá nome ao cartão: se a
// aba se chama "Operações", o cartão não pode se chamar "Rotas".
const TITULOS_POR_TELA = Object.fromEntries(
  Object.values(MODULE_IMPLEMENTATION).map((item) => [item.route, item.navLabel]),
);

const fieldLabels = {
  allocationPercent: "Alocação da rota (%)",
  cashFlowMonths: "Meses de fluxo de caixa",
  chargingWindow: "Janela de recarga",
  city: "Cidade",
  client: "Cliente",
  clientId: "ID do cliente",
  clientsOnRoute: "Clientes na rota",
  components: "Componentes do projeto",
  consolidationPercent: "Consolidação (%)",
  contractMonths: "Meses de contrato",
  customerTargetPrice: "Target do cliente",
  daysPerMonth: "Dias/mês",
  deliveryWindows: "Janelas de entrega",
  density: "Densidade da rota",
  deliveries: "Entregas",
  destination: "Destino",
  distanceKm: "Distância km",
  driverShift: "Turno do motorista",
  drivers: "Motoristas",
  frequencyPerMonth: "Frequência/mês",
  hazmat: "Carga perigosa",
  helpers: "Ajudantes",
  hoursPerDay: "Horas/dia",
  implementationCost: "Implantação R$",
  initialInvestment: "Investimento inicial R$",
  kmPerRoute: "Km por rota",
  licenseCost: "Licenças R$",
  lossPercent: "Perda técnica (%)",
  materialType: "Tipo de material",
  occupancyPercent: "Ocupação (%)",
  origin: "Origem",
  packages: "Pacotes",
  pallets: "Pallets",
  peakSeasonFactor: "Fator pico sazonal",
  points: "Pontos atendidos",
  reserveVehicle: "Veículo reserva",
  returnLoaded: "Retorno carregado",
  reverseLogistics: "Logística reversa",
  riskManagementCost: "Gerenciamento de risco R$",
  routesPerDay: "Rotas/dia",
  services: "Serviços inclusos",
  sharedRouteCost: "Custo rota compartilhada R$",
  sla: "SLA",
  stops: "Paradas",
  stores: "Lojas",
  strategicContract: "Contrato estratégico",
  successRate: "Sucesso entrega (%)",
  suppliers: "Fornecedores",
  supervisionCost: "Supervisão R$",
  technologyCost: "Tecnologia R$",
  temperatureControlled: "Temperatura controlada",
  tollCost: "Pedágio por viagem R$",
  tons: "Toneladas",
  trainingCost: "Treinamento R$",
  tripsPerMonth: "Viagens/mês",
  unloadingHours: "Horas descarga",
  vehicles: "Quantidade de veículos",
  returnsRate: "Devoluções (%)",
  cleaningCost: "Limpeza e higienização R$",
  quantity: "Quantidade",
  vehicleType: "Tipo de veículo",
  visitsPerMonth: "Visitas/mês",
  volumeM3: "Volume m³",
  waitingHours: "Horas de espera",
  weeklyFrequency: "Frequência semanal",
  weightKg: "Peso kg",
  dataQuality: "Quanto podemos confiar nos dados (%)",
};

const textFields = new Set([
  "city",
  "client",
  "clientId",
  "components",
  "deliveryWindows",
  "destination",
  "driverShift",
  "materialType",
  "origin",
  "services",
  "sla",
  "vehicleType",
]);

const booleanFields = new Set([
  "hazmat",
  "reserveVehicle",
  "returnLoaded",
  "reverseLogistics",
  "strategicContract",
  "temperatureControlled",
]);

// Toda premissa que muda preço, margem ou CO₂ nasce vazia.
//
// Antes a calculadora abria com distância, frequência, ocupação, tipo de
// veículo e confiança no dado já preenchidos. Em um segundo havia preço,
// margem, CO₂ evitado e recomendação na tela — todos calculados sobre números
// que ninguém informou. Um resultado assim é indistinguível de um cálculo
// real, e foi assim que ele chegou a proposta e a relatório.
//
// Ficam só os campos que são de fato neutros: custo que começa em zero porque
// pode não existir (pedágio, treinamento, implantação), opção de sim/não com
// resposta padrão, e o alvo do cliente, que é zero enquanto ele não disser.
const productDefaults = {
  "middle-mile": {
    client: "",
    origin: "",
    destination: "",
    distanceKm: "",
    tripsPerMonth: "",
    vehicleType: "",
    pallets: "",
    weightKg: "",
    tollCost: 0,
    waitingHours: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  "middle-mile-spot": {
    client: "",
    origin: "",
    destination: "",
    distanceKm: "",
    tripsPerMonth: 1,
    vehicleType: "",
    pallets: "",
    weightKg: "",
    tollCost: 0,
    waitingHours: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
    modality: "spot",
  },
  "last-mile": {
    client: "",
    city: "",
    packages: "",
    routesPerDay: "",
    daysPerMonth: "",
    kmPerRoute: "",
    vehicleType: "",
    stops: "",
    successRate: "",
    returnsRate: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  dedicated: {
    client: "",
    vehicles: "",
    vehicleType: "",
    drivers: "",
    helpers: "",
    hoursPerDay: "",
    daysPerMonth: "",
    reserveVehicle: false,
    supervisionCost: 0,
    technologyCost: 0,
    trainingCost: 0,
    implementationCost: 0,
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  transfer: {
    client: "",
    origin: "",
    destination: "",
    distanceKm: "",
    frequencyPerMonth: "",
    vehicleType: "",
    pallets: "",
    weightKg: "",
    waitingHours: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  "store-replenishment": {
    client: "",
    stores: "",
    visitsPerMonth: "",
    kmPerRoute: "",
    vehicleType: "",
    helpers: "",
    unloadingHours: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  "supplier-pickup": {
    client: "",
    suppliers: "",
    frequencyPerMonth: "",
    distanceKm: "",
    vehicleType: "",
    waitingHours: "",
    consolidationPercent: "",
    weightKg: "",
    pallets: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  "fractional-distribution": {
    client: "",
    sharedRouteCost: "",
    allocationPercent: "",
    deliveries: "",
    distanceKm: "",
    clientsOnRoute: "",
    occupancyPercent: "",
    weightKg: "",
    volumeM3: 36,
    customerTargetPrice: 0,
    dataQuality: "",
  },
  bulk: {
    client: "",
    materialType: "",
    tons: "",
    distanceKm: "",
    tripsPerMonth: "",
    vehicleType: "",
    cleaningCost: 0,
    waitingHours: "",
    lossPercent: 0,
    licenseCost: 0,
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
  "custom-project": {
    client: "",
    components: "",
    contractMonths: "",
    initialInvestment: 0,
    cashFlowMonths: "",
    customerTargetPrice: 0,
    occupancyPercent: "",
    dataQuality: "",
  },
};

const todoGreenPath = () =>
  typeof window === "undefined"
    ? "/todogreen"
    : `${window.location.pathname}${window.location.search}`;

const sectionFromPath = (path) => {
  const slug = String(path || "")
    .replace(/^\/todogreen\/?/, "")
    .split("?")[0]
    .split("/")[0];
  return slug || "dashboard";
};

// O produto da precificação vem da ROTA (/todogreen/precificacao/<produto>),
// não de estado só do React. Assim voltar, avançar, atualizar a página e
// compartilhar o link levam ao mesmo produto — era isto que o módulo
// imperativo (removido) fingia fazer com clique sintético no card.
export const produtoDaRota = (path) => {
  const partes = String(path || "").replace(/^\/todogreen\/?/, "").split("?")[0].split("/");
  if (partes[0] !== "precificacao") return "";
  const id = partes[1] || "";
  return LOGISTICS_PRODUCTS.some((item) => item.id === id) ? id : "";
};

const TODO_GREEN_PAGE_ALIASES = Object.freeze({
  "dashboard-esg": "esg",
  "relatorios-esg": "relatorios",
  "cofre-evidencias": "auditoria",
  certificados: "relatorios",
  contatos: "clientes",
  pipeline: "oportunidades",
  contratos: "propostas",
  simulacoes: "precificacao",
  "parametros-simulador": "regua",
  // "deal-desk" era apelido de "precificacao" porque não havia tela. Agora há.
  aprovacoes: "deal-desk",
  alcada: "deal-desk",
  remuneracao: "comissoes",
  forecast: "receita",
  recebimento: "titulos",
  opex: "custos",
  "centros-custo": "rateios",
  margem: "custos",
  rentabilidade: "custos",
  "produtos-logisticos": "produtos",
  "catalogo-produtos": "produtos",
  fretes: "operacoes",
  rotas: "operacoes",
  viagens: "operacoes",
  veiculos: "motorista-frota",
  motoristas: "motorista-frota",
  dp: "dp-rh",
  escalas: "rh",
  campanhas: "marketing",
  entregas: "operacoes",
  pacotes: "operacoes",
  ocupacao: "dashboard",
  produtividade: "dashboard",
  energia: "esg",
  tarefas: "dashboard",
  notificacoes: "dashboard",
  inbox: "dashboard",
  exportacoes: "relatorios",
  usuarios: "acessos",
  permissoes: "acessos",
  configuracoes: "acessos",
  agentes: "agentes-funcoes",
});

export const todoGreenRouteToPage = (path) => {
  const section = sectionFromPath(path);
  if (section === "comercial") return "clientes";
  if (!section || section === "dashboard") return "dashboard";
  return TODO_GREEN_PAGE_ALIASES[section] || section;
};


const navigate = (route) => {
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const openFunctionPage = (route) => {
  if (typeof window === "undefined") return;
  window.open(route, "_blank", "noopener,noreferrer");
};

const ownerId = () => {
  try {
    return localStorage.getItem("sf-space") || localStorage.getItem("sf-active-user") || "";
  } catch {
    return "";
  }
};

const demoModeEnabled = (db = {}, access = {}) => Boolean(db?.[TODO_GREEN_PRODUCTION_DATA_POLICY.demoModeFlag] || access.demoMode);

// ===== Quem entra na vertical =====
//
// Só a API responde essa pergunta. A regra anterior abria a tela por quatro
// caminhos que o próprio navegador controla:
//
//   1. e-mail terminado no domínio da empresa;
//   2. um negócio chamado "To Do Green" no espaço — nome que a própria pessoa
//      digita no cadastro;
//   3. `tenantAccess.todogreen` gravado no estado local;
//   4. a chamada de acesso falhando, e o estado anterior mantendo a tela
//      aberta.
//
// O quarto era o mais silencioso e o terceiro o mais grave: era a própria
// tela de precificação que gravava `tenantAccess.todogreen` ao salvar uma
// simulação, então o acesso se autoconcedia e sobrevivia a qualquer correção
// feita no servidor.
//
// O backend já decide certo. Enquanto ele não confirmar vínculo e permissões,
// aqui não abre — e "não respondeu ainda" não é "pode entrar".
export const ACESSO = {
  verificando: "verificando",
  liberado: "liberado",
  negado: "negado",
};

// A resposta só vale se trouxer um papel conhecido. Corpo vazio, papel
// desconhecido ou 200 sem conteúdo não viram acesso — muito menos "admin".
export const lerRespostaDeAcesso = (payload) => {
  const role = String(payload?.role || "").trim();
  if (!TODO_GREEN_ROLES.includes(role)) return null;
  return { ...payload, role, allowed: true };
};

const seedScenario = createPricingScenarioSnapshot(
  "middle-mile",
  {
    client: "Demonstração Middle Mile",
    clientId: "demo-middle-mile",
    origin: "CD exemplo",
    destination: "Hub exemplo",
    distanceKm: 86,
    tripsPerMonth: 44,
    vehicleType: "VUC elétrico",
    pallets: 12,
    weightKg: 3200,
    waitingHours: 1.5,
    tollCost: 42,
    customerTargetPrice: 72000,
    occupancyPercent: 78,
    dataQuality: 82,
  },
  { userId: "demo", tenantId: TODO_GREEN_TENANT.id, justification: "Dado demonstrativo; não usar como produção." },
);

const seedLastMile = createPricingScenarioSnapshot(
  "last-mile",
  {
    client: "Demonstração Last Mile",
    clientId: "demo-last-mile",
    city: "São Paulo",
    packages: 9600,
    routesPerDay: 18,
    daysPerMonth: 22,
    kmPerRoute: 62,
    vehicleType: "Furgão elétrico",
    stops: 7200,
    successRate: 93,
    customerTargetPrice: 142000,
    occupancyPercent: 81,
    dataQuality: 76,
  },
  { userId: "demo", tenantId: TODO_GREEN_TENANT.id, justification: "Dado demonstrativo; não usar como produção." },
);

// ===== Os dados da vertical, vindos de um lugar só =====
//
// Esta função montava a vertical a partir do `db` — o JSON do espaço de
// trabalho — enquanto clientes, ESG, Tracker e portal já vinham da API. Duas
// fontes para a mesma vertical davam painel somando coisas diferentes, portal
// cego para o que foi escrito por dentro, e sobrescrita entre pessoas do mesmo
// espaço.
//
// Agora tudo vem de `/api/todogreen/records`. Do `db` sobra só o que é do
// produto inteiro e não da vertical: tarefas e caixa de entrada.
//
// A tradução de nomes acontece aqui, num lugar só. O motor de resumo fala
// inglês desde a origem e a API fala português como o resto da vertical;
// espalhar essa conversão pelos painéis é o que faz dois lugares somarem
// campos diferentes com o mesmo nome.
const financeiroDaApi = (item) => ({
  id: item.id,
  kind: item.tipo,
  amount: item.valor,
  clientId: item.clientId,
  productId: item.produtoId,
  category: item.categoria,
  status: item.situacao,
  note: item.descricao,
  referenceMonth: item.mesReferencia,
  dueDate: item.vencimentoEm,
  paidAt: item.pagoEm,
  paidAmount: item.valorPago,
  counterparty: item.contraparte,
  documentNumber: item.numeroDocumento,
  costCenter: item.centroCusto,
  budgetCode: item.codigoOrcamento,
  paymentMethod: item.meioPagamento,
  competenceDate: item.competenciaEm,
  contractId: item.contratoId,
  invoiceStatus: item.statusFinanceiro,
  revision: item.revision,
  createdAt: item.criadoEm,
});

const operacaoDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  productId: item.produtoId,
  deliveries: item.entregas,
  packages: item.pacotes,
  trips: item.viagens,
  distanceKm: item.distanciaKm,
  occupancyPercent: item.ocupacaoPercent,
  status: item.situacao,
  route: item.referencia || item.campos?.route || "",
  referencia: item.referencia || item.campos?.route || "",
  contratoId: item.contratoId,
  dataServico: item.dataServico,
  origem: item.origem,
  destino: item.destino,
  prometidoEm: item.prometidoEm,
  entregueEm: item.entregueEm,
  etaEm: item.etaEm,
  placa: item.placa,
  motorista: item.motorista,
  sla: item.sla,
  comprovanteUrl: item.comprovanteUrl,
  ultimaPosicaoEm: item.ultimaPosicaoEm,
  mesReferencia: item.mesReferencia || String(item.criadoEm || "").slice(0, 7),
  produtoId: item.produtoId,
  entregas: item.entregas,
  pacotes: item.pacotes,
  viagens: item.viagens,
  distanciaKm: item.distanciaKm,
  ocupacaoPercent: item.ocupacaoPercent,
  incidents: Number(item.ocorrencias || 0),
  ocorrencias: Number(item.ocorrencias || 0),
  revision: item.revision,
  createdAt: item.criadoEm,
});

const propostaDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  client: item.cliente,
  opportunityId: item.oportunidadeId,
  title: item.titulo,
  scope: item.escopo,
  commercialTerms: item.condicoes,
  risks: item.riscos,
  proposalText: item.texto,
  scenarioId: item.cenarioId,
  status: item.situacao,
  revision: item.revision,
  createdAt: item.criadoEm,
});

const contratoDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  client: item.cliente,
  opportunityId: item.oportunidadeId,
  proposalId: item.propostaId,
  scenarioId: item.cenarioId,
  title: item.titulo,
  startAt: item.inicioEm,
  endAt: item.fimEm,
  monthlyValue: item.valorMensal,
  totalValue: item.valorTotal,
  status: item.situacao,
  terms: item.termos,
  signatureStatus: item.assinatura,
  signedAt: item.assinadoEm,
  renewalType: item.renovacao,
  renewalNoticeAt: item.avisoRenovacaoEm,
  billingDay: item.diaFaturamento,
  responsibleId: item.responsavelId,
  noticeDays: item.antecedenciaAvisoDias,
  version: item.versao,
  serviceId: item.servicoId,
  priceTableId: item.tabelaPrecoId,
  sla: item.sla || {},
  commercialTerms: item.condicoesComerciais || {},
  taxes: item.impostos || {},
  billingRules: item.regrasFaturamento || {},
  adjustmentIndex: item.indiceReajuste,
  adjustmentBaseDate: item.dataBaseReajuste,
  minimumCommitment: item.compromissoMinimo,
  approvalStatus: item.aprovacao,
  revision: item.revision,
  createdAt: item.criadoEm,
});

const montarDadosDaVertical = (registros = {}, clientes = [], db = {}, access = {}) => {
  const demo = demoModeEnabled(db, access);
  // Painel, indicadores e relatórios só somam simulação com premissa
  // confirmada. O que ficou de fora é contado à parte — sumir com ele em
  // silêncio seria trocar um número inventado por outro.
  const salvos = registros.scenarios || [];
  const confirmados = salvos.filter(cenarioConfirmado);
  const financeiro = (registros.financial || []).map(financeiroDaApi);
  return {
    demo,
    clients: clientes,
    opportunities: registros.opportunities || [],
    proposals: (registros.proposals || []).map(propostaDaApi),
    contracts: (registros.contracts || []).map(contratoDaApi),
    pricingScenarios: confirmados.length ? confirmados : demo ? [seedScenario, seedLastMile] : [],
    simulacoesSemProcedencia: salvos.length - confirmados.length,
    revenueEntries: financeiro.filter((item) => item.kind === "revenue"),
    costEntries: financeiro.filter((item) => item.kind === "cost"),
    commissionEntries: financeiro.filter((item) => item.kind === "commission"),
    operations: (registros.operations || []).map(operacaoDaApi),
    tasks: db.tasks || [],
    inboxUnread: (db.notifications || []).filter((item) => !item.read).length,
  };
};


// Enquanto a API não respondeu, a tela não afirma nada. Mostrar o painel e
// depois retirá-lo seria pior do que esperar: a pessoa já teria visto números
// que talvez não sejam dela.
function AcessoEmVerificacao() {
  return (
    <main className="tdg tdg-denied" aria-labelledby="tdg-verificando-title" aria-busy="true">
      <section className="tdg-denied-card">
        <div className="tdg-denied-mark"><ShieldCheck /></div>
        <span className="tdg-kicker">ACESSO PRIVADO</span>
        <h1 id="tdg-verificando-title">Confirmando permissão</h1>
        <p>A área abre assim que sua autorização for confirmada.</p>
      </section>
    </main>
  );
}

function AccessDenied({ db }) {
  return (
    <main className="tdg tdg-denied" aria-labelledby="tdg-denied-title">
      <section className="tdg-denied-card">
        <div className="tdg-denied-mark"><ShieldCheck /></div>
        <span className="tdg-kicker">ACESSO PRIVADO</span>
        <h1 id="tdg-denied-title">Acesso restrito</h1>
        <p>Entre com uma conta autorizada para acessar as rotinas da To Do Green.</p>
        <dl>
          <div><dt>Usuário atual</dt><dd>{db?.user?.email || "sessão local"}</dd></div>
          <div><dt>Empresa</dt><dd>To Do Green</dd></div>
        </dl>
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`tdg-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ModuleCard({ grupo }) {
  const Icon = iconMap[grupo.icone] || Boxes;
  // A tela está liberada se qualquer um dos nomes que caem nela estiver
  // implementado: quem procurou por "motorista" não deveria precisar adivinhar
  // que o nome liberado é "operações".
  const implemented = grupo.ids.some((id) => IMPLEMENTED_MODULE_IDS.has(id));
  const assuntos = resumirAssuntos(grupo.assuntos);
  return (
    <button className={`tdg-module-card ${implemented ? "" : "disabled"}`} type="button" title={assuntos || grupo.nome} onClick={() => implemented && openFunctionPage(grupo.rota)}>
      <span className="tdg-module-icon"><Icon size={22} /></span>
      <span>
        <strong>{grupo.nome}</strong>
        {implemented && assuntos && <small className="tdg-module-assuntos" title={assuntos}>{assuntos}</small>}
        {!implemented && <small>Em implantação.</small>}
      </span>
      {!implemented && <em>Em implantação</em>}
      {implemented && <ExternalLink size={18} aria-hidden="true" />}
    </button>
  );
}

function AreaSection({ area, grupos }) {
  const liberadas = grupos.filter((g) => g.ids.some((id) => IMPLEMENTED_MODULE_IDS.has(id)));
  const planejadas = grupos.filter((g) => !g.ids.some((id) => IMPLEMENTED_MODULE_IDS.has(id)));
  return (
    <section className="tdg-section" aria-labelledby={`area-${area.id}`}>
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">{area.name}</span>
          <h2 id={`area-${area.id}`}>{area.description}</h2>
        </div>
        <span>{liberadas.length} rotinas ativas · {planejadas.length} em implantação</span>
      </div>
      <div className="tdg-module-grid">
        {liberadas.map((grupo) => <ModuleCard grupo={grupo} key={grupo.rota} />)}
      </div>
      {planejadas.length > 0 && (
        <details className="tdg-backlog">
          <summary>Ver próximos itens</summary>
          <div className="tdg-module-grid">
            {planejadas.map((grupo) => <ModuleCard grupo={grupo} key={grupo.rota} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function sidebarFunctionLabel(grupo) {
  return grupo.nome.replace(/\s+To Do Green$/i, "").trim();
}

function ProductCard({ product, active, onSelect }) {
  return (
    <button className={`tdg-product-card ${active ? "active" : ""}`} type="button" onClick={() => onSelect(product.id)}>
      <span>{product.code}</span>
      <strong>{product.name}</strong>
      <small>{product.billingUnit} · {product.requiredFields.length} premissas</small>
    </button>
  );
}

// ===== Distância que a própria operação calcula =====
//
// `distanceKm` era digitado à mão em Middle Mile, Last Mile, Transferência e
// Coleta em fornecedores — a premissa mais frágil da conta inteira, porque
// multiplica combustível, pedágio, hora de motorista e emissão de CO2. Errar
// 40 km numa operação de 44 viagens/mês erra o preço do contrato.
//
// O app já sabia traçar rota (Nominatim + OSRM, sem chave e sem cota); só não
// estava ligado aqui. Oferece como SUGESTÃO: quem precifica pode ter motivo
// para outro número — rota que o cliente exige, restrição de circulação,
// trecho que a operação faz diferente do que o roteirizador acha.
function BotaoDistancia({ origem, destino, idaEVolta, onAceitar }) {
  const [estado, setEstado] = useState({ fase: "parado" });
  const podeCalcular = String(origem || "").trim().length >= 3 && String(destino || "").trim().length >= 3;

  const calcular = async () => {
    setEstado({ fase: "calculando" });
    const resultado = await calcularDistancia({ origem, destino, idaEVolta });
    setEstado(resultado.ok ? { fase: "pronto", resultado } : { fase: "erro", motivo: resultado.motivo });
  };

  if (!podeCalcular)
    return <small className="tdg-distancia-dica">Preencha origem e destino para calcular a distância pelo mapa.</small>;

  return (
    <div className="tdg-distancia">
      {estado.fase !== "pronto" && (
        <button type="button" className="tdg-distancia-botao" onClick={calcular} disabled={estado.fase === "calculando"}>
          {estado.fase === "calculando" ? "Consultando o mapa…" : "Calcular pelo mapa"}
        </button>
      )}
      {estado.fase === "erro" && <small className="tdg-distancia-erro">{estado.motivo}</small>}
      {estado.fase === "pronto" && (
        <div className="tdg-distancia-resultado">
          <strong>{resumoDaDistancia(estado.resultado)}</strong>
          <small>{estado.resultado.origem} → {estado.resultado.destino}</small>
          <div>
            {/* A pessoa aceita; a tela não sobrescreve o que ela digitou. */}
            <button type="button" onClick={() => { onAceitar(estado.resultado.distanciaKm); setEstado({ fase: "parado" }); }}>
              Usar {estado.resultado.distanciaKm} km
            </button>
            <button type="button" className="secundario" onClick={() => setEstado({ fase: "parado" })}>Descartar</button>
          </div>
          <small className="tdg-distancia-fonte">{estado.resultado.fonte}</small>
        </div>
      )}
    </div>
  );
}

function FieldInput({ name, value, required, onChange, inputs }) {
  if (booleanFields.has(name)) {
    return (
      <label className="tdg-check-field">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(name, event.target.checked)} />
        <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
      </label>
    );
  }
  if (name === "distanceKm") {
    return (
      <label>
        <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
        <input
          value={value ?? ""}
          inputMode="decimal"
          onChange={(event) => onChange(name, event.target.value === "" ? "" : Number(event.target.value) || 0)}
        />
        <BotaoDistancia
          origem={inputs?.origin}
          destino={inputs?.destination}
          // Middle Mile cobra o ciclo completo quando o retorno é carregado ou
          // vazio: a viagem é ida e volta, e só a ida subestima o custo.
          idaEVolta={inputs?.returnLoaded === true || inputs?.roundTrip === true}
          onAceitar={(km) => onChange(name, km)}
        />
      </label>
    );
  }
  return (
    <label>
      <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
      <input
        value={value ?? ""}
        inputMode={textFields.has(name) ? "text" : "decimal"}
        // Campo numérico apagado vira "" e não 0: zero é uma resposta, vazio é
        // a ausência dela, e a tela precisa saber a diferença para não
        // calcular preço em cima de premissa que ninguém informou.
        onChange={(event) =>
          onChange(
            name,
            textFields.has(name) || event.target.value === ""
              ? event.target.value
              : Number(event.target.value) || 0,
          )
        }
      />
    </label>
  );
}

function DashboardPanel({ data, dashboard, tasks, onNavigate }) {
  const decision = buildTodoGreenDecisionCenter({ data, dashboard, tasks });
  const margin = resumoDeMargem({ cenarios: data.pricingScenarios });
  const marginRisks = cenariosAbaixoDoPiso({ cenarios: data.pricingScenarios, limite: 3 });
  const occupancy = resumoDeOcupacao({ operacoes: data.operations });
  const occupancyRisks = operacoesCriticas({ operacoes: data.operations, limite: 3 });
  const actionableAlerts = [
    ...marginRisks.map((item) => ({ id: `margin-${item.id}`, tone: "risk", title: `${item.cliente} está ${number.format(item.distanciaDoPiso)} p.p. abaixo do piso`, detail: `Margem ${number.format(item.margemPercent)}% · piso ${number.format(item.piso)}%`, action: "Abrir precificação", route: "/todogreen/precificacao" })),
    ...occupancyRisks.map((item) => ({ id: `occupancy-${item.id}`, tone: "risk", title: `${item.referencia} com ${number.format(item.ocupacaoPercent)}% de ocupação`, detail: "Revise consolidação, frequência ou alocação da rota.", action: "Abrir operação", route: "/todogreen/operacoes" })),
    ...decision.alerts,
  ];
  const countLabel = (total, singular, plural) => `${total} ${total === 1 ? singular : plural}`;
  return (
    <section className="tdg-panel tdg-decision-center" aria-labelledby="tdg-decision-title">
      <header className="tdg-decision-header">
        <div>
          <span className="tdg-kicker">VISÃO GERAL</span>
          <h2 id="tdg-decision-title">Painel de Gerenciamento</h2>
          <p>Indicadores, pendências e atalhos principais da operação.</p>
        </div>
        <span className="tdg-data-status">{data.demo ? "Demonstração identificada" : "Dados reais"}</span>
      </header>

      <div className="tdg-decision-metrics" aria-label="Resultados principais">
        <MetricCard label="Receita" value={decision.hasRevenueData ? BRL.format(dashboard.receitaRealizada || dashboard.receitaPrevista) : "R$ 0"} detail={decision.hasRevenueData ? "realizada e contratada" : "sem lançamento"} />
        <MetricCard label="Margem" value={margin.margemPercent === null ? "Sem cálculo" : `${number.format(margin.margemPercent)}%`} detail={margin.leitura} tone={margin.abaixoDoPiso ? "risk" : margin.margemPercent === null ? "neutral" : "good"} />
        <MetricCard label="Forecast" value={BRL.format(decision.forecast)} detail={countLabel(decision.counts.openOpportunities, "oportunidade aberta", "oportunidades abertas")} />
        <MetricCard label="Pipeline" value={BRL.format(decision.pipeline)} detail="em negociação" />
        <MetricCard label="Ocupação" value={occupancy.ocupacaoMedia === null ? "Sem medição" : `${number.format(occupancy.ocupacaoMedia)}%`} detail={occupancy.leitura} tone={occupancy.criticas ? "risk" : occupancy.ocupacaoMedia === null ? "neutral" : "good"} />
        <MetricCard label="CO2 evitado" value={decision.hasImpactData ? `${number.format(dashboard.co2Evitado / 1000)} t` : "Sem cálculo"} detail={decision.hasImpactData ? "operação vinculada" : "sem operação"} tone={decision.hasImpactData ? "good" : "neutral"} />
      </div>

      <div className="tdg-decision-body">
        <section className="tdg-attention-list" aria-labelledby="tdg-attention-title">
          <div className="tdg-decision-section-title">
            <div><span>FILA</span><h2 id="tdg-attention-title">Pendências</h2></div>
            <small>{actionableAlerts.length ? countLabel(actionableAlerts.length, "item para decidir", "itens para decidir") : "Nenhuma pendência crítica encontrada"}</small>
          </div>
          {actionableAlerts.length === 0 ? (
            <div className="tdg-decision-clear"><CheckCircle2 size={20} /><div><strong>{decision.hasData ? "Sem alertas críticos" : "Sem dados operacionais"}</strong><span>{decision.hasData ? "Nenhuma pendência registrada no momento." : "Cadastre clientes, oportunidades ou simulações para alimentar o painel."}</span></div>{!decision.hasData && <button type="button" onClick={() => onNavigate?.("/todogreen/clientes")}>Cadastrar cliente</button>}</div>
          ) : actionableAlerts.slice(0, 6).map((alert) => (
            <button className={`tdg-decision-alert ${alert.tone}`} type="button" onClick={() => onNavigate?.(alert.route)} key={alert.id}>
              <span className="tdg-decision-alert-icon">{alert.tone === "risk" ? <AlertTriangle size={18} /> : <Bell size={18} />}</span>
              <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
              <b>{alert.action}<ArrowRight size={15} /></b>
            </button>
          ))}
        </section>

        <aside className="tdg-decision-next" aria-label="Atalhos para continuar o trabalho">
          <span>ATALHOS</span>
          <h2>Fluxo operacional</h2>
          <div>
            <button type="button" onClick={() => onNavigate?.("/todogreen/clientes")}>Clientes <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/oportunidades")}>Oportunidades <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/precificacao")}>Precificação <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/propostas")}>Propostas e contratos <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/deal-desk")}>Aprovações <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/operacoes")}>Operação <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/receita")}>Receita e resultado <ArrowRight size={14} /></button>
            <button type="button" onClick={() => onNavigate?.("/todogreen/central-esg")}>ESG <ArrowRight size={14} /></button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PricingPanel({ role, criar, db, authHeaders, setToast, opportunities = [] }) {
  const opportunityId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("opportunity") || "";
  const sourceOpportunity = opportunities.find((item) => item.id === opportunityId) || null;
  // O produto sai da rota primeiro; a oportunidade e o padrão só entram quando
  // a rota não traz produto. O painel é remontado ao trocar de produto (ver o
  // `key` no render), então ler a rota no início basta.
  const rotaProduto =
    typeof window === "undefined" ? "" : produtoDaRota(window.location.pathname);
  const initialProductId = rotaProduto || sourceOpportunity?.productId || "middle-mile";
  const [productId, setProductId] = useState(initialProductId);
  const [inputs, setInputs] = useState(() =>
    sourceOpportunity
      ? inputsDePrecificacaoDaOportunidade(
          sourceOpportunity,
          productDefaults[initialProductId] || productDefaults["middle-mile"],
        )
      : productDefaults["middle-mile"],
  );
  // Declaração de procedência das premissas. Cai a cada mudança: confirmar um
  // cenário e depois trocar a distância deixaria a declaração valendo para um
  // cálculo que já não é o mesmo.
  const [premissasConfirmadas, setPremissasConfirmadas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // O id da simulação que acabou de ser salva. A aprovação é sobre a condição
  // exata; sem simulação gravada não há o que aprovar.
  const [cenarioSalvoId, setCenarioSalvoId] = useState("");
  const [justificativaDeAprovacao, setJustificativaDeAprovacao] = useState("");
  const [enviandoAprovacao, setEnviandoAprovacao] = useState(false);
  // Os parâmetros em vigor, administrados pelo gestor na tela de parâmetros.
  // Sem ela carregada ainda, a calculadora usa o padrão — e diz qual régua
  // está aplicando, porque preço sem régua identificada não se defende.
  const [regua, setRegua] = useState(null);
  // Custos da operação editáveis na própria calculadora. Nascem da régua em
  // vigor (ou do padrão) e, quando a pessoa mexe, sobrescrevem as premissas SÓ
  // nesta simulação — a régua versionada continua intacta. Era o pedido: ver e
  // ajustar motorista, energia e veículo aqui, sem abrir outra tela.
  const [custosManuais, setCustosManuais] = useState({});
  useEffect(() => {
    let vivo = true;
    const consulta = new URLSearchParams({ productId });
    if (inputs.modality) consulta.set("modality", inputs.modality);
    if (inputs.vehicleType) consulta.set("vehicleType", inputs.vehicleType);
    if (inputs.region || inputs.city) consulta.set("region", inputs.region || inputs.city);
    if (inputs.clientId) consulta.set("clientId", inputs.clientId);
    if (inputs.contractId) consulta.set("contractId", inputs.contractId);
    fetch(`/api/todogreen/pricing-parameters?${consulta}`, { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.atual) {
          const aplicados = d.resolvido?.aplicados || [];
          setRegua({
            ...d.atual,
            deFabrica: d.atual.deFabrica && aplicados.length === 0,
            parametros: d.resolvido?.parametros || d.atual.parametros,
            aplicados,
            versao: aplicados.map((item) => item.versao).join(" + ") || d.atual.versao,
          });
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [authHeaders, productId, inputs.modality, inputs.vehicleType, inputs.region, inputs.city, inputs.clientId, inputs.contractId]);
  const allowed = hasTodoGreenPermission(role, "pricing:simulate");
  const blueprint = getProductPricingBlueprint(productId);
  const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
  // A base é a régua (ou o padrão); os custos manuais entram por cima. Só
  // valores realmente digitados sobrescrevem — campo vazio mantém a régua.
  const custosEfetivos = useMemo(() => ({ ...DEFAULT_PRICING_ASSUMPTIONS, ...(regua?.parametros || {}) }), [regua]);
  const assumptionsComOverride = useMemo(() => {
    const overrides = Object.fromEntries(
      Object.entries(custosManuais).filter(([, v]) => v !== "" && v != null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]),
    );
    return { ...(regua?.parametros || {}), ...overrides };
  }, [regua, custosManuais]);
  const houveOverride = Object.values(custosManuais).some((v) => v !== "" && v != null);
  const result = useMemo(
    () =>
      centralPricingEngine(
        productId,
        inputs,
        { assumptions: assumptionsComOverride, parameterVersion: (regua?.versao || "padrão") + (houveOverride ? " · custo ajustado" : "") },
      ),
    [inputs, productId, assumptionsComOverride, regua, houveOverride],
  );
  const outputs = productSpecificOutputs(productId, result);
  const decision = pricingDecisionSummary(result);
  const hasEnvironmentalInputs = Number(inputs.distanceKm || inputs.kmPerRoute || 0) > 0;
  const selectProduct = (nextProductId) => {
    // Navega em vez de só trocar estado: a URL passa a refletir o produto, e o
    // painel remonta (pelo `key`) já com as premissas do produto novo — o
    // mesmo reset que este método fazia à mão, agora dirigido pela rota.
    const busca = typeof window === "undefined" ? "" : window.location.search;
    navigate(`/todogreen/precificacao/${nextProductId}${busca}`);
  };
  const changeInput = (key, value) => {
    setInputs((current) => ({ ...current, [key]: value }));
    setPremissasConfirmadas(false);
    // Mudou a premissa, mudou a condição: o pedido de aprovação teria que ser
    // sobre a simulação nova, não sobre a que foi salva antes.
    setCenarioSalvoId("");
  };

  const pedirAprovacao = async () => {
    if (!cenarioSalvoId) return;
    setEnviandoAprovacao(true);
    try {
      const resposta = await fetch("/api/todogreen/deal-desk", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({
          cenarioId: cenarioSalvoId,
          cliente: inputs.client || "",
          justificativa: justificativaDeAprovacao,
        }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || "Não foi possível abrir o pedido.");
      setJustificativaDeAprovacao("");
      setToast?.("Pedido enviado para aprovação comercial. A proposta fica bloqueada até a decisão.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setEnviandoAprovacao(false);
    }
  };
  const camposDesenhados = new Set(blueprint.inputGroups.flatMap(([, fields]) => fields));
  const obrigatoriasForaDoFormulario = (product?.requiredFields || []).filter(
    (campo) => !camposDesenhados.has(campo),
  );
  const premissas = premissasDaSimulacao(product, inputs);
  const situacao = situacaoDoResultado(
    premissas,
    premissasConfirmadas,
    (campo) => fieldLabels[campo] || campo,
  );
  const saveScenario = () => {
    // Guarda no código, não só no `disabled` do botão: um atalho de teclado ou
    // uma chamada por fora não podem salvar cenário sem procedência.
    if (!situacao.podeSalvar) {
      setToast?.(situacao.resumo);
      return;
    }
    // A simulação salva nasce com a MESMA régua exibida na tela — snapshot e
    // resultado mostrado nunca podem divergir.
    const snapshot = createPricingScenarioSnapshot(
      productId,
      inputs,
      { userId: db?.user?.id || "local", tenantId: TODO_GREEN_TENANT.id, justification: `Simulação criada pela calculadora To Do Green (régua ${regua?.versao || "padrão"}${houveOverride ? ", com custos ajustados na simulação" : ""}).` },
      // O snapshot leva os MESMOS custos que a tela mostrou — incluindo os
      // ajustes manuais. Salvar a régua pura enquanto a tela usou outro custo
      // faria o histórico divergir do que a pessoa viu.
      { assumptions: assumptionsComOverride, parameterVersion: (regua?.versao || "padrão") + (houveOverride ? " · custo ajustado" : "") },
    );
    // A simulação vai para o banco, não para o JSON do espaço. Era daqui que
    // saía a gravação genérica que sobrescrevia o trabalho de quem estivesse
    // no mesmo espaço — e que o portal do cliente nunca enxergava.
    //
    // Aqui também ficava `tenantAccess.todogreen = { role: role || "admin" }`:
    // salvar simulação concedia acesso a quem salvou.
    setSalvando(true);
    criar("scenarios", {
      id: snapshot.id,
      productId,
      clientId: snapshot.clientId || inputs.clientId || "",
      opportunityId: sourceOpportunity?.id || "",
      ruleVersion: regua?.versao || "padrao",
      inputs,
      result: snapshot.result,
      approvals: snapshot.result?.approval || {},
      premissas: registroDaConfirmacao(situacao, { userId: db?.user?.id || "" }),
    })
      .then(() => {
        setCenarioSalvoId(snapshot.id);
        fetch(`/api/todogreen/audit?owner=${encodeURIComponent(ownerId())}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
          body: JSON.stringify({ action: "pricing_snapshot_created", target: snapshot.id, details: `Simulação ${product?.name || productId} salva.` }),
        }).catch(() => {});
        setToast?.("Simulação To Do Green salva");
      })
      // A falha aparece. Antes a chamada ao servidor era só auditoria e o
      // `.catch(() => {})` engolia qualquer erro — a tela dizia "salvo" mesmo
      // quando nada tinha sido salvo.
      .catch((razao) => setToast?.(razao.message))
      .finally(() => setSalvando(false));
  };
  if (!allowed) return <section className="tdg-panel"><h2>Sem permissão para simular</h2><p>Seu papel pode visualizar dados, mas não alterar premissas comerciais.</p></section>;
  return (
    <section className="tdg-panel tdg-pricing">
      <div className="tdg-section-head"><div><span className="tdg-kicker">CALCULAR PREÇO</span><h2>{blueprint.title}</h2><p>Preencha os dados da operação. O preço e a margem são atualizados automaticamente.</p></div><strong>{friendlyCommercialText(result.recommendation.decision)}</strong></div>
      <p className="tdg-esg-nota">
        {regua && !regua.deFabrica
          ? `Parâmetros ${regua.versao} · margem mínima ${regua.parametros.minimumMarginPercent}% · alvo ${regua.parametros.targetMarginPercent}% · ${regua.aplicados?.length || 1} regra(s) aplicada(s)`
          : "Usando os valores padrão de margem e custos. Um gestor pode definir os seus em Parâmetros do simulador."}
      </p>
      <div className="tdg-product-strip">{LOGISTICS_PRODUCTS.map((item) => <ProductCard product={item} active={item.id === productId} onSelect={selectProduct} key={item.id} />)}</div>
      <div className={`tdg-premissas tdg-premissas-${situacao.nivel}`} role="status">
        <strong>{situacao.rotulo}</strong>
        <p>{situacao.resumo}</p>
        {premissas.podeConfirmar && (
          <label className="tdg-check-field">
            <input
              type="checkbox"
              checked={premissasConfirmadas}
              onChange={(event) => setPremissasConfirmadas(event.target.checked)}
            />
            <span>Confirmo que estas premissas vieram do cliente ou de medição, e não de estimativa.</span>
          </label>
        )}
      </div>
      <div className="tdg-calculator-workspace">
        <form className="tdg-form">
          {/* Campo obrigatório que nenhum grupo do produto desenhou. O
              "middle-mile", por exemplo, exige o cliente e não tinha onde
              informá-lo — a premissa era impossível de completar, e antes
              isso não aparecia porque nada era exigido. */}
          {obrigatoriasForaDoFormulario.length > 0 && (
            <fieldset>
              <legend>Identificação</legend>
              {obrigatoriasForaDoFormulario.map((field) => (
                <FieldInput key={field} name={field} value={inputs[field]} required onChange={changeInput} inputs={inputs} />
              ))}
            </fieldset>
          )}
          {blueprint.inputGroups.map(([group, fields]) => (
            <fieldset key={group}><legend>{group}</legend>{fields.map((field) => <FieldInput key={field} name={field} value={inputs[field]} required={product?.requiredFields?.includes(field)} onChange={changeInput} inputs={inputs} />)}</fieldset>
          ))}
          {/* Custos da operação, editáveis aqui mesmo. Vêm da régua em vigor;
              ajustar sobrescreve só esta simulação. */}
          <fieldset className="tdg-custos-op">
            <legend>Custos da operação (motorista, energia, veículo)</legend>
            {[
              ["driverDailyCost", "Motorista por dia (R$)"],
              ["energyCostPerKm", "Energia por km (R$)"],
              ["vehicleMonthlyCost", "Veículo por mês (R$)"],
              ["vehicleDailyCost", "Veículo por dia (R$)"],
              ["maintenancePerKm", "Manutenção por km (R$)"],
            ].map(([campo, rotulo]) => (
              <label key={campo}>
                <span>{rotulo}</span>
                <input
                  type="number" min="0" step="0.01"
                  value={custosManuais[campo] ?? ""}
                  placeholder={String(custosEfetivos[campo] ?? 0)}
                  onChange={(e) => { setCustosManuais((c) => ({ ...c, [campo]: e.target.value })); setPremissasConfirmadas(false); setCenarioSalvoId(""); }}
                />
              </label>
            ))}
            <p className="tdg-custos-nota">{houveOverride ? "Usando custos ajustados só nesta simulação — a régua não muda." : "Em branco = usa a régua em vigor (valor cinza é o atual)."}</p>
          </fieldset>
          <fieldset><legend>Dados usados no cálculo</legend><FieldInput name="dataQuality" value={inputs.dataQuality} onChange={changeInput} /><FieldInput name="occupancyPercent" value={inputs.occupancyPercent} onChange={changeInput} /></fieldset>
        </form>
        <div
          className={`tdg-price-summary${situacao.nivel === NIVEIS.confirmada ? "" : " tdg-price-summary-provisorio"}`}
          aria-label={
            situacao.nivel === NIVEIS.confirmada
              ? "Resultado da precificação"
              : "Resultado provisório da precificação — premissas não confirmadas"
          }
        >
          <div><span>Custo mensal</span><strong>{BRL.format(result.loadedCost)}</strong><small>custo estimado da operação</small></div>
          <div><span>Piso</span><strong>{BRL.format(decision.floor)}</strong><small>abaixo disso perde margem ou viola regra</small></div>
          <div className="featured"><span>Preço recomendado</span><strong>{BRL.format(decision.recommended)}</strong><small>preço que devemos defender</small></div>
          <div><span>Preço estratégico</span><strong>{BRL.format(decision.strategic)}</strong><small>limite com justificativa comercial</small></div>
          <div className={result.marginPercent < 18 ? "risk" : "good"}><span>Margem estimada</span><strong>{number.format(result.marginPercent)}%</strong><small>{BRL.format(result.marginValue)} por mês</small></div>
        </div>
      </div>
      <div className="tdg-price-details">
        {Object.entries(outputs)
          .filter(([key]) => !["custoTotal", "precoMinimo", "precoRecomendado", "margem"].includes(key))
          .map(([key, value]) => <span key={key}><small>{outputLabels[key] || key.replace(/[A-Z]/g, " $&").toLowerCase()}</small><strong>{formatOutputValue(key, value)}</strong></span>)}
      </div>
      <section className="tdg-price-guidance">
        <div>
          <span className="tdg-kicker">RECOMENDAÇÃO: {decision.decision}</span>
          <h3>{BRL.format(decision.recommended)}</h3>
          <p>Defenda o preço recomendado. Abaixo de <strong>{BRL.format(decision.floor)}</strong>, a condição perde sustentação. O preço estratégico de <strong>{BRL.format(decision.strategic)}</strong> exige justificativa comercial.</p>
          {result.recommendation.reasons.length > 0 && <ul>{result.recommendation.reasons.map((reason) => <li key={reason}>{friendlyCommercialText(reason)}</li>)}</ul>}
        </div>
        <div className="tdg-environmental-summary">
          <span>Impacto ambiental estimado</span>
          {hasEnvironmentalInputs ? <><strong>{number.format(result.impact.co2AvoidedKg / 1000)} t de CO₂ evitadas</strong><small>{number.format(result.impact.reductionPercent)}% de redução em relação à referência informada</small></> : <><strong>Aguardando dados da rota</strong><small>Informe a quilometragem e o veículo de referência para calcular a redução de emissões.</small></>}
        </div>
      </section>
      <div className="tdg-price-details" aria-label="Indicadores da decisão comercial">
        <span><small>Margem</small><strong>{number.format(decision.marginPercent)}%</strong></span>
        <span><small>Payback</small><strong>{decision.paybackMonths ? `${number.format(decision.paybackMonths)} meses` : "Não aplicável"}</strong></span>
        <span><small>Capacidade</small><strong>{decision.capacity}</strong></span>
        <span><small>Risco principal</small><strong>{friendlyCommercialText(decision.risk)}</strong></span>
        <span><small>CO₂</small><strong>{hasEnvironmentalInputs ? `${number.format(decision.co2AvoidedKg / 1000)} t evitadas` : "Aguardando rota"}</strong></span>
        <span><small>Aprovação necessária</small><strong>{friendlyCommercialText(decision.approval)}</strong></span>
      </div>
      <details className="tdg-calculation-details"><summary>Ver documentos necessários e detalhes do cálculo</summary><div className="tdg-method"><strong>Documentos necessários</strong><p>{blueprint.requiredEvidence.join(" · ")}</p><small>Relatórios: {blueprint.executiveOutputs.join(" · ")}</small></div></details>
      {result.approval.required && (
        // Antes isto era só um aviso: a tela dizia que precisava de aprovação e
        // a simulação era salva do mesmo jeito. Agora o aviso vem com o caminho.
        <div className="tdg-alert" role="status">
          <AlertTriangle size={18} />
          <span>Esta condição precisa de aprovação comercial: {result.approval.triggers.join(", ")}.</span>
        </div>
      )}
      {result.approval.required && (
        <div className="tdg-dd-pedido">
          <label>
            <span>Justificativa comercial para aprovação</span>
            <input
              value={justificativaDeAprovacao}
              onChange={(event) => setJustificativaDeAprovacao(event.target.value)}
              placeholder="Por que vale a pena aceitar esta condição fora da régua"
            />
          </label>
          <button
            type="button"
            className="tdg-action"
            disabled={!cenarioSalvoId || justificativaDeAprovacao.trim().length < 20 || Boolean(enviandoAprovacao)}
            onClick={pedirAprovacao}
          >
            <ShieldCheck size={16} />
            {enviandoAprovacao ? "Enviando..." : "Enviar para aprovação"}
          </button>
          <small>
            {!cenarioSalvoId
              ? "Salve a simulação antes: a aprovação é sobre a condição exata, não sobre o cliente."
              : "A alçada, o prazo e o desvio são calculados a partir desta simulação e da régua vigente."}
          </small>
        </div>
      )}
      <div className="tdg-pricing-actions">
        <button className="tdg-action" type="button" onClick={saveScenario} disabled={!situacao.podeSalvar || salvando}>
          <Plus size={17} />{salvando ? "Salvando..." : "Salvar simulação"}
        </button>
        {!situacao.podeSalvar && <small>{situacao.resumo}</small>}
      </div>
      <Suspense fallback={<p>Carregando planejado × realizado...</p>}><PricingPerformancePanel authHeaders={authHeaders} canManage={hasTodoGreenPermission(role, "pricing:manage")} setToast={setToast} /></Suspense>
    </section>
  );
}

const rotuloDoCenario = (item, clients = []) => {
  const nome = clients.find((client) => client.id === item.clientId)?.name || item.inputs?.client || item.clientId || "Cliente não identificado";
  const produto = item.result?.productName || item.productId || "Produto não informado";
  const dateValue = item.criadoEm || item.createdAt;
  const dataCriacao = dateValue && !Number.isNaN(Date.parse(dateValue))
    ? new Date(dateValue).toLocaleDateString("pt-BR")
    : "sem data";
  return `${nome} · ${produto} · ${dataCriacao}`;
};

const propostaAceita = (proposal) => ["accepted", "approved", "aceita", "aprovada"].includes(String(proposal?.status || proposal?.situacao || "").toLowerCase());
const escaparHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function ProposalPanel({ data, criar, atualizar, pedidosDeAprovacao = [], setToast }) {
  // A proposta é o documento que sai da empresa. Ela só pode nascer de uma
  // simulação cujas premissas alguém declarou como vindas do cliente ou de
  // medição — não da última simulação qualquer que passou pela tela.
  // `data.pricingScenarios` já chega filtrado: só entra ali o que tem
  // procedência. O que sobrou de fora vem contado à parte, para a tela poder
  // dizer por que a proposta não sai em vez de fingir que não há simulação.
  const cenariosDisponiveis = (data.pricingScenarios || []).filter(cenarioConfirmado);
  const [cenarioId, setCenarioId] = useState("");
  const latest = cenariosDisponiveis.find((item) => item.id === cenarioId) || cenariosDisponiveis[0];
  const oportunidade = (data.opportunities || []).find((item) => item.id === latest?.opportunityId);
  const clienteId = latest?.clientId || oportunidade?.clientId || "";
  const cliente = (data.clients || []).find((item) => item.id === clienteId);
  const nomeCliente = cliente?.name || oportunidade?.cliente || oportunidade?.clientName || "";
  const existemNaoConfirmadas = !latest && Number(data.simulacoesSemProcedencia || 0) > 0;
  // O Deal Desk manda por cima da confirmação de premissas: premissa
  // confirmada com condição fora da régua ainda depende de aprovação.
  const liberacao = liberacaoDaProposta(latest?.id, pedidosDeAprovacao);
  const podeSalvar = Boolean(latest) && liberacao.liberada;
  const translated = esgTranslator(latest?.result?.impact?.co2AvoidedKg || 0);
  const [form, setForm] = useState({ title: "Proposta logística sustentável", scope: "", commercialTerms: "", risks: "" });
  const proposalText = latest
    ? `Proposta ${latest.result.productName}: preço recomendado ${BRL.format(latest.result.recommendedPrice)}, margem estimada ${number.format(latest.result.marginPercent)}%, CO2 evitado estimado de ${number.format(latest.result.impact.co2AvoidedKg / 1000)} tCO2e. ${translated.proposalText}`
    : existemNaoConfirmadas
      ? "As simulações existentes ainda estão como hipótese. Abra Precificação, confirme as premissas e salve. Só então o preço e o ESG podem virar proposta."
      : "Nenhuma simulação confirmada disponível para proposta.";
  const [salvando, setSalvando] = useState(false);
  const propostasAceitas = (data.proposals || []).filter(propostaAceita);
  const [propostaContratoId, setPropostaContratoId] = useState("");
  const propostaContrato = propostasAceitas.find((item) => item.id === propostaContratoId) || propostasAceitas[0];
  const contratoVazio = { titulo: "Contrato de operação logística", inicioEm: "", fimEm: "", valorMensal: "", tipoCobranca: "mensal", valorTotal: "", termos: "", assinatura: "pending", aprovacao: "pending", renovacao: "manual", avisoRenovacaoEm: "", diaFaturamento: "", antecedenciaAvisoDias: "60", servicoId: "", tabelaPrecoId: "", indiceReajuste: "", dataBaseReajuste: "", compromissoMinimo: "", slaPrazoHoras: "", prazoPagamentoDias: "", aliquotaImposto: "", eventoFaturamento: "delivery" };
  const [contrato, setContrato] = useState(contratoVazio);
  const [salvandoContrato, setSalvandoContrato] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    if (!latest) {
      setToast?.("Sem simulação com premissas confirmadas, a proposta não pode ser gerada.");
      return;
    }
    // Guarda no código, não só no `disabled`: era exatamente aqui que faltava
    // impedimento — o Deal Desk avisava e a proposta saía do mesmo jeito.
    if (!liberacao.liberada) {
      setToast?.(liberacao.motivo);
      return;
    }
    setSalvando(true);
    try {
      await criar("proposals", {
        clientId: clienteId,
        cliente: nomeCliente,
        oportunidadeId: latest.opportunityId || "",
        titulo: form.title,
        escopo: form.scope,
        condicoes: form.commercialTerms,
        riscos: form.risks,
        texto: proposalText,
        cenarioId: latest.id,
      });
      setForm({ title: "Proposta logística sustentável", scope: "", commercialTerms: "", risks: "" });
      setToast?.("Proposta To Do Green salva");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };
  const aceitarProposta = async (proposal) => {
    try {
      await atualizar("proposals", proposal.id, { situacao: "accepted", revision: proposal.revision });
      setToast?.("Proposta marcada como aceita. O contrato já pode ser gerado.");
    } catch (error) { setToast?.(error.message); }
  };
  const baixarProposta = (proposal) => {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escaparHtml(proposal.title)}</title><style>body{font:16px/1.55 system-ui;margin:48px auto;max-width:760px;color:#17372d}h1{color:#075c45}section{margin:28px 0}small{color:#547067}</style><body><small>To Do Green · proposta vinculada ${escaparHtml(proposal.id)}</small><h1>${escaparHtml(proposal.title)}</h1><p><strong>Cliente:</strong> ${escaparHtml(proposal.client)}</p><section><h2>Proposta</h2><p>${escaparHtml(proposal.proposalText)}</p></section><section><h2>Escopo</h2><p>${escaparHtml(proposal.scope)}</p><h2>Condições comerciais</h2><p>${escaparHtml(proposal.commercialTerms)}</p><h2>Riscos e ressalvas</h2><p>${escaparHtml(proposal.risks)}</p></section><small>Gerada a partir da simulação ${escaparHtml(proposal.scenarioId)}. Valide termos, evidências e aprovações antes do envio.</small></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `proposta-${String(proposal.client || proposal.id).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const salvarContrato = async (event) => {
    event.preventDefault();
    if (!propostaContrato) { setToast?.("Aceite uma proposta antes de gerar o contrato."); return; }
    setSalvandoContrato(true);
    try {
      await criar("contracts", {
        clientId: propostaContrato.clientId,
        cliente: propostaContrato.client,
        oportunidadeId: propostaContrato.opportunityId,
        propostaId: propostaContrato.id,
        cenarioId: propostaContrato.scenarioId,
        ...contrato,
        valorMensal: Number(contrato.valorMensal || 0),
        valorTotal: Number(contrato.valorTotal || 0),
        compromissoMinimo: Number(contrato.compromissoMinimo || 0),
        // A OS lê isto do fields_json do contrato para saber se o valor
        // negociado é mensal (não multiplica) ou por unidade (× quantidade).
        campos: { pricingMode: contrato.tipoCobranca === "por_unidade" ? "por_unidade" : "mensal" },
        sla: { prazoEntregaHoras: Number(contrato.slaPrazoHoras || 0) },
        condicoesComerciais: { prazoPagamentoDias: Number(contrato.prazoPagamentoDias || 0) },
        impostos: { aliquotaPercentual: Number(contrato.aliquotaImposto || 0) },
        regrasFaturamento: { evento: contrato.eventoFaturamento },
        situacao: "draft",
      });
      setContrato(contratoVazio);
      setToast?.("Contrato criado e vinculado à proposta, oportunidade e cliente.");
    } catch (error) { setToast?.(error.message); }
    finally { setSalvandoContrato(false); }
  };
  const mudarContrato = async (item, changes, message) => {
    try {
      await atualizar("contracts", item.id, { ...changes, revision: item.revision, nota: message });
      setToast?.(message);
    } catch (error) { setToast?.(error.message); }
  };
  return (
    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">PROPOSTAS</span><h2>Proposta comercial com preço, operação e ROI ambiental</h2></div><strong>{data.proposals.length} proposta(s)</strong></div>
      <form className="tdg-access-form" onSubmit={save}>
        <label><span>Simulação confirmada</span><select value={latest?.id || ""} onChange={(event) => setCenarioId(event.target.value)} disabled={!cenariosDisponiveis.length}><option value="">Selecione</option>{cenariosDisponiveis.map((item) => <option value={item.id} key={item.id}>{rotuloDoCenario(item, data.clients || [])}</option>)}</select></label>
        <label><span>Cliente vinculado</span><input value={nomeCliente || "Cliente não identificado"} readOnly /></label>
        {[ ["title", "Título"], ["scope", "O que está incluído na operação"], ["commercialTerms", "Condições comerciais"], ["risks", "Riscos e ressalvas"]].map(([key, label]) => <label key={key}><span>{label}</span><input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <button className="tdg-action" type="submit" disabled={!podeSalvar || !clienteId || !nomeCliente || salvando}><Plus size={17} />{salvando ? "Salvando..." : "Salvar proposta"}</button>
      </form>
      {latest && (!clienteId || !nomeCliente) && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>A simulação não está vinculada a um cliente válido. Abra a oportunidade, confirme o cliente e gere uma nova simulação.</span></div>}
      {latest && !liberacao.liberada && (
        <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{liberacao.motivo}</span></div>
      )}
      {latest && liberacao.liberada && liberacao.pedido && (
        <p className="tdg-esg-nota">{liberacao.motivo}</p>
      )}
      <div className="tdg-method"><strong>Prévia da proposta</strong><p>{proposalText}</p><small>Valide preço, escopo, evidências ESG e aprovações antes do envio.</small></div>
      <div className="tdg-access-list">{data.proposals.map((item) => <div className="tdg-access-row" key={item.id}><span><strong>{item.title}</strong><small>{item.client || "cliente não informado"}</small></span><span>{propostaAceita(item) ? "aceita" : item.scenarioId ? "com simulação" : "rascunho"}</span><button type="button" onClick={() => baixarProposta(item)}>Baixar documento</button>{!propostaAceita(item) && <button type="button" onClick={() => aceitarProposta(item)}>Registrar aceite</button>}</div>)}</div>
      <div className="tdg-section-head"><div><span className="tdg-kicker">CONTRATOS</span><h2>Gerar contrato a partir de proposta aceita</h2></div><strong>{data.contracts.length} contrato(s)</strong></div>
      <form className="tdg-access-form" onSubmit={salvarContrato}>
        <label><span>Proposta aceita</span><select value={propostaContrato?.id || ""} onChange={(event) => setPropostaContratoId(event.target.value)}><option value="">Selecione</option>{propostasAceitas.map((item) => <option key={item.id} value={item.id}>{item.client || "Cliente"} · {item.title}</option>)}</select></label>
        <label><span>Título</span><input value={contrato.titulo} onChange={(event) => setContrato((current) => ({ ...current, titulo: event.target.value }))} /></label>
        <label><span>Início</span><input type="date" value={contrato.inicioEm} onChange={(event) => setContrato((current) => ({ ...current, inicioEm: event.target.value }))} /></label>
        <label><span>Fim</span><input type="date" value={contrato.fimEm} onChange={(event) => setContrato((current) => ({ ...current, fimEm: event.target.value }))} /></label>
        <label><span>Valor negociado</span><input type="number" value={contrato.valorMensal} onChange={(event) => setContrato((current) => ({ ...current, valorMensal: event.target.value }))} /></label>
        <label><span>Tipo de cobrança</span><select value={contrato.tipoCobranca} onChange={(event) => setContrato((current) => ({ ...current, tipoCobranca: event.target.value }))}><option value="mensal">Mensal (operação dedicada)</option><option value="por_unidade">Por viagem/entrega</option></select><small>Decide como a OS usa o valor: "mensal" é fechado no período; "por viagem" multiplica pela quantidade.</small></label>
        <label><span>Valor total</span><input type="number" value={contrato.valorTotal} onChange={(event) => setContrato((current) => ({ ...current, valorTotal: event.target.value }))} /></label>
        <label><span>Serviço</span><input value={contrato.servicoId} onChange={(event) => setContrato((current) => ({ ...current, servicoId: event.target.value }))} placeholder="Código do serviço" /></label>
        <label><span>Tabela de preço</span><input value={contrato.tabelaPrecoId} onChange={(event) => setContrato((current) => ({ ...current, tabelaPrecoId: event.target.value }))} placeholder="Código da tabela" /></label>
        <label><span>SLA de entrega</span><input type="number" min="0" value={contrato.slaPrazoHoras} onChange={(event) => setContrato((current) => ({ ...current, slaPrazoHoras: event.target.value }))} placeholder="Horas" /></label>
        <label><span>Prazo de pagamento</span><input type="number" min="0" value={contrato.prazoPagamentoDias} onChange={(event) => setContrato((current) => ({ ...current, prazoPagamentoDias: event.target.value }))} placeholder="Dias" /></label>
        <label><span>Imposto estimado</span><input type="number" min="0" step="0.01" value={contrato.aliquotaImposto} onChange={(event) => setContrato((current) => ({ ...current, aliquotaImposto: event.target.value }))} placeholder="%" /></label>
        <label><span>Compromisso mínimo</span><input type="number" min="0" step="0.01" value={contrato.compromissoMinimo} onChange={(event) => setContrato((current) => ({ ...current, compromissoMinimo: event.target.value }))} /></label>
        <label><span>Índice de reajuste</span><input value={contrato.indiceReajuste} onChange={(event) => setContrato((current) => ({ ...current, indiceReajuste: event.target.value }))} placeholder="Ex.: IPCA" /></label>
        <label><span>Data-base do reajuste</span><input type="date" value={contrato.dataBaseReajuste} onChange={(event) => setContrato((current) => ({ ...current, dataBaseReajuste: event.target.value }))} /></label>
        <label><span>Gatilho do faturamento</span><select value={contrato.eventoFaturamento} onChange={(event) => setContrato((current) => ({ ...current, eventoFaturamento: event.target.value }))}><option value="delivery">Entrega concluída</option><option value="monthly">Fechamento mensal</option><option value="milestone">Marco contratual</option></select></label>
        <label><span>Termos e condições</span><input value={contrato.termos} onChange={(event) => setContrato((current) => ({ ...current, termos: event.target.value }))} /></label>
        <label><span>Renovação</span><select value={contrato.renovacao} onChange={(event) => setContrato((current) => ({ ...current, renovacao: event.target.value }))}><option value="manual">Manual</option><option value="automatic">Automática</option><option value="none">Sem renovação</option></select></label>
        <label><span>Aviso de renovação</span><input type="date" value={contrato.avisoRenovacaoEm} onChange={(event) => setContrato((current) => ({ ...current, avisoRenovacaoEm: event.target.value }))} /></label>
        <label><span>Dia de faturamento</span><input type="number" min="1" max="31" value={contrato.diaFaturamento} onChange={(event) => setContrato((current) => ({ ...current, diaFaturamento: event.target.value }))} /></label>
        <label><span>Antecedência do aviso</span><input type="number" min="0" max="365" value={contrato.antecedenciaAvisoDias} onChange={(event) => setContrato((current) => ({ ...current, antecedenciaAvisoDias: event.target.value }))} /></label>
        <button className="tdg-action" type="submit" disabled={!propostaContrato || salvandoContrato}><FileCheck size={17} />{salvandoContrato ? "Gerando..." : "Gerar contrato"}</button>
      </form>
      <div className="tdg-access-list">{data.contracts.map((item) => <div className="tdg-access-row" key={item.id}><span><strong>{item.title}</strong><small>{item.client || "cliente não informado"} · versão {item.version || 1} · {item.serviceId || "serviço pendente"} · mínimo {BRL.format(item.minimumCommitment || 0)}</small></span><span>{item.approvalStatus === "approved" ? "aprovado" : "aprovação pendente"}</span><span>{item.signatureStatus === "signed" ? "assinado" : item.signatureStatus === "sent" ? "aguardando assinatura" : "assinatura pendente"}</span>{item.approvalStatus !== "approved" && <button type="button" onClick={() => mudarContrato(item, { aprovacao: "approved" }, "Contrato aprovado e liberado para assinatura.")}>Aprovar</button>}{item.signatureStatus === "pending" && <button type="button" onClick={() => mudarContrato(item, { assinatura: "sent" }, "Envio para assinatura registrado. Nenhuma mensagem externa foi disparada.")}>Registrar envio</button>}{item.signatureStatus === "sent" && <button type="button" onClick={() => mudarContrato(item, { assinatura: "signed", assinadoEm: new Date().toISOString(), situacao: "active" }, "Assinatura confirmada e contrato ativado.")}>Confirmar assinatura</button>}</div>)}</div>
    </section>
  );
}

function EsgPanel({ dashboard, data, onNavigate }) {
  const translator = esgTranslator(dashboard.co2Evitado);
  const latest = data.pricingScenarios[0]?.result?.impact;
  const hasImpact = Number(dashboard.co2Evitado || 0) > 0 || Boolean(latest);
  const dataState = hasImpact ? "Impacto calculado" : "Sem simulação validada";
  const nextActions = hasImpact
    ? [
        ["Emitir relatório", "/todogreen/relatorios"],
        ["Abrir evidências", "/todogreen/documentos"],
        ["Revisar metodologia", "/todogreen/metodologia"],
      ]
    : [
        ["Gerar simulação", "/todogreen/precificacao"],
        ["Parâmetros ESG", "/todogreen/parametros-simulador"],
        ["Ver oportunidades", "/todogreen/oportunidades"],
      ];
  return (
    <section className={`tdg-panel tdg-esg tdg-esg-ops ${hasImpact ? "" : "empty"}`}>
      <div className="tdg-esg-command">
        <div>
          <span className="tdg-kicker">ESG OPERACIONAL</span>
          <h2>Green Score e emissões</h2>
          <p>{hasImpact ? "Resultado ambiental ligado a simulações, evidências e relatórios." : "Calcule uma simulação confirmada para liberar números ambientais auditáveis."}</p>
        </div>
        <strong>{dataState}</strong>
      </div>
      <div className="tdg-esg-layout">
        <div className={`tdg-esg-score${hasImpact ? "" : " pending"}`}>
          <span>Green Score</span>
          <strong>{hasImpact ? number.format(dashboard.greenScore) : "Pendente"}</strong>
          <small>{hasImpact ? "Indicador proprietário, não certificação" : "Depende de preço, rota, distância e evidências"}</small>
        </div>
        <div className="tdg-result tdg-esg-kpis">
          <MetricCard label="CO2 evitado" value={hasImpact ? `${number.format(dashboard.co2Evitado / 1000)} t` : "Pendente"} detail="com memória de cálculo" tone={hasImpact ? "good" : "neutral"} />
          <MetricCard label="Diesel evitado" value={hasImpact ? `${number.format(dashboard.dieselNaoConsumido)} L` : "Pendente"} detail="comparação operacional" />
          <MetricCard label="Redução" value={hasImpact ? `${number.format(dashboard.reducaoEmissoesPercent)}%` : "Pendente"} detail="vs referência" />
        </div>
        <aside className="tdg-esg-next">
          <strong>Próximas ações</strong>
          {nextActions.map(([label, route]) => (
            <button type="button" onClick={() => onNavigate?.(route)} key={route}>{label}<ArrowRight size={14} /></button>
          ))}
        </aside>
      </div>
      {hasImpact ? <div className="tdg-method"><strong>Texto para proposta</strong><p>{translator.proposalText}</p><small>{translator.disclaimer}</small></div> : <div className="tdg-method tdg-esg-empty-state"><strong>Sem número publicado</strong><p>Evitei mostrar zero como resultado. Zero aqui significa ausência de simulação confirmada, não ausência de impacto.</p><small>Use Precificação para gerar a memória de cálculo e depois publique relatório.</small></div>}
      <div className="tdg-output-grid">
        <span><small>Versão metodologia</small><strong>{latest?.methodologyVersion || "tdg-env-v1"}</strong></span>
        <span><small>Fórmula</small><strong>{latest?.formula || "Aguardando simulação"}</strong></span>
        <span><small>Unidades</small><strong>{latest?.units || "kgCO2e, litros, km, kWh"}</strong></span>
      </div>
    </section>
  );
}

function MethodologyPanel() {
  const rows = LOGISTICS_PRODUCTS.map((product) => ({ product, blueprint: getProductPricingBlueprint(product.id) }));
  return (
    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">METODOLOGIA</span><h2>Premissas, evidências e rastreabilidade por produto</h2></div><strong>tdg-env-v1</strong></div>
      <div className="tdg-access-list">{rows.map(({ product, blueprint }) => <div className="tdg-access-row" key={product.id}><span><strong>{product.name}</strong><small>{blueprint.requiredEvidence.join(" · ")}</small></span><span>{blueprint.pricingUnit}</span></div>)}</div>
      <div className="tdg-method"><strong>Regra de dados</strong><p>{TODO_GREEN_PRODUCTION_DATA_POLICY.rule}</p><small>Estimativas ESG não são certificação oficial; servem como memória de cálculo comercial e operacional.</small></div>
    </section>
  );
}

function AccessPanel({ role, permissions, authHeaders, setToast }) {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [form, setForm] = useState({ email: "", role: "admin", note: "", expiresAt: "", customPermissions: false, permissions: [] });
  const canManage = hasTodoGreenPermission(role, "access:manage", permissions);
  const load = useCallback(() => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    setLoading(true);
    fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}`, { headers })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os acessos.");
        setEmails(payload.emails || []);
        setLoadedAt(Date.now());
      })
      .catch((error) => setToast?.(error.message))
      .finally(() => setLoading(false));
  }, [authHeaders, canManage, setToast]);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => {
    event.preventDefault();
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    setSaving(true);
    try {
      const body = {
        email: form.email,
        role: form.role,
        note: form.note,
        ...(form.customPermissions ? { permissions: form.permissions } : {}),
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59.999Z`).toISOString() : "",
      };
      const response = await fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o acesso.");
      setForm({ email: "", role: "admin", note: "", expiresAt: "", customPermissions: false, permissions: [] });
      setToast?.("E-mail autorizado na To Do Green");
      load();
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setSaving(false);
    }
  };
  const alternarPermissao = (permission) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(permission)
      ? current.permissions.filter((item) => item !== permission)
      : [...current.permissions, permission],
  }));
  const selecionarPerfilAtual = () => setForm((current) => ({
    ...current,
    permissions: (TODO_GREEN_PERMISSIONS[current.role] || []).filter((item) => item !== "*"),
  }));
  const remove = async (email) => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    if (!confirm(`Remover o acesso de ${email}?`)) return;
    try {
      const response = await fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}&email=${encodeURIComponent(email)}`, { method: "DELETE", headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível remover o acesso.");
      load();
      setToast?.("Acesso revogado e preservado na auditoria");
    } catch (error) {
      setToast?.(error.message);
    }
  };
  if (!canManage) return <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">ACESSOS</span><h2>Você tem acesso, mas não pode gerenciar usuários.</h2></div><strong>{role || "sem papel"}</strong></div></section>;
  return (
    <section className="tdg-panel tdg-access-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">ACESSOS</span><h2>Autorize usuários por perfil pronto ou selecione cada funcionalidade.</h2></div><strong>{loading ? "carregando" : `${emails.length} e-mail(s)`}</strong></div>
      <form className="tdg-access-form" onSubmit={save}>
        <label><span>E-mail autorizado</span><input value={form.email} type="email" required placeholder="nome@empresa.com.br" onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <label><span>Perfil base</span><select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>{TODO_GREEN_ROLES.filter((item) => item !== "owner").map((item) => <option value={item} key={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
        <label><span>Tipo de acesso</span><select value={form.customPermissions ? "custom" : "profile"} onChange={(event) => setForm((current) => ({ ...current, customPermissions: event.target.value === "custom", permissions: event.target.value === "custom" ? (TODO_GREEN_PERMISSIONS[current.role] || []).filter((item) => item !== "*") : [] }))}><option value="profile">Perfil pronto</option><option value="custom">Funcionalidades selecionadas</option></select></label>
        <label><span>Validade</span><input type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} /><small>Vazio mantém o acesso sem expiração.</small></label>
        <label><span>Observação</span><input value={form.note} placeholder="Ex.: implantação, auditor externo" onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
        {form.customPermissions && <div className="tdg-permission-editor"><div className="tdg-permission-editor-head"><strong>Funcionalidades liberadas</strong><button type="button" onClick={selecionarPerfilAtual}>Restaurar perfil base</button></div>{TODO_GREEN_PERMISSION_CATALOG.map((group) => <fieldset key={group.group}><legend>{group.group}</legend>{group.items.map(([permission, label]) => <label className="tdg-check-field" key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={() => alternarPermissao(permission)} /><span>{label}</span></label>)}</fieldset>)}</div>}
        <button className="tdg-action" type="submit" disabled={saving || (form.customPermissions && !form.permissions.includes("read"))}><Plus size={17} />{saving ? "Salvando..." : "Autorizar"}</button>
      </form>
      {form.customPermissions && !form.permissions.includes("read") && <div className="tdg-alert"><AlertTriangle size={17} />Selecione “Acessar a vertical” para liberar a entrada.</div>}
      <div className="tdg-access-list">{emails.length === 0 && <div className="tdg-empty-access"><ShieldCheck size={18} />Nenhum e-mail autorizado ainda.</div>}{emails.map((item) => { const expired = item.expiresAt && loadedAt > 0 && Date.parse(item.expiresAt) <= loadedAt; const active = item.status === "active" && !item.revokedAt && !expired; const defaults = TODO_GREEN_PERMISSIONS[item.role] || []; const customized = !defaults.includes("*") && JSON.stringify([...(item.permissions || [])].sort()) !== JSON.stringify([...defaults].sort()); return <div className="tdg-access-row" key={item.email}><span><strong>{item.email}</strong><small>{item.note || "sem observação"}{item.lastAccessAt ? ` · último acesso ${new Date(item.lastAccessAt).toLocaleString("pt-BR")}` : ""}</small></span><span>{item.role.replace(/_/g, " ")}<small>{customized ? `${item.permissions?.length || 0} funcionalidades` : "perfil pronto"}</small></span><span className={active ? "good" : ""}>{active ? item.expiresAt ? `ativo até ${new Date(item.expiresAt).toLocaleDateString("pt-BR")}` : "ativo" : item.revokedAt ? "revogado" : expired ? "expirado" : "inativo"}</span>{active && <button type="button" onClick={() => remove(item.email)} aria-label={`Revogar ${item.email}`}><Trash2 size={17} /></button>}</div>; })}</div>
    </section>
  );
}

export default function LogisticsVertical({ db, update, setToast, access = {}, authHeaders }) {
  const [path, setPath] = useState(todoGreenPath());
  const [query, setQuery] = useState("");
  // O modo de navegação (por área × por funcionalidade) é preferência de quem
  // usa: persiste igual ao menu oculto, para não voltar a "área" a cada refresh.
  // Menu em acordeão (pedido da titular): áreas na frente; dentro de cada
  // área, o segundo nível com as funcionalidades dela. A área da tela atual
  // abre sozinha; as que a pessoa abrir à mão ficam na sessão.
  const [areasAbertas, setAreasAbertas] = useState(() => new Set());
  const abrirArea = useCallback((id) => {
    setAreasAbertas((atual) => (atual.has(id) ? atual : new Set([...atual, id])));
  }, []);
  const alternarArea = useCallback((id) => {
    setAreasAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      return proximo;
    });
  }, []);
  const [navigationQuery, setNavigationQuery] = useState("");
  // Esconder o menu lateral (persistido) — dá tela cheia ao conteúdo quando preciso.
  const [menuOculto, setMenuOculto] = useState(() => {
    try { return localStorage.getItem("todogreen-menu-oculto") === "1"; } catch { return false; }
  });
  const alternarMenu = useCallback(() => {
    setMenuOculto((atual) => {
      const proximo = !atual;
      try { localStorage.setItem("todogreen-menu-oculto", proximo ? "1" : "0"); } catch { /* ignora */ }
      return proximo;
    });
  }, []);
  // `access` chega vazio hoje; se um dia vier preenchido, ainda precisa passar
  // pela mesma leitura — a origem é que decide, não o formato.
  const [remoteAccess, setRemoteAccess] = useState(() => lerRespostaDeAcesso(access) || {});
  const [estadoDoAcesso, setEstadoDoAcesso] = useState(() =>
    lerRespostaDeAcesso(access) ? ACESSO.liberado : ACESSO.verificando,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setPath(todoGreenPath());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const headers = authHeaders?.() || {};
    // Sem sessão não há o que confirmar: nega direto em vez de ficar num
    // "verificando" que nunca termina.
    if (!headers.authorization) {
      setRemoteAccess({});
      setEstadoDoAcesso(ACESSO.negado);
      return undefined;
    }
    let ativo = true;
    setEstadoDoAcesso(ACESSO.verificando);
    fetch(`/api/todogreen/access?owner=${encodeURIComponent(ownerId())}`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!ativo) return;
        const confirmado = lerRespostaDeAcesso(payload);
        setRemoteAccess(confirmado || {});
        setEstadoDoAcesso(confirmado ? ACESSO.liberado : ACESSO.negado);
      })
      // Rede fora do ar, 500, resposta ilegível: todos significam "não sei".
      // Não saber é motivo para fechar, nunca para manter aberto.
      .catch(() => {
        if (!ativo) return;
        setRemoteAccess({});
        setEstadoDoAcesso(ACESSO.negado);
      });
    return () => { ativo = false; };
  }, [authHeaders]);
  const allowed = estadoDoAcesso === ACESSO.liberado;
  const role = allowed ? remoteAccess.role || "" : "";
  const page = todoGreenRouteToPage(path);
  const secaoDeCadastro = secaoDaRota(path);
  const primaryNavigation = navigationFor(page, secaoDeCadastro);
  const isOverview = page === "dashboard";
  const isWorkCenter = String(path).includes("/central-trabalho");
  const activeManagement = isWorkCenter
    ? MANAGEMENT_TOOLS[0]
    : MANAGEMENT_TOOLS.find((item) => item.id === page) || null;
  const currentPage = activeManagement || MODULE_IMPLEMENTATION[page] || MODULE_IMPLEMENTATION.dashboard;
  const trilha = trilhaDaPagina(page, secaoDeCadastro);
  // A permissão da tela é conferida AQUI, na rota, e não só no menu: o menu
  // esconde o botão, mas voltar no histórico, atualizar ou digitar a URL
  // chegam à tela sem passar por ele. A fonte é a mesma que o menu usa.
  const permissaoNecessaria = activeManagement ? activeManagement.permission : permissaoDaPagina(page);
  const podeVerPagina = podeAcessarFuncionalidade(role, remoteAccess.permissions, permissaoNecessaria);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.title = `${currentPage.title} | To Do Green`;
    return undefined;
  }, [currentPage.title]);
  const catalogRequested = new URLSearchParams(path.split("?")[1] || "").get("ferramentas") === "1";
  // A vertical inteira numa chamada só, e só depois que o acesso foi
  // confirmado: pedir os registros antes disso seria bater no servidor para
  // ouvir 403.
  const {
    dados: registros,
    erro: erroDosRegistros,
    criar,
    atualizar,
    arquivar,
    registrarPagamento,
    estornarPagamento,
    registrarEventoOperacao,
    listarSubrecurso,
  } = useVerticalRecords(authHeaders, { ativo: allowed });
  // Os pedidos ao Deal Desk. A proposta precisa deles para saber se sai — e a
  // decisão de sair ou não é do servidor, não de um estado local.
  const [pedidosDeAprovacao, setPedidosDeAprovacao] = useState([]);
  useEffect(() => {
    if (!allowed) return undefined;
    let vivo = true;
    fetch("/api/todogreen/deal-desk", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setPedidosDeAprovacao(d?.pedidos || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [allowed, authHeaders]);
  // Clientes continuam vindo do serviço deles: é lá que mora a regra de
  // carteira, e reescrevê-la aqui seria criar uma segunda regra de quem
  // enxerga quem.
  const [clientes, setClientes] = useState([]);
  useEffect(() => {
    if (!allowed) return undefined;
    let vivo = true;
    fetch("/api/todogreen/clients", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setClientes(d?.clientes || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [allowed, authHeaders]);
  const verticalData = useMemo(
    () => montarDadosDaVertical(registros, clientes, db, remoteAccess),
    [registros, clientes, db, remoteAccess],
  );
  const dashboard = useMemo(() => summarizeTodoGreenDashboard(verticalData), [verticalData]);
  // Um cartão por tela. O catálogo continua com o vocabulário todo — é ele que
  // faz a busca por "motorista" ou "forecast" achar alguma coisa — mas a tela
  // deixa de mostrar sete nomes que abrem o mesmo lugar.
  const gruposDeTela = useMemo(
    () => agruparModulosPorTela(TODO_GREEN_MODULE_CATALOG, TITULOS_POR_TELA),
    [],
  );
  const modulesByArea = TODO_GREEN_MODULE_AREAS.map((area) => ({
    ...area,
    grupos: ordenarPorRelevancia(
      gruposDeTela.filter(
        (grupo) => grupo.area === area.id && grupoAtendeBusca(grupo, query),
      ),
      query,
    ),
  }));
  const functionNavigation = useMemo(
    () => ordenarPorRelevancia(
      gruposDeTela
        .filter((grupo) => grupo.ids.some((id) => IMPLEMENTED_MODULE_IDS.has(id)))
        .filter((grupo) => {
          const paginaDoGrupo = todoGreenRouteToPage(grupo.rota);
          const modulo = MODULE_IMPLEMENTATION[paginaDoGrupo];
          return podeAcessarFuncionalidade(role, remoteAccess.permissions, modulo?.permission);
        })
        .filter((grupo) => grupoAtendeBusca(grupo, navigationQuery)),
      navigationQuery,
    ),
    [gruposDeTela, navigationQuery, role],
  );

  if (estadoDoAcesso === ACESSO.verificando) return <AcessoEmVerificacao />;
  if (!allowed) return <AccessDenied db={db} />;

  const openPricing = () => navigate("/todogreen/precificacao");
  const saveHomePreferences = (preferences) => update?.((current) => ({
    ...current,
    preferences: { ...(current.preferences || {}), todoGreenHome: preferences },
  }));

  return (
    <main className={`tdg ${isOverview ? "tdg-overview-page" : "tdg-module-page"}`} aria-labelledby="tdg-title">
      <header className="tdg-shell-header">
        <div className="tdg-shell-location">
          <span className="tdg-workspace-name">TO DO GREEN · WORKSPACE CORPORATIVO</span>
          <nav className="tdg-breadcrumb" aria-label="Trilha de navegação">
            {trilha.map((passo, indice) => {
              const ultimo = indice === trilha.length - 1;
              return (
                <span className="tdg-breadcrumb-item" key={passo.route}>
                  {ultimo ? (
                    <span aria-current="page">{passo.label}</span>
                  ) : (
                    <button type="button" onClick={() => navigate(passo.route)}>{passo.label}</button>
                  )}
                  {!ultimo && <span className="tdg-breadcrumb-sep" aria-hidden="true">›</span>}
                </span>
              );
            })}
          </nav>
          <h1 id="tdg-title">{currentPage.title}</h1>
          <p title={currentPage.description}>{currentPage.description}</p>
        </div>
        <div className="tdg-shell-actions">
          <button className="tdg-shell-search" type="button" onClick={() => navigate("/todogreen/dashboard?ferramentas=1")}>
            <Search size={15} />Buscar ferramenta
          </button>
          <details className="tdg-management-menu">
            <summary>Configurações</summary>
            <div data-tdg-management-tools="true">
              {MANAGEMENT_TOOLS
                // Projetos e tarefas não é configuração: já tem o cartão fixo
                // no topo do menu lateral. Aqui ficam só as ferramentas de
                // administração (integrações, usuários e acessos).
                .filter((item) => item.id !== "projects")
                .filter((item) => podeAcessarFuncionalidade(role, remoteAccess.permissions, item.permission))
                .map((item) => (
                  <button
                    type="button"
                    className={page === item.id ? "active" : ""}
                    onClick={() => navigate(item.route)}
                    key={item.id}
                  >
                    {item.label}
                  </button>
                ))}
            </div>
          </details>
        </div>
      </header>

      <div className={`tdg-erp-layout${menuOculto ? " menu-oculto" : ""}`}>
        {menuOculto && (
          <button type="button" className="tdg-menu-mostrar" onClick={alternarMenu} aria-label="Mostrar menu lateral">
            <PanelLeftOpen size={16} />Menu
          </button>
        )}
        <aside className="tdg-erp-sidebar" hidden={menuOculto}>
          <div className="tdg-erp-sidebar-head">
            <div><strong>To Do Green</strong><small>Workspace corporativo</small></div>
            <button type="button" className="tdg-menu-ocultar" onClick={alternarMenu} aria-label="Esconder menu lateral" title="Esconder menu">
              <PanelLeftClose size={16} />
            </button>
          </div>
          <button
            type="button"
            className={`tdg-work-entry ${isWorkCenter ? "active" : ""}`}
            onClick={() => navigate("/todogreen/central-trabalho")}
          >
            <strong>Projetos e tarefas</strong>
            <small>Boards, Kanban, Gantt e Workload</small>
          </button>
          {/* Um menu só, do jeito que a titular pediu: as áreas na frente e,
              dentro de cada área, o segundo nível com todas as funcionalidades
              dela. A busca fica sempre à mão e, enquanto há termo digitado,
              mostra o resultado atravessando todas as áreas. */}
          <label className="tdg-sidebar-search">
            <Search size={15} />
            <input value={navigationQuery} onChange={(event) => setNavigationQuery(event.target.value)} placeholder="Buscar funcionalidade" aria-label="Buscar funcionalidades" />
          </label>
          {navigationQuery.trim() ? (
            <nav className="tdg-tabs" aria-label="Navegação por funcionalidades">
              {functionNavigation.map((grupo) => {
                const paginaDoGrupo = todoGreenRouteToPage(grupo.rota);
                return (
                  <button
                    type="button"
                    className={paginaDoGrupo === page ? "active" : ""}
                    onClick={() => { navigate(grupo.rota); setNavigationQuery(""); }}
                    key={grupo.rota}
                  >
                    <span>{sidebarFunctionLabel(grupo)}</span>
                    {grupo.assuntos.length > 0 && <small>{resumirAssuntos(grupo.assuntos)}</small>}
                  </button>
                );
              })}
              {functionNavigation.length === 0 && <p className="tdg-nav-vazio">Nada com esse termo. Tente “ocorrência”, “holerite”, “frota”...</p>}
            </nav>
          ) : (
            <nav className="tdg-nav-areas" aria-label="Navegação To Do Green">
              {PRIMARY_NAVIGATION.map((item) => {
                const ativa = primaryNavigation.id === item.id;
                const aberta = areasAbertas.has(item.id) || ativa;
                // O Workspace apresenta "Projetos e tarefas", "Visualizações e
                // gráficos" e "Agentes e funções" na barra de jornadas dele.
                // Repetir os mesmos rótulos no menu lateral é o mesmo nome
                // levando ao mesmo lugar em duas navegações da MESMA tela — a
                // repetição que a titular mandou eliminar, e o que quebrava
                // `LogisticsVertical.test.jsx` desde a unificação do workspace
                // (dois botões com o nome acessível idêntico). As rotas
                // continuam válidas e o `pages` continua completo, para o link
                // direto ainda destacar a área certa.
                const jornadasInternas = new Set(item.jornadasInternas || []);
                const paginas = navigationModules(item.pages)
                  .filter(([id]) => !jornadasInternas.has(id))
                  .filter(([, modulo]) => podeAcessarFuncionalidade(role, remoteAccess.permissions, modulo.permission));
                return (
                  <div className={`tdg-nav-area${aberta ? " aberta" : ""}`} key={item.id}>
                    <div className="tdg-nav-area-cabeca">
                      <button
                        type="button"
                        className={ativa ? "active" : ""}
                        onClick={() => { navigate(item.route); abrirArea(item.id); }}
                      >
                        {item.label}
                      </button>
                      {(paginas.length > 1 || (item.extras || []).length > 0) && (
                        <button
                          type="button"
                          className="tdg-nav-area-seta"
                          aria-label={`${aberta ? "Recolher" : "Abrir"} funcionalidades de ${item.label}`}
                          aria-expanded={aberta}
                          onClick={() => alternarArea(item.id)}
                        >
                          <ChevronDown size={14} className={aberta ? "aberta" : ""} />
                        </button>
                      )}
                    </div>
                    {aberta && (paginas.length > 1 || (item.extras || []).length > 0) && (
                      <nav className="tdg-nav-area-itens" aria-label={`Seções de ${item.label}`}>
                        {paginas.length > 1 && paginas.map(([id, modulo]) => (
                          <button
                            type="button"
                            className={page === id ? "active" : ""}
                            onClick={() => navigate(modulo.route)}
                            key={id}
                          >
                            {modulo.navLabel || modulo.title}
                          </button>
                        ))}
                        {(item.extras || []).map(([rotulo, rota]) => (
                          <button type="button" className="tdg-nav-extra" onClick={() => navigate(rota)} key={rota}>
                            {rotulo}
                          </button>
                        ))}
                      </nav>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
        </aside>

        <section className="tdg-erp-stage">
          <div data-tdg-page-content="true">
      {erroDosRegistros && (
        <div className="tdg-alert" role="alert">
          <AlertTriangle size={18} />
          <span>{erroDosRegistros} Os indicadores abaixo estão zerados porque os dados não puderam ser lidos — não porque não existam.</span>
        </div>
      )}

      {!podeVerPagina && (
        <section className="tdg-panel tdg-sem-permissao" role="alert">
          <LockKeyhole size={20} />
          <div>
            <strong>Esta tela é restrita ao seu perfil.</strong>
            <p>Seu acesso não inclui {currentPage.title}. Fale com quem administra os acessos da vertical se precisar entrar aqui.</p>
            <button type="button" className="tdg-action" onClick={() => navigate("/todogreen/dashboard")}>Voltar ao painel</button>
          </div>
        </section>
      )}
      {podeVerPagina && (<>
      {page === "dashboard" && <ErpHome role={role} user={db?.user || {}} data={verticalData} dashboard={dashboard} tasks={db?.tasks || []} products={LOGISTICS_PRODUCTS} preferences={db?.preferences?.todoGreenHome} onSave={saveHomePreferences} onNavigate={navigate} />}
      {/* /central-trabalho fica FORA desta lista de propósito: é a rota da
          Central de Trabalho (quadros), que monta a própria tela. Montar o
          workspace ali também deixava duas telas empilhadas, cada uma com
          metade. */}
      {["espaco", "visualizacoes", "agentes-funcoes"].includes(page) && (
        <Suspense fallback={<section className="tdg-panel">Abrindo o espaço de trabalho...</section>}>
          <TodoGreenWorkspace
            key={page}
            db={db}
            update={update}
            verticalData={verticalData}
            setToast={setToast}
            onNavigate={navigate}
            authHeaders={authHeaders}
            initialTool={page === "visualizacoes" ? "visoes" : page === "agentes-funcoes" ? "agentes" : "visao-geral"}
          />
        </Suspense>
      )}
      {page === "dashboards" && <Suspense fallback={<section className="tdg-panel">Carregando seus painéis...</section>}><DashboardBuilderPage authHeaders={authHeaders} summary={dashboard} data={registros} setToast={setToast} /></Suspense>}
      {page === "metas" && <Suspense fallback={<section className="tdg-panel">Carregando metas...</section>}><GoalsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "performance-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando performance comercial...</section>}><SalesPerformancePage authHeaders={authHeaders} onNavigate={navigate} /></Suspense>}
      {page === "playbook-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando playbook comercial...</section>}><TodoGreenGuides mode="playbook" onNavigate={navigate} /></Suspense>}
      {page === "solicitacoes" && <Suspense fallback={<section className="tdg-panel">Carregando solicitações...</section>}><ClientRequestsPage authHeaders={authHeaders} setToast={setToast} currentUserId={db?.user?.id} clientes={clientes} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} /></Suspense>}
      {page === "cadastros" && <Suspense fallback={<section className="tdg-panel">Carregando cadastros...</section>}><ErpRegistriesPage registros={registros} criar={criar} setToast={setToast} secao={secaoDeCadastro} areaLabel={AREA_DO_CADASTRO[secaoDeCadastro] ? primaryNavigation.label : ""} /></Suspense>}
      {page === "implantacao" && (
        <Suspense fallback={<section className="tdg-panel">Carregando implantação...</section>}>
          <ClientActivationPage db={db} update={update} authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "estoque" && <Suspense fallback={<section className="tdg-panel">Carregando estoque...</section>}><StockPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "compras" && <Suspense fallback={<section className="tdg-panel">Carregando compras...</section>}><PurchasingPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "fiscal" && <Suspense fallback={<section className="tdg-panel">Carregando fiscal...</section>}><FiscalPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "tesouraria" && <Suspense fallback={<section className="tdg-panel">Carregando a tesouraria...</section>}><TreasuryPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "central-rfq" && (
        <Suspense fallback={<section className="tdg-panel">Carregando a Central de RFQ...</section>}>
          <CentralRfqPage
            habilitacao={registros.habilitacao}
            habilitacaoKits={registros.habilitacaoKits}
            rfq={registros.rfq}
            clientes={clientes}
            onCriarDocumento={(registro) => criar("habilitacao", registro)}
            onAtualizarDocumento={(id, registro) => atualizar("habilitacao", id, registro)}
            onArquivarDocumento={(id) => arquivar("habilitacao", id)}
            onCriarKit={(registro) => criar("habilitacaoKits", registro)}
            onCriarRfq={(registro) => criar("rfq", registro)}
            onAtualizarRfq={(id, registro) => atualizar("rfq", id, registro)}
            podeEditar={podeAcessarFuncionalidade(role, remoteAccess.permissions, "compliance:manage")}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "sobre-o-negocio" && (
        <Suspense fallback={<section className="tdg-panel">Carregando o dossiê do negócio...</section>}>
          <SobreONegocioPage
            businessContext={registros.businessContext}
            onCreate={(registro) => criar("businessContext", registro)}
            onUpdate={(id, registro) => atualizar("businessContext", id, registro)}
            onArchive={(id) => arquivar("businessContext", id)}
            podeEditar={podeAcessarFuncionalidade(role, remoteAccess.permissions, "business:teach")}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "clientes" && <Suspense fallback={<section className="tdg-panel">Carregando clientes...</section>}><ClientsPage authHeaders={authHeaders} opportunities={verticalData.opportunities} contracts={registros.contracts} operations={registros.operations} financial={registros.financial} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} onNavigate={navigate} setToast={setToast} currentUserId={db?.user?.id} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} /></Suspense>}
      {page === "oportunidades" && <Suspense fallback={<section className="tdg-panel">Carregando oportunidades...</section>}><OpportunitiesPage clients={clientes} opportunities={verticalData.opportunities} scenarios={verticalData.pricingScenarios} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} authHeaders={authHeaders} onCreate={(registro) => criar("opportunities", registro)} onUpdate={(id, alteracoes) => atualizar("opportunities", id, alteracoes)} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "propostas" && <ProposalPanel data={verticalData} criar={criar} atualizar={atualizar} pedidosDeAprovacao={pedidosDeAprovacao} setToast={setToast} />}
      {page === "precificacao" && <PricingPanel key={`${produtoDaRota(path) || "nova"}:${new URLSearchParams(path.split("?")[1] || "").get("opportunity") || "nova"}`} role={role} criar={criar} db={db} authHeaders={authHeaders} setToast={setToast} opportunities={verticalData.opportunities} />}
      {["esg", "green-score", "calculadora-ambiental", "tradutor-esg", "escopo-3"].includes(page) && <EsgPanel dashboard={dashboard} data={verticalData} onNavigate={navigate} />}
      {page === "regua" && (
        <Suspense fallback={<section className="tdg-panel">Carregando parâmetros do simulador...</section>}>
          <PricingParametersPanel authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "central-esg" && (
        <Suspense fallback={<section className="tdg-panel">Carregando Central ESG...</section>}>
          <EsgCenter authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "produtos" && <Suspense fallback={<section className="tdg-panel">Carregando produtos...</section>}><EnterpriseAreaPage area="products" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {page === "planejamento" && <Suspense fallback={<section className="tdg-panel">Carregando planejamento...</section>}><EnterpriseAreaPage area="planning" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {/* O simulador de aceite tem tela própria de novo: ele nasceu em
          Financeiro → Custos, foi parar no rodapé do Planejamento e o menu
          "Aceite" apontava para Ordens de Serviço — na prática, sumiu. */}
      {page === "aceite-viagens" && <Suspense fallback={<section className="tdg-panel">Carregando o simulador de aceite...</section>}><TripViabilityPage authHeaders={authHeaders} /></Suspense>}
      {page === "operacoes" && <Suspense fallback={<section className="tdg-panel">Carregando operações...</section>}><OperationsPage operations={registros.operations} clients={clientes} contracts={registros.contracts} criar={criar} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "motorista-frota" && <Suspense fallback={<section className="tdg-panel">Carregando frota e motoristas...</section>}><DriverFleetCenterPage authHeaders={authHeaders} operations={registros.operations} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "ocorrencias" && <Suspense fallback={<section className="tdg-panel">Carregando ocorrências...</section>}><OccurrencesPage operations={registros.operations} clients={clientes} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "ordens-servico" && <Suspense fallback={<section className="tdg-panel">Carregando ordens de serviço...</section>}><TransactionalSpinePage mode="service-orders" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "ciot" && <Suspense fallback={<section className="tdg-panel">Carregando CIOT...</section>}><TransactionalSpinePage mode="ciot" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "rastreamento" && <Suspense fallback={<section className="tdg-panel">Carregando TMS Tracker...</section>}><TrackerPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "receita" && <Suspense fallback={<section className="tdg-panel">Carregando contas a receber...</section>}><FinancePage type="revenue" entries={registros.financial.filter((item) => item.tipo === "revenue")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} /></Suspense>}
      {page === "faturamento" && <Suspense fallback={<section className="tdg-panel">Carregando faturamento...</section>}><TransactionalSpinePage mode="billing" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "titulos" && <Suspense fallback={<section className="tdg-panel">Carregando títulos...</section>}><TransactionalSpinePage mode="titles" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "rateios" && <Suspense fallback={<section className="tdg-panel">Carregando rateios...</section>}><TransactionalSpinePage mode="costs" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "custos" && <Suspense fallback={<section className="tdg-panel">Carregando custos e margem...</section>}><FinancePage type="cost" entries={registros.financial.filter((item) => item.tipo === "cost")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} /></Suspense>}
      {page === "rasci" && <Suspense fallback={<section className="tdg-panel">Carregando matriz RASCI...</section>}><RasciMatrixPage /></Suspense>}
      {page === "fluxos" && <Suspense fallback={<section className="tdg-panel">Carregando fluxos...</section>}><FluxosPage onNavigate={navigate} /></Suspense>}
      {page === "manual" && <Suspense fallback={<section className="tdg-panel">Carregando manual do ERP...</section>}><ErpManualPage onNavigate={navigate} /></Suspense>}
      {page === "comissoes" && <Suspense fallback={<section className="tdg-panel">Carregando comissões...</section>}><FinancePage type="commission" entries={registros.financial.filter((item) => item.tipo === "commission")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} /></Suspense>}
      {page === "dp-rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP...</section>}><EnterpriseAreaPage area="dp" onNavigate={navigate} /></Suspense>}
      {page === "rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP/RH...</section>}><PeoplePage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "planner" && <Suspense fallback={<section className="tdg-panel">Carregando o Planner...</section>}><PlannerPage authHeaders={authHeaders} setToast={setToast} currentUserId={db?.user?.id} role={role} espacoId={remoteAccess.ownerId || ""} /></Suspense>}
      {page === "avancos" && <Suspense fallback={<section className="tdg-panel">Carregando os avanços da semana...</section>}><AvancosDaSemanaPage opportunities={verticalData.opportunities} comments={verticalData.comments} interactions={verticalData.interactions} onNavigate={navigate} /></Suspense>}
      {page === "qualidade" && <Suspense fallback={<section className="tdg-panel">Carregando qualidade...</section>}><EnterpriseAreaPage area="quality" onNavigate={navigate} /></Suspense>}
      {page === "marketing" && <Suspense fallback={<section className="tdg-panel">Carregando inteligência de mercado...</section>}><TodoGreenIntelligenceHub verticalData={verticalData} onNavigate={navigate} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "juridico" && <Suspense fallback={<section className="tdg-panel">Carregando jurídico...</section>}><EnterpriseAreaPage area="legal" onNavigate={navigate} /></Suspense>}
      {page === "indicadores" && <Suspense fallback={<section className="tdg-panel">Carregando indicadores...</section>}><EnterpriseAreaPage area="indicators" onNavigate={navigate} /></Suspense>}
      {page === "administracao" && <Suspense fallback={<section className="tdg-panel">Carregando administração...</section>}><EnterpriseAreaPage area="admin" onNavigate={navigate} /></Suspense>}
      {page === "relatorios" && <Suspense fallback={<section className="tdg-panel">Carregando relatórios...</section>}><ReportsPage dashboard={dashboard} data={verticalData} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "metodologia" && <MethodologyPanel />}
      {page === "documentos" && (
        <Suspense fallback={<section className="tdg-panel">Carregando os documentos...</section>}>
          <DocumentVaultPage authHeaders={authHeaders} clientes={clientes} setToast={setToast} />
        </Suspense>
      )}
      {page === "deal-desk" && (
        <Suspense fallback={<section className="tdg-panel">Carregando aprovações...</section>}>
          <DealDeskPage
            authHeaders={authHeaders}
            quem={{ userId: db?.user?.id || "", role, permissions: remoteAccess.permissions || [] }}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "auditoria" && <Suspense fallback={<section className="tdg-panel">Carregando auditoria...</section>}><GovernancePage role={role} permissions={remoteAccess.permissions || []} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "acessos" && <AccessPanel role={role} permissions={remoteAccess.permissions} authHeaders={authHeaders} setToast={setToast} />}
      {page === "integracoes" && <Suspense fallback={<section className="tdg-panel">Carregando integrações...</section>}><IntegrationsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {!Object.keys(MODULE_IMPLEMENTATION).includes(page) && !["central-trabalho", "green-score", "calculadora-ambiental", "tradutor-esg", "escopo-3", "custos", "comissoes"].includes(page) && <DashboardPanel data={verticalData} dashboard={dashboard} tasks={db?.tasks || []} onNavigate={navigate} />}

      {isOverview && (
        <details className="tdg-tool-catalog" open={catalogRequested || undefined}>
          <summary>
            <span><strong>Catálogo de rotinas</strong><small>Áreas, produtos e funções do ERP.</small></span>
            <span>Ver catálogo</span>
          </summary>
          <div className="tdg-tool-catalog-content">
            <div className="tdg-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar rotina, área, produto ou responsável" aria-label="Buscar rotinas To Do Green" /></div>
          <section className="tdg-panel">
            <div className="tdg-section-head"><div><span className="tdg-kicker">PORTFÓLIO</span><h2>Produtos e modelos de preço</h2></div><button className="tdg-action" type="button" onClick={openPricing}>Calcular preço</button></div>
            <div className="tdg-product-strip">{LOGISTICS_PRODUCTS.map((product) => <ProductCard product={product} active={false} onSelect={openPricing} key={product.id} />)}</div>
          </section>

          {modulesByArea.map((area) => <AreaSection area={area} grupos={area.grupos} key={area.id} />)}
          </div>
        </details>
      )}
      </>)}
          </div>
        </section>
      </div>

      {/* A Semente fica por último no DOM de propósito: quem navega por teclado
          ou leitor de tela percorre a tela inteira antes de chegar nela, em vez
          de tropeçar num assistente antes do conteúdo que veio ver. */}
      <Semente
        pagina={page}
        clienteId={new URLSearchParams(path.split("?")[1] || "").get("client") || ""}
        authHeaders={authHeaders}
      />
    </main>
  );
}
