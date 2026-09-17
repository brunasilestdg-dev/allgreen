import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  uid,
  today,
  contactLinks,
  DEFAULT_LEVELS,
  computeUserPoints,
  levelForPoints,
  levelProgress,
  computeAchievements,
  computeMyWork,
  recurringStatus,
  buildRecurringTransaction,
  buildRecurringPostings,
  buildRecurringReminder,
  parseDeckSlides,
  parseContentPlan,
  scheduleContentDates,
  parseSheet,
  buildCsv,
  parseAnalysis,
  parseMindMap,
  DOCUMENT_TEMPLATES,
  fillDocTemplate,
  makeSignature,
  verifySignature,
  signatureStatus,
  signatureBlockText,
  buildEmailSignature,
  buildPixCode,
  DB_FIELD_TYPES,
  coerceCellValue,
  formatCellValue,
  kanbanColumns,
  recordLabel,
  groupRowsByDate,
  monthMatrix,
  buildPageTree,
  pageDescendantIds,
  searchPages,
  AUTOMATION_WEEKDAYS,
  AUTOMATION_ACTIONS,
  runAutomations,
  applyMergeFields,
  evalFormula,
  sheetChartSeries,
  EMAIL_TEMPLATES,
} from "./domain.js";
import {
  DEFAULT_CHART_CONFIG,
  normalizeChartConfig,
} from "./features/spreadsheets/chartConfig.js";
import {
  createProjectRecord,
  MILESTONE_TYPES,
  normalizeGovernanceItem,
  PROJECT_STATUSES,
  projectMetrics,
} from "./features/projects/projectDomain.js";
import {
  buildProjectSchedule,
  ganttPosition,
  ganttWidth,
  scheduleRiskSummary,
} from "./features/projects/scheduleDomain.js";
import {
  buildNavigation,
  writeVisit,
} from "./features/navigation/menuDomain.js";
import Modal from "./components/Modal.jsx";
import {
  Button,
  DynamicIcon,
  Empty,
  Field,
  FilterSelect,
  Logo,
  PageTitle,
} from "./components/ui.jsx";
import HomeHub from "./features/home/HomeHub.jsx";
import PrimaryAppRouter, { resolvePrimaryRoute } from "./routing/PrimaryAppRouter.jsx";
import { useRoutePath } from "./routing/useRoutePath.js";
import { taskUrgency } from "./features/tasks/taskUrgencia.js";
import {
  aiWorkspaceContext,
  inboxUrl,
  logInteraction,
  trackProductEvent,
} from "./session/telemetria.js";
import { escapeHtml, money, slugify, urlBase64ToUint8Array } from "./components/formato.js";
import { specialistData } from "./domain/especialistas.js";
import {
  DOCUMENT_UPLOAD_LIMIT,
  documentFileKind,
  extractDocumentText,
} from "./components/leituraDeArquivo.js";
import Markdown from "./components/Markdown.jsx";
import SharingFields from "./components/SharingFields.jsx";
import Tasks from "./features/tasks/TasksScreen.jsx";
import Documents from "./features/documents/DocumentsScreen.jsx";
import Catalog from "./features/catalog/CatalogScreen.jsx";
import DataBases from "./features/databases/DataBasesScreen.jsx";
import Finance from "./features/finance/FinanceScreen.jsx";
import Sites, {
  looksLikeSiteInstruction,
  mergeSiteBrief,
  SITE_THEMES,
  HOME_BLOCK_IDS,
  HERO_STYLES,
  makeSite,
  makeSitePages,
  websiteMilestones,
  parseSiteJson,
} from "./features/sites/SitesScreen.jsx";
// Movido para ./features/sites/SitesScreen.jsx; reexportado para quem já importava daqui.
export {
  looksLikeSiteInstruction,
  mergeSiteBrief,
  SITE_THEMES,
  HOME_BLOCK_IDS,
  HERO_STYLES,
  makeSite,
  makeSitePages,
  websiteMilestones,
  parseSiteJson,
};
import { LEGACY_STORAGE_KEY, ACTIVE_USER_KEY, STORAGE_PREFIX, AUTH_TOKEN_KEY, emptyDb } from "./session/espacoVazio.js";
import { userStorageKey, WORKSPACE_REVISION_PREFIX, WORKSPACE_CONFLICT_PREFIX, readWorkspaceRevision, storeWorkspaceRevision, preserveWorkspaceConflict, readUserDb, loadInitialDb, startUserSession, authHeaders, endSession, mergeMedia, activeSpaceId, cleanDb } from "./session/armazenamento.js";
import { parseDelimitedText, parseOfxTransactions } from "./domain/importacoes.js";
import { buildOrderReceita, buildLeadWonSideEffects, quoteTotal, orderFromQuote } from "./domain/vendas.js";
import { DEFAULT_WA_TEMPLATES, WA_TEMPLATE_CATEGORIES, fillWhatsappTemplate } from "./domain/whatsappModelos.js";
import { DAS_DEFAULT_DUE_DAY, monthLabelPt, dasStatus, buildDasReminder, weekRange, previousWeekRange, computeWeeklySummary, dayRangeLabel } from "./domain/dasEResumoSemanal.js";
import {
  RECURRENCE_OPTIONS,
  addBusinessDays,
  addDaysYmd,
  addDaysYmdDashed,
  buildTaskCalendar,
  businessDaysBetween,
  nextRecurrenceDue,
  shiftYearMonth,
  todayYearMonth,
} from "./domain/datas.js";
import { googleCalendarUrl, requestGoogleAccessToken, sendGmailReal, createGoogleCalendarEventReal } from "./integrations/google.js";
import { CHANGELOG_ENTRIES } from "./domain/changelog.js";
import LegalPage, { LegalContent } from "./features/legal/LegalPage.jsx";
import InboxHub from "./features/omnichannel/InboxHub.jsx";
import Contacts from "./features/omnichannel/Contacts.jsx";
import CRM from "./features/omnichannel/CRM.jsx";
import Appointments from "./features/omnichannel/Appointments.jsx";
import Quotes from "./features/omnichannel/Quotes.jsx";
import TimeTracking from "./features/omnichannel/TimeTracking.jsx";
import { textoDoToast, tomDoToast } from "./toastTone.js";
import {
  BUSINESS_INDUSTRY_CATALOG,
  businessPackLabels,
  businessTypeLabel,
  filterNavigationForBusiness,
  industryCategoryById,
  profileTypeForIndustry,
  recommendedPackIds,
} from "./features/business-profile/businessProfileDomain.js";
import {
  buildDigitalTaskPrompt,
  buildTaskStructurePrompt,
  localTaskStructure,
  parseTaskStructure,
  prioritizeTaskBacklog,
  taskCompletionGaps,
} from "./features/tasks/taskAiDomain.js";
// Reexporta a camada de lógica pura para os testes que importam de "./App".
export {
  contactLinks,
  DEFAULT_LEVELS,
  computeUserPoints,
  levelForPoints,
  levelProgress,
  computeAchievements,
  computeMyWork,
  computeBusinessInsights,
  recurringStatus,
  buildRecurringTransaction,
  buildRecurringPostings,
  buildRecurringReminder,
  parseDeckSlides,
  parseContentPlan,
  scheduleContentDates,
  parseSheet,
  buildCsv,
  parseAnalysis,
  parseMindMap,
  DOCUMENT_TEMPLATES,
  fillDocTemplate,
  normalizeForSigning,
  documentFingerprint,
  signatureCode,
  makeSignature,
  verifySignature,
  signatureStatus,
  signatureBlockText,
  buildEmailSignature,
  buildPixCode,
  pixCrc16,
  DB_FIELD_TYPES,
  coerceCellValue,
  formatCellValue,
  groupRowsByField,
  kanbanColumns,
  recordLabel,
  groupRowsByDate,
  monthMatrix,
  buildPageTree,
  pageDescendantIds,
  searchPages,
  AUTOMATION_WEEKDAYS,
  AUTOMATION_ACTIONS,
  automationDue,
  runAutomations,
  extractMergeFields,
  applyMergeFields,
  evalFormula,
  sheetChartSeries,
  parseBrNumber,
  EMAIL_TEMPLATES,
  procurementNumber,
  supplierBidTotals,
  compareSupplierBids,
  bestOffersByItem,
  buildProcurementCsv,
  parseSupplierProposal,
} from "./domain.js";
export { groupInteractions } from "./features/omnichannel/inboxDomain.js";
import {
  Sparkles,
  MessagesSquare,
  Home,
  Rocket,
  Target,
  Megaphone,
  Network,
  Gauge,
  ListChecks,
  GitBranch,
  Handshake,
  Gavel,
  WalletCards,
  Workflow,
  PanelsTopLeft,
  FileText,
  History,
  Leaf,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Moon,
  Sun,
  Plus,
  Send,
  Building2,
  CheckCircle2,
  Circle,
  Clock3,
  Search,
  Filter,
  Trash2,
  Edit3,
  Copy,
  Download,
  Upload,
  ExternalLink,
  Users,
  ListTodo,
  TrendingUp,
  Globe2,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  MessageSquareText,
  Calculator,
  DollarSign,
  Save,
  Eye,
  EyeOff,
  RotateCcw,
  Archive,
  GripVertical,
  UserRound,
  ShieldCheck,
  CircleAlert,
  LogOut,
  Check,
  Lightbulb,
  Palette,
  ShoppingBag,
  Headphones,
  Boxes,
  UserCog,
  WandSparkles,
  Award,
  BadgeCheck,
  Mic,
  BrainCog,
  Sigma,
  GraduationCap,
  LockKeyhole,
  Printer,
  Mail,
  Inbox,
  Pencil,
  BarChart3,
  Image as ImageIcon,
  Video,
  Link2,
  Wrench,
  ReceiptText,
  CalendarDays,
  Play,
  Bot,
  Square,
  Table,
  FileSearch,
  QrCode,
  Database,
  BookOpen,
  Zap,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Plug,
  Code2,
  Table2,
  KeyRound,
  Sparkle,
  Layers,
  Languages,
  Route,
  MapPin,
  Navigation,
  Truck,
  Bell,
  Paperclip,
  Repeat,
  Bug,
  Activity,
  LifeBuoy,
  FolderTree,
} from "lucide-react";

// Favicon próprio da To Do Green (folha lima sobre verde da marca): dentro da
// vertical e dos portais a aba tem de mostrar a marca, não o mascote rosa do
// Seu Funcionário. SVG inline p/ não depender de um arquivo de logo no repo.
const TDG_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#0e5c46'/><path d='M22.8 8.2C13 8 8.7 13.7 9.4 20.9c3.3.3 5-.7 5-.7-.9-2.5.2-5.3 2.3-6.8-1.3 1.7-1.7 3.6-1.4 5.5 5-.2 8.4-4.4 7.5-10.7z' fill='#9fe870'/></svg>",
  );
const DEFAULT_FAVICON = "/icone-192.png?v=7";
function setFavicon(href) {
  if (typeof document === "undefined") return;
  for (const rel of ["icon", "apple-touch-icon"]) {
    const el = document.querySelector(`link[rel="${rel}"]`);
    if (el && el.getAttribute("href") !== href) el.setAttribute("href", href);
  }
}

const Procurement = lazy(
  () => import("./features/procurement/Procurement.jsx"),
);
const ProcessStudio = lazy(
  () => import("./features/processes/ProcessStudio.jsx"),
);
const CapacityPlanner = lazy(
  () => import("./features/resources/CapacityPlanner.jsx"),
);
const PricingImpactStudio = lazy(
  () => import("./features/pricing/PricingImpactStudio.jsx"),
);
const WorkStructure = lazy(
  () => import("./features/work/WorkStructure.jsx"),
);
const Goals = lazy(() => import("./features/goals/Goals.jsx"));
// Simulador de impacto ESG — público, aberto na tela de entrada sem login.
const EsgEmissionSimulator = lazy(() => import("./features/logistics/EsgEmissionSimulator.jsx"));
const Bills = lazy(() => import("./features/finance/Bills.jsx"));
const SalesPipeline = lazy(
  () => import("./features/crm/SalesPipeline.jsx"),
);
const MonthlyStatement = lazy(
  () => import("./features/finance/MonthlyStatement.jsx"),
);
const Meetings = lazy(() => import("./features/meetings/Meetings.jsx"));
const CanvasBoard = lazy(
  () => import("./features/canvas/CanvasBoard.jsx"),
);
const DiagramStudio = lazy(
  () => import("./features/diagrams/DiagramStudio.jsx"),
);
const QuickWhiteboard = lazy(
  () => import("./features/whiteboard/QuickWhiteboard.jsx"),
);
const DayPlanner = lazy(() => import("./features/planner/DayPlanner.jsx"));
const KnowledgeCenter = lazy(
  () => import("./features/knowledge/KnowledgeCenter.jsx"),
);
const DataLab = lazy(() => import("./features/analytics/DataLab.jsx"));
const ConnectedNotes = lazy(
  () => import("./features/notes/ConnectedNotes.jsx"),
);
const PortfolioBoard = lazy(
  () => import("./features/portfolio/PortfolioBoard.jsx"),
);
const AgentStudio = lazy(() => import("./features/agents/AgentStudio.jsx"));
const PlanPanel = lazy(() => import("./features/plans/PlanPanel.jsx"));
const MenuSettings = lazy(
  () => import("./features/navigation/MenuSettings.jsx"),
);
const MediaStudio = lazy(() => import("./features/media/MediaStudio.jsx"));
const CodeStudio = lazy(() => import("./features/code/CodeStudio.jsx"));
const DataNotebook = lazy(() => import("./features/notebook/DataNotebook.jsx"));
const IntegrationsHub = lazy(
  () => import("./features/integrations/IntegrationsHub.jsx"),
);
const ConfigurableDashboard = lazy(
  () => import("./features/dashboard/ConfigurableDashboard.jsx"),
);
const CorporateChat = lazy(
  () => import("./features/chat/CorporateChat.jsx"),
);
const PublicFormsStudio = lazy(
  () => import("./features/forms/PublicFormsStudio.jsx"),
);
const ClientPortalStudio = lazy(
  () => import("./features/portal/ClientPortalStudio.jsx"),
);
const CreativeToolkit = lazy(
  () => import("./features/creative/CreativeToolkit.jsx"),
);
const FreeSuite = lazy(
  () => import("./features/free-suite/FreeSuite.jsx"),
);
const PlatformSuite = lazy(
  () => import("./features/platform-suite/PlatformSuite.jsx"),
);
const BusinessProfileStudio = lazy(
  () => import("./features/business-profile/BusinessProfileStudio.jsx"),
);
const LegalHub = lazy(() => import("./features/legal/LegalHub.jsx"));
const PermissionsPanel = lazy(
  () => import("./features/permissions/PermissionsPanel.jsx"),
);
// Adaptador de permissões → papel do LegalHub. Fica no bundle principal (leve)
// para o roteador não precisar aguardar o painel inteiro.
import { permissionsToLegalRole } from "./features/permissions/permissionsDomain.js";
import { buildPlannerItemsFromLegal } from "./features/legal/legalHubDomain.js";
// Movido para ./session/espacoVazio.js; reexportado para quem já importava daqui.
export { LEGACY_STORAGE_KEY, ACTIVE_USER_KEY, STORAGE_PREFIX, AUTH_TOKEN_KEY, emptyDb };

export const hasAnyWorkspaceData = (db) =>
  (db?.businesses || []).length > 0 ||
  (db?.tasks || []).length > 0 ||
  (db?.leads || []).length > 0 ||
  (db?.appointments || []).length > 0 ||
  (db?.contacts || []).length > 0 ||
  (db?.products || []).length > 0 ||
  (db?.orders || []).length > 0 ||
  (db?.timeEntries || []).length > 0 ||
  (db?.vehicles || []).length > 0 ||
  (db?.trips || []).length > 0 ||
  (db?.developmentPlans || []).length > 0 ||
  (db?.documents || []).length > 0 ||
  (db?.syncedBlocks || []).length > 0 ||
  (db?.processes || []).length > 0 ||
  (db?.processCases || []).length > 0 ||
  (db?.publicForms || []).length > 0 ||
  (db?.clientPortals || []).length > 0 ||
  (db?.resourceProfiles || []).length > 0 ||
  (db?.resourceAllocations || []).length > 0 ||
  (db?.pricingModels || []).length > 0 ||
  (db?.pricingScenarios || []).length > 0 ||
  (db?.workNodes || []).length > 0 ||
  (db?.chatChannels || []).length > 0 ||
  (db?.chatMessages || []).length > 0 ||
  (db?.sites || []).length > 0 ||
  (db?.conversations || []).length > 0 ||
  (db?.history || []).length > 0;

const nav = [
  ["inicio", "Início", Home],
  ["conversar", "Falar com seu Funcionário", MessagesSquare],
  ["meu-trabalho", "Meu trabalho", BriefcaseBusiness],
  ["comecar", "Começar do zero", Rocket],
  ["perfil-negocio", "Central do negócio", SlidersHorizontal],
  ["estrategia", "Estratégia", Target],
  ["marketing", "Marca e Marketing", Megaphone],
  ["vendas", "Vendas e Clientes", Handshake],
  ["orcamentos", "Orçamentos", ReceiptText],
  ["precificacao", "Precificação e Impacto", Calculator],
  ["compras", "Compras e Cotações", Boxes],
  ["caixa", "Caixa de entrada", Inbox],
  ["chat-corporativo", "Chat corporativo", MessageSquareText],
  ["contatos", "Contatos", Users],
  ["agendamentos", "Agendamentos", CalendarDays],
  ["produtos", "Produtos e Pedidos", ShoppingBag],
  ["frota", "Frota e Fretes", Truck],
  ["horas", "Horas e Faturamento", Clock3],
  ["bases", "Meus dados", Database],
  ["automacoes", "Automações", Zap],
  ["financeiro", "Financeiro", WalletCards],
  ["contas", "Contas a receber e pagar", ReceiptText],
  ["juridico", "Jurídico", Gavel],
  ["funil", "Funil de vendas", TrendingUp],
  ["resultado-mes", "Resultado do mês", BarChart3],
  ["reunioes", "Reuniões", Mic],
  ["quadro", "Quadro visual", Layers],
  ["diagramas", "Diagramas", Workflow],
  ["quadro-rapido", "Quadro rápido", Lightbulb],
  ["cobranca", "Cobrança Pix", QrCode],
  ["resultados", "Dashboards", BarChart3],
  ["operacao", "Operação", Workflow],
  ["estrutura", "Estrutura de trabalho", FolderTree],
  ["planejar", "Planejar o dia", CalendarDays],
  ["memoria-busca", "Memória e busca", BrainCog],
  ["analise-dados", "Análise de dados", Sigma],
  ["notas-conectadas", "Conhecimento conectado", Network],
  ["portfolio", "Portfólio de projetos", GitBranch],
  ["agentes", "Agentes", Bot],
  ["central-crescimento", "Central de crescimento", PanelsTopLeft],
  ["metas", "Metas e OKRs", Target],
  ["processos", "Processos e Solicitações", PanelsTopLeft],
  ["formularios-publicos", "Formulários públicos", PanelsTopLeft],
  ["portal-cliente", "Portal do cliente", Users],
  ["capacidade", "Capacidade e Recursos", Users],
  ["desenvolvimento", "Desenvolvimento", TrendingUp],
  ["sites", "Sites e Materiais", PanelsTopLeft],
  ["documentos", "Documentos", FileText],
  ["wiki", "Base de conhecimento", BookOpen],
  ["analise", "Análise de textos", FileSearch],
  ["ideias", "Mapa de ideias", Lightbulb],
  ["apresentacoes", "Apresentações", Layers],
  ["conteudo", "Calendário de conteúdo", CalendarDays],
  ["planilhas", "Planilhas", Table],
  ["assinatura", "Assinatura de e-mail", Mail],
  ["ferramentas", "Ferramentas", Wrench],
  ["criacao-local", "Criação sem custo", WandSparkles],
  ["laboratorio-gratuito", "Laboratório gratuito", Bot],
  ["estudio", "Estúdio de IA", WandSparkles],
  ["midia", "Mídia", ImageIcon],
  ["editor-codigo", "Editor de código", Code2],
  ["notebook", "Notebook de dados", Table2],
  ["integracoes", "Integrações", Plug],
  ["historico", "Histórico", History],
  ["certificacoes", "Certificações", Award],
];

const navSecondary = [
  ["personalizar-menu", "Personalizar menu", ListChecks],
  ["meu-plano", "Meu plano", Gauge],
  ["time", "Meu Time", Users],
  ["permissoes", "Permissões", ShieldCheck],
  ["config", "Configurações", Settings],
];

const navGroups = [
  {
    label: null,
    items: ["inicio", "conversar", "meu-trabalho", "comecar"],
  },
  {
    label: "VENDAS E CLIENTES",
    items: [
      "estrategia",
      "marketing",
      "vendas",
      "funil",
      "orcamentos",
      "precificacao",
      "caixa",
      "contatos",
      "agendamentos",
      "reunioes",
    ],
  },
  {
    label: "OPERAÇÃO",
    items: [
      "chat-corporativo",
      "produtos",
      "compras",
      "frota",
      "horas",
      "operacao",
      "estrutura",
      "planejar",
      "memoria-busca",
      "analise-dados",
      "notas-conectadas",
      "portfolio",
      "agentes",
      "central-crescimento",
      "metas",
      "resultados",
      "processos",
      "formularios-publicos",
      "portal-cliente",
      "capacidade",
      "desenvolvimento",
      "bases",
      "automacoes",
      "notebook",
      "integracoes",
      "juridico",
    ],
  },
  {
    label: "FINANCEIRO",
    items: ["financeiro", "contas", "resultado-mes", "cobranca"],
  },
  {
    label: "CONTEÚDO",
    items: [
      "sites",
      "documentos",
      "wiki",
      "analise",
      "ideias",
      "quadro",
      "diagramas",
      "quadro-rapido",
      "apresentacoes",
      "conteudo",
      "planilhas",
      "assinatura",
      "ferramentas",
      "criacao-local",
      "laboratorio-gratuito",
      "estudio",
      "midia",
      "editor-codigo",
    ],
  },
  { label: "REGISTROS", items: ["historico", "certificacoes"] },
];

// O modo employee personaliza sugestões e rótulos, mas nunca restringe
// acesso: os dois modos navegam pelo mesmo conjunto completo de páginas.
export const navForMode = () => nav;
export const navForBusiness = (mode, business) =>
  filterNavigationForBusiness(navForMode(mode), business);

const toolCatalog = [
  {
    id: "nfse",
    name: "NFS-e Nacional",
    category: "Nota fiscal",
    description:
      "Emissor oficial e gratuito de nota fiscal de serviço, inclusive para MEI.",
    url: "https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica",
    badge: "Oficial · Gratuito",
    keywords: "nota fiscal nfse serviço mei imposto",
    icon: ReceiptText,
  },
  {
    id: "nfe-sebrae",
    name: "Emissor NF-e Sebrae",
    category: "Nota fiscal",
    description:
      "Emissão gratuita de NF-e para venda de produtos, disponível em todo o Brasil.",
    url: "https://emissornfe.sebrae.com.br/",
    badge: "Gratuito",
    keywords: "nota fiscal nfe produto venda sebrae",
    icon: ReceiptText,
  },
  {
    id: "nfse-api",
    name: "Documentação API NFS-e",
    category: "Nota fiscal",
    description:
      "Manuais e documentação técnica oficial para integração com sistemas de emissão.",
    url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica",
    badge: "API oficial",
    keywords: "api nota fiscal nfse integração erp",
    icon: Link2,
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Comunicação",
    description: "Componha e envie e-mails usando sua conta Google.",
    url: "https://mail.google.com/mail/?view=cm&fs=1",
    badge: "Gratuito",
    keywords: "email e-mail gmail mensagem proposta orçamento",
    icon: Mail,
  },
  {
    id: "outlook",
    name: "Outlook",
    category: "Comunicação",
    description: "Abra uma nova mensagem no Outlook Web.",
    url: "https://outlook.office.com/mail/deeplink/compose",
    badge: "Gratuito",
    keywords: "email e-mail outlook mensagem",
    icon: Mail,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Web",
    category: "Comunicação",
    description: "Atendimento e acompanhamento de clientes pelo navegador.",
    url: "https://web.whatsapp.com/",
    badge: "Gratuito",
    keywords: "whatsapp cliente mensagem atendimento",
    icon: MessageSquareText,
  },
  {
    id: "calendar",
    name: "Google Agenda",
    category: "Organização",
    description: "Crie compromissos, prazos e lembretes.",
    url: "https://calendar.google.com/",
    badge: "Gratuito",
    keywords: "agenda calendário compromisso reunião prazo",
    icon: CalendarDays,
  },
  {
    id: "drive",
    name: "Google Drive",
    category: "Arquivos",
    description: "Armazene e compartilhe documentos e materiais.",
    url: "https://drive.google.com/",
    badge: "Redirecionamento",
    keywords: "arquivo documento drive compartilhar",
    icon: Archive,
  },
  {
    id: "sheets",
    name: "Google Planilhas",
    category: "Financeiro",
    description: "Organize dados, preços, despesas e controles.",
    url: "https://sheets.google.com/",
    badge: "Gratuito",
    keywords: "planilha financeiro preço despesa excel",
    icon: WalletCards,
  },
  {
    id: "canva",
    name: "Canva",
    category: "Design",
    description: "Crie apresentações, posts e materiais visuais.",
    url: "https://www.canva.com/",
    badge: "Redirecionamento",
    keywords: "design logo post apresentação imagem canva",
    icon: Palette,
  },
  {
    id: "trello",
    name: "Trello",
    category: "Organização",
    description: "Organize tarefas e projetos em quadros visuais.",
    url: "https://trello.com/",
    badge: "Redirecionamento",
    keywords: "tarefa projeto quadro kanban trello",
    icon: ListTodo,
  },
  {
    id: "notion",
    name: "Notion",
    category: "Organização",
    description: "Centralize documentos, processos e conhecimento.",
    url: "https://www.notion.so/",
    badge: "Redirecionamento",
    keywords: "documento processo wiki organização notion",
    icon: FileText,
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    category: "Vendas",
    description:
      "CRM gratuito para contatos, negócios e acompanhamento comercial.",
    url: "https://www.hubspot.com/products/crm",
    badge: "CRM gratuito",
    keywords: "crm vendas lead cliente hubspot",
    icon: Users,
  },
];

function recommendedTools(text = "") {
  const terms = text.toLowerCase();
  return toolCatalog
    .filter((tool) =>
      tool.keywords
        .split(" ")
        .some((word) => word.length > 3 && terms.includes(word)),
    )
    .slice(0, 3);
}

// Movido para ./domain/especialistas.js.

const journeyData = {
  start: {
    title: "Quero começar um negócio",
    icon: Rocket,
    steps: [
      "Explicar a ideia",
      "Definir o problema",
      "Definir o público",
      "Avaliar a demanda",
      "Mapear concorrentes",
      "Criar proposta de valor",
      "Definir a oferta",
      "Estruturar preços",
      "Criar nome e posicionamento",
      "Plano de lançamento",
      "Materiais iniciais",
      "Página de apresentação",
      "Primeiros clientes",
    ],
  },
  organize: {
    title: "Quero organizar meu negócio",
    icon: Workflow,
    steps: [
      "Diagnóstico atual",
      "Produtos e serviços",
      "Preços",
      "Clientes",
      "Atendimento",
      "Financeiro",
      "Processos",
      "Tarefas",
      "Prioridades",
      "Plano de melhoria",
    ],
  },
  sell: {
    title: "Quero vender mais",
    icon: TrendingUp,
    steps: [
      "Diagnóstico comercial",
      "Cliente ideal",
      "Revisão da oferta",
      "Revisão dos preços",
      "Argumentos",
      "Mensagens de prospecção",
      "Proposta comercial",
      "Leads",
      "Acompanhamento",
      "Análise dos resultados",
    ],
  },
  brand: {
    title: "Quero profissionalizar minha marca",
    icon: Palette,
    steps: [
      "Diagnóstico da marca",
      "Posicionamento",
      "Tom de voz",
      "Identidade visual",
      "Biografia",
      "Materiais comerciais",
      "Redes sociais",
      "Site",
      "Portfólio",
      "Plano de comunicação",
    ],
  },
};

// Movido para ./components/formato.js.

const whatsappLink = (phone, message) =>
  `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ""}`;

// Movido para ./domain/whatsappModelos.js; reexportado para quem já importava daqui.
export { DEFAULT_WA_TEMPLATES, WA_TEMPLATE_CATEGORIES, fillWhatsappTemplate };
// Constrói a agenda de contatos automaticamente a partir do uso do CRM,
// Agendamentos e Pedidos, sem exigir nenhum passo extra do usuário.
export const pushNotification = (
  notifications,
  { recipientId, message, link, createdBy },
) => {
  if (!recipientId) return notifications || [];
  return [
    {
      id: uid(),
      assigneeId: recipientId,
      ownerId: createdBy || null,
      message,
      link: link || "",
      read: false,
      createdAt: new Date().toISOString(),
    },
    ...(notifications || []),
  ].slice(0, 50);
};

// ── Saúde do espaço de sincronização ────────────────────────────────────
// O workspace é sincronizado como um único JSON; quando ele cresce demais,
// a sincronização fica lenta e pode falhar. Estas funções puras mostram o
// que ocupa espaço (por coleção) e permitem liberar o maior ofensor seguro
// (conversas de IA antigas) sem tocar no coração da sincronização.
const WORKSPACE_COLLECTION_LABELS = {
  conversations: "Conversas de IA",
  media: "Mídia gerada",
  documents: "Documentos",
  syncedBlocks: "Conteúdo sincronizado",
  history: "Histórico de projetos",
  sites: "Sites",
  tasks: "Tarefas",
  leads: "CRM (leads)",
  transactions: "Financeiro",
  orders: "Pedidos",
  quotes: "Orçamentos",
  products: "Produtos",
  timeEntries: "Apontamentos de horas",
  appointments: "Agendamentos",
  contacts: "Contatos",
  certificates: "Certificados",
  notifications: "Notificações",
};

const approxBytes = (value) => {
  const str = JSON.stringify(value) || "";
  try {
    return new Blob([str]).size;
  } catch {
    return str.length;
  }
};

export const workspaceBreakdown = (db) => {
  const rows = Object.keys(WORKSPACE_COLLECTION_LABELS)
    .map((key) => {
      const value = db?.[key];
      if (!Array.isArray(value) || value.length === 0) return null;
      return {
        key,
        label: WORKSPACE_COLLECTION_LABELS[key],
        count: value.length,
        bytes: approxBytes(value),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.bytes - a.bytes);
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  return { rows, total };
};

// Mantém apenas as `keep` conversas mais recentes (por createdAt), para
// liberar espaço sem perder o histórico ativo. Pura e testável.
export const trimOldConversations = (conversations, keep = 5) => {
  const list = Array.isArray(conversations) ? conversations : [];
  if (list.length <= keep) return list;
  return [...list]
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    )
    .slice(0, keep);
};

// Movido para ./domain/dasEResumoSemanal.js; reexportado para quem já importava daqui.
export { DAS_DEFAULT_DUE_DAY, monthLabelPt, dasStatus, buildDasReminder, weekRange, previousWeekRange, computeWeeklySummary, dayRangeLabel };

export const upsertContact = (
  contacts,
  { name, contact, company, businessId, ownerId },
) => {
  const trimmedName = String(name || "").trim();
  const trimmedContact = String(contact || "").trim();
  if (!trimmedName && !trimmedContact) return contacts;
  const { phone, email } = contactLinks(trimmedContact);
  const now = new Date().toISOString();
  const idx = contacts.findIndex((c) => {
    if (phone && c.phone === phone) return true;
    if (email && c.email === email) return true;
    if (!phone && !email && trimmedName)
      return c.name.toLowerCase() === trimmedName.toLowerCase();
    return false;
  });
  if (idx === -1) {
    if (!trimmedName) return contacts;
    return [
      {
        id: uid(),
        name: trimmedName,
        phone,
        email,
        rawContact: trimmedContact,
        company: company || "",
        notes: "",
        businessId: businessId || null,
        ownerId: ownerId || null,
        visibility: "privado",
        sharingPermission: "visualizar",
        sharedWith: [],
        sharedTeams: [],
        createdAt: now,
        updatedAt: now,
      },
      ...contacts,
    ];
  }
  return contacts.map((c, i) =>
    i === idx
      ? {
          ...c,
          name: trimmedName || c.name,
          phone: phone || c.phone,
          email: email || c.email,
          rawContact: trimmedContact || c.rawContact,
          company: company || c.company,
          updatedAt: now,
        }
      : c,
  );
};

const toolBadgeLabel = (tool) =>
  tool.badge === "Redirecionamento" ? tool.badge : `Redirecionamento · ${tool.badge}`;

// Movido para ./domain/datas.js; reexportado para quem já importava daqui.
export { addDaysYmd, addDaysYmdDashed, addBusinessDays, RECURRENCE_OPTIONS, nextRecurrenceDue, todayYearMonth, shiftYearMonth, buildTaskCalendar };

// Movido para ./domain/changelog.js; reexportado para quem já importava daqui.
export { CHANGELOG_ENTRIES };

// Movido para ./domain/datas.js; reexportado para quem já importava daqui.
export { businessDaysBetween };

// Movido para ./integrations/google.js; reexportado para quem já importava daqui.
export { googleCalendarUrl, requestGoogleAccessToken, sendGmailReal, createGoogleCalendarEventReal };

// Movido para ./session/armazenamento.js; reexportado para quem já importava daqui.
export { userStorageKey, WORKSPACE_REVISION_PREFIX, WORKSPACE_CONFLICT_PREFIX, readWorkspaceRevision, storeWorkspaceRevision, preserveWorkspaceConflict, readUserDb, loadInitialDb, startUserSession, authHeaders, endSession, mergeMedia, activeSpaceId, cleanDb };
// Movido para ./domain/importacoes.js; reexportado para quem já importava daqui.
export { parseDelimitedText, parseOfxTransactions };

export const nextBestAction = (data, business, userId, ymdValue = today()) => {
  const businessMatches = (item) =>
    !business || !item?.businessId || item.businessId === business.id;
  const tasks = (data?.tasks || [])
    .filter((item) => item?.status !== "Concluído" && businessMatches(item))
    .filter(
      (item) =>
        !item.assigneeId ||
        item.assigneeId === userId ||
        item.ownerId === userId ||
        (item.assignees || []).some((person) => person?.userId === userId),
    )
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  const overdue = tasks.find((item) => item.due && item.due < ymdValue);
  if (overdue)
    return {
      tone: "danger",
      eyebrow: "PRECISA DE ATENÇÃO",
      title: overdue.title,
      text: `O prazo era ${overdue.due}. Abra a tarefa para concluir, ajustar o prazo ou pedir orientação.`,
      action: "Abrir tarefa",
      page: "operacao",
    };
  const dueToday = tasks.find((item) => item.due === ymdValue);
  if (dueToday)
    return {
      tone: "warning",
      eyebrow: "PRIORIDADE DE HOJE",
      title: dueToday.title,
      text: dueToday.instructions || dueToday.description || "Conclua esta ação para manter o plano em movimento.",
      action: "Continuar agora",
      page: "operacao",
    };
  const followup = (data?.leads || []).find(
    (item) =>
      businessMatches(item) &&
      item.status !== "Ganho" &&
      item.status !== "Perdido" &&
      typeof item.next === "string" &&
      item.next.slice(0, 10) <= ymdValue,
  );
  if (followup)
    return {
      tone: "warning",
      eyebrow: "CLIENTE PARA ACOMPANHAR",
      title: `Retomar contato com ${followup.name || "este cliente"}`,
      text: followup.next || "Existe um acompanhamento pendente no CRM.",
      action: "Abrir CRM",
      page: "vendas",
    };
  const appointment = (data?.appointments || [])
    .filter((item) => businessMatches(item) && item.date === ymdValue)
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")))[0];
  if (appointment)
    return {
      tone: "default",
      eyebrow: "PRÓXIMO COMPROMISSO",
      title: appointment.title || appointment.client || "Compromisso de hoje",
      text: appointment.time ? `Marcado para ${appointment.time}.` : "Confira os detalhes na agenda.",
      action: "Abrir agenda",
      page: "agendamentos",
    };
  if (tasks[0])
    return {
      tone: "default",
      eyebrow: "PRÓXIMA AÇÃO",
      title: tasks[0].title,
      text: tasks[0].instructions || tasks[0].description || "Uma pequena entrega agora mantém seu plano avançando.",
      action: "Continuar",
      page: "operacao",
    };
  return {
    tone: "default",
    eyebrow: "COMECE AGORA",
    title: business?.weeklyGoal || business?.goal || "Escolha um resultado para esta semana",
    text: "Transforme o resultado em uma tarefa pequena, com prazo e critério de conclusão.",
    action: "Criar uma ação",
    page: "operacao",
  };
};

// Movido para ./session/telemetria.js.

// Movido para ./domain/vendas.js; reexportado para quem já importava daqui.
export { buildOrderReceita, buildLeadWonSideEffects, quoteTotal, orderFromQuote };

function useDatabase() {
  const [db, setDb] = useState(loadInitialDb);
  // O usuário salvo no navegador é só cache de interface; nunca é prova de
  // sessão. Enquanto o Worker não valida o token, a vertical To Do Green não
  // é renderizada.
  const [sessionStatus, setSessionStatus] = useState(() => {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) && db.user?.id
        ? "checking"
        : "anonymous";
    } catch {
      return "anonymous";
    }
  });
  const [workspaceConflict, setWorkspaceConflict] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const syncTimer = useRef(null);
  const syncChain = useRef(Promise.resolve());
  const pulled = useRef(false);
  const skipSyncDb = useRef(null);
  const revisionRef = useRef(0);
  const conflictRef = useRef(false);
  const authInvalidRef = useRef(false);
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);
  const userId = db.user?.id;
  const space = activeSpaceId();
  const spaceKey = space || userId;
  const wsUrl = space
    ? `/api/workspace?owner=${encodeURIComponent(space)}`
    : "/api/workspace";

  useEffect(() => {
    if (!userId || !localStorage.getItem(AUTH_TOKEN_KEY)) {
      setSessionStatus("anonymous");
      return;
    }
    let cancelled = false;
    setSessionStatus("checking");
    fetch("/api/auth/session", { headers: authHeaders() })
      .then(async (response) => ({
        status: response.status,
        ok: response.ok,
        data: await response.json().catch(() => ({})),
      }))
      .then(({ status, ok, data }) => {
        if (cancelled) return;
        // Só 401 é o servidor dizendo "esta sessão não existe mais" — os
        // outros erros (429 de limite de tentativas, 5xx passageiro, banco
        // fora do ar por um instante) não provam nada sobre o token, e
        // derrubar a sessão por causa deles tira do ar quem só teve azar de
        // pegar o servidor num pico. Sem essa distinção, um limite de
        // tentativas por IP compartilhado (escritório, rede móvel) já bastava
        // para deslogar todo mundo daquele IP no minuto seguinte.
        if (status === 401) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(ACTIVE_USER_KEY);
          setDb(cleanDb(null));
          setSessionStatus("anonymous");
          return;
        }
        if (ok && data.user) {
          setDb((current) => ({ ...current, user: data.user }));
          setSessionStatus("authenticated");
          return;
        }
        // Sem confirmação do servidor, a conta cacheada não abre o produto.
        setSessionStatus("anonymous");
      })
      .catch(() => {
        if (!cancelled) setSessionStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    pulled.current = false;
    conflictRef.current = false;
    authInvalidRef.current = false;
    const resetTimer = setTimeout(() => {
      setWorkspaceConflict(null);
      setSyncError(null);
    }, 0);
    if (!userId || !localStorage.getItem(AUTH_TOKEN_KEY))
      return () => clearTimeout(resetTimer);
    const localRevision = readWorkspaceRevision(spaceKey);
    revisionRef.current = localRevision;
    let cancelled = false;
    fetch(wsUrl, { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || payload === null) return;
        const serverRevision =
          Number.isInteger(payload.revision) && payload.revision >= 0
            ? payload.revision
            : 0;
        const current = dbRef.current;
        const foreign = current.spaceKey && current.spaceKey !== spaceKey;
        const localNewer =
          !foreign &&
          current.updatedAt &&
          payload.updatedAt &&
          current.updatedAt > payload.updatedAt;
        if (payload.data && localNewer && localRevision !== serverRevision) {
          const conflict = {
            error:
              "Existem alterações mais recentes neste espaço feitas em outra aba ou dispositivo.",
            serverRevision,
            serverUpdatedAt: payload.updatedAt,
          };
          const { user: _user, spaceKey: _space, ...localData } = current;
          preserveWorkspaceConflict(
            spaceKey,
            localData,
            localRevision,
            conflict,
          );
          conflictRef.current = true;
          setWorkspaceConflict(conflict);
          setDb({ ...current, spaceKey });
          pulled.current = true;
          return;
        }
        revisionRef.current = serverRevision;
        storeWorkspaceRevision(spaceKey, serverRevision);
        setDb((current) => {
          const foreign = current.spaceKey && current.spaceKey !== spaceKey;
          if (payload.data) {
            const localNewer =
              !foreign &&
              current.updatedAt &&
              payload.updatedAt &&
              current.updatedAt > payload.updatedAt;
            if (localNewer) return { ...current, spaceKey };
            const next = {
              ...emptyDb,
              ...payload.data,
              media: mergeMedia(
                foreign ? [] : current.media,
                payload.data.media,
              ),
              user: current.user,
              spaceKey,
              updatedAt: payload.updatedAt,
            };
            skipSyncDb.current = next;
            return next;
          }
          if (foreign) {
            const next = { ...emptyDb, user: current.user, spaceKey };
            skipSyncDb.current = next;
            return next;
          }
          return { ...current, spaceKey };
        });
        pulled.current = true;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(resetTimer);
    };
  }, [userId, space, spaceKey, wsUrl]);

  const performSync = useCallback(async () => {
    if (conflictRef.current || authInvalidRef.current) return false;
    const { user: _user, spaceKey: _s, ...rest } = dbRef.current;
    const data = {
      ...rest,
      media: (rest.media || []).map((item) =>
        item.url && item.url.startsWith("data:")
          ? { ...item, url: null, localOnly: true }
          : item,
      ),
    };
    setSyncing(true);
    try {
      const baseRevision = revisionRef.current;
      const response = await fetch(wsUrl, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ data, revision: baseRevision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        preserveWorkspaceConflict(spaceKey, data, baseRevision, payload);
        conflictRef.current = true;
        setWorkspaceConflict(payload);
        return false;
      }
      if (response.status === 401) {
        authInvalidRef.current = true;
        setSyncError({
          code: "auth",
          message:
            "Sua sessão expirou. Suas últimas alterações continuam salvas neste navegador — entre novamente para voltar a sincronizar.",
        });
        return false;
      }
      if (!response.ok) {
        setSyncError({
          code: "server",
          message:
            "Não foi possível salvar suas últimas alterações agora. Vamos tentar de novo.",
        });
        return false;
      }
      const revision = Number(payload.revision);
      if (Number.isInteger(revision) && revision >= 0) {
        revisionRef.current = revision;
        storeWorkspaceRevision(spaceKey, revision);
      }
      setSyncError(null);
      return true;
    } catch {
      setSyncError({
        code: "network",
        message:
          "Você está sem conexão. Suas alterações serão sincronizadas assim que a internet voltar.",
      });
      return false;
    } finally {
      setSyncing(false);
    }
  }, [spaceKey, wsUrl]);

  useEffect(() => {
    if (db.user?.id && sessionStatus === "authenticated") {
      localStorage.setItem(ACTIVE_USER_KEY, db.user.id);
      localStorage.setItem(userStorageKey(db.user.id), JSON.stringify(db));
    }
    if (
      !userId ||
      !pulled.current ||
      db.spaceKey !== spaceKey ||
      !localStorage.getItem(AUTH_TOKEN_KEY)
    )
      return;
    if (skipSyncDb.current === db) {
      skipSyncDb.current = null;
      return;
    }
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      if (conflictRef.current || authInvalidRef.current) return;
      syncChain.current = syncChain.current
        .catch(() => {})
        .then(performSync)
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(syncTimer.current);
  }, [db, userId, space, spaceKey, performSync, sessionStatus]);

  const retrySync = () => {
    syncChain.current = syncChain.current
      .catch(() => {})
      .then(performSync)
      .catch(() => {});
  };
  const logoutFromExpiredSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    setDb(cleanDb(null));
    setSessionStatus("anonymous");
  };
  const markSessionAuthenticated = useCallback(
    () => setSessionStatus("authenticated"),
    [],
  );

  const workspaceAction = async (action, taskId) => {
    clearTimeout(syncTimer.current);
    await syncChain.current.catch(() => {});
    const synced = await performSync();
    if (!synced)
      throw new Error(
        "Não foi possível salvar suas alterações antes desta ação.",
      );
    const response = await fetch(
      `/api/tasks/action${space ? `?owner=${encodeURIComponent(space)}` : ""}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, taskId }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error || "Não foi possível atualizar esta tarefa.");
    const revision = Number(payload.revision);
    if (Number.isInteger(revision) && revision >= 0) {
      revisionRef.current = revision;
      storeWorkspaceRevision(spaceKey, revision);
    }
    if (payload.task) {
      setDb((current) => {
        const next = {
          ...current,
          tasks: (current.tasks || []).map((task) =>
            task.id === payload.task.id ? payload.task : task,
          ),
          updatedAt: payload.updatedAt || new Date().toISOString(),
        };
        skipSyncDb.current = next;
        return next;
      });
    }
    return payload;
  };

  const update = (fn) =>
    setDb((current) => {
      const next =
        typeof fn === "function" ? fn(current) : { ...current, ...fn };
      return { ...next, updatedAt: new Date().toISOString() };
    });
  return [
    db,
    update,
    workspaceConflict,
    syncing,
    syncError,
    retrySync,
    logoutFromExpiredSession,
    workspaceAction,
    sessionStatus,
    markSessionAuthenticated,
  ];
}

function WhatsappSendModal({ templates, payload, onClose, onSent }) {
  const list = templates && templates.length ? templates : DEFAULT_WA_TEMPLATES;
  const preferred =
    list.find((t) => t.category === payload.category) || list[0];
  const [templateId, setTemplateId] = useState(preferred?.id || "");
  const selected = list.find((t) => t.id === templateId) || preferred;
  const [text, setText] = useState(
    fillWhatsappTemplate(selected?.body || "", payload.vars),
  );
  const pickTemplate = (id) => {
    setTemplateId(id);
    const tpl = list.find((t) => t.id === id);
    setText(fillWhatsappTemplate(tpl?.body || "", payload.vars));
  };
  const send = () => {
    window.open(
      whatsappLink(payload.phone, text.trim()),
      "_blank",
      "noopener",
    );
    onSent?.(text.trim());
    onClose();
  };
  return (
    <Modal title="Enviar pelo WhatsApp" onClose={onClose}>
      <div className="wa-send">
        <Field label="Modelo">
          <select value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mensagem" hint="Você pode editar antes de enviar.">
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="wa-send-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Send} disabled={!text.trim()} onClick={send}>
            Abrir no WhatsApp
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Hook reutilizável: cada página que envia WhatsApp instancia isto, chama
// open({ phone, category, vars }) no clique e renderiza `modal` no JSX.
function useWhatsappSender({ db, setToast }) {
  const [payload, setPayload] = useState(null);
  const templates =
    db.waTemplates && db.waTemplates.length
      ? db.waTemplates
      : DEFAULT_WA_TEMPLATES;
  const open = (p) => {
    if (!p || !p.phone) {
      setToast?.("Este contato não tem um número de WhatsApp válido.");
      return;
    }
    setPayload(p);
  };
  const modal = payload ? (
    <WhatsappSendModal
      templates={templates}
      payload={payload}
      onClose={() => setPayload(null)}
      onSent={(text) =>
        logInteraction({
          channel: "whatsapp",
          direction: "out",
          contactId: payload.contactId || "",
          contactName:
            payload.contactName ||
            payload.vars?.nome ||
            payload.vars?.cliente ||
            payload.vars?.name ||
            "",
          contactHandle: payload.phone || "",
          body: text,
        })
      }
    />
  ) : null;
  return { open, modal };
}

// Movido para ./components/SharingFields.jsx.

function Toast({ toast }) {
  if (!toast) return null;
  const tom = tomDoToast(toast);
  const texto = textoDoToast(toast);
  const Icone = tom === "erro" ? CircleAlert : CheckCircle2;
  return (
    <div className={`toast ${tom === "erro" ? "erro" : ""}`} role="status" aria-live="polite">
      <Icone size={18} />
      {texto}
    </div>
  );
}

function AppUpdate({ visible, latestVersion }) {
  return visible ? (
    <div className="app-update" role="status" aria-live="polite">
      <span>
        <RefreshCw size={18} />
        <strong>Uma nova versão está pronta.</strong>
        {latestVersion
          ? `Versão ${latestVersion} disponível.`
          : "Atualize para receber as melhorias sem perder seus dados."}
      </span>
      <button type="button" onClick={() => location.reload()}>
        Atualizar agora
      </button>
    </div>
  ) : null;
}

// Movido para ./components/Markdown.jsx.

function ModeOnboarding({ update }) {
  const choose = (mode) => {
    update((d) => ({
      ...d,
      onboarding: mode === "employee" ? true : d.onboarding,
      preferences: {
        ...d.preferences,
        mode,
        modeChosen: true,
        needsBusinessOnboarding:
          mode === "business" &&
          d.preferences.needsBusinessOnboardingCandidate === true,
        needsBusinessOnboardingCandidate: false,
      },
    }));
    trackProductEvent("action_completed", {
      module: "onboarding",
      kind: "mode_selected",
      mode,
    });
  };
  return (
    <main className="onboarding">
      <header>
        <Logo />
      </header>
      <div className="onboard-card mode-onboard-card">
        <h1>Como você pretende usar o Seu Funcionário?</h1>
        <p>Você pode mudar isso quando quiser em Configurações.</p>
        <div className="option-grid mode-option-grid">
          <button
            type="button"
            aria-label="Para administrar meu negócio"
            onClick={() => choose("business")}
          >
            <BriefcaseBusiness />
            <span>
              <strong>Para administrar meu negócio</strong>
              <small>
                CRM, produtos, pedidos, financeiro, sites e faturamento para
                quem toca uma empresa ou trabalha por conta própria.
              </small>
            </span>
          </button>
          <button
            type="button"
            aria-label="Para me ajudar no meu trabalho"
            onClick={() => choose("employee")}
          >
            <UserRound />
            <span>
              <strong>Para me ajudar no meu trabalho</strong>
              <small>
                Tarefas, agenda, documentos e especialistas de IA para quem
                trabalha dentro de outra empresa.
              </small>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}

function Login({ update, onAuthenticated = () => {}, vertical = false, entryPortal = "" }) {
  // A raiz é a porta de entrada da To Do Green. Cliente e motorista usam
  // a mesma identidade, mas seguem para o próprio portal depois do login.
  const entradaToDoGreen =
    vertical ||
    Boolean(entryPortal) ||
    (typeof window !== "undefined" && /^\/todogreen(\/|$)/.test(window.location.pathname));
  const destinoAposLogin =
    entryPortal === "cliente"
      ? "/portal-cliente"
      : entryPortal === "motorista"
        ? "/portal-motorista"
        : entryPortal === "tms"
          ? "/portal-tms"
          : entryPortal === "colaborador"
            ? "/portal-colaborador"
            : entradaToDoGreen
              ? "/todogreen"
              : "";
  const tituloDoAcesso =
    entryPortal === "cliente"
      ? "Entre no Portal do Cliente"
      : entryPortal === "motorista"
        ? "Entre no Portal do Motorista"
        : entryPortal === "tms"
          ? "Entre no Portal TMS"
          : entryPortal === "colaborador"
            ? "Entre no Portal do Colaborador"
            : "Entre no ambiente To Do Green";
  const contextoDoAcesso =
    entryPortal === "cliente"
      ? {
          kicker: "PORTAL DO CLIENTE",
          helper:
            "Acompanhe pedidos, entregas, ocorrências, comprovantes e indicadores da sua operação.",
          secondary: "Primeiro acesso",
        }
      : entryPortal === "motorista"
        ? {
            kicker: "PORTAL DO MOTORISTA",
            helper:
              "Acesse viagens, coletas, entregas, ocorrências, documentos e comprovantes operacionais.",
            secondary: "Primeiro acesso",
          }
        : entryPortal === "tms"
          ? {
              kicker: "TMS",
              helper:
                "Gerencie cargas, viagens, roteirização, ocorrências, POD e faturamento operacional.",
              secondary: "Alterar senha inicial",
            }
          : entryPortal === "colaborador"
            ? {
                kicker: "PORTAL DO COLABORADOR",
                helper: "Acesse suas rotinas, documentos e informações de trabalho.",
                secondary: "Primeiro acesso",
              }
            : {
                kicker: "LOGIN PRIVADO",
                helper:
                  "Use o e-mail e a senha inicial recebidos. No primeiro acesso, altere a senha antes de usar a operação.",
                secondary: "Alterar senha inicial",
              };
  const [mode, setMode] = useState("login");
  // Simulador de impacto ESG: público, aberto por um botão na tela de entrada,
  // sem exigir login (pedido da titular).
  const [simuladorEsgAberto, setSimuladorEsgAberto] = useState(false);
  useEffect(() => {
    if (entradaToDoGreen)
      document.title =
        entryPortal === "cliente"
          ? "To Do Green | Portal do Cliente"
          : entryPortal === "motorista"
            ? "To Do Green | Portal do Motorista"
            : entryPortal === "tms"
              ? "To Do Green | Portal TMS"
              : entryPortal === "colaborador"
                ? "To Do Green | Portal do Colaborador"
                : "To Do Green";
  }, [entradaToDoGreen, entryPortal]);

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState("");
  const [showLegal, setShowLegal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Pedido de acesso à To Do Green: quem não tem conta pede aqui e um
  // administrador decide dentro do app. Fica só na entrada da To Do Green.
  const [pedindoAcesso, setPedindoAcesso] = useState(false);
  const [pedidoForm, setPedidoForm] = useState({ nome: "", email: "", empresa: "", telefone: "", mensagem: "" });
  const [pedidoStatus, setPedidoStatus] = useState("");
  const enviarPedidoDeAcesso = async (evento) => {
    evento.preventDefault();
    setPedidoStatus("enviando");
    try {
      const resposta = await fetch("/api/todogreen/solicitar-acesso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pedidoForm),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || "Não foi possível registrar o pedido.");
      setPedidoStatus("enviado");
    } catch (razao) {
      setPedidoStatus(razao.message || "Não foi possível registrar o pedido.");
    }
  };
  const googleRef = useRef(null);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setGoogleId(d.googleClientId || ""))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!googleId) return;
    const handle = (resp) => {
      fetch("/api/auth/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: resp.credential }),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) throw new Error(d.error || "Falha no login com Google.");
          localStorage.setItem(AUTH_TOKEN_KEY, d.token);
          if (destinoAposLogin) history.replaceState({}, "", destinoAposLogin);
          onAuthenticated();
          update(() => {
            const session = startUserSession(d.user);
            return {
              ...session,
              preferences: {
                ...session.preferences,
                needsBusinessOnboardingCandidate: destinoAposLogin
                  ? false
                  : d.created === true || d.isNew === true,
              },
            };
          });
        })
        .catch((e) => setError(e.message));
    };
    const init = () => {
      if (!window.google?.accounts?.id || !googleRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleId,
        callback: handle,
      });
      googleRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        locale: "pt-BR",
      });
    };
    if (window.google?.accounts?.id) {
      init();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = init;
    document.body.appendChild(s);
  }, [destinoAposLogin, googleId, onAuthenticated, update]);
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const changeMode = (next) => {
    setMode(next);
    setError("");
    setForm((current) => ({ ...current, password: "" }));
  };
  const enter = (data, newAccount = false) => {
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    // A identidade da porta de entrada define o destino. Não voltamos ao
    // produto genérico depois de autenticar uma pessoa da To Do Green.
    if (destinoAposLogin) history.replaceState({}, "", destinoAposLogin);
    onAuthenticated();
    update(() => {
      const session = startUserSession(data.user);
      return {
        ...session,
        preferences: {
          ...session.preferences,
          needsBusinessOnboardingCandidate: destinoAposLogin ? false : newAccount,
        },
      };
    });
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const email = form.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return setError("Informe um e-mail válido.");
    if (form.password.length < 8)
      return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (mode === "register" && form.name.trim().length < 2)
      return setError("Informe seu nome.");
    setBusy(true);
    try {
      const response = await fetch(
        `/api/auth/${mode === "login" ? "login" : "register"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email,
            password: form.password,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Não foi possível acessar sua conta.");
      if (data.pending) {
        setPending(data.email);
        setCode("");
        return;
      }
      enter(data, mode === "register");
    } catch (reason) {
      setError(
        reason.message === "Failed to fetch"
          ? "Não foi possível conectar ao servidor. Tente novamente."
          : reason.message,
      );
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pending, code }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || "Não foi possível confirmar o código.");
      enter(data, mode === "register");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setError("");
    try {
      const r = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pending }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Não foi possível reenviar.");
      setError("Novo código enviado. Confira seu e-mail.");
    } catch (reason) {
      setError(reason.message);
    }
  };
  const [recover, setRecover] = useState(null);
  const forgot = async () => {
    const email = form.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return setError("Digite seu e-mail no campo acima e clique de novo.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || "Não foi possível enviar o código.");
      setRecover({ email });
      setCode("");
      setForm((c) => ({ ...c, password: "" }));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const doReset = async () => {
    if (code.length < 6) return setError("Digite o código de 6 dígitos.");
    if (form.password.length < 8)
      return setError("A nova senha precisa ter pelo menos 8 caracteres.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: recover.email,
          code,
          password: form.password,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || "Não foi possível redefinir a senha.");
      enter(data);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  if (recover)
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            {entradaToDoGreen ? <strong className="tdg-auth-marca">To Do Green</strong> : <Logo />}
          </span>
          <span className="eyebrow">RECUPERAR ACESSO</span>
          <h2>Redefinir senha</h2>
          <p>
            Enviamos um código de 6 dígitos para{" "}
            <strong>{recover.email}</strong>. Digite o código e escolha a nova
            senha.
          </p>
          <Field label="Código de 6 dígitos">
            <input
              className="code-input"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
            />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres">
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </Field>
          {error && (
            <div className="auth-error" role="alert">
              <CircleAlert />
              {error}
            </div>
          )}
          <Button
            className="full"
            icon={busy ? RefreshCw : KeyRound}
            disabled={busy}
            onClick={doReset}
          >
            {busy ? "Redefinindo..." : "Redefinir e entrar"}
          </Button>
          <p className="auth-switch">
            <button
              type="button"
              onClick={() => {
                setRecover(null);
                setCode("");
                setError("");
              }}
            >
              Voltar para o login
            </button>
          </p>
        </div>
      </main>
    );
  if (pending)
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            {entradaToDoGreen ? <strong className="tdg-auth-marca">To Do Green</strong> : <Logo />}
          </span>
          <span className="eyebrow">VERIFICAÇÃO DE E-MAIL</span>
          <h2>Confirme seu e-mail</h2>
          <p>
            Enviamos um código de 6 dígitos para <strong>{pending}</strong>.
            Digite abaixo para ativar sua conta.
          </p>
          <Field label="Código de 6 dígitos">
            <input
              className="code-input"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
            />
          </Field>
          {error && (
            <div className="auth-error" role="alert">
              <CircleAlert />
              {error}
            </div>
          )}
          <Button
            className="full"
            icon={busy ? RefreshCw : CheckCircle2}
            disabled={busy || code.length < 6}
            onClick={verify}
          >
            {busy ? "Verificando..." : "Confirmar e entrar"}
          </Button>
          <p className="auth-switch">
            Não recebeu?{" "}
            <button type="button" onClick={resend}>
              Reenviar código
            </button>{" "}
            ·{" "}
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setCode("");
                setError("");
              }}
            >
              Voltar
            </button>
          </p>
        </div>
      </main>
    );
  if (entradaToDoGreen)
    return (
      <main className={`auth-shell tdg-auth-entry tdg-auth-entry-${entryPortal || "erp"}`}>
        <section className="tdg-auth-panel" aria-label={tituloDoAcesso}>
          <div className="tdg-auth-brand-panel" aria-label="To Do Green">
            <img src="/logo-todo-green.png" alt="To Do Green" />
          </div>
          <div className="tdg-auth-form-panel">
            <div className="auth-card tdg-auth-card">
              <span className="eyebrow tdg-auth-kicker">{contextoDoAcesso.kicker}</span>
              <h2>Entrar</h2>
              <p className="tdg-auth-helper">{contextoDoAcesso.helper}</p>

              <form onSubmit={submit}>
                <Field label="E-mail">
                  <input
                    required
                    autoFocus
                    autoComplete="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="seu@exemplo.com"
                  />
                </Field>
                <Field label="Senha">
                  <span className="auth-password">
                    <input
                      required
                      minLength="8"
                      autoComplete="current-password"
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Digite sua senha"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </Field>

                {error && (
                  <div className="auth-error" role="alert">
                    <CircleAlert />
                    {error}
                  </div>
                )}

                <Button
                  className="full tdg-auth-primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "Aguarde..." : "Entrar"}
                </Button>
              </form>

              <button
                type="button"
                className="tdg-auth-secondary"
                onClick={forgot}
                disabled={busy}
              >
                {contextoDoAcesso.secondary}
              </button>

              {!entryPortal && !pedindoAcesso && pedidoStatus !== "enviado" && (
                <button
                  type="button"
                  className="tdg-auth-request-link"
                  onClick={() => setPedindoAcesso(true)}
                >
                  Ainda não tem acesso? Solicitar acesso
                </button>
              )}

              {!entryPortal && pedindoAcesso && pedidoStatus !== "enviado" && (
                <form className="tdg-auth-pedido tdg-auth-pedido-inline" onSubmit={enviarPedidoDeAcesso}>
                  <strong>Solicitar acesso à To Do Green</strong>
                  <label>
                    <span>Nome</span>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      value={pedidoForm.nome}
                      onChange={(e) => setPedidoForm((f) => ({ ...f, nome: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>E-mail corporativo</span>
                    <input
                      type="email"
                      required
                      maxLength={160}
                      value={pedidoForm.email}
                      onChange={(e) => setPedidoForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Empresa / área</span>
                    <input
                      type="text"
                      maxLength={160}
                      value={pedidoForm.empresa}
                      onChange={(e) => setPedidoForm((f) => ({ ...f, empresa: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Telefone (opcional)</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={pedidoForm.telefone}
                      onChange={(e) => setPedidoForm((f) => ({ ...f, telefone: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Por que precisa de acesso?</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={pedidoForm.mensagem}
                      onChange={(e) => setPedidoForm((f) => ({ ...f, mensagem: e.target.value }))}
                    />
                  </label>
                  {pedidoStatus && pedidoStatus !== "enviando" && (
                    <p className="tdg-auth-pedido-erro">{pedidoStatus}</p>
                  )}
                  <div className="tdg-auth-pedido-acoes">
                    <button
                      type="button"
                      onClick={() => {
                        setPedindoAcesso(false);
                        setPedidoStatus("");
                      }}
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      className="tdg-auth-solicitar"
                      disabled={pedidoStatus === "enviando"}
                    >
                      {pedidoStatus === "enviando" ? "Enviando..." : "Enviar pedido"}
                    </button>
                  </div>
                </form>
              )}

              {!entryPortal && pedidoStatus === "enviado" && (
                <p className="tdg-auth-request-status">
                  Pedido enviado. Você receberá um convite por e-mail se for aprovado.
                </p>
              )}

              <p className="auth-legal tdg-auth-legal">
                <button type="button" onClick={() => setShowLegal(true)}>
                  Termos de Uso e Política de Privacidade
                </button>
              </p>
            </div>
          </div>
        </section>
        {showLegal && (
          <Modal
            title="Termos de Uso e Política de Privacidade"
            onClose={() => setShowLegal(false)}
          >
            <LegalContent />
          </Modal>
        )}
      </main>
    );

  return (
    <main className="auth-shell">
      {simuladorEsgAberto && (
        <div className="tdg-sim-overlay" role="dialog" aria-modal="true" aria-label="Simulador de impacto ESG">
          <div className="tdg-sim-overlay-bar">
            <strong>Simulador de impacto ESG</strong>
            <button type="button" onClick={() => setSimuladorEsgAberto(false)} aria-label="Fechar simulador">
              <X size={18} /> Fechar
            </button>
          </div>
          <div className="tdg-sim-overlay-body">
            <Suspense fallback={<div className="tdg-sim-overlay-load">Carregando simulador…</div>}>
              <EsgEmissionSimulator />
            </Suspense>
          </div>
        </div>
      )}
      <div className="auth-art">
        {entradaToDoGreen ? <strong className="tdg-auth-marca">To Do Green</strong> : <Logo />}
        {entradaToDoGreen ? (
          <div>
            <span className="eyebrow light">TRANSPORTADORA 100% ELÉTRICA</span>
            <h1>
              Ambiente corporativo <em>To Do Green.</em>
            </h1>
            <p>
              Acesso restrito à equipe autorizada. Entre com o e-mail liberado
              pela administração para abrir o ERP, o CRM e a operação.
            </p>
          </div>
        ) : (
          <div>
            <span className="eyebrow light">SEU NEGÓCIO EM MOVIMENTO</span>
            <h1>
              Tenha o funcionário que sua empresa precisa,{" "}
              <em>quando precisar.</em>
            </h1>
            <p>
              Mais de 40 funcionários especialistas — estratégia, jurídico,
              marketing, vendas, financeiro, TI e muito mais — coordenados por um
              Diretor de Inteligência.
            </p>
          </div>
        )}
        <div className="auth-chips">
          {entradaToDoGreen ? (
            <>
              <span>
                <Target />
                Operação
              </span>
              <span>
                <WandSparkles />
                Frota elétrica
              </span>
              <span>
                <CheckCircle2 />
                ESG
              </span>
            </>
          ) : (
            <>
              <span>
                <Target />
                Planeje
              </span>
              <span>
                <WandSparkles />
                Crie
              </span>
              <span>
                <CheckCircle2 />
                Execute
              </span>
            </>
          )}
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-card">
          <span className="mobile-logo">
            {entradaToDoGreen ? <strong className="tdg-auth-marca">To Do Green</strong> : <Logo />}
          </span>
          <div className="auth-perfis" role="group" aria-label="Escolha seu acesso">
            <button
              type="button"
              className={!entryPortal ? "active" : ""}
              aria-pressed={!entryPortal}
              onClick={() => window.location.assign("/")}
            >
              Equipe To Do Green
            </button>
            <button
              type="button"
              className={entryPortal === "cliente" ? "active" : ""}
              aria-pressed={entryPortal === "cliente"}
              onClick={() => window.location.assign("/portal-cliente")}
            >
              Portal do Cliente
            </button>
            <button
              type="button"
              className={entryPortal === "motorista" ? "active" : ""}
              aria-pressed={entryPortal === "motorista"}
              onClick={() => window.location.assign("/portal-motorista")}
            >
              Portal do Motorista
            </button>
            <button
              type="button"
              className={entryPortal === "tms" ? "active" : ""}
              aria-pressed={entryPortal === "tms"}
              onClick={() => window.location.assign("/portal-tms")}
            >
              Portal TMS
            </button>
          </div>
          {entradaToDoGreen && (
            <div className="auth-social" aria-label="To Do Green nas redes">
              <a
                href="https://br.linkedin.com/company/todogreen"
                target="_blank"
                rel="noreferrer noopener"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </svg>
                LinkedIn
              </a>
              <a
                href="https://www.todogreen.com.br"
                target="_blank"
                rel="noreferrer noopener"
              >
                <Globe2 aria-hidden="true" />
                Site oficial
              </a>
            </div>
          )}
          {entradaToDoGreen && (
            <div className="tdg-auth-ctas">
              <button
                type="button"
                className="tdg-auth-simulador"
                onClick={() => setSimuladorEsgAberto(true)}
              >
                <Leaf aria-hidden="true" />
                Simulador de Emissão
              </button>
              {/* CTA de prospecção: qualquer pessoa (sem login) fala direto com
                  o comercial da To Do Green no WhatsApp. Número da titular, com
                  DDI 55 + DDD 11, e uma mensagem já preenchida. */}
              <a
                className="tdg-auth-cotacao"
                href={whatsappLink(
                  "5511951006360",
                  "Olá! Vim pela plataforma da To Do Green e quero fazer uma cotação de frete.",
                )}
                target="_blank"
                rel="noreferrer noopener"
              >
                <MessageSquareText aria-hidden="true" />
                Quero fazer uma cotação
              </a>
            </div>
          )}
          {!entradaToDoGreen && (
            <div className="auth-tabs" role="tablist" aria-label="Acesso">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "active" : ""}
                onClick={() => changeMode("login")}
              >
                Entrar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "active" : ""}
                onClick={() => changeMode("register")}
              >
                Criar conta
              </button>
            </div>
          )}
          <span className="eyebrow">
            {entradaToDoGreen ? "ACESSO TO DO GREEN" : mode === "login" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}
          </span>
          <h2>
            {entradaToDoGreen
              ? mode === "login"
                ? tituloDoAcesso
                : "Crie sua conta autorizada"
              : mode === "login"
                ? "Entre no seu espaço"
                : "Crie seu espaço de trabalho"}
          </h2>
          <p>
            {mode === "login"
              ? "Use o e-mail e a senha cadastrados para continuar."
              : "Crie sua conta gratuita. Nenhum cartão é necessário."}
          </p>
          {googleId && (
            <>
              <div ref={googleRef} className="google-btn" />
              <div className="or-divider">
                <span>ou use e-mail</span>
              </div>
            </>
          )}
          <form onSubmit={submit}>
            {mode === "register" && (
              <Field label="Seu nome">
                <input
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Como podemos chamar você?"
                />
              </Field>
            )}
            <Field label="E-mail">
              <input
                required
                autoFocus={mode === "login"}
                autoComplete="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="voce@empresa.com"
              />
            </Field>
            <Field
              label="Senha"
              hint={mode === "register" ? "Mínimo de 8 caracteres" : undefined}
            >
              {/* Sem o olho, quem erra a senha não tem como conferir o que
                  digitou — a causa mais comum de "não consigo entrar". */}
              <span className="auth-password">
                <input
                  required
                  minLength="8"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </Field>
            {error && (
              <div className="auth-error" role="alert">
                <CircleAlert />
                {error}
              </div>
            )}
            <Button
              className="full"
              type="submit"
              icon={ArrowRight}
              disabled={busy}
            >
              {busy
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : "Criar minha conta"}
            </Button>
          </form>
          <div className="auth-switch">
            {!entradaToDoGreen && (
              <span>
                {mode === "login"
                  ? "Ainda não tem uma conta?"
                  : "Já possui uma conta?"}{" "}
                <button
                  type="button"
                  onClick={() =>
                    changeMode(mode === "login" ? "register" : "login")
                  }
                >
                  {mode === "login" ? "Criar conta" : "Entrar"}
                </button>
              </span>
            )}
            {mode === "login" && (
              <button type="button" onClick={forgot} disabled={busy}>
                Esqueci minha senha
              </button>
            )}
          </div>
          {entradaToDoGreen && !entryPortal && !pedindoAcesso && pedidoStatus !== "enviado" && (
            <div className="auth-invite-note">
              <p>
                O acesso à To Do Green é liberado pela administração. Se ainda
                não tem login, solicite abaixo — um administrador avalia e
                libera dentro do app.
              </p>
              <button type="button" className="tdg-auth-solicitar" onClick={() => setPedindoAcesso(true)}>
                Solicitar acesso
              </button>
            </div>
          )}
          {entradaToDoGreen && !entryPortal && pedindoAcesso && pedidoStatus !== "enviado" && (
            <form className="tdg-auth-pedido" onSubmit={enviarPedidoDeAcesso}>
              <strong>Solicitar acesso à To Do Green</strong>
              <label>
                <span>Nome</span>
                <input
                  type="text" required maxLength={160} value={pedidoForm.nome}
                  onChange={(e) => setPedidoForm((f) => ({ ...f, nome: e.target.value }))}
                />
              </label>
              <label>
                <span>E-mail corporativo</span>
                <input
                  type="email" required maxLength={160} value={pedidoForm.email}
                  onChange={(e) => setPedidoForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label>
                <span>Empresa / área</span>
                <input
                  type="text" maxLength={160} value={pedidoForm.empresa}
                  onChange={(e) => setPedidoForm((f) => ({ ...f, empresa: e.target.value }))}
                />
              </label>
              <label>
                <span>Telefone (opcional)</span>
                <input
                  type="text" maxLength={40} value={pedidoForm.telefone}
                  onChange={(e) => setPedidoForm((f) => ({ ...f, telefone: e.target.value }))}
                />
              </label>
              <label>
                <span>Por que precisa de acesso?</span>
                <textarea
                  rows={3} maxLength={1000} value={pedidoForm.mensagem}
                  onChange={(e) => setPedidoForm((f) => ({ ...f, mensagem: e.target.value }))}
                />
              </label>
              {pedidoStatus && pedidoStatus !== "enviando" && (
                <p className="tdg-auth-pedido-erro">{pedidoStatus}</p>
              )}
              <div className="tdg-auth-pedido-acoes">
                <button type="button" onClick={() => { setPedindoAcesso(false); setPedidoStatus(""); }}>
                  Voltar
                </button>
                <button type="submit" className="tdg-auth-solicitar" disabled={pedidoStatus === "enviando"}>
                  {pedidoStatus === "enviando" ? "Enviando..." : "Enviar pedido"}
                </button>
              </div>
            </form>
          )}
          {entradaToDoGreen && !entryPortal && pedidoStatus === "enviado" && (
            <p className="auth-invite-note tdg-auth-pedido-ok">
              Pedido enviado. Um administrador da To Do Green vai avaliar e você
              receberá um convite por e-mail se for aprovado.
            </p>
          )}
          <p className="privacy">
            <ShieldCheck />
            Senha protegida com criptografia. Seus dados ficam na sua conta e
            acompanham você em qualquer dispositivo.
          </p>
          <p className="auth-legal">
            <button type="button" onClick={() => setShowLegal(true)}>
              Termos de Uso e Política de Privacidade
            </button>
          </p>
        </div>
      </div>
      {showLegal && (
        <Modal
          title="Termos de Uso e Política de Privacidade"
          onClose={() => setShowLegal(false)}
        >
          <LegalContent />
        </Modal>
      )}
    </main>
  );
}

function enterSharedSpace(ownerId, ownerName) {
  try {
    localStorage.setItem("sf-space", ownerId);
    localStorage.setItem("sf-space-name", ownerName || "Espaço compartilhado");
  } catch {}
  history.replaceState({}, "", "/");
  location.reload();
}

function AcceptInvite({ db, update, token, onAuthenticated = () => {} }) {
  const [state, setState] = useState({ status: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(null);

  useEffect(() => {
    fetch(`/api/collab/invite-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) return setState({ status: "error", message: d.error });
        setState({ status: "ready", invite: d });
      })
      .catch(() => setState({ status: "error", message: "Não foi possível carregar o convite." }));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/collab/invite/accept", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(
          state.invite.hasAccount ? { token } : { token, password },
        ),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível aceitar o convite.");
      if (d.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, d.token);
        onAuthenticated();
        update(() => startUserSession(d.user));
      }
      setAccepted({ ownerId: d.ownerId, ownerName: d.ownerName });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (accepted)
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <span className="eyebrow">CONVITE ACEITO</span>
          <h2>Bem-vindo(a) ao espaço de {accepted.ownerName}</h2>
          <p>Você já pode acessar as ferramentas e os dados liberados para você.</p>
          <Button
            className="full"
            icon={ArrowUpRight}
            onClick={() => enterSharedSpace(accepted.ownerId, accepted.ownerName)}
          >
            Entrar no espaço
          </Button>
        </div>
      </main>
    );

  if (state.status === "loading")
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <p>Carregando convite...</p>
        </div>
      </main>
    );

  if (state.status === "error")
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <span className="eyebrow">CONVITE</span>
          <h2>Não foi possível abrir este convite</h2>
          <div className="auth-error" role="alert">
            <CircleAlert />
            {state.message}
          </div>
          <p className="auth-switch">
            <a href="/">Voltar para o início</a>
          </p>
        </div>
      </main>
    );

  const invite = state.invite;
  const wrongAccount =
    db.user && invite.hasAccount && db.user.email !== invite.email;
  const rightAccount =
    db.user && invite.hasAccount && db.user.email === invite.email;

  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="mobile-logo">
          <Logo />
        </span>
        <span className="eyebrow">CONVITE DE {invite.ownerName.toUpperCase()}</span>
        <h2>Você foi convidado(a) como {ROLE_LABELS_PT[invite.role] || "Colaborador"}</h2>
        <p>
          Convite enviado para <strong>{invite.email}</strong>.
        </p>
        {invite.hasAccount ? (
          wrongAccount ? (
            <>
              <div className="auth-error" role="alert">
                <CircleAlert />
                Você está logado(a) como {db.user.email}. Entre com a conta{" "}
                {invite.email} para aceitar este convite.
              </div>
              <Button
                className="full"
                variant="secondary"
                icon={LogOut}
                onClick={() => {
                  endSession();
                  update(() => cleanDb(null));
                }}
              >
                Sair e entrar com outra conta
              </Button>
            </>
          ) : rightAccount ? (
            <>
              {error && (
                <div className="auth-error" role="alert">
                  <CircleAlert />
                  {error}
                </div>
              )}
              <Button
                className="full"
                icon={busy ? RefreshCw : ArrowUpRight}
                disabled={busy}
                onClick={accept}
              >
                {busy ? "Aceitando..." : "Aceitar convite"}
              </Button>
            </>
          ) : (
            <p className="auth-switch">
              Você já possui conta. Entre com {invite.email} e volte a este
              link para aceitar.{" "}
              <a href="/">Ir para o login</a>
            </p>
          )
        ) : (
          <>
            <Field label="Crie uma senha" hint="Mínimo de 8 caracteres">
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            {error && (
              <div className="auth-error" role="alert">
                <CircleAlert />
                {error}
              </div>
            )}
            <Button
              className="full"
              icon={busy ? RefreshCw : ArrowUpRight}
              disabled={busy || password.length < 8}
              onClick={accept}
            >
              {busy ? "Criando conta..." : "Criar conta e aceitar convite"}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

const ROLE_LABELS_PT = {
  admin: "Administrador",
  gestor: "Gestor",
  colaborador: "Colaborador",
};

function Onboarding({ db, update }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    stage: "Tenho apenas uma ideia",
    hasBusiness: "Sim",
    name: "",
    industryCategoryId: "outros",
    industryActivity: "",
    segment: "",
    need: "Organizar os próximos passos",
    weeklyGoal: "",
    areas: ["Estratégia"],
  });
  const finish = (skip) => {
    let business = null;
    let starterTask = null;
    if (!skip) {
      const businessId = uid();
      const category = industryCategoryById(form.industryCategoryId);
      const businessTypeId = profileTypeForIndustry(
        form.industryCategoryId,
        form.industryActivity,
      );
      const enabledPacks = recommendedPackIds(businessTypeId);
      const firstActions = {
        "Organizar os próximos passos": "Definir as 3 prioridades desta semana",
        "Conseguir clientes": "Listar 10 possíveis clientes e preparar o primeiro contato",
        "Criar minha marca": "Registrar a proposta e o tom da marca",
        "Definir preços": "Calcular o preço do principal produto ou serviço",
        "Organizar a operação": "Descrever o processo que mais precisa de organização",
        "Criar um site": "Reunir os textos e informações para o primeiro site",
      };
      business = {
        id: businessId,
        name: form.name.trim() || "Meu negócio",
        owner: db.user.name,
        industryCategoryId: form.industryCategoryId,
        industryCategoryLabel: category?.label || "Outros",
        industryActivity: form.industryActivity,
        businessTypeId,
        businessTypeLabel: businessTypeLabel({ businessTypeId }),
        segment:
          form.segment.trim() ||
          form.industryActivity ||
          category?.label ||
          "",
        menuMode: "custom",
        enabledPacks,
        stage: form.stage,
        goal: form.need,
        hasBusiness: form.hasBusiness,
        focusAreas: businessPackLabels(enabledPacks).join(", "),
        weeklyGoal: form.weeklyGoal.trim() || form.need,
        city: "",
        audience: "",
        offer: "",
        tone: "Profissional e acolhedor",
        createdAt: today(),
        main: true,
      };
      starterTask = {
        id: uid(),
        title: firstActions[form.need] || "Dar o primeiro passo do meu plano",
        description: `Primeira ação sugerida para avançar em: ${form.weeklyGoal.trim() || form.need}.`,
        instructions:
          "Comece com o que você já sabe, registre o resultado e use o chat da tarefa se precisar de orientação.",
        priority: "Alta",
        status: "A fazer",
        due: today(),
        area: "Operação",
        ownerId: db.user.id,
        businessId,
        visibility: "privado",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    update((d) => ({
      ...d,
      onboarding: true,
      businesses: business ? [business, ...d.businesses] : d.businesses,
      tasks: starterTask ? [starterTask, ...(d.tasks || [])] : d.tasks,
      selectedBusinessId: business?.id || d.selectedBusinessId,
      preferences: {
        ...d.preferences,
        needsBusinessOnboarding: false,
      },
    }));
    trackProductEvent("onboarding_completed", {
      mode: db.preferences.mode || "business",
      success: true,
      kind: skip ? "skipped" : "guided",
    });
  };
  const stages = [
    "Tenho apenas uma ideia",
    "Estou estruturando o negócio",
    "Estou começando a vender",
    "Já tenho clientes",
    "Quero organizar a operação",
    "Quero aumentar as vendas",
    "Quero profissionalizar a empresa",
    "Quero expandir",
  ];
  const needs = [
    "Organizar os próximos passos",
    "Conseguir clientes",
    "Criar minha marca",
    "Definir preços",
    "Organizar a operação",
    "Criar um site",
  ];
  return (
    <main className="onboarding">
      <header>
        <Logo />
        <button className="text-button" onClick={() => finish(true)}>
          Pular por enquanto
        </button>
      </header>
      <section className="onboard-card">
        <div className="steps">
          <span className={step >= 0 ? "active" : ""} />
          <span className={step >= 1 ? "active" : ""} />
          <span className={step >= 2 ? "active" : ""} />
        </div>
        {step === 0 && (
          <>
            <span className="eyebrow">PASSO 1 DE 3</span>
            <h1>Onde seu negócio está hoje?</h1>
            <p>Isso ajuda a mostrar as ferramentas mais úteis para você.</p>
            <div className="option-grid">
              {stages.map((s) => (
                <button
                  key={s}
                  className={form.stage === s ? "selected" : ""}
                  onClick={() => setForm({ ...form, stage: s })}
                >
                  {form.stage === s ? <CheckCircle2 /> : <Circle />}
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <span className="eyebrow">PASSO 2 DE 3</span>
            <h1>Conte um pouco sobre o negócio</h1>
            <p>Você pode completar e editar tudo depois.</p>
            <div className="form-grid">
              <Field label="Você já possui um negócio em atividade?">
                <select
                  value={form.hasBusiness}
                  onChange={(e) =>
                    setForm({ ...form, hasBusiness: e.target.value })
                  }
                >
                  <option>Sim</option>
                  <option>Não, estou começando</option>
                </select>
              </Field>
              <Field label="Nome do negócio">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Ateliê Aurora"
                />
              </Field>
              <Field label="Categoria do negócio">
                <select
                  value={form.industryCategoryId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      industryCategoryId: e.target.value,
                      industryActivity: "",
                    })
                  }
                >
                  {BUSINESS_INDUSTRY_CATALOG.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Atividade específica">
                <select
                  value={form.industryActivity}
                  onChange={(e) =>
                    setForm({ ...form, industryActivity: e.target.value })
                  }
                >
                  <option value="">Selecione a atividade</option>
                  {(industryCategoryById(form.industryCategoryId)?.activities || []).map(
                    (activity) => (
                      <option key={activity} value={activity}>
                        {activity}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field
                label="Como você descreve o segmento"
                hint="Opcional. Use se o negócio for híbrido ou muito específico."
              >
                <input
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  placeholder="Ex.: criadora de conteúdo sobre beleza e carreira"
                />
              </Field>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <span className="eyebrow">PASSO 3 DE 3</span>
            <h1>O que mais precisa resolver agora?</h1>
            <p>Seu painel será organizado a partir desta prioridade.</p>
            <div className="option-grid compact">
              {needs.map((s) => (
                <button
                  key={s}
                  className={form.need === s ? "selected" : ""}
                  onClick={() => setForm({ ...form, need: s })}
                >
                  {form.need === s ? <CheckCircle2 /> : <Circle />}
                  {s}
                </button>
              ))}
            </div>
            <Field
              label="Que resultado você quer alcançar nesta semana?"
              hint="Opcional. Você poderá ajustar essa meta na página inicial."
            >
              <input
                value={form.weeklyGoal}
                onChange={(e) =>
                  setForm({ ...form, weeklyGoal: e.target.value })
                }
                placeholder="Ex.: enviar 5 propostas ou organizar as despesas"
              />
            </Field>
          </>
        )}
        <footer>
          <Button
            variant="ghost"
            icon={ChevronLeft}
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Voltar
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>
              Continuar <ChevronRight size={17} />
            </Button>
          ) : (
            <Button icon={Sparkles} onClick={() => finish(false)}>
              Preparar meu painel
            </Button>
          )}
        </footer>
      </section>
    </main>
  );
}

function BusinessForm({ value, onSave, onClose }) {
  const [f, setF] = useState(
    {
      name: "",
      owner: "",
      industryCategoryId: "outros",
      industryActivity: "",
      businessTypeId: "outro",
      menuMode: "custom",
      enabledPacks: recommendedPackIds("outro"),
      segment: "",
      stage: "Estou estruturando o negócio",
      city: "",
      audience: "",
      offer: "",
      goal: "",
      tone: "Profissional e acolhedor",
      differentiators: "",
      competitors: "",
      channels: "",
      website: "",
      social: "",
      priceRange: "",
      challenges: "",
      visualIdentity: "",
      focusAreas: "",
      ...(value || {}),
    },
  );
  const save = (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const category = industryCategoryById(f.industryCategoryId);
    const businessTypeId = profileTypeForIndustry(
      f.industryCategoryId,
      f.industryActivity,
    );
    const enabledPacks =
      Array.isArray(f.enabledPacks) && f.enabledPacks.length
        ? f.enabledPacks
        : recommendedPackIds(businessTypeId);
    onSave({
      ...f,
      id: f.id || uid(),
      name: f.name.trim(),
      industryCategoryLabel: category?.label || "Outros",
      businessTypeId,
      businessTypeLabel: businessTypeLabel({ businessTypeId }),
      segment:
        f.segment.trim() || f.industryActivity || category?.label || "",
      enabledPacks,
      focusAreas:
        f.focusAreas?.trim() || businessPackLabels(enabledPacks).join(", "),
      createdAt: f.createdAt || today(),
    });
  };
  return (
    <form className="modal-body" onSubmit={save}>
      <div className="form-grid">
        <Field label="Nome do negócio">
          <input
            required
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Responsável">
          <input
            value={f.owner}
            onChange={(e) => setF({ ...f, owner: e.target.value })}
          />
        </Field>
        <Field label="Categoria do negócio">
          <select
            value={f.industryCategoryId || "outros"}
            onChange={(e) => {
              const categoryId = e.target.value;
              const businessTypeId = profileTypeForIndustry(categoryId);
              setF({
                ...f,
                industryCategoryId: categoryId,
                industryActivity: "",
                businessTypeId,
                enabledPacks: recommendedPackIds(businessTypeId),
                menuMode: "custom",
              });
            }}
          >
            {BUSINESS_INDUSTRY_CATALOG.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Atividade específica">
          <select
            value={f.industryActivity || ""}
            onChange={(e) => {
              const activity = e.target.value;
              const businessTypeId = profileTypeForIndustry(
                f.industryCategoryId,
                activity,
              );
              setF({
                ...f,
                industryActivity: activity,
                businessTypeId,
                enabledPacks: recommendedPackIds(businessTypeId),
                menuMode: "custom",
              });
            }}
          >
            <option value="">Selecione a atividade</option>
            {(industryCategoryById(f.industryCategoryId)?.activities || []).map(
              (activity) => (
                <option key={activity} value={activity}>
                  {activity}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Descrição livre do segmento">
          <input
            value={f.segment}
            onChange={(e) => setF({ ...f, segment: e.target.value })}
            placeholder="Use para negócios híbridos ou muito específicos"
          />
        </Field>
        <Field label="Estágio">
          <select
            value={f.stage}
            onChange={(e) => setF({ ...f, stage: e.target.value })}
          >
            <option>Tenho apenas uma ideia</option>
            <option>Estou estruturando o negócio</option>
            <option>Estou começando a vender</option>
            <option>Já tenho clientes</option>
            <option>Quero organizar a operação</option>
            <option>Quero aumentar as vendas</option>
            <option>Quero profissionalizar a empresa</option>
            <option>Quero expandir</option>
          </select>
        </Field>
        <Field label="Cidade ou região">
          <input
            value={f.city}
            onChange={(e) => setF({ ...f, city: e.target.value })}
          />
        </Field>
        <Field label="Público-alvo">
          <input
            value={f.audience}
            onChange={(e) => setF({ ...f, audience: e.target.value })}
          />
        </Field>
        <Field label="Produtos ou serviços">
          <textarea
            value={f.offer}
            onChange={(e) => setF({ ...f, offer: e.target.value })}
          />
        </Field>
        <Field label="Objetivo principal">
          <textarea
            value={f.goal}
            onChange={(e) => setF({ ...f, goal: e.target.value })}
          />
        </Field>
        <Field label="Tom de comunicação">
          <input
            value={f.tone}
            onChange={(e) => setF({ ...f, tone: e.target.value })}
          />
        </Field>
        <Field label="Diferenciais">
          <textarea
            value={f.differentiators || ""}
            onChange={(e) => setF({ ...f, differentiators: e.target.value })}
            placeholder="O que faz clientes escolherem este negócio?"
          />
        </Field>
        <Field label="Concorrentes e referências">
          <textarea
            value={f.competitors || ""}
            onChange={(e) => setF({ ...f, competitors: e.target.value })}
            placeholder="Nomes, links ou alternativas consideradas pelo cliente"
          />
        </Field>
        <Field label="Canais de venda e atendimento">
          <input
            value={f.channels || ""}
            onChange={(e) => setF({ ...f, channels: e.target.value })}
            placeholder="Ex.: loja, WhatsApp, Instagram, indicação"
          />
        </Field>
        <Field label="Site">
          <input
            type="url"
            value={f.website || ""}
            onChange={(e) => setF({ ...f, website: e.target.value })}
            placeholder="https://"
          />
        </Field>
        <Field label="Redes sociais">
          <input
            value={f.social || ""}
            onChange={(e) => setF({ ...f, social: e.target.value })}
            placeholder="@perfil ou links"
          />
        </Field>
        <Field label="Faixa de preço">
          <input
            value={f.priceRange || ""}
            onChange={(e) => setF({ ...f, priceRange: e.target.value })}
            placeholder="Ex.: R$ 80 a R$ 350"
          />
        </Field>
        <Field label="Principais dificuldades">
          <textarea
            value={f.challenges || ""}
            onChange={(e) => setF({ ...f, challenges: e.target.value })}
          />
        </Field>
        <Field label="Áreas prioritárias">
          <input
            value={f.focusAreas || ""}
            onChange={(e) => setF({ ...f, focusAreas: e.target.value })}
            placeholder="Ex.: vendas, financeiro, marketing"
          />
        </Field>
        <Field label="Identidade visual atual">
          <textarea
            value={f.visualIdentity || ""}
            onChange={(e) => setF({ ...f, visualIdentity: e.target.value })}
            placeholder="Cores, tipografia, símbolos e materiais existentes"
          />
        </Field>
      </div>
      <div className="modal-actions">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" icon={Save}>
          Salvar negócio
        </Button>
      </div>
    </form>
  );
}

function NewEmployeeModal({ onClose, onSave }) {
  const [f, setF] = useState({ name: "", instructions: "" });
  const submit = (e) => {
    e.preventDefault();
    const name = f.name.trim().slice(0, 48);
    const instructions = f.instructions.trim().slice(0, 800);
    if (name.length < 3 || instructions.length < 20) return;
    onSave({ name, instructions });
  };
  return (
    <Modal title="Contratar novo funcionário" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice">
          <Sparkles />
          <span>
            Descreva a especialidade e o Seu Funcionário cria um especialista
            sob medida — por setor, profissão, projeto ou problema específico.
            Ele fica salvo na sua equipe.
          </span>
        </div>
        <Field
          label="Área ou especialidade"
          hint="Ex.: Tráfego pago, Licitações, Clínicas, Exportação..."
        >
          <input
            required
            autoFocus
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 48) })}
            placeholder="Ex.: Licitações públicas"
          />
        </Field>
        <Field
          label="O que esse funcionário deve saber e fazer"
          hint="Mínimo de 20 caracteres"
        >
          <textarea
            required
            value={f.instructions}
            onChange={(e) =>
              setF({ ...f, instructions: e.target.value.slice(0, 800) })
            }
            placeholder="Ex.: Especialista em vender para o governo: encontra editais adequados, monta checklist de documentos, analisa requisitos e prepara propostas."
          />
        </Field>
        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon={Plus}>
            Contratar funcionário
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function UniversalRequest({ db, update, business, setToast }) {
  const [text, setText] = useState(
    () => localStorage.getItem("sf-draft") || "",
  );
  const [busy, setBusy] = useState(false);
  const [newEmployee, setNewEmployee] = useState(false);
  const [error, setError] = useState("");
  const [revealing, setRevealing] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const endRef = useRef(null);
  const chatUploadRef = useRef(null);
  const composerRef = useRef(null);
  const abortRef = useRef(null);
  const stoppedRef = useRef(false);
  const stopGenerating = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  };
  const applyStarter = (starter) => {
    setText(starter);
    composerRef.current?.focus();
  };
  const specialist = db.preferences.specialist;
  const conversations = db.conversations || [];
  const active =
    conversations.find((x) => x.id === db.selectedConversationId) || null;
  const messages = useMemo(() => active?.messages || [], [active?.messages]);
  // Comprimento da última mensagem: muda a cada token durante o streaming,
  // fazendo o auto-scroll acompanhar a resposta enquanto ela é gerada.
  const streamingLen = messages.length
    ? messages[messages.length - 1].content?.length || 0
    : 0;
  useEffect(() => {
    localStorage.setItem("sf-draft", text);
  }, [text]);
  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (typeof el?.scrollTo === "function")
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, revealing?.count, streamingLen]);
  useEffect(() => {
    if (!revealing?.id) return;
    const message = messages.find((item) => item.id === revealing.id);
    if (!message || revealing.count >= message.content.length) {
      const timer = setTimeout(() => setRevealing(null), 0);
      return () => clearTimeout(timer);
    }
    const step = Math.max(2, Math.ceil(message.content.length / 180));
    const timer = setTimeout(
      () =>
        setRevealing((current) =>
          current?.id === message.id
            ? {
                ...current,
                count: Math.min(message.content.length, current.count + step),
              }
            : current,
        ),
      18,
    );
    return () => clearTimeout(timer);
  }, [revealing, messages]);
  const newChat = () => {
    update((d) => ({ ...d, selectedConversationId: null }));
    setText("");
    setError("");
  };
  const attachDocuments = async (fileList) => {
    const files = [...(fileList || [])].slice(0, 3 - attachments.length);
    if (!files.length || attachmentBusy) return;
    setAttachmentBusy(true);
    setError("");
    const next = [];
    const failed = [];
    for (const file of files) {
      try {
        const extracted = await extractDocumentText(file);
        next.push({
          id: uid(),
          name: file.name,
          size: file.size,
          kind: extracted.kind.label,
          content: extracted.content.slice(0, 12_000),
        });
      } catch (uploadError) {
        failed.push(`${file.name}: ${uploadError.message}`);
      }
    }
    if (next.length) {
      setAttachments((current) => [...current, ...next].slice(0, 3));
      setToast(
        next.length === 1
          ? "Documento anexado à conversa"
          : `${next.length} documentos anexados`,
      );
    }
    if (failed.length) setError(failed.join(" "));
    setAttachmentBusy(false);
    if (chatUploadRef.current) chatUploadRef.current.value = "";
  };
  const saveMessage = (message) => {
    const item = {
      id: uid(),
      title: active?.title || "Conversa com IA",
      request: messages.find((x) => x.role === "user")?.content || "",
      result: message.content,
      specialist,
      businessId: business?.id || null,
      ownerId: db.user.id,
      visibility: "privado",
      type: "Conversa salva",
      status: "Concluído",
      createdAt: new Date().toISOString(),
    };
    update((d) => ({ ...d, history: [item, ...d.history] }));
    setToast("Resposta salva em Projetos e Histórico");
  };
  const saveMessageAsDocument = (message) => {
    const title = active?.title || "Documento criado com IA";
    if (
      !confirm(
        `Será criado um documento privado chamado "${title}". O texto da resposta será salvo e poderá ser editado antes de qualquer envio. Continuar?`,
      )
    )
      return;
    const now = new Date().toISOString();
    update((current) => ({
      ...current,
      documents: [
        {
          id: uid(),
          title,
          type: "Documento criado com IA",
          content: message.content,
          businessId: business?.id || null,
          ownerId: db.user.id,
          visibility: "privado",
          sharingPermission: "visualizar",
          versions: [],
          createdAt: now,
          updatedAt: now,
        },
        ...(current.documents || []),
      ],
    }));
    trackProductEvent("record_created", {
      module: "documentos",
      source: "chat",
      kind: "ai_response",
    });
    setToast("Documento criado; revise antes de compartilhar");
  };
  const createTaskFromMessage = (message) => {
    const title = active?.title || "Aplicar orientação da IA";
    if (
      !confirm(
        `Será criada uma tarefa privada chamada "${title}", com a resposta como orientação. Nenhuma outra ação será executada. Continuar?`,
      )
    )
      return;
    const now = new Date().toISOString();
    update((current) => ({
      ...current,
      tasks: [
        {
          id: uid(),
          title,
          description: "Ação criada a partir de uma conversa com a IA.",
          instructions: message.content.slice(0, 4000),
          priority: "Média",
          status: "A fazer",
          due: today(),
          area: specialist || "Operação",
          businessId: business?.id || null,
          ownerId: db.user.id,
          visibility: "privado",
          createdAt: now,
          updatedAt: now,
        },
        ...(current.tasks || []),
      ],
    }));
    trackProductEvent("record_created", {
      module: "operacao",
      source: "chat",
      kind: "task",
    });
    setToast("Tarefa criada com a orientação da conversa");
  };
  const saveMessageAsTaskOutput = (message) => {
    const sourceTask = (db.tasks || []).find(
      (task) => task.id === active?.sourceTaskId,
    );
    if (!sourceTask) {
      setToast("A tarefa de origem não foi encontrada");
      return;
    }
    if (
      !confirm(
        `Anexar esta entrega à tarefa "${sourceTask.title}"? A tarefa não será concluída automaticamente.`,
      )
    )
      return;
    const now = new Date().toISOString();
    update((current) => ({
      ...current,
      tasks: (current.tasks || []).map((task) =>
        task.id === sourceTask.id
          ? {
              ...task,
              aiOutputs: [
                {
                  id: uid(),
                  content: String(message.content || "").slice(0, 8_000),
                  specialist: active?.specialist || specialist,
                  conversationId: active?.id || "",
                  provider: message.provider || "",
                  model: message.model || "",
                  createdAt: now,
                },
                ...(task.aiOutputs || []),
              ].slice(0, 3),
              updatedAt: now,
            }
          : task,
      ),
    }));
    setToast("Entrega anexada à tarefa para conferência");
  };
  const submit = async () => {
    if ((!text.trim() && !attachments.length) || busy) return;
    const prompt =
        text.trim() ||
        "Analise os documentos anexados e apresente um resumo, pontos importantes e próximas ações.",
      attachmentContext = attachments.length
        ? `\n\nDOCUMENTOS ANEXADOS PELO USUÁRIO:\n${attachments
            .map(
              (item, index) =>
                `\n--- Documento ${index + 1}: ${item.name} ---\n${item.content}`,
            )
            .join("\n")}`
        : "",
      aiPrompt = `${prompt}${attachmentContext}`.slice(0, 48_000),
      conversationId = active?.id || uid(),
      userMessage = {
        id: uid(),
        role: "user",
        content: prompt,
        attachments: attachments.map(({ name, size, kind }) => ({
          name,
          size,
          kind,
        })),
        createdAt: new Date().toISOString(),
      };
    const previousMessages = messages;
    update((d) => {
      const list = d.conversations || [],
        exists = list.some((x) => x.id === conversationId),
        conversation = exists
          ? null
          : {
              id: conversationId,
              title: prompt.slice(0, 55),
              businessId: business?.id || null,
              specialist,
              ownerId: db.user.id,
              createdAt: new Date().toISOString(),
              messages: [],
            };
      return {
        ...d,
        selectedConversationId: conversationId,
        conversations: exists
          ? list.map((x) =>
              x.id === conversationId
                ? {
                    ...x,
                    messages: [...x.messages, userMessage],
                    updatedAt: new Date().toISOString(),
                  }
                : x,
            )
          : [{ ...conversation, messages: [userMessage] }, ...list],
      };
    });
    setText("");
    setAttachments([]);
    localStorage.setItem("sf-draft", "");
    setBusy(true);
    setError("");
    const aiBody = {
      prompt: aiPrompt,
      specialist,
      messages: [...previousMessages, userMessage]
        .slice(-10)
        .map((x) => ({ role: x.role, content: x.content })),
      ...aiWorkspaceContext(business),
    };
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 70000);
    abortRef.current = controller;
    stoppedRef.current = false;
    let streamed = false;
    try {
      try {
        if (specialist === "Diretor") throw { skipStream: true };
        const sres = await fetch("/api/ai/stream", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          signal: controller.signal,
          body: JSON.stringify(aiBody),
        });
        if (
          sres.ok &&
          (sres.headers.get("content-type") || "").includes(
            "text/event-stream",
          ) &&
          sres.body
        ) {
          const amId = uid();
          const amMsg = {
            id: amId,
            role: "assistant",
            content: "",
            toolIds: recommendedTools(prompt).map((x) => x.id),
            createdAt: new Date().toISOString(),
          };
          update((d) => ({
            ...d,
            conversations: (d.conversations || []).map((x) =>
              x.id === conversationId
                ? {
                    ...x,
                    messages: [...x.messages, amMsg],
                    updatedAt: new Date().toISOString(),
                  }
                : x,
            ),
          }));
          const reader = sres.body.getReader();
          const dec = new TextDecoder();
          let buf = "",
            acc = "",
            prov = null,
            mdl = null;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const chunks = buf.split("\n\n");
            buf = chunks.pop() || "";
            for (const chunk of chunks) {
              const line = chunk
                .split("\n")
                .find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                const j = JSON.parse(line.slice(5).trim());
                if (j.t) {
                  acc += j.t;
                  const cur = acc;
                  update((d) => ({
                    ...d,
                    conversations: (d.conversations || []).map((x) =>
                      x.id === conversationId
                        ? {
                            ...x,
                            messages: x.messages.map((m) =>
                              m.id === amId ? { ...m, content: cur } : m,
                            ),
                          }
                        : x,
                    ),
                  }));
                } else if (j.done) {
                  prov = j.provider;
                  mdl = j.model;
                }
              } catch {}
            }
          }
          if (acc.trim()) {
            update((d) => ({
              ...d,
              conversations: (d.conversations || []).map((x) =>
                x.id === conversationId
                  ? {
                      ...x,
                      messages: x.messages.map((m) =>
                        m.id === amId ? { ...m, provider: prov, model: mdl } : m,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : x,
              ),
            }));
            setToast("Resposta pronta");
            trackProductEvent("ai_completed", {
              module: "chat",
              kind: specialist,
              success: true,
            });
            streamed = true;
          } else {
            update((d) => ({
              ...d,
              conversations: (d.conversations || []).map((x) =>
                x.id === conversationId
                  ? {
                      ...x,
                      messages: x.messages.filter((m) => m.id !== amId),
                    }
                  : x,
              ),
            }));
          }
        }
      } catch (streamErr) {
        if (streamErr.name === "AbortError") {
          // Parada pelo usuário: mantém o texto parcial já recebido e não trata
          // como erro. Timeout real (não-stoppedRef) segue para o catch externo.
          if (stoppedRef.current) {
            streamed = true;
            setToast("Geração interrompida");
          } else throw streamErr;
        }
      }
      if (!streamed) {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        signal: controller.signal,
        body: JSON.stringify(aiBody),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error || "Não foi possível obter uma resposta agora.",
        );
      const assistantMessage = {
        id: uid(),
        role: "assistant",
        content: data.content,
        degraded: !!data.degraded,
        toolIds: recommendedTools(prompt).map((x) => x.id),
        createdAt: new Date().toISOString(),
      };
      update((d) => ({
        ...d,
        conversations: (d.conversations || []).map((x) =>
          x.id === conversationId
            ? {
                ...x,
                messages: [...x.messages, assistantMessage],
                updatedAt: new Date().toISOString(),
              }
            : x,
        ),
      }));
      setRevealing({ id: assistantMessage.id, count: 0 });
      setToast(data.degraded ? "Plano inicial preparado" : "Resposta pronta");
      trackProductEvent("ai_completed", {
        module: "chat",
        kind: specialist,
        success: true,
      });
      }
    } catch (err) {
      setText(prompt);
      setError(
        err.name === "AbortError"
          ? "A resposta demorou demais. Seu texto foi restaurado para tentar novamente."
          : err.message,
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
      abortRef.current = null;
      stoppedRef.current = false;
    }
  };
  const renderToolLink = (id) => {
    const tool = toolCatalog.find((x) => x.id === id);
    if (!tool) return null;
    const ToolIcon = tool.icon;
    return (
      <a href={tool.url} target="_blank" rel="noreferrer" key={id}>
        <ToolIcon />
        <span>
          <strong>{tool.name}</strong>
          <small>{toolBadgeLabel(tool)}</small>
        </span>
        <ExternalLink />
      </a>
    );
  };
  return (
    <section className="ask-card chat-card">
      <div className="ask-top">
        <div>
          <span className="spark-dot">
            <Sparkles />
          </span>
          <div>
            <h2>{active?.title || "O que você precisa resolver hoje?"}</h2>
            <p>Converse, complemente e refine sem perder o contexto.</p>
          </div>
        </div>
        <div className="chat-head-actions">
          <span className="business-context">
            <Building2 />
            {business?.name || "Nenhum negócio selecionado"}
          </span>
          {active && (
            <button
              className="icon-button danger"
              title="Excluir esta conversa"
              onClick={() => {
                if (
                  confirm(
                    "Excluir esta conversa? Respostas salvas em Projetos são mantidas.",
                  )
                )
                  update((d) => ({
                    ...d,
                    conversations: (d.conversations || []).filter(
                      (x) => x.id !== active.id,
                    ),
                    selectedConversationId: null,
                  }));
              }}
            >
              <Trash2 />
            </button>
          )}
          <Button variant="ghost" icon={Plus} onClick={newChat}>
            Nova conversa
          </Button>
        </div>
      </div>
      {conversations.length > 0 && (
        <div className="conversation-tabs">
          {conversations.slice(0, 5).map((c) => (
            <button
              className={c.id === active?.id ? "active" : ""}
              key={c.id}
              onClick={() =>
                update((d) => ({ ...d, selectedConversationId: c.id }))
              }
            >
              <MessageSquareText />
              <span className="tab-title">{c.title}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`chat-messages ${messages.length ? "has-messages" : ""}`}>
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <Bot />
            <h3>Seu agente está pronto</h3>
            <p>
              Peça uma análise, material, plano ou orientação. Quando uma
              ferramenta externa for melhor, eu mostro o caminho certo.
            </p>
            <div className="prompt-starters">
              {[
                "Monte um plano de ações para esta semana no meu negócio",
                "Escreva uma mensagem educada de cobrança para um cliente",
                "Analise meus números e diga onde posso melhorar",
                "Crie uma descrição de vaga para um ajudante",
              ].map((starter) => (
                <button
                  type="button"
                  key={starter}
                  onClick={() => applyStarter(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`chat-message ${message.role}`} key={message.id}>
              <span className="message-avatar">
                {message.role === "assistant" ? <Sparkles /> : db.user.name[0]}
              </span>
              <div className="message-content">
                <small>
                  {message.role === "assistant"
                    ? "Seu Funcionário"
                    : db.user.name}
                </small>
                {message.role === "assistant" ? (
                  <div
                    className={
                      revealing?.id === message.id ? "revealing-answer" : ""
                    }
                  >
                    <Markdown
                      text={
                        revealing?.id === message.id
                          ? message.content.slice(0, revealing.count)
                          : message.content
                      }
                    />
                  </div>
                ) : (
                  <>
                    <pre>{message.content}</pre>
                    {message.attachments?.length > 0 && (
                      <div className="message-attachments">
                        {message.attachments.map((item) => (
                          <span key={item.name}>
                            <FileText /> {item.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {message.toolIds?.length > 0 && (
                  <div className="message-tools">
                    {message.toolIds.map(renderToolLink)}
                  </div>
                )}
                {message.role === "assistant" &&
                  revealing?.id !== message.id && (
                    <div className="message-actions">
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(message.content);
                          setToast("Resposta copiada");
                        }}
                      >
                        <Copy />
                        Copiar
                      </button>
                      <button onClick={() => saveMessage(message)}>
                        <Save />
                        Salvar em projetos
                      </button>
                      <button onClick={() => saveMessageAsDocument(message)}>
                        <FileText />
                        Criar documento
                      </button>
                      <button onClick={() => createTaskFromMessage(message)}>
                        <ListTodo />
                        Criar tarefa
                      </button>
                      {active?.sourceTaskId && (
                        <button onClick={() => saveMessageAsTaskOutput(message)}>
                          <Paperclip />
                          Anexar à tarefa
                        </button>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))
        )}
        {busy && (
          <div className="chat-message assistant">
            <span className="message-avatar pensando">
              <img src="/mascote-48.png" alt="" width="22" height="22" />
            </span>
            <div className="typing">
              <i />
              <i />
              <i />
              <span>Organizando sua resposta...</span>
              <button
                type="button"
                className="stop-generating"
                onClick={stopGenerating}
              >
                <Square />
                Parar
              </button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-composer">
        <input
          ref={chatUploadRef}
          className="visually-hidden"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
          aria-label="Anexar documentos ao chat"
          onChange={(event) => attachDocuments(event.target.files)}
        />
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((item) => (
              <span key={item.id}>
                <FileText />
                <b>{item.name}</b>
                <button
                  aria-label={`Remover ${item.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((attachment) => attachment.id !== item.id),
                    )
                  }
                >
                  <X />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={composerRef}
          aria-label="Mensagem para a IA"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 8000))}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Escreva sua mensagem..."
        />
        <div className="ask-actions">
          <div className="specialist-select">
            <span>Com</span>
            <select
              aria-label="Funcionário"
              value={specialist}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new") {
                  setNewEmployee(true);
                  return;
                }
                update((d) => ({
                  ...d,
                  preferences: { ...d.preferences, specialist: v },
                }));
              }}
            >
              <optgroup label="Equipe padrão">
                {specialistData.map((s) => (
                  <option key={s[0]} value={s[0]}>
                    {s[0]}
                  </option>
                ))}
              </optgroup>
              {(db.customSpecialists || []).length > 0 && (
                <optgroup label="Meus funcionários">
                  {db.customSpecialists.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="__new">+ Contratar novo funcionário...</option>
            </select>
          </div>
          <span className="keyboard-hint">
            Enter envia · Shift + Enter quebra linha
          </span>
          <span className="ai-live" title="Assistência inteligente disponível">
            <span />
            Assistente online
          </span>
          <span className="counter">{text.length}/8000</span>
          <Button
            variant="ghost"
            icon={attachmentBusy ? RefreshCw : Upload}
            disabled={attachmentBusy || attachments.length >= 3}
            onClick={() => chatUploadRef.current?.click()}
          >
            {attachmentBusy ? "Lendo..." : "Anexar documento"}
          </Button>
          <Button
            icon={Send}
            disabled={(!text.trim() && !attachments.length) || busy}
            onClick={submit}
          >
            {busy ? "Pensando..." : "Enviar"}
          </Button>
        </div>
        {error && (
          <div className="ask-error">
            <CircleAlert />
            {error}
          </div>
        )}
      </div>
      {busy && (
        <div className="progress-line">
          <span />
        </div>
      )}
      {newEmployee && (
        <NewEmployeeModal
          onClose={() => setNewEmployee(false)}
          onSave={(emp) => {
            update((d) => ({
              ...d,
              customSpecialists: [
                ...(d.customSpecialists || []).filter(
                  (x) => x.name !== emp.name,
                ),
                emp,
              ],
              preferences: { ...d.preferences, specialist: emp.name },
            }));
            setNewEmployee(false);
            setToast(`Funcionário de ${emp.name} contratado`);
          }}
        />
      )}
    </section>
  );
}

function Dashboard({ db, update, business, go, setToast, visibleNav }) {
  const isEmployeeMode = (db.preferences.mode || "business") === "employee";
  const [team, setTeam] = useState({ members: [], invites: [] });
  const [goalDraft, setGoalDraft] = useState(business?.weeklyGoal || "");
  useEffect(() => {
    const id = setTimeout(() => setGoalDraft(business?.weeklyGoal || ""), 0);
    return () => clearTimeout(id);
  }, [business?.id, business?.weeklyGoal]);
  useEffect(() => {
    if (isEmployeeMode) return;
    const space = activeSpaceId();
    fetch(`/api/collab${space ? `?owner=${encodeURIComponent(space)}` : ""}`, {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTeam({ members: d.members || [], invites: d.invites || [] }))
      .catch(() => {});
  }, [isEmployeeMode]);
  const managerStats = {
    activeMembers: team.members.filter((m) => m.status !== "suspenso").length,
    pendingInvites: team.invites.filter((i) => i.status === "enviado").length,
    awaitingReview: db.tasks.filter(
      (t) => t.isMission && t.missionStatus === "enviada_para_revisao",
    ).length,
    overdue: db.tasks.filter(
      (t) => t.due && t.due < today() && t.status !== "Concluído",
    ).length,
    pendingPayouts: db.tasks.filter(
      (t) => Number(t.reward) > 0 && t.rewardStatus === "aprovada",
    ).length,
  };
  const myTasks = db.tasks.filter(
    (t) =>
      t.assigneeId === db.user.id ||
      (t.assignees || []).some((a) => a.userId === db.user.id),
  );
  const collaboratorStats = {
    inProgress: myTasks.filter((t) => t.status !== "Concluído").length,
    inReview: myTasks.filter((t) => t.missionStatus === "enviada_para_revisao")
      .length,
    correctionsNeeded: myTasks.filter(
      (t) => t.missionStatus === "correcao_solicitada",
    ).length,
  };
  const myPlan = (db.developmentPlans || []).find(
    (p) => p.assigneeId === db.user.id,
  );
  const activeTasks = db.tasks.filter(
    (x) => x.status !== "Concluído" && (!business || x.businessId === business.id),
  );
  const followups = db.leads.filter(
    (x) =>
      (!business || x.businessId === business.id) &&
      x.status !== "Ganho" &&
      x.status !== "Perdido",
  );
  const upcomingAppointments = (db.appointments || [])
    .filter(
      (a) =>
        (!business || a.businessId === business.id) &&
        a.status !== "Cancelado" &&
        a.date >= today(),
    )
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .slice(0, 4);
  const recent = db.history
    .filter((x) => !business || x.businessId === business.id)
    .slice(0, 3);
  const selectSpecialist = (name) => {
    update((d) => ({ ...d, preferences: { ...d.preferences, specialist: name } }));
    setToast(`${name} selecionado — envie sua mensagem abaixo`);
  };
  const quickEmployee = [
    ["Organizar minha semana", ListTodo, "operacao"],
    ["Organizar tarefas e prioridades", CheckCircle2, "operacao"],
    ["Escrever um e-mail ou mensagem", Mail, "ferramentas"],
    ["Resumir ou analisar um documento", FileText, "documentos"],
    ["Registrar resultados e entregas", History, "historico"],
  ];
  const quickEmployeeSpecialists = [
    ["Preparar uma reunião", Users, "Reuniões"],
    ["Criar uma apresentação", Layers, "Apresentações"],
    ["Planejar um projeto", ListTodo, "Projetos"],
    ["Preparar uma conversa com meu gestor", MessageSquareText, "Liderança"],
    ["Melhorar um processo de trabalho", Workflow, "Processos"],
  ];
  const quickBase = [
    ["Validar uma ideia", Lightbulb, "comecar"],
    ["Montar meus preços", Calculator, "financeiro"],
    ["Encontrar clientes", Users, "vendas"],
    ["Criar um site", Globe2, "sites"],
    ["Organizar tarefas", ListTodo, "operacao"],
    ["Criar uma proposta", FileText, "documentos"],
    ["Traduzir um texto", Languages, "ferramentas"],
    ["Analisar meus números", Filter, "ferramentas"],
  ];
  const priorityText =
    `${business?.goal || ""} ${business?.focusAreas || ""}`.toLowerCase();
  const recommendedPage = /preç|finance/.test(priorityText)
    ? "financeiro"
    : /cliente|vend/.test(priorityText)
      ? "vendas"
      : /site/.test(priorityText)
        ? "sites"
        : /marca|marketing/.test(priorityText)
          ? "estrategia"
          : /opera|process|tarefa/.test(priorityText)
            ? "operacao"
            : "comecar";
  const quick = [...quickBase].sort(
    (a, b) =>
      Number(b[2] === recommendedPage) - Number(a[2] === recommendedPage),
  );
  const thisWeek = weekRange();
  const weekSummary = computeWeeklySummary(db, thisWeek.start, thisWeek.end);
  const gamificationEnabled = db.preferences.gamificationEnabled !== false;
  const myPoints = useMemo(
    () => computeUserPoints(db.tasks, db.user.id),
    [db.tasks, db.user.id],
  );
  const myLevel = levelForPoints(myPoints, db.levels || DEFAULT_LEVELS);
  const myLevelProgress = levelProgress(myPoints, db.levels || DEFAULT_LEVELS);
  const myAchievements = useMemo(
    () => computeAchievements(db.tasks, db.user.id),
    [db.tasks, db.user.id],
  );
  const achievementIds = useMemo(
    () => myAchievements.map((a) => a.id).join(","),
    [myAchievements],
  );
  const focus = nextBestAction(db, business, db.user.id);
  const saveWeeklyGoal = (event) => {
    event.preventDefault();
    if (!business || !goalDraft.trim()) return;
    update((current) => ({
      ...current,
      businesses: (current.businesses || []).map((item) =>
        item.id === business.id
          ? { ...item, weeklyGoal: goalDraft.trim() }
          : item,
      ),
    }));
    trackProductEvent("weekly_goal_saved", { module: "inicio", success: true });
    setToast("Meta da semana atualizada");
  };
  useEffect(() => {
    if (!gamificationEnabled || myAchievements.length === 0) return;
    const key = `seu-funcionario-achievements-seen:${db.user.id}`;
    let seen = [];
    try {
      seen = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      seen = [];
    }
    const newOnes = myAchievements.filter((a) => !seen.includes(a.id));
    if (newOnes.length === 0) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify([...seen, ...newOnes.map((a) => a.id)]),
      );
    } catch {}
    update((d) => ({
      ...d,
      notifications: newOnes.reduce(
        (list, a) =>
          pushNotification(list, {
            recipientId: db.user.id,
            message: `Conquista desbloqueada: ${a.label}`,
            link: "inicio",
            createdBy: db.user.id,
          }),
        d.notifications,
      ),
    }));
  }, [achievementIds, db.user.id, gamificationEnabled, myAchievements, update]);
  return (
    <>
      <HomeHub
        db={db}
        update={update}
        business={business}
        go={go}
        setToast={setToast}
        visibleNav={visibleNav}
        navGroups={navGroups}
        aiTools={aiTools}
        specialists={specialistData}
        businessCatalog={BUSINESS_INDUSTRY_CATALOG}
      />
      {gamificationEnabled && myPoints > 0 && (
        <div className="progress-card">
          <div>
            <span className="eyebrow">MEU PROGRESSO</span>
            <h2>
              {myLevel.name} · {myPoints} pontos
            </h2>
            {myLevelProgress.next ? (
              <div className="level-progress">
                <div className="level-progress-bar">
                  <div
                    className="level-progress-fill"
                    style={{ width: `${myLevelProgress.pct}%` }}
                  />
                </div>
                <small>
                  Faltam {myLevelProgress.pointsToNext} pontos para{" "}
                  {myLevelProgress.next.name}
                </small>
              </div>
            ) : (
              <small className="level-progress-max">
                Nível máximo alcançado
              </small>
            )}
          </div>
          {myAchievements.length > 0 && (
            <div className="achievement-chips">
              {myAchievements.map((a) => (
                <span key={a.id} className="chip on">
                  <Award size={14} /> {a.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="welcome">
        <div>
          <span className="eyebrow">CENTRAL DE TRABALHO</span>
          <h1>
            Olá, {db.user.name.split(" ")[0]}.{" "}
            <span>Vamos fazer acontecer?</span>
          </h1>
          <p>
            {business ? (
              <>
                <strong>{business.name}</strong> está na fase “{business.stage}
                ”.
              </>
            ) : isEmployeeMode ? (
              "Organize sua semana e conte com a IA para o seu trabalho."
            ) : (
              "Crie seu primeiro negócio para receber um painel personalizado."
            )}
          </p>
        </div>
        <div className="day-badge">
          <span>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long" })}
          </span>
          <strong>{new Date().getDate()}</strong>
          <small>
            {new Date().toLocaleDateString("pt-BR", { month: "short" })}
          </small>
        </div>
      </div>
      <section className={`today-focus ${focus.tone || "default"}`} id="today-focus">
        <div className="today-focus-main">
          <span className="eyebrow">{focus.eyebrow}</span>
          <h2>{focus.title}</h2>
          <p>{focus.text}</p>
          <Button icon={ArrowUpRight} onClick={() => go(focus.page)}>
            {focus.action}
          </Button>
        </div>
        {!isEmployeeMode && business && (
          <form className="weekly-goal" onSubmit={saveWeeklyGoal}>
            <label htmlFor="weekly-goal-input">Meta desta semana</label>
            <input
              id="weekly-goal-input"
              value={goalDraft}
              onChange={(event) => setGoalDraft(event.target.value)}
              placeholder="Qual resultado precisa estar pronto?"
            />
            <Button variant="secondary" type="submit" disabled={!goalDraft.trim()}>
              Salvar meta
            </Button>
          </form>
        )}
      </section>
      {!isEmployeeMode && (
        <section className="week-summary" id="week-summary">
          <div className="section-head">
            <div>
              <span className="eyebrow">SUA SEMANA</span>
              <h2>Resumo de {dayRangeLabel(thisWeek.start, thisWeek.end)}</h2>
            </div>
          </div>
          {weekSummary.hasActivity ? (
            <div className="week-stats">
              <div>
                <span className="week-stat-icon g2">
                  <ShoppingBag />
                </span>
                <div>
                  <small>Vendas</small>
                  <strong>{weekSummary.sales}</strong>
                  <span>{money(weekSummary.salesRevenue)}</span>
                </div>
              </div>
              <div>
                <span className="week-stat-icon g5">
                  <ArrowUpRight />
                </span>
                <div>
                  <small>Entrou em caixa</small>
                  <strong>{money(weekSummary.cashIn)}</strong>
                  <span>Saldo {money(weekSummary.cashNet)}</span>
                </div>
              </div>
              <div>
                <span className="week-stat-icon g0">
                  <CheckCircle2 />
                </span>
                <div>
                  <small>Tarefas concluídas</small>
                  <strong>{weekSummary.tasksDone}</strong>
                  {weekSummary.tasksReward > 0 && (
                    <span>{money(weekSummary.tasksReward)}</span>
                  )}
                </div>
              </div>
              <div>
                <span className="week-stat-icon g3">
                  <Users />
                </span>
                <div>
                  <small>Novos contatos</small>
                  <strong>{weekSummary.newLeads}</strong>
                </div>
              </div>
            </div>
          ) : (
            <p className="week-empty">
              Sem movimento registrado nesta semana ainda. Registre uma venda,
              conclua uma tarefa ou adicione um contato — os números aparecem
              aqui na hora.
            </p>
          )}
          <small className="week-summary-note">
            Ative as notificações do navegador em Configurações para receber
            esse resumo toda segunda-feira, mesmo com o app fechado.
          </small>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">ATALHOS</span>
            <h2>Comece por aqui</h2>
          </div>
        </div>
        <div className="quick-grid">
          {isEmployeeMode ? (
            <>
              {quickEmployee.map(([t, I, p], i) => (
                <button key={t} onClick={() => go(p)}>
                  <span className={`quick-icon q${i % 6}`}>
                    <I />
                  </span>
                  <span>
                    <strong>{t}</strong>
                    <small>Abrir ferramenta</small>
                  </span>
                  <ArrowUpRight />
                </button>
              ))}
              {quickEmployeeSpecialists.map(([t, I, name], i) => (
                <button key={t} onClick={() => selectSpecialist(name)}>
                  <span className={`quick-icon q${(i + quickEmployee.length) % 6}`}>
                    <I />
                  </span>
                  <span>
                    <strong>{t}</strong>
                    <small>Conversar com a IA</small>
                  </span>
                  <ArrowUpRight />
                </button>
              ))}
            </>
          ) : (
            quick.map(([t, I, p], i) => (
              <button key={t} onClick={() => go(p)}>
                <span className={`quick-icon q${i % 6}`}>
                  <I />
                </span>
                <span>
                  <strong>{t}</strong>
                  <small>Abrir ferramenta</small>
                </span>
                <ArrowUpRight />
              </button>
            ))
          )}
        </div>
      </section>
      {isEmployeeMode ? (
        (collaboratorStats.inProgress > 0 ||
          collaboratorStats.inReview > 0 ||
          collaboratorStats.correctionsNeeded > 0 ||
          myPlan) && (
          <section className="section">
            <div className="section-head">
              <div>
                <span className="eyebrow">PAINEL DO COLABORADOR</span>
                <h2>Meu resumo</h2>
              </div>
            </div>
            <div className="settings-links">
              <div className="settings-stat">
                <ListTodo />
                <span>
                  <strong>{collaboratorStats.inProgress}</strong> tarefas em
                  andamento comigo
                </span>
              </div>
              <div className="settings-stat">
                <Clock3 />
                <span>
                  <strong>{collaboratorStats.inReview}</strong> entregas minhas
                  aguardando revisão
                </span>
              </div>
              <div className="settings-stat">
                <CircleAlert />
                <span>
                  <strong>{collaboratorStats.correctionsNeeded}</strong>{" "}
                  correções pendentes
                </span>
              </div>
              {myPlan && (
                <button
                  className="settings-stat as-button"
                  onClick={() => go("desenvolvimento")}
                >
                  <TrendingUp />
                  <span>
                    Meu plano de desenvolvimento: <strong>{myPlan.status}</strong>
                  </span>
                </button>
              )}
            </div>
          </section>
        )
      ) : (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">PAINEL DO GESTOR</span>
              <h2>Visão geral da equipe</h2>
            </div>
            <button className="text-button" onClick={() => go("time")}>
              Gerenciar
            </button>
          </div>
          <div className="settings-links">
            <div className="settings-stat">
              <UserRound />
              <span>
                <strong>{managerStats.activeMembers}</strong> colaboradores
                ativos · <strong>{managerStats.pendingInvites}</strong>{" "}
                convites aguardando ativação
              </span>
            </div>
            <button
              className="settings-stat as-button"
              onClick={() => go("operacao")}
            >
              <Clock3 />
              <span>
                <strong>{managerStats.awaitingReview}</strong> entregas
                aguardando revisão
              </span>
            </button>
            <button
              className="settings-stat as-button"
              onClick={() => go("operacao")}
            >
              <CircleAlert />
              <span>
                <strong>{managerStats.overdue}</strong> tarefas atrasadas
              </span>
            </button>
            <button
              className="settings-stat as-button"
              onClick={() => go("financeiro")}
            >
              <WalletCards />
              <span>
                <strong>{managerStats.pendingPayouts}</strong> recompensas
                aprovadas aguardando pagamento
              </span>
            </button>
          </div>
        </section>
      )}
      {(db.pluggedTools || []).length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">MINHAS FERRAMENTAS</span>
              <h2>Acesso rápido</h2>
            </div>
            <button className="text-button" onClick={() => go("ferramentas")}>
              Gerenciar
            </button>
          </div>
          <div className="plugged-row">
            {(db.pluggedTools || []).map((id) => {
              const t = toolCatalog.find((x) => x.id === id);
              if (!t) return null;
              const TI = t.icon;
              return (
                <a key={id} href={t.url} target="_blank" rel="noreferrer">
                  <span className="tool-icon">
                    <TI />
                  </span>
                  <strong>{t.name}</strong>
                  <ExternalLink />
                </a>
              );
            })}
          </div>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">EM ANDAMENTO</span>
              <h2>Próximas ações</h2>
            </div>
            <button className="text-button" onClick={() => go("operacao")}>
              Ver todas
            </button>
          </div>
          {activeTasks.length ? (
            <div className="mini-list">
              {activeTasks.slice(0, 4).map((t) => (
                <div key={t.id}>
                  <button
                    aria-label="Concluir"
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        tasks: d.tasks.map((x) =>
                          x.id === t.id ? { ...x, status: "Concluído" } : x,
                        ),
                      }))
                    }
                  >
                    <Circle />
                  </button>
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {t.due || "Sem prazo"} · {t.priority}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={ListTodo}
              title="Nenhuma tarefa pendente"
              text="Transforme um plano em ações ou crie sua primeira tarefa."
            />
          )}
        </section>
        {isEmployeeMode ? (
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">AGENDA</span>
                <h2>Próximos compromissos</h2>
              </div>
              <button className="text-button" onClick={() => go("agendamentos")}>
                Abrir agenda
              </button>
            </div>
            {upcomingAppointments.length ? (
              <div className="mini-list">
                {upcomingAppointments.map((a) => (
                  <div key={a.id}>
                    <span className="avatar">
                      {(a.clientName || a.title || "?")[0]}
                    </span>
                    <span>
                      <strong>{a.title}</strong>
                      <small>
                        {new Date(`${a.date}T12:00`).toLocaleDateString("pt-BR")}{" "}
                        · {a.time}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={CalendarDays}
                title="Nada agendado"
                text="Marque uma reunião, prazo ou bloco de foco."
              />
            )}
          </section>
        ) : (
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">RELACIONAMENTOS</span>
                <h2>Leads para acompanhar</h2>
              </div>
              <button className="text-button" onClick={() => go("vendas")}>
                Abrir CRM
              </button>
            </div>
            {followups.length ? (
              <div className="mini-list">
                {followups.slice(0, 4).map((l) => (
                  <div key={l.id}>
                    <span className="avatar">{l.name[0]}</span>
                    <span>
                      <strong>{l.name}</strong>
                      <small>
                        {l.status} · {l.next || "Sem follow-up"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Users}
                title="Seu CRM está livre"
                text="Adicione oportunidades e acompanhe cada conversa."
              />
            )}
          </section>
        )}
      </div>
      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">RECENTES</span>
              <h2>Continue de onde parou</h2>
            </div>
            <button className="text-button" onClick={() => go("historico")}>
              Ver histórico
            </button>
          </div>
          <div className="recent-grid">
            {recent.map((x) => (
              <article key={x.id}>
                <span className="doc-icon">
                  <Sparkles />
                </span>
                <div>
                  <span className="tag">{x.specialist}</span>
                  <h3>{x.title}</h3>
                  <small>{new Date(x.createdAt).toLocaleString("pt-BR")}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function journeyRecord(value) {
  return Array.isArray(value)
    ? { completed: value, evidence: {} }
    : {
        completed: value?.completed || [],
        evidence: value?.evidence || {},
      };
}

function journeyTool(step) {
  const text = step.toLowerCase();
  if (/preç|finance/.test(text)) return "financeiro";
  if (/cliente|lead|vend|prospec|comercial/.test(text)) return "vendas";
  if (/site|página/.test(text)) return "sites";
  if (/marca|identidade|biografia|rede social|material/.test(text))
    return "estudio";
  if (/processo|tarefa|prioridade|atendimento/.test(text)) return "operacao";
  if (/plano|proposta|diagnóstico|portfólio/.test(text)) return "documentos";
  return "estrategia";
}

function Journeys({ db, update, go }) {
  const [open, setOpen] = useState(null);
  const [drafts, setDrafts] = useState({});
  const saveMilestone = (id, i) => {
    const key = `${id}:${i}`;
    const evidence = String(drafts[key] || "").trim();
    if (evidence.length < 3) return;
    update((d) => {
      const record = journeyRecord(d.journeys[id]);
      return {
        ...d,
        journeys: {
          ...d.journeys,
          [id]: {
            completed: record.completed.includes(i)
              ? record.completed
              : [...record.completed, i],
            evidence: { ...record.evidence, [i]: evidence },
          },
        },
      };
    });
  };
  const reopenMilestone = (id, i) =>
    update((d) => {
      const record = journeyRecord(d.journeys[id]);
      return {
        ...d,
        journeys: {
          ...d.journeys,
          [id]: {
            ...record,
            completed: record.completed.filter((index) => index !== i),
          },
        },
      };
    });
  return (
    <PageTitle
      eyebrow="JORNADAS GUIADAS"
      title="Um caminho claro para cada objetivo"
      text="Avance no seu ritmo. O progresso é salvo automaticamente."
    >
      <div className="journey-grid">
        {Object.entries(journeyData).map(([id, j]) => {
          const done = journeyRecord(db.journeys[id]).completed;
          const pct = Math.round((done.length / j.steps.length) * 100);
          return (
            <article className="journey-card" key={id}>
              <span className="journey-icon">
                <DynamicIcon icon={j.icon} />
              </span>
              <h2>{j.title}</h2>
              <p>{j.steps.length} etapas práticas</p>
              <div className="meter">
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="journey-meta">
                <span>
                  {done.length} de {j.steps.length} concluídas
                </span>
                <strong>{pct}%</strong>
              </div>
              <Button variant="secondary" onClick={() => setOpen(id)}>
                {done.length ? "Continuar jornada" : "Começar jornada"}
              </Button>
            </article>
          );
        })}
      </div>
      {open && (
        <Modal title={journeyData[open].title} onClose={() => setOpen(null)}>
          <div className="journey-steps">
            {journeyData[open].steps.map((s, i) => {
              const record = journeyRecord(db.journeys[open]);
              const checked = record.completed.includes(i);
              const key = `${open}:${i}`;
              const evidence = record.evidence[i] || "";
              return (
                <article className={checked ? "done" : ""} key={s}>
                  <span className="journey-check">
                    {checked ? <CheckCircle2 /> : <Circle />}
                  </span>
                  <div>
                    <small>Etapa {i + 1}</small>
                    <strong>{s}</strong>
                    {checked ? (
                      <>
                        <p>{evidence}</p>
                        <button
                          className="text-button"
                          onClick={() => reopenMilestone(open, i)}
                        >
                          Reabrir marco
                        </button>
                      </>
                    ) : (
                      <>
                        <textarea
                          value={drafts[key] || evidence}
                          onChange={(event) =>
                            setDrafts({ ...drafts, [key]: event.target.value })
                          }
                          placeholder="Descreva o entregável, decisão ou evidência produzida nesta etapa."
                        />
                        <div className="milestone-actions">
                          <Button
                            variant="secondary"
                            icon={Wrench}
                            onClick={() => {
                              setOpen(null);
                              go(journeyTool(s));
                            }}
                          >
                            Abrir ferramenta
                          </Button>
                          <Button
                            icon={CheckCircle2}
                            disabled={
                              String(drafts[key] || evidence).trim().length < 3
                            }
                            onClick={() => saveMilestone(open, i)}
                          >
                            Validar marco
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Modal>
      )}
    </PageTitle>
  );
}

const areaToolkits = {
  estrategia: {
    label: "Estratégia",
    items: [
      {
        kind: "page",
        page: "comecar",
        title: "Jornadas guiadas",
        description: "Valide uma ideia ou estruture o negócio por etapas.",
        icon: Rocket,
      },
      {
        kind: "ai",
        tool: "dados",
        title: "Análise de cenários e números",
        description: "Transforme dados informados em padrões e decisões.",
        icon: Filter,
      },
      {
        kind: "page",
        page: "documentos",
        title: "Planos e diagnósticos",
        description: "Crie e organize planos, pesquisas e relatórios.",
        icon: FileText,
      },
      {
        kind: "page",
        page: "historico",
        title: "Projetos e decisões",
        description: "Continue, refine ou duplique trabalhos anteriores.",
        icon: History,
      },
      { kind: "external", tool: "sheets" },
    ],
  },
  marketing: {
    label: "Marca e Marketing",
    items: [
      { kind: "ai", tool: "post" },
      { kind: "ai", tool: "ecommerce" },
      {
        kind: "page",
        page: "estudio",
        title: "Estúdio de logos e imagens",
        description: "Crie identidade, peças visuais, imagens e vídeos.",
        icon: Palette,
      },
      {
        kind: "page",
        page: "sites",
        title: "Sites e landing pages",
        description: "Crie, edite por conversa e publique seu site.",
        icon: Globe2,
      },
      { kind: "special", tool: "translate" },
      { kind: "external", tool: "canva" },
      { kind: "external", tool: "drive" },
    ],
  },
  vendas: {
    label: "Vendas e Clientes",
    items: [
      {
        kind: "scroll",
        target: "crm-board",
        title: "CRM e funil de vendas",
        description: "Cadastre leads, etapas e histórico de interações.",
        icon: Users,
      },
      {
        kind: "page",
        page: "agendamentos",
        title: "Agenda de atendimentos",
        description: "Marque horários e confirme por WhatsApp ou Google Agenda.",
        icon: CalendarDays,
      },
      { kind: "ai", tool: "sales" },
      { kind: "ai", tool: "support" },
      { kind: "special", tool: "email" },
      { kind: "external", tool: "whatsapp" },
      { kind: "external", tool: "gmail" },
      { kind: "external", tool: "outlook" },
    ],
  },
  financeiro: {
    label: "Financeiro",
    items: [
      {
        kind: "scroll",
        target: "finance-transactions",
        title: "Fluxo de caixa",
        description: "Registre receitas e despesas e acompanhe o saldo.",
        icon: WalletCards,
      },
      {
        kind: "scroll",
        target: "finance-planning",
        title: "Metas e ponto de equilíbrio",
        description: "Planeje a receita necessária para cobrir os custos.",
        icon: Target,
      },
      {
        kind: "page",
        page: "horas",
        title: "Horas e faturamento",
        description: "Aponte horas por cliente e fature com um clique.",
        icon: Clock3,
      },
      { kind: "ai", tool: "price" },
      { kind: "ai", tool: "dados" },
      { kind: "ai", tool: "compras" },
      { kind: "external", tool: "sheets" },
      { kind: "external", tool: "nfse" },
      { kind: "external", tool: "nfe-sebrae" },
      { kind: "external", tool: "nfse-api" },
    ],
  },
  operacao: {
    label: "Operação",
    items: [
      {
        kind: "page",
        page: "produtos",
        title: "Produtos, estoque e pedidos",
        description: "Cadastre produtos e registre pedidos com baixa automática.",
        icon: ShoppingBag,
      },
      { kind: "ai", tool: "ops" },
      { kind: "ai", tool: "rh" },
      { kind: "ai", tool: "compras" },
      { kind: "special", tool: "route" },
      { kind: "external", tool: "calendar" },
    ],
  },
  sites: {
    label: "Sites e Materiais",
    items: [
      {
        kind: "scroll",
        target: "site-projects",
        title: "Construtor de sites",
        description: "Crie sites multipágina e edite tudo por conversa.",
        icon: Globe2,
      },
      {
        kind: "page",
        page: "estudio",
        title: "Logos, imagens e vídeos",
        description: "Produza materiais visuais no Estúdio de IA.",
        icon: ImageIcon,
      },
      {
        kind: "page",
        page: "documentos",
        title: "Propostas e materiais",
        description: "Crie documentos e exporte em PDF ou DOCX.",
        icon: FileText,
      },
      { kind: "ai", tool: "post" },
      { kind: "external", tool: "canva" },
      { kind: "external", tool: "drive" },
    ],
  },
  documentos: {
    label: "Documentos",
    items: [
      {
        kind: "scroll",
        target: "document-library",
        title: "Biblioteca e upload",
        description: "Envie, pesquise, edite, versione e exporte arquivos.",
        icon: Upload,
      },
      { kind: "ai", tool: "contract" },
      { kind: "special", tool: "translate" },
      {
        kind: "page",
        page: "estrategia",
        title: "Analisar com um especialista",
        description: "Use o documento como contexto em uma conversa.",
        icon: Bot,
      },
      { kind: "external", tool: "drive" },
    ],
  },
};

function AreaToolkit({ area, db: _db, update, business, setToast, go }) {
  const config = areaToolkits[area];
  const storageKey = `sf-toolkit-open:${area}`;
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [activeTool, setActiveTool] = useState("");
  if (!config) return null;
  const resolve = (item) => {
    if (item.kind === "external") {
      const external = toolCatalog.find((tool) => tool.id === item.tool);
      return external
        ? {
            ...item,
            title: item.title || external.name,
            description: item.description || external.description,
            icon: item.icon || external.icon,
            url: external.url,
            badge: "Serviço externo",
          }
        : null;
    }
    if (item.kind === "ai") {
      const tool = aiTools[item.tool];
      return tool
        ? {
            ...item,
            title: item.title || tool.title.replace(/^.*? — /, ""),
            description: item.description || tool.hint,
            icon: item.icon || tool.icon,
            badge: "Com IA",
          }
        : null;
    }
    const special = {
      translate: {
        title: "Tradutor profissional",
        description: "Traduza textos, propostas e comunicações.",
        icon: Languages,
      },
      route: {
        title: "Roteirizador de entregas",
        description: "Organize paradas e abra a rota no Google Maps.",
        icon: Route,
      },
      email: {
        title: "Escrever e-mail",
        description: "Prepare a mensagem e envie pela sua própria conta.",
        icon: Mail,
      },
    }[item.tool];
    return special ? { ...item, ...special, badge: "No app" } : item;
  };
  const items = config.items.map(resolve).filter(Boolean);
  const run = (item) => {
    if (item.kind === "page") return go(item.page);
    if (item.kind === "scroll") {
      document.getElementById(item.target)?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    setActiveTool(item.tool);
  };
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
      return next;
    });
  };
  return (
    <section className={`area-toolkit${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="area-toolkit-toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="area-toolkit-label">
          <span className="eyebrow">Recursos desta área</span>
          <strong>Tudo de {config.label} em um só lugar</strong>
        </span>
        <span className="area-toolkit-count">{items.length} recursos</span>
        <ChevronDown className="area-toolkit-caret" />
      </button>
      {open && (
        <div className="area-tools-grid">
          {items.map((item, index) => {
            const Icon = item.icon || Wrench;
            const content = (
              <>
                <span className={`quick-icon q${index % 6}`}>
                  <Icon />
                </span>
                <span>
                  <small>{item.badge || "No app"}</small>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </span>
                {item.kind === "external" ? <ExternalLink /> : <ArrowUpRight />}
              </>
            );
            return item.kind === "external" ? (
              <a
                key={`${item.kind}-${item.tool}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {content}
              </a>
            ) : (
              <button
                key={`${item.kind}-${item.tool || item.page || item.target}`}
                onClick={() => run(item)}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
      {activeTool === "translate" && (
        <TranslatorModal
          onClose={() => setActiveTool("")}
          setToast={setToast}
        />
      )}
      {activeTool === "route" && (
        <RouterModal onClose={() => setActiveTool("")} setToast={setToast} />
      )}
      {activeTool === "email" && (
        <EmailComposer onClose={() => setActiveTool("")} setToast={setToast} />
      )}
      {aiTools[activeTool] && (
        <AIToolModal
          config={aiTools[activeTool]}
          onClose={() => setActiveTool("")}
          setToast={setToast}
          update={update}
          business={business}
        />
      )}
    </section>
  );
}

function Specialists({
  db,
  update,
  business,
  setToast,
  go,
  area = "estrategia",
}) {
  const marketing = area === "marketing";
  return (
    <PageTitle
      eyebrow={marketing ? "MARCA E MARKETING" : "ESTRATÉGIA"}
      title={
        marketing
          ? "Marca, conteúdo e crescimento conectados"
          : "A habilidade certa para cada desafio"
      }
      text={
        marketing
          ? "Crie estratégia, conteúdo, materiais e presença digital sem procurar ferramentas em outras telas."
          : "Analise, planeje e transforme decisões em projetos usando todos os recursos disponíveis."
      }
    >
      <AreaToolkit
        area={area}
        db={db}
        update={update}
        business={business}
        setToast={setToast}
        go={go}
      />
      <UniversalRequest
        db={db}
        update={update}
        business={business}
        setToast={setToast}
      />
      <div className="specialist-grid">
        {specialistData.map(([n, I, d], i) => (
          <button
            className={db.preferences.specialist === n ? "active" : ""}
            key={n}
            onClick={() => {
              update((x) => ({
                ...x,
                preferences: { ...x.preferences, specialist: n },
              }));
              setToast(`${n} selecionado`);
            }}
          >
            <span className={`quick-icon q${i % 6}`}>
              <I />
            </span>
            <span>
              <strong>{n}</strong>
              <small>{d}</small>
            </span>
            {db.preferences.specialist === n && <CheckCircle2 />}
          </button>
        ))}
      </div>
    </PageTitle>
  );
}

// Movido para ./features/tasks/taskUrgencia.js.

// Movido para ./features/tasks/TasksScreen.jsx.

const TASK_STATUS_TONE = {
  "A fazer": "muted",
  "Em andamento": "info",
  Aguardando: "warn",
  Concluído: "ok",
};

export const MYDAY_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "overdue", label: "Atrasadas" },
  { id: "today", label: "Hoje" },
  { id: "week", label: "Esta semana" },
  { id: "next", label: "Próximas" },
  { id: "undated", label: "Sem prazo" },
];

const addDaysYmdIso = (ymd, days) => {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(base)) return ymd;
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
};

const endOfWeekYmd = (ymd) => {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(base)) return ymd;
  return addDaysYmdIso(ymd, 6 - new Date(base).getUTCDay());
};

export const isMyDayTaskDone = (status) =>
  ["concluído", "concluido", "concluída", "concluida"].includes(
    String(status || "").trim().toLocaleLowerCase("pt-BR"),
  );

export const applyMyDayFilter = (tasks, filterId, ymd) => {
  const endOfWeek = endOfWeekYmd(ymd);
  const validDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  return (tasks || []).filter((task) => {
    const raw = String(task.due || "").slice(0, 10);
    const due = validDate(raw) ? raw : "";
    if (filterId === "today") return due === ymd;
    if (filterId === "overdue") return Boolean(due) && due < ymd;
    if (filterId === "week") return Boolean(due) && due > ymd && due <= endOfWeek;
    if (filterId === "next") return Boolean(due) && due > endOfWeek;
    if (filterId === "undated") return !due;
    return true;
  });
};

export const taskOriginLabel = (task) => {
  const source = String(task?.source || "").toLocaleLowerCase("pt-BR");
  if (source.includes("greenon")) return "Green On";
  if (source.includes("todogreen") || source.includes("tdg")) return "CRM TDG";
  if (task?.sourceLeadId || task?.leadId || task?.opportunityId) return "CRM";
  if (task?.projectId || task?.project) return "Planner";
  if (task?.sourceQuoteId) return "Orçamento";
  if (task?.sourceOrderId) return "Pedido";
  return "To Do";
};

export const updateCanonicalTask = (tasks, id, patch, updatedAt) =>
  (tasks || []).map((task) =>
    task.id === id ? { ...task, ...patch, updatedAt } : task,
  );

function MyWork({ db, update, business, setToast, go }) {
  const userId = db.user?.id;
  const work = computeMyWork(db, userId, business);
  // Prazos, audiências e prazos processuais do Jurídico já são convertidos em
  // itens compatíveis pelo domínio (`buildPlannerItemsFromLegal`). Aqui
  // trazemos para o Meu Trabalho, respeitando a confidencialidade do viewer:
  // colaborador só vê o que a permissão de leitura permite.
  const legalRole = permissionsToLegalRole(db.memberPermissions || {}, userId);
  const legalPlannerItems = buildPlannerItemsFromLegal(
    {
      deadlines: db.legalDeadlines || [],
      processes: db.legalProcesses || [],
      powersOfAttorney: db.legalPowersOfAttorney || [],
      contracts: db.legalContracts || [],
    },
    { userId, role: legalRole !== "solicitante" ? legalRole : db.user?.role || "colaborador" },
  );
  const gamificationEnabled = db.preferences?.gamificationEnabled !== false;
  const points = computeUserPoints(db.tasks, userId);
  const level = levelForPoints(points, db.levels || DEFAULT_LEVELS);
  const progress = levelProgress(points, db.levels || DEFAULT_LEVELS);
  const achievements = computeAchievements(db.tasks, userId);
  const myPlan = (db.developmentPlans || []).find(
    (p) => p.assigneeId === userId,
  );
  const firstName = (db.user?.name || "").trim().split(" ")[0] || "";
  const needsAttention = work.corrections + work.overdue + work.inReview;
  const stats = [
    [work.inProgress, "Em andamento", ListTodo],
    [work.inReview, "Aguardando revisão", Clock3],
    [work.corrections, "Correções pedidas", CircleAlert],
    [work.overdue, "Atrasadas", CalendarDays],
  ];
  const [filter, setFilter] = useState("all");
  const [rescheduleId, setRescheduleId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const now = today();
  const filtered = applyMyDayFilter(work.all, filter, now);
  const filterCounts = MYDAY_FILTERS.reduce((counts, item) => ({
    ...counts,
    [item.id]: applyMyDayFilter(work.all, item.id, now).length,
  }), {});
  const patchTask = (id, patch) => {
    const updatedAt = new Date().toISOString();
    update((current) => ({
      ...current,
      tasks: updateCanonicalTask(current.tasks, id, patch, updatedAt),
    }));
  };
  const openTaskDetail = (task) => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("task", task.id);
      url.searchParams.set("open", "1");
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }
    go("operacao");
  };
  const startReschedule = (task) => {
    setRescheduleId(task.id);
    setRescheduleDate(String(task.due || "").slice(0, 10) || now);
  };
  const saveReschedule = (task) => {
    if (!rescheduleDate) return;
    patchTask(task.id, { due: rescheduleDate });
    setRescheduleId("");
    setRescheduleDate("");
    setToast?.("Prazo atualizado");
  };
  return (
    <PageTitle
      eyebrow="MEU TRABALHO"
      title={firstName ? `Olá, ${firstName}` : "Meu trabalho"}
      text="Tudo que está com você agora — tarefas, entregas e seu progresso — reunido em um só lugar."
    >
      <div className="mywork-stats">
        {stats.map(([n, label, Icon]) => (
          <div key={label} className="mywork-stat">
            <Icon />
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {needsAttention > 0 && (
        <button className="mywork-attention" onClick={() => go("operacao")}>
          <CircleAlert />
          <span>
            Você tem {needsAttention} item(ns) pedindo atenção — abra suas
            tarefas para resolver.
          </span>
          <ArrowUpRight />
        </button>
      )}
      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">MINHAS TAREFAS</span>
            <h2>Meu dia</h2>
          </div>
          <button className="text-button" onClick={() => go("planejar")}>
            Planejar meu dia
          </button>
        </div>
        <div className="myday-filters" role="group" aria-label="Filtrar minhas tarefas por prazo">
          {MYDAY_FILTERS.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "myday-filter active" : "myday-filter"} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label} <span>{filterCounts[item.id] || 0}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <Empty
            icon={BriefcaseBusiness}
            title={work.all.length === 0 ? "Nada na sua fila" : "Nada neste filtro"}
            text={work.all.length === 0 ? "Quando alguém atribuir uma tarefa a você, ela aparece aqui." : "Escolha outro filtro ou abra o To Do para ver a tarefa."}
            action="Abrir To Do"
            onAction={() => go("operacao")}
          />
        ) : (
          <div className="mywork-tasks">
            {filtered.map((t) => (
              <div key={t.id} className="myday-task">
                <button className="mywork-task" type="button" onClick={() => openTaskDetail(t)}>
                  <span className={`mywork-dot ${TASK_STATUS_TONE[t.status] || "muted"}`} />
                  <span className="mywork-task-body">
                    <strong>{t.title || "Sem título"}</strong>
                    <small>
                      {taskOriginLabel(t)}
                      {t.clientName || t.accountName ? ` · ${t.clientName || t.accountName}` : ""}
                      {t.due ? ` · prazo ${String(t.due).slice(0, 10)}` : " · sem prazo"}
                    </small>
                    <small>
                      {t.assigneeName || t.assignee || (t.assigneeId === userId ? "Você" : "Sem responsável")}
                      {t.priority ? ` · prioridade ${t.priority}` : ""}
                      {t.status ? ` · ${t.status}` : ""}
                    </small>
                  </span>
                  {t.due && String(t.due).slice(0, 10) < now && !isMyDayTaskDone(t.status) && <span className="mywork-late">Atrasada</span>}
                  <ArrowUpRight />
                </button>
                <div className="myday-actions" role="group" aria-label={`Ações para ${t.title || "tarefa"}`}>
                  <button type="button" className="myday-action" onClick={() => {
                    patchTask(t.id, { status: isMyDayTaskDone(t.status) ? "A fazer" : "Concluído" });
                    setToast?.(isMyDayTaskDone(t.status) ? "Tarefa reaberta" : "Tarefa concluída");
                  }}>
                    {isMyDayTaskDone(t.status) ? <RotateCcw /> : <CheckCircle2 />}
                    {isMyDayTaskDone(t.status) ? "Reabrir" : "Concluir"}
                  </button>
                  {rescheduleId === t.id ? (
                    <span className="myday-reschedule">
                      <input type="date" aria-label="Novo prazo" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
                      <button type="button" className="myday-action" onClick={() => saveReschedule(t)}>Salvar</button>
                      <button type="button" className="myday-action ghost" onClick={() => setRescheduleId("")}>Cancelar</button>
                    </span>
                  ) : (
                    <button type="button" className="myday-action" onClick={() => startReschedule(t)}><Clock3 /> Reagendar</button>
                  )}
                  <button type="button" className="myday-action" onClick={() => openTaskDetail(t)}><ArrowUpRight /> Abrir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {legalPlannerItems.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">JURÍDICO</span>
              <h2>Prazos, audiências e vencimentos</h2>
            </div>
            <button className="text-button" onClick={() => go("juridico")}>
              Abrir Jurídico
            </button>
          </div>
          <div className="mywork-tasks">
            {legalPlannerItems.slice(0, 6).map((item) => (
              <button
                key={item.id}
                className="mywork-task"
                onClick={() => go("juridico")}
              >
                <span
                  className={`mywork-dot ${item.priority === "Alta" ? "warn" : "muted"}`}
                />
                <span className="mywork-task-body">
                  <strong>{item.title}</strong>
                  <small>
                    {item.priority} · prazo {item.dueDate}
                    {item.kind === "hearing" ? " · audiência" : ""}
                    {item.kind === "process-deadline" ? " · processo" : ""}
                  </small>
                </span>
                {item.dueDate && item.dueDate < today() && (
                  <span className="mywork-late">Atrasada</span>
                )}
                <ArrowUpRight />
              </button>
            ))}
          </div>
        </section>
      )}
      {gamificationEnabled && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">MEU PROGRESSO</span>
              <h2>{level.name}</h2>
            </div>
          </div>
          <div className="mywork-progress">
            <div className="mywork-level">
              <div className="mywork-level-top">
                <strong>{points} pontos</strong>
                {progress.next && (
                  <small>
                    faltam {progress.pointsToNext} para {progress.next.name}
                  </small>
                )}
              </div>
              <div className="mywork-bar">
                <span style={{ width: `${progress.pct}%` }} />
              </div>
            </div>
            {achievements.length > 0 && (
              <div className="mywork-achievements">
                {achievements.map((a) => (
                  <span key={a.id} className="mywork-badge">
                    <Award />
                    {a.label}
                  </span>
                ))}
              </div>
            )}
            <div className="mywork-links">
              <button
                className="settings-stat as-button"
                onClick={() => go("desenvolvimento")}
              >
                <TrendingUp />
                <span>
                  {myPlan ? (
                    <>
                      Meu plano de desenvolvimento:{" "}
                      <strong>{myPlan.status}</strong>
                    </>
                  ) : (
                    "Ver plano de desenvolvimento"
                  )}
                </span>
              </button>
              <button
                className="settings-stat as-button"
                onClick={() => go("certificacoes")}
              >
                <Award />
                <span>Minhas certificações</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </PageTitle>
  );
}




const vehicleStatuses = ["Ativo", "Manutenção", "Inativo"];
const tripStatuses = ["Agendado", "Em rota", "Entregue", "Cancelado"];

function Fleet({ db, update, business, setToast, go: _go }) {
  const [view, setView] = useState("frota"),
    [search, setSearch] = useState(""),
    [vehicleModal, setVehicleModal] = useState(false),
    [editingVehicle, setEditingVehicle] = useState(null),
    [tripModal, setTripModal] = useState(false),
    [editingTrip, setEditingTrip] = useState(null);
  const blankVehicle = {
    plate: "",
    model: "",
    type: "Caminhão",
    capacityKg: "",
    status: "Ativo",
    driverName: "",
    driverContact: "",
    nextMaintenanceDate: "",
    notes: "",
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [vehicleForm, setVehicleForm] = useState(blankVehicle);
  const blankTrip = {
    vehicleId: "",
    driverName: "",
    origin: "",
    destination: "",
    cargoDescription: "",
    weightKg: "",
    freightValue: "",
    cteNumber: "",
    cteValue: "",
    status: "Agendado",
    scheduledDate: today(),
    notes: "",
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [tripForm, setTripForm] = useState(blankTrip);

  const vehicles = (db.vehicles || []).filter(
    (v) => !business || v.businessId === business.id,
  );
  const trips = (db.trips || []).filter(
    (t) => !business || t.businessId === business.id,
  );
  const filteredVehicles = vehicles.filter(
    (v) =>
      !search ||
      `${v.plate} ${v.model} ${v.driverName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filteredTrips = trips
    .filter(
      (t) =>
        !search ||
        `${t.origin} ${t.destination} ${t.driverName}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
  const maintenanceDue = (v) =>
    v.nextMaintenanceDate &&
    v.nextMaintenanceDate <= addDaysYmdDashed(today(), 7);

  const openVehicle = (item = null) => {
    setEditingVehicle(item?.id || null);
    setVehicleForm(item ? { ...blankVehicle, ...item } : blankVehicle);
    setVehicleModal(true);
  };
  const saveVehicle = (e) => {
    e.preventDefault();
    if (!vehicleForm.plate.trim()) return;
    const now = new Date().toISOString();
    const item = {
      ...vehicleForm,
      plate: vehicleForm.plate.trim().toUpperCase(),
      model: vehicleForm.model.trim(),
      capacityKg: Number(vehicleForm.capacityKg) || 0,
      id: editingVehicle || uid(),
      businessId: business?.id || null,
      ownerId: vehicleForm.ownerId || db.user.id,
      visibility: vehicleForm.visibility || "espaco_todo",
      sharedWith: Array.isArray(vehicleForm.sharedWith)
        ? vehicleForm.sharedWith
        : [],
      sharedTeams: Array.isArray(vehicleForm.sharedTeams)
        ? vehicleForm.sharedTeams
        : [],
      createdAt: vehicleForm.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      vehicles: editingVehicle
        ? (d.vehicles || []).map((v) => (v.id === editingVehicle ? item : v))
        : [item, ...(d.vehicles || [])],
    }));
    setVehicleModal(false);
    setToast(editingVehicle ? "Veículo atualizado" : "Veículo cadastrado");
  };
  const removeVehicle = (id) => {
    if (!confirm("Excluir este veículo da frota?")) return;
    update((d) => ({
      ...d,
      vehicles: (d.vehicles || []).filter((v) => v.id !== id),
    }));
  };

  const openTrip = (item = null) => {
    setEditingTrip(item?.id || null);
    setTripForm(item ? { ...blankTrip, ...item } : blankTrip);
    setTripModal(true);
  };
  const saveTrip = (e) => {
    e.preventDefault();
    if (!tripForm.origin.trim() || !tripForm.destination.trim()) return;
    const now = new Date().toISOString();
    const item = {
      ...tripForm,
      origin: tripForm.origin.trim(),
      destination: tripForm.destination.trim(),
      weightKg: Number(tripForm.weightKg) || 0,
      freightValue: Number(tripForm.freightValue) || 0,
      cteValue: Number(tripForm.cteValue) || 0,
      id: editingTrip || uid(),
      businessId: business?.id || null,
      ownerId: tripForm.ownerId || db.user.id,
      visibility: tripForm.visibility || "espaco_todo",
      sharedWith: Array.isArray(tripForm.sharedWith) ? tripForm.sharedWith : [],
      sharedTeams: Array.isArray(tripForm.sharedTeams)
        ? tripForm.sharedTeams
        : [],
      createdAt: tripForm.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      trips: editingTrip
        ? (d.trips || []).map((t) => (t.id === editingTrip ? item : t))
        : [item, ...(d.trips || [])],
    }));
    setTripModal(false);
    setToast(editingTrip ? "Frete atualizado" : "Frete registrado");
  };
  const removeTrip = (id) => {
    if (!confirm("Excluir este frete?")) return;
    update((d) => ({ ...d, trips: (d.trips || []).filter((t) => t.id !== id) }));
  };
  const changeTripStatus = (item, status) =>
    update((d) => ({
      ...d,
      trips: (d.trips || []).map((t) =>
        t.id === item.id ? { ...t, status, updatedAt: new Date().toISOString() } : t,
      ),
    }));
  const vehicleLabel = (id) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.plate} · ${v.model}` : "Sem veículo definido";
  };

  return (
    <PageTitle
      eyebrow="FROTA E FRETES"
      title="Veículos e fretes em um só lugar"
      text="Cadastre a frota, acompanhe manutenções e registre fretes com controle de CT-e."
      action={
        <Button
          icon={Plus}
          onClick={() => (view === "frota" ? openVehicle() : openTrip())}
        >
          {view === "frota" ? "Novo veículo" : "Novo frete"}
        </Button>
      }
    >
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            type="search"
            placeholder={view === "frota" ? "Buscar veículo" : "Buscar frete"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === "frota" ? "active" : ""}
            onClick={() => setView("frota")}
          >
            Frota
          </button>
          <button
            className={view === "fretes" ? "active" : ""}
            onClick={() => setView("fretes")}
          >
            Fretes
          </button>
        </div>
      </div>

      {view === "frota" ? (
        filteredVehicles.length === 0 ? (
          <Empty
            icon={Truck}
            title="Nenhum veículo cadastrado"
            text="Cadastre os veículos da frota para vinculá-los aos fretes."
            action="Novo veículo"
            onAction={() => openVehicle()}
          />
        ) : (
          <div className="data-list">
            {filteredVehicles.map((v) => (
              <article key={v.id}>
                <span
                  className={`status-dot ${v.status === "Inativo" ? "cancelado" : maintenanceDue(v) ? "faltou" : "concluído"}`}
                />
                <span>
                  <strong>
                    {v.plate} · {v.model || "Sem modelo"}
                  </strong>
                  <small>
                    {v.type} · {v.status}
                    {v.driverName && ` · Motorista: ${v.driverName}`}
                    {maintenanceDue(v) && " · Manutenção próxima"}
                  </small>
                </span>
                <span className="task-actions">
                  <button
                    className="icon-button"
                    aria-label={`Editar ${v.plate}`}
                    onClick={() => openVehicle(v)}
                  >
                    <Edit3 />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Excluir ${v.plate}`}
                    onClick={() => removeVehicle(v.id)}
                  >
                    <Trash2 />
                  </button>
                </span>
              </article>
            ))}
          </div>
        )
      ) : filteredTrips.length === 0 ? (
        <Empty
          icon={Route}
          title="Nenhum frete registrado"
          text="Registre fretes vinculando veículo, rota e o CT-e correspondente."
          action="Novo frete"
          onAction={() => openTrip()}
        />
      ) : (
        <div className="data-list">
          {filteredTrips.map((t) => (
            <article key={t.id}>
              <span>
                <strong>
                  {t.origin} → {t.destination}
                </strong>
                <small>
                  {vehicleLabel(t.vehicleId)}
                  {t.cteNumber && ` · CT-e ${t.cteNumber}`} ·{" "}
                  {t.scheduledDate}
                </small>
              </span>
              <select
                value={t.status}
                onChange={(e) => changeTripStatus(t, e.target.value)}
              >
                {tripStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span className="task-actions">
                <button
                  className="icon-button"
                  aria-label={`Editar frete ${t.origin} para ${t.destination}`}
                  onClick={() => openTrip(t)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Excluir frete ${t.origin} para ${t.destination}`}
                  onClick={() => removeTrip(t.id)}
                >
                  <Trash2 />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}

      {vehicleModal && (
        <Modal
          title={editingVehicle ? "Editar veículo" : "Novo veículo"}
          onClose={() => setVehicleModal(false)}
        >
          <form className="modal-body" onSubmit={saveVehicle}>
            <div className="form-grid">
              <Field label="Placa">
                <input
                  required
                  autoFocus
                  value={vehicleForm.plate}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, plate: e.target.value })
                  }
                />
              </Field>
              <Field label="Modelo">
                <input
                  value={vehicleForm.model}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, model: e.target.value })
                  }
                />
              </Field>
              <Field label="Tipo">
                <input
                  value={vehicleForm.type}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, type: e.target.value })
                  }
                  placeholder="Caminhão, Van, Moto..."
                />
              </Field>
              <Field label="Capacidade (kg)">
                <input
                  type="number"
                  min="0"
                  value={vehicleForm.capacityKg}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, capacityKg: e.target.value })
                  }
                />
              </Field>
              <Field label="Status">
                <select
                  value={vehicleForm.status}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, status: e.target.value })
                  }
                >
                  {vehicleStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Motorista">
                <input
                  value={vehicleForm.driverName}
                  onChange={(e) =>
                    setVehicleForm({ ...vehicleForm, driverName: e.target.value })
                  }
                />
              </Field>
              <Field label="WhatsApp do motorista">
                <input
                  value={vehicleForm.driverContact}
                  onChange={(e) =>
                    setVehicleForm({
                      ...vehicleForm,
                      driverContact: e.target.value,
                    })
                  }
                  placeholder="(11) 98888-7777"
                />
              </Field>
              <Field label="Próxima manutenção">
                <input
                  type="date"
                  value={vehicleForm.nextMaintenanceDate}
                  onChange={(e) =>
                    setVehicleForm({
                      ...vehicleForm,
                      nextMaintenanceDate: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Observações">
              <textarea
                value={vehicleForm.notes}
                onChange={(e) =>
                  setVehicleForm({ ...vehicleForm, notes: e.target.value })
                }
              />
            </Field>
            <SharingFields
              value={{
                visibility: vehicleForm.visibility,
                sharedWith: vehicleForm.sharedWith,
                sharedTeams: vehicleForm.sharedTeams,
              }}
              onChange={(next) => setVehicleForm({ ...vehicleForm, ...next })}
              teams={db.teams}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setVehicleModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editingVehicle ? "Salvar alterações" : "Salvar veículo"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {tripModal && (
        <Modal
          title={editingTrip ? "Editar frete" : "Novo frete"}
          wide
          onClose={() => setTripModal(false)}
        >
          <form className="modal-body" onSubmit={saveTrip}>
            <div className="form-grid">
              <Field label="Veículo">
                <select
                  value={tripForm.vehicleId}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, vehicleId: e.target.value })
                  }
                >
                  <option value="">A definir</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} · {v.model}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Motorista">
                <input
                  value={tripForm.driverName}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, driverName: e.target.value })
                  }
                />
              </Field>
              <Field label="Origem">
                <input
                  required
                  autoFocus
                  value={tripForm.origin}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, origin: e.target.value })
                  }
                />
              </Field>
              <Field label="Destino">
                <input
                  required
                  value={tripForm.destination}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, destination: e.target.value })
                  }
                />
              </Field>
              <Field label="Peso da carga (kg)">
                <input
                  type="number"
                  min="0"
                  value={tripForm.weightKg}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, weightKg: e.target.value })
                  }
                />
              </Field>
              <Field label="Valor do frete">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tripForm.freightValue}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, freightValue: e.target.value })
                  }
                />
              </Field>
              <Field label="Data programada">
                <input
                  type="date"
                  value={tripForm.scheduledDate}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, scheduledDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Status">
                <select
                  value={tripForm.status}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, status: e.target.value })
                  }
                >
                  {tripStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Descrição da carga">
              <input
                value={tripForm.cargoDescription}
                onChange={(e) =>
                  setTripForm({ ...tripForm, cargoDescription: e.target.value })
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Número do CT-e (registro manual)">
                <input
                  value={tripForm.cteNumber}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, cteNumber: e.target.value })
                  }
                />
              </Field>
              <Field label="Valor do CT-e">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tripForm.cteValue}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, cteValue: e.target.value })
                  }
                />
              </Field>
            </div>
            <p className="settings-note">
              <CircleAlert />A emissão oficial do CT-e é feita no seu emissor
              fiscal homologado. Aqui você só registra o número e o valor
              para controle interno do frete.
            </p>
            <Field label="Observações">
              <textarea
                value={tripForm.notes}
                onChange={(e) =>
                  setTripForm({ ...tripForm, notes: e.target.value })
                }
              />
            </Field>
            <SharingFields
              value={{
                visibility: tripForm.visibility,
                sharedWith: tripForm.sharedWith,
                sharedTeams: tripForm.sharedTeams,
              }}
              onChange={(next) => setTripForm({ ...tripForm, ...next })}
              teams={db.teams}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setTripModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editingTrip ? "Salvar alterações" : "Salvar frete"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </PageTitle>
  );
}

const planStatuses = ["Planejado", "Em andamento", "Concluído", "Cancelado"];
const suggestedCompetencies = [
  "Organização",
  "Comunicação",
  "Responsabilidade",
  "Atendimento",
  "Ferramentas digitais",
  "Vendas",
  "Qualidade",
  "Produtividade",
  "Trabalho em equipe",
  "Autonomia",
  "Pontualidade",
  "Atenção aos detalhes",
  "Resolução de problemas",
];

function DevelopmentPlans({ db, update, business, setToast, go: _go }) {
  const [modal, setModal] = useState(false),
    [editing, setEditing] = useState(null),
    [search, setSearch] = useState(""),
    [realMembers, setRealMembers] = useState([]);
  useEffect(() => {
    const space = activeSpaceId();
    fetch(`/api/collab${space ? `?owner=${encodeURIComponent(space)}` : ""}`, {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRealMembers(d.members || []))
      .catch(() => {});
  }, []);
  const blankPlan = {
    title: "",
    collaboratorId: "",
    collaboratorName: "",
    generalObjective: "",
    period: "",
    status: "Planejado",
    competencies: [],
    finalResult: "",
    notes: "",
  };
  const [form, setForm] = useState(blankPlan);
  const plans = db.developmentPlans || [];
  const filtered = plans.filter(
    (p) =>
      (!business || p.businessId === business.id) &&
      (!search ||
        `${p.title} ${p.collaboratorName}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const openPlan = (plan = null) => {
    setEditing(plan?.id || null);
    setForm(plan ? { ...blankPlan, ...plan } : blankPlan);
    setModal(true);
  };
  const save = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.collaboratorName.trim()) return;
    const now = new Date().toISOString();
    update((d) => {
      const item = {
        ...form,
        title: form.title.trim(),
        id: editing || uid(),
        businessId: business?.id || null,
        ownerId: form.ownerId || db.user.id,
        assigneeId: form.collaboratorId || null,
        createdAt: form.createdAt || now,
        updatedAt: now,
      };
      return {
        ...d,
        developmentPlans: editing
          ? (d.developmentPlans || []).map((p) => (p.id === editing ? item : p))
          : [item, ...(d.developmentPlans || [])],
      };
    });
    setModal(false);
    setToast(editing ? "Plano atualizado" : "Plano de desenvolvimento criado");
  };
  const removePlan = (id) => {
    if (!confirm("Excluir este plano de desenvolvimento?")) return;
    update((d) => ({
      ...d,
      developmentPlans: (d.developmentPlans || []).filter((p) => p.id !== id),
    }));
  };
  const blankCompetency = {
    name: "",
    currentSituation: "",
    objective: "",
    deadline: "",
    progress: "0",
    evidence: "",
    managerEvaluation: "",
  };
  const addCompetency = () =>
    setForm((c) => ({
      ...c,
      competencies: [...(c.competencies || []), { id: uid(), ...blankCompetency }],
    }));
  const updateCompetency = (id, field, value) =>
    setForm((c) => ({
      ...c,
      competencies: (c.competencies || []).map((comp) =>
        comp.id === id ? { ...comp, [field]: value } : comp,
      ),
    }));
  const removeCompetency = (id) =>
    setForm((c) => ({
      ...c,
      competencies: (c.competencies || []).filter((comp) => comp.id !== id),
    }));
  const overallProgress = (plan) => {
    const list = plan.competencies || [];
    if (!list.length) return 0;
    return Math.round(
      list.reduce((sum, c) => sum + (Number(c.progress) || 0), 0) / list.length,
    );
  };
  return (
    <PageTitle
      eyebrow="DESENVOLVIMENTO"
      title="Planos de desenvolvimento"
      text="Acompanhe competências e evolução da equipe."
      action={
        <Button icon={Plus} onClick={() => openPlan()}>
          Novo plano
        </Button>
      }
    >
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            type="search"
            placeholder="Buscar plano"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar"
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <Empty
          icon={TrendingUp}
          title="Nenhum plano de desenvolvimento"
          text="Crie um plano vinculando competências e metas práticas para um colaborador."
          action="Novo plano"
          onAction={() => openPlan()}
        />
      ) : (
        <div className="data-list">
          {filtered.map((p) => (
            <article key={p.id}>
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.collaboratorName} · {p.status} · {overallProgress(p)}% concluído
                </small>
              </span>
              <span className="task-actions">
                <button
                  className="icon-button"
                  aria-label={`Editar ${p.title}`}
                  onClick={() => openPlan(p)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Excluir ${p.title}`}
                  onClick={() => removePlan(p.id)}
                >
                  <Trash2 />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
      {modal && (
        <Modal
          title={editing ? "Editar plano" : "Novo plano de desenvolvimento"}
          wide
          onClose={() => setModal(false)}
        >
          <form className="modal-body" onSubmit={save}>
            <Field label="Título do plano">
              <input
                required
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="Colaborador">
                <input
                  required
                  list="dev-plan-members"
                  value={form.collaboratorName}
                  onChange={(e) => {
                    const value = e.target.value;
                    const member = realMembers.find((m) => m.name === value);
                    setForm({
                      ...form,
                      collaboratorName: value,
                      collaboratorId: member ? member.id : "",
                    });
                  }}
                  placeholder="Nome da pessoa"
                />
                <datalist id="dev-plan-members">
                  {realMembers.map((m) => (
                    <option key={m.id} value={m.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Período">
                <input
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value })}
                  placeholder="Ex.: Jul–Set 2026"
                />
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {planStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Objetivo geral">
              <textarea
                value={form.generalObjective}
                onChange={(e) =>
                  setForm({ ...form, generalObjective: e.target.value })
                }
              />
            </Field>
            <div className="field">
              <span>Competências</span>
              <div className="variant-rows">
                {(form.competencies || []).map((c) => (
                  <div key={c.id} className="competency-row">
                    <input
                      list="suggested-competencies"
                      value={c.name}
                      onChange={(e) =>
                        updateCompetency(c.id, "name", e.target.value)
                      }
                      placeholder="Competência"
                      aria-label="Nome da competência"
                    />
                    <input
                      value={c.objective}
                      onChange={(e) =>
                        updateCompetency(c.id, "objective", e.target.value)
                      }
                      placeholder="Objetivo"
                      aria-label={`Objetivo da competência ${c.name || ""}`}
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={c.progress}
                      onChange={(e) =>
                        updateCompetency(c.id, "progress", e.target.value)
                      }
                      placeholder="% concluído"
                      aria-label={`Progresso da competência ${c.name || ""}`}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remover competência"
                      onClick={() => removeCompetency(c.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <datalist id="suggested-competencies">
                  {suggestedCompetencies.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <Button type="button" variant="secondary" onClick={addCompetency}>
                  Adicionar competência
                </Button>
              </div>
            </div>
            <Field label="Resultado final (opcional)">
              <textarea
                value={form.finalResult}
                onChange={(e) => setForm({ ...form, finalResult: e.target.value })}
              />
            </Field>
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editing ? "Salvar alterações" : "Criar plano"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </PageTitle>
  );
}


// Movido para ./components/leituraDeArquivo.js.

// Movido para ./components/Anexos.jsx.

// Movido para ./components/Anexos.jsx.

const AUTOMATION_TEMPLATES = [
  {
    name: "Planejar a semana",
    frequency: "weekly",
    day: 1,
    actionType: "task",
    actionText: "Planejar as prioridades da semana",
  },
  {
    name: "Fechar o caixa do mês",
    frequency: "monthly",
    day: 1,
    actionType: "task",
    actionText: "Conferir entradas e saídas do mês passado",
  },
  {
    name: "Lembrete de cobrança",
    frequency: "monthly",
    day: 5,
    actionType: "reminder",
    actionText: "Enviar as cobranças pendentes aos clientes",
  },
];

const automationScheduleLabel = (rule) => {
  if (rule.frequency === "monthly") return `Todo dia ${rule.day || 1} do mês`;
  const wd = AUTOMATION_WEEKDAYS.find(([v]) => v === Number(rule.day));
  return `Toda ${wd ? wd[1].toLowerCase() : "semana"}`;
};

function Automations({ db, update, business, setToast }) {
  const rules = (db.automations || []).filter(
    (r) => !r.businessId || !business || r.businessId === business.id,
  );
  const blank = {
    id: null,
    name: "",
    enabled: true,
    frequency: "weekly",
    day: 1,
    actionType: "task",
    actionText: "",
  };
  const [editing, setEditing] = useState(null);

  const persist = (list) => update((prev) => ({ ...prev, automations: list }));
  const createFromTemplate = (t) => {
    const rule = {
      ...blank,
      ...t,
      id: uid(),
      history: {},
      businessId: business?.id || null,
      ownerId: db.user.id,
      createdAt: new Date().toISOString(),
    };
    persist([rule, ...(db.automations || [])]);
    setToast("Automação criada");
  };
  const saveRule = () => {
    if (!editing.name.trim() || !editing.actionText.trim()) return;
    const id = editing.id || uid();
    const rule = {
      ...editing,
      id,
      day: Number(editing.day) || 1,
      businessId: editing.businessId || business?.id || null,
      ownerId: editing.ownerId || db.user.id,
      history: editing.history || {},
      createdAt: editing.createdAt || new Date().toISOString(),
    };
    persist(
      (db.automations || []).some((r) => r.id === id)
        ? (db.automations || []).map((r) => (r.id === id ? rule : r))
        : [rule, ...(db.automations || [])],
    );
    setEditing(null);
    setToast("Automação salva");
  };
  const toggle = (id) =>
    persist(
      (db.automations || []).map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r,
      ),
    );
  const remove = (id) => {
    if (!window.confirm("Excluir esta automação?")) return;
    persist((db.automations || []).filter((r) => r.id !== id));
    setToast("Automação excluída");
  };
  const runNow = () => {
    const { rules: updatedRules, intents } = runAutomations(db.automations || []);
    if (intents.length === 0) {
      setToast("Nada para executar agora — nenhuma automação vencida");
      return;
    }
    update((d) => {
      const tasks = intents
        .filter((i) => i.actionType === "task")
        .map((i) => taskFromIdea(i.text, { businessId: business?.id, ownerId: d.user.id }));
      const notifs = intents
        .filter((i) => i.actionType === "reminder")
        .map((i) => ({
          id: uid(),
          assigneeId: d.user.id,
          ownerId: d.user.id,
          message: i.text,
          link: "automacoes",
          read: false,
          createdAt: new Date().toISOString(),
        }));
      return {
        ...d,
        automations: updatedRules,
        tasks: [...tasks, ...(d.tasks || [])],
        notifications: [...notifs, ...(d.notifications || [])],
      };
    });
    setToast(`${intents.length} automação(ões) executada(s)`);
  };

  return (
    <div className="page automations-page">
      <header className="page-head">
        <div>
          <h1>Automações</h1>
          <p className="page-sub">
            Crie regras que rodam sozinhas: toda semana ou todo mês, elas criam
            uma tarefa ou um lembrete para você, mesmo com o aplicativo fechado.
          </p>
        </div>
      </header>

      <div className="card automation-templates">
        <div className="notice">
          <Zap />
          <span>
            Comece por um modelo ou crie a sua. As automações nunca gastam
            dinheiro nem enviam nada sozinhas — só criam tarefas e lembretes
            para você decidir. A execução é verificada de hora em hora.
          </span>
        </div>
        <div className="automation-template-row">
          {AUTOMATION_TEMPLATES.map((t) => (
            <button
              key={t.name}
              className="chip-btn"
              onClick={() => createFromTemplate(t)}
            >
              <Plus size={13} /> {t.name}
            </button>
          ))}
          <button
            className="btn ghost sm"
            onClick={() => setEditing({ ...blank })}
          >
            <Plus size={15} /> Nova automação
          </button>
          {rules.length > 0 && (
            <button className="btn primary sm" onClick={runNow}>
              Rodar agora
            </button>
          )}
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="empty-state">
          <Zap />
          <h3>Nenhuma automação ainda</h3>
          <p>Crie uma regra acima para o app trabalhar por você.</p>
        </div>
      ) : (
        <div className="automation-list">
          {rules.map((r) => (
            <article
              key={r.id}
              className={`card automation-item ${r.enabled === false ? "off" : ""}`}
            >
              <div className="automation-info">
                <h4>{r.name}</h4>
                <p className="automation-when">
                  {automationScheduleLabel(r)} ·{" "}
                  {r.actionType === "reminder" ? "Lembrete" : "Tarefa"}: “{r.actionText}”
                </p>
                {r.lastRun && (
                  <p className="automation-last">
                    Última execução:{" "}
                    {new Date(r.lastRun).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
              <div className="automation-actions">
                <label className="automation-switch">
                  <input
                    type="checkbox"
                    checked={r.enabled !== false}
                    onChange={() => toggle(r.id)}
                  />
                  <span>{r.enabled === false ? "Pausada" : "Ativa"}</span>
                </label>
                <button className="btn ghost sm" onClick={() => setEditing({ ...r })}>
                  <Pencil size={15} /> Editar
                </button>
                <button className="btn ghost sm danger" onClick={() => remove(r.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Editar automação" : "Nova automação"}
          onClose={() => setEditing(null)}
        >
          <div className="modal-body">
            <Field label="Nome da automação">
              <input
                value={editing.name}
                onChange={(e) => setEditing((m) => ({ ...m, name: e.target.value }))}
                placeholder="Ex.: Planejar a semana"
                autoFocus
              />
            </Field>
            <div className="form-grid">
              <Field label="Frequência">
                <select
                  value={editing.frequency}
                  onChange={(e) =>
                    setEditing((m) => ({ ...m, frequency: e.target.value }))
                  }
                >
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês</option>
                </select>
              </Field>
              {editing.frequency === "weekly" ? (
                <Field label="Dia da semana">
                  <select
                    value={editing.day}
                    onChange={(e) =>
                      setEditing((m) => ({ ...m, day: Number(e.target.value) }))
                    }
                  >
                    {AUTOMATION_WEEKDAYS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Dia do mês">
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={editing.day}
                    onChange={(e) =>
                      setEditing((m) => ({ ...m, day: Number(e.target.value) }))
                    }
                  />
                </Field>
              )}
            </div>
            <Field label="O que fazer">
              <select
                value={editing.actionType}
                onChange={(e) =>
                  setEditing((m) => ({ ...m, actionType: e.target.value }))
                }
              >
                {AUTOMATION_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                editing.actionType === "reminder"
                  ? "Texto do lembrete"
                  : "Título da tarefa"
              }
            >
              <input
                value={editing.actionText}
                onChange={(e) =>
                  setEditing((m) => ({ ...m, actionText: e.target.value }))
                }
                placeholder="Ex.: Conferir o caixa do mês"
              />
            </Field>
            <div className="form-actions">
              <button className="btn primary" onClick={saveRule}>
                Salvar automação
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WikiTreeNodes({ nodes, selectedId, onSelect, depth }) {
  return nodes.map((node) => (
    <div key={node.id}>
      <button
        className={`wiki-tree-item ${node.id === selectedId ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 10 }}
        onClick={() => onSelect(node.id)}
      >
        <FileText size={14} />
        <span>{node.title || "Sem título"}</span>
      </button>
      {node.children.length > 0 && (
        <WikiTreeNodes
          nodes={node.children}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  ));
}

function Wiki({ db, update, business, setToast }) {
  const pages = (db.wikiPages || []).filter(
    (p) => !business || p.businessId === business.id,
  );
  const [selectedId, setSelectedId] = useState(pages[0]?.id || null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);

  const selected = pages.find((p) => p.id === selectedId) || null;
  const visiblePages = search.trim() ? searchPages(pages, search) : pages;
  const tree = buildPageTree(visiblePages);

  const createPage = (parentId = null) => {
    const now = new Date().toISOString();
    const page = {
      id: uid(),
      title: "Nova página",
      content: "",
      parentId: parentId || null,
      businessId: business?.id || null,
      ownerId: db.user.id,
      createdAt: now,
      updatedAt: now,
    };
    update((prev) => ({ ...prev, wikiPages: [...(prev.wikiPages || []), page] }));
    setSelectedId(page.id);
    setPreview(false);
  };
  const patchPage = (id, patch) =>
    update((prev) => ({
      ...prev,
      wikiPages: (prev.wikiPages || []).map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
      ),
    }));
  const deletePage = (id) => {
    const ids = pageDescendantIds(pages, id);
    const msg =
      ids.length > 1
        ? `Excluir esta página e as ${ids.length - 1} subpáginas?`
        : "Excluir esta página?";
    if (!window.confirm(msg)) return;
    update((prev) => ({
      ...prev,
      wikiPages: (prev.wikiPages || []).filter((p) => !ids.includes(p.id)),
    }));
    if (ids.includes(selectedId))
      setSelectedId(pages.find((p) => !ids.includes(p.id))?.id || null);
    setToast("Página excluída");
  };

  const parentOptions = selected
    ? pages.filter((p) => !pageDescendantIds(pages, selected.id).includes(p.id))
    : [];

  if (pages.length === 0) {
    return (
      <div className="page wiki-page">
        <header className="page-head">
          <div>
            <h1>Base de conhecimento</h1>
            <p className="page-sub">
              Crie páginas em pastas e subpáginas, com busca — a sua wiki
              interna para processos, manuais e anotações. Grátis.
            </p>
          </div>
        </header>
        <div className="empty-state">
          <BookOpen />
          <h3>Nenhuma página ainda</h3>
          <p>Crie a primeira página da sua base de conhecimento.</p>
          <button className="btn primary" onClick={() => createPage(null)}>
            <Plus size={16} /> Criar primeira página
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page wiki-page">
      <header className="page-head">
        <div>
          <h1>Base de conhecimento</h1>
          <p className="page-sub">Sua wiki interna: páginas, subpáginas e busca.</p>
        </div>
      </header>

      <div className="wiki-layout">
        <aside className="wiki-sidebar">
          <div className="wiki-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar páginas..."
            />
          </div>
          <button className="btn ghost sm wiki-newroot" onClick={() => createPage(null)}>
            <Plus size={15} /> Nova página
          </button>
          <div className="wiki-tree">
            {tree.length === 0 ? (
              <p className="wiki-empty-hint">Nenhuma página encontrada.</p>
            ) : (
              <WikiTreeNodes
                nodes={tree}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setPreview(false);
                }}
                depth={0}
              />
            )}
          </div>
        </aside>

        {selected ? (
          <section className="wiki-main">
            <div className="wiki-toolbar">
              <input
                className="wiki-title-input"
                value={selected.title}
                onChange={(e) => patchPage(selected.id, { title: e.target.value })}
                placeholder="Título da página"
                aria-label="Título da página"
              />
              <div className="wiki-toolbar-actions">
                <button
                  className="btn ghost sm"
                  onClick={() => createPage(selected.id)}
                  title="Nova subpágina"
                >
                  <Plus size={15} /> Subpágina
                </button>
                <button
                  className={`btn ghost sm ${preview ? "active" : ""}`}
                  onClick={() => setPreview((p) => !p)}
                >
                  {preview ? "Editar" : "Ler"}
                </button>
                <button
                  className="btn ghost sm danger"
                  onClick={() => deletePage(selected.id)}
                  title="Excluir página"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="wiki-meta">
              <label>
                Dentro de:{" "}
                <select
                  value={selected.parentId || ""}
                  onChange={(e) =>
                    patchPage(selected.id, { parentId: e.target.value || null })
                  }
                >
                  <option value="">— Raiz —</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title || "Sem título"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {preview ? (
              <div className="wiki-preview">
                {selected.content.trim() ? (
                  <Markdown text={selected.content} />
                ) : (
                  <p className="wiki-empty-hint">Página vazia. Clique em “Editar”.</p>
                )}
              </div>
            ) : (
              <textarea
                className="wiki-editor"
                value={selected.content}
                onChange={(e) => patchPage(selected.id, { content: e.target.value })}
                placeholder="Escreva aqui. Aceita Markdown: # títulos, - listas, **negrito**, links..."
              />
            )}
          </section>
        ) : (
          <section className="wiki-main">
            <div className="empty-state">
              <BookOpen />
              <h3>Selecione uma página</h3>
              <p>Escolha uma página na lista ou crie uma nova.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}


function PixCharge({ db, update, business, setToast }) {
  const charges = (db.pixCharges || []).filter(
    (c) => !business || c.businessId === business.id,
  );
  const last = charges[0];
  const [form, setForm] = useState({
    id: null,
    key: last?.key || "",
    name: last?.name || business?.name || db.user?.name || "",
    city: last?.city || "",
    amount: "",
    description: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hasKey = form.key.trim().length > 0;
  const code = hasKey ? buildPixCode(form) : "";

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setToast("Código Pix copiado");
      trackProductEvent("pix_code_copied", { module: "cobranca" });
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const shareWhatsapp = () => {
    if (!code) return;
    const valor = Number(form.amount) > 0 ? ` de R$ ${Number(form.amount).toFixed(2).replace(".", ",")}` : "";
    const msg = `Olá! Segue o Pix${valor}${form.description ? ` referente a ${form.description}` : ""}. É só copiar o código e colar no app do seu banco (Pix > Copia e cola):\n\n${code}`;
    window.open(whatsappLink("", msg), "_blank", "noopener");
  };
  const saveCharge = () => {
    if (!hasKey) return;
    const now = new Date().toISOString();
    const id = form.id || uid();
    const record = {
      id,
      key: form.key.trim(),
      name: form.name.trim(),
      city: form.city.trim(),
      amount: form.amount,
      description: form.description.trim(),
      businessId: business?.id || null,
      ownerId: db.user.id,
      createdAt: now,
    };
    update((prev) => ({
      ...prev,
      pixCharges: [record, ...(prev.pixCharges || []).filter((c) => c.id !== id)],
    }));
    setForm((f) => ({ ...f, id }));
    setToast("Cobrança salva");
  };
  const openCharge = (c) =>
    setForm({
      id: c.id,
      key: c.key || "",
      name: c.name || "",
      city: c.city || "",
      amount: c.amount || "",
      description: c.description || "",
    });
  const removeCharge = (id) => {
    if (!window.confirm("Excluir esta cobrança?")) return;
    update((prev) => ({
      ...prev,
      pixCharges: (prev.pixCharges || []).filter((c) => c.id !== id),
    }));
    if (form.id === id) setForm((f) => ({ ...f, id: null }));
    setToast("Cobrança excluída");
  };

  return (
    <div className="page pix-page">
      <header className="page-head">
        <div>
          <h1>Cobrança Pix</h1>
          <p className="page-sub">
            Gere um Pix &quot;copia e cola&quot; com o valor e a descrição, e envie ao
            cliente. Gratuito — o dinheiro cai direto na conta da sua chave.
          </p>
        </div>
      </header>

      <div className="card pix-form">
        <div className="notice">
          <QrCode />
          <span>
            O app apenas monta o código Pix a partir da sua chave — não
            processa pagamentos nem toca no seu dinheiro. Confira sua chave
            antes de enviar.
          </span>
        </div>
        <div className="form-grid">
          <Field label="Sua chave Pix">
            <input
              value={form.key}
              onChange={(e) => set("key", e.target.value)}
              placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória"
            />
          </Field>
          <Field label="Nome do recebedor">
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Cidade">
            <input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Ex.: Recife"
            />
          </Field>
          <Field label="Valor (opcional)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="Deixe em branco para o cliente digitar"
            />
          </Field>
          <Field label="Descrição (opcional)">
            <input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Ex.: Bolo de aniversário"
            />
          </Field>
        </div>
      </div>

      {code ? (
        <div className="card pix-result">
          <span className="pix-result-label">Pix copia e cola</span>
          <textarea className="pix-code" readOnly rows={4} value={code} />
          <div className="form-actions">
            <button className="btn primary" onClick={copyCode}>
              <Copy size={16} /> Copiar código
            </button>
            <button className="btn ghost" onClick={shareWhatsapp}>
              <Send size={16} /> Enviar por WhatsApp
            </button>
            <button className="btn ghost" onClick={saveCharge}>
              Salvar
            </button>
          </div>
          <p className="pix-hint">
            O cliente paga em <strong>Pix → Copia e cola</strong> no app do
            banco. Se você preencheu o valor, ele já vem preenchido.
          </p>
        </div>
      ) : (
        <div className="empty-state">
          <QrCode />
          <h3>Informe sua chave Pix</h3>
          <p>Preencha a chave acima para gerar o código de cobrança.</p>
        </div>
      )}

      {charges.length > 0 && (
        <div className="pix-saved">
          <h3>Cobranças salvas</h3>
          <div className="pix-saved-list">
            {charges.map((c) => (
              <article key={c.id} className="card pix-saved-item">
                <div>
                  <h4>
                    {Number(c.amount) > 0
                      ? `R$ ${Number(c.amount).toFixed(2).replace(".", ",")}`
                      : "Valor livre"}
                  </h4>
                  <p className="pix-saved-meta">
                    {c.description || c.key}
                  </p>
                </div>
                <div className="pix-saved-actions">
                  <button className="btn ghost sm" onClick={() => openCharge(c)}>
                    <Pencil size={15} /> Abrir
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeCharge(c.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailSignature({ db, update, business, setToast }) {
  const blank = {
    id: null,
    label: "",
    name: db.user?.name || "",
    role: "",
    business: business?.name || "",
    phone: "",
    email: db.user?.email || "",
    site: "",
    city: "",
    instagram: "",
    accent: "#0369a1",
  };
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const sig = buildEmailSignature(form);
  const saved = db.signatures
    .filter((s) => !business || s.businessId === business.id)
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const waDigits = String(form.whatsapp || form.phone || "").replace(/\D/g, "");
  const waLink = waDigits
    ? `https://wa.me/${waDigits.startsWith("55") ? waDigits : `55${waDigits}`}`
    : "";
  const igLink = form.instagram
    ? /^https?:\/\//i.test(form.instagram)
      ? form.instagram
      : `https://instagram.com/${form.instagram.replace(/^@/, "")}`
    : "";
  const accent = /^#[0-9a-f]{3,8}$/i.test(form.accent) ? form.accent : "#0369a1";

  const copyRich = async () => {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([sig.html], { type: "text/html" }),
            "text/plain": new Blob([sig.text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(sig.text);
      }
      setToast("Assinatura copiada — cole no seu e-mail");
      trackProductEvent("signature_copied", { module: "assinatura", format: "html" });
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(sig.text);
      setToast("Texto copiado");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const downloadHtml = () => {
    const blob = new Blob(
      [`<!doctype html><meta charset="utf-8"><body>${sig.html}</body>`],
      { type: "text/html;charset=utf-8" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `assinatura-${slugify(form.name || "email")}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const saveSignature = () => {
    const now = new Date().toISOString();
    const id = form.id || uid();
    const record = {
      ...form,
      id,
      label: form.label || form.name || "Assinatura",
      businessId: business?.id || null,
      ownerId: form.ownerId || db.user.id,
      createdAt: form.createdAt || now,
      updatedAt: now,
    };
    update((prev) => ({
      ...prev,
      signatures: prev.signatures.some((s) => s.id === id)
        ? prev.signatures.map((s) => (s.id === id ? record : s))
        : [record, ...prev.signatures],
    }));
    setForm((f) => ({ ...f, id, createdAt: record.createdAt, ownerId: record.ownerId }));
    setToast("Assinatura salva");
  };
  const openSaved = (s) => setForm({ ...blank, ...s });
  const removeSaved = (id) => {
    if (!window.confirm("Excluir esta assinatura?")) return;
    update((prev) => ({
      ...prev,
      signatures: prev.signatures.filter((s) => s.id !== id),
    }));
    if (form.id === id) setForm(blank);
    setToast("Assinatura excluída");
  };

  return (
    <div className="page signature-page">
      <header className="page-head">
        <div>
          <h1>Assinatura de e-mail</h1>
          <p className="page-sub">
            Monte uma assinatura profissional e copie pronta para o Gmail,
            Outlook ou qualquer e-mail. Gratuito e instantâneo.
          </p>
        </div>
      </header>

      <div className="signature-layout">
        <div className="card signature-form">
          <div className="form-grid">
            <Field label="Seu nome">
              <input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Cargo / função">
              <input
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                placeholder="Ex.: Fundadora"
              />
            </Field>
            <Field label="Negócio">
              <input
                value={form.business}
                onChange={(e) => set("business", e.target.value)}
              />
            </Field>
            <Field label="Cidade (opcional)">
              <input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Ex.: Recife, PE"
              />
            </Field>
            <Field label="Telefone">
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="(81) 99999-9999"
              />
            </Field>
            <Field label="E-mail">
              <input value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Site (opcional)">
              <input
                value={form.site}
                onChange={(e) => set("site", e.target.value)}
                placeholder="www.seunegocio.com.br"
              />
            </Field>
            <Field label="Instagram (opcional)">
              <input
                value={form.instagram}
                onChange={(e) => set("instagram", e.target.value)}
                placeholder="@seunegocio"
              />
            </Field>
            <Field label="Cor de destaque">
              <input
                type="color"
                value={accent}
                onChange={(e) => set("accent", e.target.value)}
                aria-label="Cor de destaque"
              />
            </Field>
          </div>
          <div className="form-actions">
            <button className="btn primary" onClick={copyRich}>
              <Copy size={16} /> Copiar assinatura
            </button>
            <button className="btn ghost" onClick={copyText}>
              Copiar texto
            </button>
            <button className="btn ghost" onClick={downloadHtml}>
              <Download size={16} /> Baixar HTML
            </button>
            <button className="btn ghost" onClick={saveSignature}>
              Salvar
            </button>
          </div>
        </div>

        <div className="signature-preview-wrap">
          <span className="signature-preview-label">Prévia</span>
          <div className="card signature-preview">
            <div
              className="signature-card"
              style={{ borderLeft: `3px solid ${accent}` }}
            >
              {form.name && <div className="sig-name">{form.name}</div>}
              {(form.role || form.business) && (
                <div className="sig-role">
                  {[form.role, form.business].filter(Boolean).join(" — ")}
                </div>
              )}
              {form.city && <div className="sig-city">{form.city}</div>}
              {(form.phone || form.email || form.site) && (
                <div className="sig-contact">
                  {[form.phone, form.email, form.site].filter(Boolean).map((bit, i, arr) => (
                    <span key={i}>
                      <span style={{ color: accent }}>{bit}</span>
                      {i < arr.length - 1 && <span className="sig-sep"> | </span>}
                    </span>
                  ))}
                </div>
              )}
              {(waLink || igLink) && (
                <div className="sig-links">
                  {waLink && <span style={{ color: accent }}>WhatsApp</span>}
                  {waLink && igLink && <span className="sig-sep"> | </span>}
                  {igLink && <span style={{ color: accent }}>Instagram</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {saved.length > 0 && (
        <div className="signature-saved">
          <h3>Assinaturas salvas</h3>
          <div className="signature-saved-list">
            {saved.map((s) => (
              <article key={s.id} className="card signature-saved-item">
                <div>
                  <h4>{s.label}</h4>
                  <p className="signature-saved-meta">
                    {[s.role, s.business].filter(Boolean).join(" — ")}
                  </p>
                </div>
                <div className="signature-saved-actions">
                  <button className="btn ghost sm" onClick={() => openSaved(s)}>
                    <Pencil size={15} /> Abrir
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeSaved(s.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MINDMAP_EXAMPLES = [
  "Como atrair mais clientes para o meu negócio",
  "Organizar o lançamento de um novo produto",
  "Reduzir custos sem perder qualidade",
  "Ideias de conteúdo para as redes sociais",
];

// Tarefa criada a partir de uma ideia do mapa — espelha o blankTask de Tasks
// para aparecer corretamente no quadro de Operação.
const taskFromIdea = (title, ctx = {}) => ({
  id: uid(),
  title,
  description: "",
  priority: "Média",
  status: "A fazer",
  due: "",
  area: "Operação",
  assigneeType: "real",
  assignee: "",
  assigneeId: "",
  project: "",
  isMission: false,
  distribution: "atribuida",
  difficulty: "Simples",
  slots: "1",
  points: "",
  reward: "",
  approvalMode: "imediata",
  allowWithdrawal: true,
  assignees: [],
  interested: [],
  missionStatus: "",
  deliveries: [],
  deliveryDraft: "",
  visibility: "privado",
  sharedWith: [],
  sharedTeams: [],
  subtasks: [],
  subtaskDraft: "",
  dependsOn: [],
  attachments: [],
  recurrence: { frequency: "none" },
  businessId: ctx.businessId || null,
  ownerId: ctx.ownerId || null,
  createdAt: new Date().toISOString(),
});

export function MindMap({ db, update, business, setToast, go }) {
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(null);

  const saved = db.brainstorms
    .filter((b) => !business || b.businessId === business.id)
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const generate = async () => {
    const t = theme.trim();
    if (t.length < 4 || busy) {
      if (t.length < 4) setErr("Descreva o tema em pelo menos 4 letras.");
      return;
    }
    setBusy(true);
    setErr("");
    const prompt = `Você facilita um brainstorming para um pequeno negócio no Brasil. Explore o tema abaixo num mapa de ideias.

Tema central: ${t}

Responda SOMENTE com um objeto JSON válido, sem comentários e sem cercas de código, no formato:
{"title": "tema central", "branches": [{"title": "nome do ramo", "ideas": ["ideia", ...]}, ...]}

Regras:
- De 4 a 6 ramos (ângulos/categorias diferentes do tema).
- De 3 a 5 ideias curtas e acionáveis por ramo.
- Português do Brasil, concreto e ético. Não invente números, preços ou resultados.`;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ prompt, specialist: "Estrategista" }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Não foi possível gerar agora.");
      const map = parseMindMap(data.content || "");
      if (!map.branches.length)
        throw new Error(
          "A IA respondeu, mas não consegui montar o mapa. Tente de novo.",
        );
      setActive({
        id: null,
        title: map.title || t,
        branches: map.branches,
      });
      trackProductEvent("mindmap_generated", {
        module: "ideias",
        branches: map.branches.length,
      });
      setTheme("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setBranch = (bi, patch) =>
    setActive((s) => ({
      ...s,
      branches: s.branches.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
    }));
  const setIdea = (bi, ii, value) =>
    setBranch(bi, {
      ideas: active.branches[bi].ideas.map((v, i) => (i === ii ? value : v)),
    });
  const addIdea = (bi) =>
    setBranch(bi, { ideas: [...active.branches[bi].ideas, ""] });
  const removeIdea = (bi, ii) =>
    setBranch(bi, { ideas: active.branches[bi].ideas.filter((_, i) => i !== ii) });
  const addBranch = () =>
    setActive((s) => ({
      ...s,
      branches: [...s.branches, { title: "Novo ramo", ideas: [""] }],
    }));
  const removeBranch = (bi) =>
    setActive((s) => ({ ...s, branches: s.branches.filter((_, i) => i !== bi) }));

  const ideaToTask = (idea) => {
    const title = idea.trim();
    if (!title) return;
    update((prev) => ({
      ...prev,
      tasks: [
        taskFromIdea(title, { businessId: business?.id, ownerId: db.user.id }),
        ...prev.tasks,
      ],
    }));
    setToast("Ideia virou tarefa em Operação");
  };

  const mapToText = (map) =>
    [
      `# ${map.title}`,
      ...map.branches.map(
        (b) =>
          `\n## ${b.title}\n${b.ideas.map((i) => `- ${i}`).join("\n")}`,
      ),
    ].join("\n");
  const copyMap = async () => {
    try {
      await navigator.clipboard.writeText(mapToText(active));
      setToast("Mapa copiado");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const saveMap = () => {
    if (!active) return;
    const now = new Date().toISOString();
    const id = active.id || uid();
    const record = {
      id,
      title: active.title || "Mapa de ideias",
      branches: active.branches,
      businessId: business?.id || null,
      ownerId: active.ownerId || db.user.id,
      createdAt: active.createdAt || now,
      updatedAt: now,
    };
    update((prev) => ({
      ...prev,
      brainstorms: prev.brainstorms.some((b) => b.id === id)
        ? prev.brainstorms.map((b) => (b.id === id ? record : b))
        : [record, ...prev.brainstorms],
    }));
    setActive((s) => ({ ...s, id, createdAt: record.createdAt, ownerId: record.ownerId }));
    setToast("Mapa salvo");
  };
  const openMap = (b) =>
    setActive({
      id: b.id,
      title: b.title,
      branches: b.branches || [],
      createdAt: b.createdAt,
      ownerId: b.ownerId,
    });
  const removeSaved = (id) => {
    if (!window.confirm("Excluir este mapa?")) return;
    update((prev) => ({
      ...prev,
      brainstorms: prev.brainstorms.filter((b) => b.id !== id),
    }));
    if (active?.id === id) setActive(null);
    setToast("Mapa excluído");
  };

  return (
    <div className="page mindmap-page">
      <header className="page-head">
        <div>
          <h1>Mapa de ideias</h1>
          <p className="page-sub">
            Escreva um desafio ou tema e a IA abre em ramos e ideias. Edite,
            transforme ideias em tarefas e salve. Tudo gratuito.
          </p>
        </div>
      </header>

      <div className="card mindmap-generator">
        <div className="notice">
          <Lightbulb />
          <span>
            Ótimo para destravar um problema, planejar algo novo ou juntar
            ideias antes de agir. A IA não inventa números nem resultados.
          </span>
        </div>
        <Field label="Qual é o tema ou desafio?">
          <textarea
            rows={2}
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Ex.: Como conseguir meus primeiros 10 clientes"
          />
        </Field>
        <div className="mindmap-examples">
          {MINDMAP_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip-btn"
              onClick={() => setTheme(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="form-actions">
          <button className="btn primary" onClick={generate} disabled={busy}>
            <Sparkles size={16} />
            {busy ? "Pensando..." : "Gerar mapa de ideias"}
          </button>
        </div>
      </div>

      {active && (
        <div className="mindmap-active">
          <div className="mindmap-active-head">
            <input
              className="mindmap-title-input"
              value={active.title}
              onChange={(e) => setActive((s) => ({ ...s, title: e.target.value }))}
              placeholder="Tema central"
            />
            <div className="mindmap-toolbar">
              <button className="btn ghost sm" onClick={addBranch}>
                <Plus size={15} /> Ramo
              </button>
              <button className="btn ghost sm" onClick={copyMap}>
                <Copy size={15} /> Copiar
              </button>
              <button className="btn primary sm" onClick={saveMap}>
                Salvar
              </button>
              <button className="btn ghost sm" onClick={() => setActive(null)}>
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="mindmap-branches">
            {active.branches.map((branch, bi) => (
              <div key={bi} className="card mindmap-branch">
                <div className="mindmap-branch-head">
                  <input
                    className="mindmap-branch-title"
                    value={branch.title}
                    onChange={(e) => setBranch(bi, { title: e.target.value })}
                    aria-label={`Nome do ramo ${bi + 1}`}
                  />
                  <button
                    className="sheet-col-del"
                    onClick={() => removeBranch(bi)}
                    title="Excluir ramo"
                  >
                    <X size={14} />
                  </button>
                </div>
                <ul className="mindmap-ideas">
                  {branch.ideas.map((idea, ii) => (
                    <li key={ii}>
                      <input
                        value={idea}
                        onChange={(e) => setIdea(bi, ii, e.target.value)}
                        aria-label={`Ideia ${ii + 1} de ${branch.title}`}
                        placeholder="Nova ideia"
                      />
                      <button
                        className="mindmap-idea-task"
                        onClick={() => ideaToTask(idea)}
                        title="Virar tarefa"
                        disabled={!idea.trim()}
                      >
                        <CheckCircle2 size={14} />
                      </button>
                      <button
                        className="sheet-col-del"
                        onClick={() => removeIdea(bi, ii)}
                        title="Remover ideia"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="btn ghost sm mindmap-add-idea" onClick={() => addIdea(bi)}>
                  <Plus size={14} /> Ideia
                </button>
              </div>
            ))}
          </div>
          <p className="mindmap-hint">
            Dica: clique no ✓ de uma ideia para transformá-la numa tarefa em{" "}
            <button className="link-btn" onClick={() => go?.("operacao")}>
              Operação
            </button>
            .
          </p>
        </div>
      )}

      {saved.length > 0 && (
        <div className="mindmap-saved">
          <h3>Mapas salvos</h3>
          <div className="mindmap-saved-list">
            {saved.map((b) => (
              <article key={b.id} className="card mindmap-saved-item">
                <div>
                  <h4>{b.title}</h4>
                  <p className="mindmap-saved-meta">
                    {(b.branches || []).length} ramos ·{" "}
                    {(b.branches || []).reduce(
                      (n, x) => n + (x.ideas || []).length,
                      0,
                    )}{" "}
                    ideias
                  </p>
                </div>
                <div className="mindmap-saved-actions">
                  <button className="btn ghost sm" onClick={() => openMap(b)}>
                    <Pencil size={15} /> Abrir
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeSaved(b.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisResultView({ r, q }) {
  return (
    <div className="analysis-result">
      {r.answer && (
        <div className="analysis-block analysis-answer">
          <h4>Resposta{q ? " à sua pergunta" : ""}</h4>
          <p>{r.answer}</p>
        </div>
      )}
      {r.summary && (
        <div className="analysis-block">
          <h4>Resumo</h4>
          <p>{r.summary}</p>
        </div>
      )}
      {r.keyPoints?.length > 0 && (
        <div className="analysis-block">
          <h4>Pontos-chave</h4>
          <ul>
            {r.keyPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {r.risks?.length > 0 && (
        <div className="analysis-block analysis-risks">
          <h4>Pontos de atenção</h4>
          <ul>
            {r.risks.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {r.actions?.length > 0 && (
        <div className="analysis-block">
          <h4>Próximas ações</h4>
          <ul>
            {r.actions.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Analyzer({ db, update, business, setToast }) {
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const uploadRef = useRef(null);

  const saved = db.analyses
    .filter((a) => !business || a.businessId === business.id)
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const importFile = async (file) => {
    if (!file || uploading) return;
    setUploading(true);
    setErr("");
    try {
      const extracted = await extractDocumentText(file);
      setText(extracted.content || "");
      setSourceName(file.name);
      if (extracted.truncated)
        setToast("Arquivo grande: analisei o começo do conteúdo");
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const analyze = async () => {
    const source = text.trim();
    if (source.length < 20 || busy) {
      if (source.length < 20)
        setErr("Cole ou envie um texto com pelo menos 20 letras.");
      return;
    }
    setBusy(true);
    setErr("");
    const q = question.trim();
    const prompt = `Você é um analista que trabalha APENAS com o texto fornecido abaixo. Não use conhecimento externo e não invente nada: se a informação não estiver no texto, diga que não consta.

${q ? `Pergunta do usuário: ${q}\n\n` : ""}Texto para analisar (entre as marcas):
<<<
${source.slice(0, 18000)}
>>>

Responda SOMENTE com um objeto JSON válido, sem comentários e sem cercas de código, no formato:
{"summary": "resumo em 2 a 4 frases", "keyPoints": ["ponto", ...], "risks": ["ponto de atenção ou risco", ...], "actions": ["próxima ação sugerida", ...], "answer": "${q ? "resposta objetiva à pergunta, baseada só no texto" : ""}"}

Use português do Brasil. Se algum campo não se aplicar, use lista vazia ou string vazia. Máximo de 6 itens por lista.`;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ prompt, specialist: "Estrategista" }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Não foi possível analisar agora.");
      const parsed = parseAnalysis(data.content || "");
      if (!parsed)
        throw new Error(
          "A IA respondeu, mas não consegui estruturar a análise. Tente de novo.",
        );
      const title =
        sourceName ||
        (q ? q.slice(0, 60) : source.split(/\s+/).slice(0, 7).join(" "));
      const record = {
        id: uid(),
        title,
        question: q,
        excerpt: source.slice(0, 280),
        result: parsed,
        businessId: business?.id || null,
        ownerId: db.user.id,
        createdAt: new Date().toISOString(),
      };
      update((prev) => ({ ...prev, analyses: [record, ...prev.analyses] }));
      trackProductEvent("analysis_done", {
        module: "analise",
        hasQuestion: !!q,
      });
      setResult(parsed);
      setToast("Análise pronta");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () => {
    setText("");
    setQuestion("");
    setSourceName("");
    setResult(null);
    setErr("");
  };
  const removeSaved = (id) => {
    if (!window.confirm("Excluir esta análise?")) return;
    update((prev) => ({ ...prev, analyses: prev.analyses.filter((a) => a.id !== id) }));
    setToast("Análise excluída");
  };
  const copyResult = async (r, q) => {
    const block = (label, items) =>
      items?.length ? `${label}:\n${items.map((i) => `- ${i}`).join("\n")}` : "";
    const parts = [
      r.summary ? `Resumo:\n${r.summary}` : "",
      block("Pontos-chave", r.keyPoints),
      block("Pontos de atenção", r.risks),
      block("Próximas ações", r.actions),
      r.answer ? `${q ? `Pergunta: ${q}\n` : ""}Resposta:\n${r.answer}` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join("\n\n"));
      setToast("Análise copiada");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };

  return (
    <div className="page analyzer-page">
      <header className="page-head">
        <div>
          <h1>Análise de textos</h1>
          <p className="page-sub">
            Cole um texto ou envie um PDF/DOCX e a IA resume, destaca os pontos
            importantes e responde suas perguntas — só com o que está no texto.
          </p>
        </div>
      </header>

      <div className="card analyzer-input">
        <div className="notice">
          <FileSearch />
          <span>
            A IA trabalha apenas com o conteúdo que você fornecer. Ideal para
            contratos, e-mails longos, editais e propostas. Não inventa o que
            não estiver escrito.
          </span>
        </div>
        <Field
          label={
            sourceName ? `Texto (de: ${sourceName})` : "Cole o texto para analisar"
          }
        >
          <textarea
            rows={7}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (sourceName) setSourceName("");
            }}
            placeholder="Cole aqui um contrato, e-mail, edital, proposta..."
          />
        </Field>
        <Field label="Alguma pergunta específica? (opcional)">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex.: Quais são os prazos e as multas deste contrato?"
          />
        </Field>
        <input
          ref={uploadRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv"
          hidden
          onChange={(e) => importFile(e.target.files?.[0])}
        />
        {err && <p className="form-error">{err}</p>}
        <div className="form-actions">
          <button
            className="btn ghost"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
          >
            <FileText size={16} />
            {uploading ? "Lendo arquivo..." : "Enviar arquivo"}
          </button>
          <button className="btn primary" onClick={analyze} disabled={busy}>
            <Sparkles size={16} />
            {busy ? "Analisando..." : "Analisar"}
          </button>
          {(text || result) && (
            <button className="btn ghost" onClick={clearAll}>
              Limpar
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="card analysis-current">
          <div className="analysis-current-head">
            <h3>Resultado</h3>
            <button
              className="btn ghost sm"
              onClick={() => copyResult(result, question.trim())}
            >
              <Copy size={15} /> Copiar
            </button>
          </div>
          <AnalysisResultView r={result} q={question.trim()} />
        </div>
      )}

      {saved.length > 0 && (
        <div className="analysis-saved">
          <h3>Análises anteriores</h3>
          {saved.map((a) => (
            <details key={a.id} className="card analysis-saved-item">
              <summary>
                <span className="analysis-saved-title">{a.title}</span>
                <span className="analysis-saved-date">
                  {new Date(a.createdAt).toLocaleDateString("pt-BR")}
                </span>
              </summary>
              <div className="analysis-saved-body">
                {a.excerpt && <p className="analysis-excerpt">“{a.excerpt}…”</p>}
                <AnalysisResultView r={a.result} q={a.question} />
                <div className="form-actions">
                  <button
                    className="btn ghost sm"
                    onClick={() => copyResult(a.result, a.question)}
                  >
                    <Copy size={15} /> Copiar
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeSaved(a.id)}
                  >
                    <Trash2 size={15} /> Excluir
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

const SHEET_EXAMPLES = [
  "Controle de estoque de uma loja de roupas",
  "Fluxo de caixa mensal de um MEI",
  "Lista de clientes com contato e histórico de compras",
  "Cardápio com preço de venda e custo de cada item",
  "Controle de horas trabalhadas por projeto",
  "Planejamento de metas do trimestre",
];

const CHART_COLORS = [
  "#0369a1",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function SheetChart({ series, type }) {
  const data = (series || []).slice(0, 12);
  if (data.length === 0)
    return <p className="db-empty-hint">Sem dados para o gráfico.</p>;
  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));

  if (type === "pizza") {
    const total = values.reduce((s, v) => s + Math.max(0, v), 0);
    if (total <= 0)
      return <p className="db-empty-hint">A coluna de valores precisa ter números positivos.</p>;
    const cx = 100;
    const cy = 100;
    const r = 82;
    const polar = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const slices = data.reduce(
      (acc, d, i) => {
        const frac = Math.max(0, d.value) / total;
        if (frac <= 0) return acc;
        const start = acc.angle;
        const end = start + frac * Math.PI * 2;
        acc.items.push({ i, start, end });
        acc.angle = end;
        return acc;
      },
      { angle: -Math.PI / 2, items: [] },
    ).items;
    return (
      <div className="sheet-chart-wrap">
        <svg viewBox="0 0 200 200" className="sheet-chart-svg" role="img">
          {slices.map(({ i, start, end }) => {
            const [x1, y1] = polar(start);
            const [x2, y2] = polar(end);
            const large = end - start > Math.PI ? 1 : 0;
            return (
              <path
                key={i}
                d={`M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            );
          })}
        </svg>
        <ul className="sheet-chart-legend">
          {data.map((d, i) => (
            <li key={i}>
              <span
                className="sheet-chart-swatch"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              {d.label} · {String(d.value).replace(".", ",")}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // barras e linha compartilham eixo
  const W = 320;
  const H = 180;
  const pad = 24;
  const plotW = W - pad * 2;
  const plotH = H - pad * 2;
  const step = plotW / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sheet-chart-svg wide" role="img">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#cbd5e1" />
      {type === "linha" ? (
        <>
          <polyline
            fill="none"
            stroke="#0369a1"
            strokeWidth="2"
            points={data
              .map((d, i) => {
                const x = pad + step * i + step / 2;
                const y = H - pad - (Math.max(0, d.value) / max) * plotH;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(" ")}
          />
          {data.map((d, i) => {
            const x = pad + step * i + step / 2;
            const y = H - pad - (Math.max(0, d.value) / max) * plotH;
            return <circle key={i} cx={x} cy={y} r="3" fill="#0369a1" />;
          })}
        </>
      ) : (
        data.map((d, i) => {
          const bh = (Math.max(0, d.value) / max) * plotH;
          const x = pad + step * i + step * 0.15;
          const bw = step * 0.7;
          return (
            <rect
              key={i}
              x={x}
              y={H - pad - bh}
              width={bw}
              height={bh}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              rx="2"
            />
          );
        })
      )}
      {data.map((d, i) => (
        <text
          key={i}
          x={pad + step * i + step / 2}
          y={H - pad + 12}
          textAnchor="middle"
          className="sheet-chart-label"
        >
          {d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label}
        </text>
      ))}
    </svg>
  );
}

function SheetBuilder({ db, update, business, setToast }) {
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartType, setChartType] = useState("barras");
  const [labelCol, setLabelCol] = useState(0);
  const [valueCol, setValueCol] = useState(1);

  const saved = db.sheets
    .filter((s) => !business || s.businessId === business.id)
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const generate = async () => {
    const d = desc.trim();
    if (d.length < 4 || busy) {
      if (d.length < 4) setErr("Descreva a planilha em pelo menos 4 letras.");
      return;
    }
    setBusy(true);
    setErr("");
    const prompt = `Você monta planilhas para pequenos negócios no Brasil. Crie a estrutura de uma planilha para o pedido abaixo.

Pedido: ${d}

Responda SOMENTE com um objeto JSON válido, sem comentários e sem cercas de código, no formato:
{"title": "Nome da planilha", "columns": ["Coluna 1", "Coluna 2", ...], "rows": [["valor", "valor", ...], ...]}

Regras:
- Use de 3 a 8 colunas úteis e bem nomeadas, na ordem em que fazem sentido.
- Inclua de 3 a 6 linhas de EXEMPLO plausíveis para a pessoa entender e depois substituir pelos dados reais.
- Valores monetários no formato brasileiro (ex.: "R$ 1.200,00"). Datas como AAAA-MM-DD.
- Não invente dados reais de clientes, preços de mercado ou resultados; os exemplos são apenas ilustrativos.`;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ prompt, specialist: "Estrategista" }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Não foi possível gerar agora.");
      const sheet = parseSheet(data.content || "");
      if (!sheet.columns.length)
        throw new Error(
          "A IA respondeu, mas não consegui montar a planilha. Tente de novo.",
        );
      setActive({
        id: null,
        title: sheet.title || d.slice(0, 60),
        columns: sheet.columns,
        rows: sheet.rows,
      });
      setChartOpen(DEFAULT_CHART_CONFIG.enabled);
      setChartType(DEFAULT_CHART_CONFIG.type);
      setLabelCol(DEFAULT_CHART_CONFIG.labelCol);
      setValueCol(
        Math.min(
          Math.max(0, sheet.columns.length - 1),
          DEFAULT_CHART_CONFIG.valueCol,
        ),
      );
      trackProductEvent("sheet_generated", {
        module: "planilhas",
        columns: sheet.columns.length,
        rows: sheet.rows.length,
      });
      setDesc("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const editCell = (r, c, value) =>
    setActive((s) => ({
      ...s,
      rows: s.rows.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
      ),
    }));
  const editHeader = (c, value) =>
    setActive((s) => ({
      ...s,
      columns: s.columns.map((col, ci) => (ci === c ? value : col)),
    }));
  const addRow = () =>
    setActive((s) => ({ ...s, rows: [...s.rows, s.columns.map(() => "")] }));
  const removeRow = (r) =>
    setActive((s) => ({ ...s, rows: s.rows.filter((_, ri) => ri !== r) }));
  const addColumn = () =>
    setActive((s) => ({
      ...s,
      columns: [...s.columns, `Coluna ${s.columns.length + 1}`],
      rows: s.rows.map((row) => [...row, ""]),
    }));
  const removeColumn = (c) =>
    setActive((s) => ({
      ...s,
      columns: s.columns.filter((_, ci) => ci !== c),
      rows: s.rows.map((row) => row.filter((_, ci) => ci !== c)),
    }));

  const downloadCsv = () => {
    if (!active) return;
    const csv = buildCsv(active.columns, active.rows);
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(active.title || "planilha")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    trackProductEvent("sheet_exported", { module: "planilhas", format: "csv" });
  };
  const copyTable = async () => {
    if (!active) return;
    const clean = (v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ");
    const tsv = [
      active.columns.map(clean).join("\t"),
      ...active.rows.map((row) => active.columns.map((_, i) => clean(row[i])).join("\t")),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setToast("Copiado — cole no Excel ou Google Planilhas");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const saveSheet = () => {
    if (!active) return;
    const now = new Date().toISOString();
    const id = active.id || uid();
    const record = {
      id,
      title: active.title || "Planilha",
      columns: active.columns,
      rows: active.rows,
      chart: normalizeChartConfig(
        {
          enabled: chartOpen,
          type: chartType,
          labelCol,
          valueCol,
        },
        active.columns.length,
      ),
      businessId: business?.id || null,
      ownerId: active.ownerId || db.user.id,
      createdAt: active.createdAt || now,
      updatedAt: now,
    };
    update((prev) => ({
      ...prev,
      sheets: prev.sheets.some((s) => s.id === id)
        ? prev.sheets.map((s) => (s.id === id ? record : s))
        : [record, ...prev.sheets],
    }));
    setActive((s) => ({ ...s, id, createdAt: record.createdAt, ownerId: record.ownerId }));
    setToast("Planilha salva");
  };
  const openSheet = (s) => {
    const chart = normalizeChartConfig(s.chart, (s.columns || []).length);
    setChartOpen(chart.enabled);
    setChartType(chart.type);
    setLabelCol(chart.labelCol);
    setValueCol(chart.valueCol);
    setActive({
      id: s.id,
      title: s.title,
      columns: s.columns || [],
      rows: s.rows || [],
      createdAt: s.createdAt,
      ownerId: s.ownerId,
    });
  };
  const removeSheet = (id) => {
    if (!window.confirm("Excluir esta planilha?")) return;
    update((prev) => ({ ...prev, sheets: prev.sheets.filter((s) => s.id !== id) }));
    if (active?.id === id) setActive(null);
    setToast("Planilha excluída");
  };

  return (
    <div className="page sheet-builder-page">
      <header className="page-head">
        <div>
          <h1>Planilhas</h1>
          <p className="page-sub">
            Descreva o que precisa e a IA monta a planilha pronta. Edite e baixe
            em CSV (abre no Excel e no Google Planilhas). Tudo gratuito.
          </p>
        </div>
      </header>

      <div className="card sheet-generator">
        <div className="notice">
          <Table />
          <span>
            Os valores gerados são exemplos para você entender a estrutura e
            depois substituir pelos seus dados reais.
          </span>
        </div>
        <Field label="Que planilha você precisa?">
          <textarea
            rows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ex.: Controle de estoque com produto, quantidade, custo e preço de venda"
          />
        </Field>
        <div className="sheet-examples">
          {SHEET_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip-btn"
              onClick={() => setDesc(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="form-actions">
          <button className="btn primary" onClick={generate} disabled={busy}>
            <Sparkles size={16} />
            {busy ? "Montando planilha..." : "Gerar planilha"}
          </button>
        </div>
      </div>

      {active && (
        <div className="card sheet-workspace">
          <div className="sheet-workspace-head">
            <input
              className="sheet-title-input"
              value={active.title}
              onChange={(e) => setActive((s) => ({ ...s, title: e.target.value }))}
              placeholder="Nome da planilha"
            />
            <div className="sheet-toolbar">
              <button className="btn ghost sm" onClick={addRow}>
                <Plus size={15} /> Linha
              </button>
              <button className="btn ghost sm" onClick={addColumn}>
                <Plus size={15} /> Coluna
              </button>
              <button className="btn ghost sm" onClick={copyTable}>
                <Copy size={15} /> Copiar
              </button>
              <button className="btn ghost sm" onClick={downloadCsv}>
                <Download size={15} /> CSV
              </button>
              <button
                className={`btn ghost sm ${chartOpen ? "active" : ""}`}
                onClick={() => setChartOpen((v) => !v)}
              >
                <BarChart3 size={15} /> Gráfico
              </button>
              <button className="btn primary sm" onClick={saveSheet}>
                Salvar
              </button>
              <button className="btn ghost sm" onClick={() => setActive(null)}>
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="sheet-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="sheet-rownum" aria-hidden="true"></th>
                  {active.columns.map((col, c) => (
                    <th key={c}>
                      <div className="sheet-header-cell">
                        <input
                          value={col}
                          onChange={(e) => editHeader(c, e.target.value)}
                          aria-label={`Nome da coluna ${c + 1}`}
                        />
                        <button
                          className="sheet-col-del"
                          onClick={() => removeColumn(c)}
                          title="Excluir coluna"
                          disabled={active.columns.length <= 1}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.rows.map((row, r) => (
                  <tr key={r}>
                    <td className="sheet-rownum">
                      <button
                        className="sheet-row-del"
                        onClick={() => removeRow(r)}
                        title="Excluir linha"
                      >
                        <X size={13} />
                      </button>
                    </td>
                    {active.columns.map((_, c) => (
                      <td key={c}>
                        <input
                          value={row[c] ?? ""}
                          onChange={(e) => editCell(r, c, e.target.value)}
                          aria-label={`Linha ${r + 1}, ${active.columns[c]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.rows.length === 0 && (
            <p className="sheet-empty-hint">
              Sem linhas ainda. Use “+ Linha” para começar.
            </p>
          )}
          {chartOpen && (
            <div className="sheet-chart card">
              <div className="sheet-chart-controls">
                <label>
                  Categorias:{" "}
                  <select
                    value={labelCol}
                    onChange={(e) => setLabelCol(Number(e.target.value))}
                  >
                    {active.columns.map((c, i) => (
                      <option key={i} value={i}>
                        {c || `Coluna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valores:{" "}
                  <select
                    value={valueCol}
                    onChange={(e) => setValueCol(Number(e.target.value))}
                  >
                    {active.columns.map((c, i) => (
                      <option key={i} value={i}>
                        {c || `Coluna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sheet-chart-types">
                  {[
                    ["barras", "Barras"],
                    ["linha", "Linha"],
                    ["pizza", "Pizza"],
                  ].map(([t, label]) => (
                    <button
                      key={t}
                      className={`db-view-btn ${chartType === t ? "active" : ""}`}
                      onClick={() => setChartType(t)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <SheetChart
                series={sheetChartSeries(active.columns, active.rows, labelCol, valueCol)}
                type={chartType}
              />
            </div>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div className="sheet-saved">
          <h3>Planilhas salvas</h3>
          <div className="sheet-saved-list">
            {saved.map((s) => (
              <article key={s.id} className="card sheet-saved-item">
                <div>
                  <h4>{s.title}</h4>
                  <p className="sheet-saved-meta">
                    {(s.columns || []).length} colunas · {(s.rows || []).length} linhas
                    {s.chart?.enabled ? " · gráfico salvo" : ""}
                  </p>
                </div>
                <div className="sheet-saved-actions">
                  <button className="btn ghost sm" onClick={() => openSheet(s)}>
                    <Pencil size={15} /> Abrir
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeSheet(s.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CONTENT_CHANNELS = [
  "Instagram",
  "Facebook",
  "WhatsApp Status",
  "TikTok",
  "LinkedIn",
  "Google Meu Negócio",
];
const CONTENT_GOALS = [
  "Atrair novos clientes",
  "Engajar seguidores",
  "Divulgar uma promoção",
  "Mostrar os bastidores",
  "Educar sobre o serviço",
  "Depoimentos e prova social",
];
const CONTENT_STATUS = {
  ideia: { label: "Ideia", next: "pronto" },
  pronto: { label: "Pronto", next: "publicado" },
  publicado: { label: "Publicado", next: "ideia" },
};
const contentDateLabel = (ymd) =>
  ymd
    ? new Date(`${ymd}T12:00:00`).toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      })
    : "Sem data";

function ContentPlanner({ db, update, business, setToast }) {
  const [tema, setTema] = useState("");
  const [canal, setCanal] = useState(CONTENT_CHANNELS[0]);
  const [objetivo, setObjetivo] = useState(CONTENT_GOALS[0]);
  const [qtd, setQtd] = useState(6);
  const [inicio, setInicio] = useState(today());
  const [cadencia, setCadencia] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);

  const posts = db.contentPlan
    .filter((p) => !business || p.businessId === business.id)
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const generate = async () => {
    const theme = tema.trim();
    if (theme.length < 3 || busy) {
      if (theme.length < 3) setErr("Descreva o tema em pelo menos 3 letras.");
      return;
    }
    setBusy(true);
    setErr("");
    const n = Math.max(3, Math.min(15, Number(qtd) || 6));
    const prompt = `Você é um estrategista de conteúdo para redes sociais de pequenos negócios no Brasil. Crie um calendário editorial com ${n} posts em português do Brasil.

Negócio/tema: ${theme}
Canal principal: ${canal}
Objetivo: ${objetivo}

Responda SOMENTE com um array JSON válido, sem comentários e sem cercas de código. Cada item deve ter:
- "channel": a rede social sugerida para esse post
- "format": o formato (ex.: Post, Reels, Carrossel, Story, Vídeo curto)
- "hook": uma chamada/ideia curta e atrativa (máx. 10 palavras)
- "caption": uma legenda pronta para publicar, com 2 a 4 frases e tom próximo do público
- "cta": uma chamada para ação clara (ex.: "Chame no WhatsApp", "Agende agora")
- "hashtags": lista de 3 a 6 hashtags relevantes, sem o símbolo #

Varie os formatos e os ângulos. Não invente preços, promoções, depoimentos ou resultados que não foram informados.`;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ prompt, specialist: "Redator" }),
      });
      const d = await response.json();
      if (!response.ok)
        throw new Error(d.error || "Não foi possível gerar agora.");
      const parsed = parseContentPlan(d.content || "");
      if (!parsed.length)
        throw new Error(
          "A IA respondeu, mas não consegui montar o calendário. Tente de novo.",
        );
      const dates = scheduleContentDates(parsed.length, inicio, cadencia);
      const now = new Date().toISOString();
      const created = parsed.map((p, i) => ({
        ...p,
        id: uid(),
        status: "ideia",
        date: dates[i],
        theme,
        businessId: business?.id || null,
        ownerId: db.user.id,
        createdAt: now,
      }));
      update((prev) => ({
        ...prev,
        contentPlan: [...created, ...prev.contentPlan],
      }));
      trackProductEvent("content_plan_generated", {
        module: "conteudo",
        posts: created.length,
      });
      setTema("");
      setToast(`${created.length} posts adicionados ao calendário`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patchPost = (id, patch) =>
    update((prev) => ({
      ...prev,
      contentPlan: prev.contentPlan.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  const cycleStatus = (post) =>
    patchPost(post.id, {
      status: CONTENT_STATUS[post.status]?.next || "ideia",
    });
  const removePost = (id) => {
    if (!window.confirm("Remover este post do calendário?")) return;
    update((prev) => ({
      ...prev,
      contentPlan: prev.contentPlan.filter((p) => p.id !== id),
    }));
    setToast("Post removido");
  };
  const postText = (post) => {
    const tags = (post.hashtags || []).map((t) => `#${t}`).join(" ");
    return [post.caption, post.cta, tags].filter(Boolean).join("\n\n");
  };
  const copyPost = async (post) => {
    try {
      await navigator.clipboard.writeText(postText(post));
      setToast("Legenda copiada");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  const shareWhatsapp = (post) => {
    window.open(whatsappLink("", postText(post)), "_blank", "noopener");
  };

  const saveEdit = (post) => {
    update((prev) => ({
      ...prev,
      contentPlan: prev.contentPlan.map((p) => (p.id === post.id ? post : p)),
    }));
    setEditing(null);
    setToast("Post salvo");
  };

  const grouped = [];
  for (const post of posts) {
    const key = post.date || "";
    let bucket = grouped.find((g) => g.key === key);
    if (!bucket) {
      bucket = { key, items: [] };
      grouped.push(bucket);
    }
    bucket.items.push(post);
  }

  return (
    <div className="page content-planner-page">
      <header className="page-head">
        <div>
          <h1>Calendário de conteúdo</h1>
          <p className="page-sub">
            A IA planeja seus posts das redes sociais: ideia, legenda pronta,
            chamada e hashtags. Edite, agende e publique. Tudo gratuito.
          </p>
        </div>
      </header>

      <div className="card content-generator">
        <div className="notice">
          <Megaphone />
          <span>
            Descreva seu negócio e o objetivo. A IA sugere uma sequência de
            posts — sem inventar preços ou promoções que você não informou.
          </span>
        </div>
        <div className="form-grid">
          <Field label="Sobre o que postar?">
            <textarea
              rows={2}
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              placeholder="Ex.: Confeitaria artesanal de bolos e doces para festas"
            />
          </Field>
          <Field label="Canal principal">
            <select value={canal} onChange={(e) => setCanal(e.target.value)}>
              {CONTENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objetivo">
            <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
              {CONTENT_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantos posts">
            <select value={qtd} onChange={(e) => setQtd(Number(e.target.value))}>
              {[3, 4, 5, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n} posts
                </option>
              ))}
            </select>
          </Field>
          <Field label="Começar em">
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </Field>
          <Field label="Frequência">
            <select
              value={cadencia}
              onChange={(e) => setCadencia(Number(e.target.value))}
            >
              <option value={1}>Todo dia</option>
              <option value={2}>A cada 2 dias</option>
              <option value={3}>A cada 3 dias</option>
              <option value={7}>1 por semana</option>
            </select>
          </Field>
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="form-actions">
          <button className="btn primary" onClick={generate} disabled={busy}>
            <Sparkles size={16} />
            {busy ? "Planejando..." : "Gerar calendário"}
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">
          <Megaphone />
          <h3>Seu calendário está vazio</h3>
          <p>Descreva seu negócio acima e crie a primeira sequência de posts.</p>
        </div>
      ) : (
        <div className="content-plan-list">
          {grouped.map((group) => (
            <section key={group.key} className="content-day">
              <h3 className="content-day-label">{contentDateLabel(group.key)}</h3>
              {group.items.map((post) => (
                <article
                  key={post.id}
                  className={`card content-post status-${post.status}`}
                >
                  <div className="content-post-top">
                    <span className="content-chip">{post.channel}</span>
                    <span className="content-chip ghost">{post.format}</span>
                    <button
                      className={`content-status-btn s-${post.status}`}
                      onClick={() => cycleStatus(post)}
                      title="Mudar situação"
                    >
                      {CONTENT_STATUS[post.status]?.label || "Ideia"}
                    </button>
                  </div>
                  <h4>{post.hook}</h4>
                  <p className="content-caption">{post.caption}</p>
                  {post.cta && <p className="content-cta">➡ {post.cta}</p>}
                  {post.hashtags?.length > 0 && (
                    <p className="content-tags">
                      {post.hashtags.map((t) => `#${t}`).join(" ")}
                    </p>
                  )}
                  <div className="content-post-actions">
                    <button className="btn ghost sm" onClick={() => copyPost(post)}>
                      <Copy size={15} /> Copiar
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => shareWhatsapp(post)}
                    >
                      <Send size={15} /> WhatsApp
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => setEditing(structuredClone(post))}
                    >
                      <Pencil size={15} /> Editar
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => removePost(post.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {editing && (
        <ContentPostEditor
          post={editing}
          onChange={setEditing}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ContentPostEditor({ post, onChange, onSave, onClose }) {
  const set = (patch) => onChange({ ...post, ...patch });
  return (
    <Modal title="Editar post" wide onClose={onClose}>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Data">
            <input
              type="date"
              value={post.date || ""}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field label="Canal">
            <select
              value={post.channel}
              onChange={(e) => set({ channel: e.target.value })}
            >
              {CONTENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Formato">
            <input
              value={post.format}
              onChange={(e) => set({ format: e.target.value })}
            />
          </Field>
          <Field label="Situação">
            <select
              value={post.status}
              onChange={(e) => set({ status: e.target.value })}
            >
              {Object.entries(CONTENT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Chamada / ideia">
          <input value={post.hook} onChange={(e) => set({ hook: e.target.value })} />
        </Field>
        <Field label="Legenda">
          <textarea
            rows={5}
            value={post.caption}
            onChange={(e) => set({ caption: e.target.value })}
          />
        </Field>
        <Field label="Chamada para ação (CTA)">
          <input value={post.cta || ""} onChange={(e) => set({ cta: e.target.value })} />
        </Field>
        <Field label="Hashtags (separadas por espaço, sem #)">
          <input
            value={(post.hashtags || []).join(" ")}
            onChange={(e) =>
              set({
                hashtags: e.target.value
                  .split(/[\s,]+/)
                  .map((t) => t.replace(/^#+/, "").trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <div className="form-actions">
          <button className="btn primary" onClick={() => onSave(post)}>
            Salvar post
          </button>
        </div>
      </div>
    </Modal>
  );
}

const PRESENTATION_GOALS = [
  "Apresentar uma proposta comercial",
  "Fechar uma venda",
  "Explicar um serviço ou produto",
  "Treinar a equipe",
  "Dar uma aula ou palestra",
  "Prestar contas / relatório de resultados",
];

function Presentations({ db, update, business, setToast }) {
  const [tema, setTema] = useState("");
  const [publico, setPublico] = useState("");
  const [objetivo, setObjetivo] = useState(PRESENTATION_GOALS[0]);
  const [numSlides, setNumSlides] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [viewing, setViewing] = useState(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [editing, setEditing] = useState(null);
  const [exportBusy, setExportBusy] = useState("");

  const decks = db.presentations.filter(
    (p) => !business || p.businessId === business.id,
  );
  const viewingDeck = viewing
    ? decks.find((d) => d.id === viewing) || null
    : null;

  const generate = async () => {
    const theme = tema.trim();
    if (theme.length < 3 || busy) {
      if (theme.length < 3) setErr("Descreva o tema em pelo menos 3 letras.");
      return;
    }
    setBusy(true);
    setErr("");
    const n = Math.max(3, Math.min(12, Number(numSlides) || 6));
    const prompt = `Você é um especialista em apresentações profissionais. Monte o roteiro de uma apresentação de slides em português do Brasil.

Tema: ${theme}
Objetivo: ${objetivo}
Público: ${publico.trim() || "clientes e parceiros do negócio"}
Quantidade de slides: exatamente ${n} (inclua um slide de capa no início e um slide de próximos passos/contato no fim).

Responda SOMENTE com um array JSON válido, sem comentários e sem cercas de código. Cada item deve ter:
- "title": título curto e forte do slide (máx. 8 palavras)
- "bullets": lista de 2 a 5 frases curtas e objetivas (o slide de capa pode ter 1 bullet com o subtítulo)
- "notes": uma frase de apoio para quem vai apresentar (o que falar)

Não invente números, preços, depoimentos ou resultados que não foram informados. Seja concreto e ético.`;
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ prompt, specialist: "Redator" }),
      });
      const d = await response.json();
      if (!response.ok)
        throw new Error(d.error || "Não foi possível gerar agora.");
      const slides = parseDeckSlides(d.content || "");
      if (!slides.length)
        throw new Error(
          "A IA respondeu, mas não consegui montar os slides. Tente de novo.",
        );
      const deck = {
        id: uid(),
        title: theme.length > 60 ? `${theme.slice(0, 57)}...` : theme,
        objetivo,
        publico: publico.trim(),
        slides,
        businessId: business?.id || null,
        ownerId: db.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      update((prev) => ({
        ...prev,
        presentations: [deck, ...prev.presentations],
      }));
      trackProductEvent("presentation_generated", {
        module: "apresentacoes",
        slides: slides.length,
      });
      setTema("");
      setPublico("");
      setToast(`Apresentação criada com ${slides.length} slides`);
      setViewing(deck.id);
      setSlideIndex(0);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeDeck = (id) => {
    if (!window.confirm("Excluir esta apresentação?")) return;
    update((prev) => ({
      ...prev,
      presentations: prev.presentations.filter((p) => p.id !== id),
    }));
    if (viewing === id) setViewing(null);
    setToast("Apresentação excluída");
  };

  const duplicateDeck = (deck) => {
    const copy = {
      ...deck,
      id: uid(),
      title: `${deck.title} (cópia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    update((prev) => ({
      ...prev,
      presentations: [copy, ...prev.presentations],
    }));
    setToast("Cópia criada");
  };

  const saveEdit = (deck) => {
    update((prev) => ({
      ...prev,
      presentations: prev.presentations.map((p) =>
        p.id === deck.id ? { ...deck, updatedAt: new Date().toISOString() } : p,
      ),
    }));
    setEditing(null);
    setToast("Apresentação salva");
  };

  const exportPdf = async (deck) => {
    setExportBusy(`${deck.id}:pdf`);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      const W = 297;
      const H = 210;
      (deck.slides || []).forEach((slide, i) => {
        if (i > 0) pdf.addPage();
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, W, H, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(i === 0 ? 30 : 24);
        const title = pdf.splitTextToSize(slide.title || "Slide", W - 40);
        pdf.text(title, 22, i === 0 ? 90 : 34);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(15);
        pdf.setTextColor(226, 232, 240);
        let y = i === 0 ? 90 + title.length * 12 + 8 : 34 + title.length * 12 + 6;
        (slide.bullets || []).forEach((b) => {
          const lines = pdf.splitTextToSize(`•  ${b}`, W - 50);
          lines.forEach((line) => {
            if (y > H - 22) return;
            pdf.text(line, 26, y);
            y += 9;
          });
          y += 2;
        });
        pdf.setTextColor(148, 163, 184);
        pdf.setFontSize(9);
        pdf.text(`${i + 1} / ${deck.slides.length}`, W - 26, H - 12);
      });
      const a = document.createElement("a");
      a.href = pdf.output("bloburl");
      a.download = `${slugify(deck.title || "apresentacao")}.pdf`;
      a.click();
      trackProductEvent("presentation_exported", {
        module: "apresentacoes",
        format: "pdf",
      });
    } catch {
      setToast("Não foi possível gerar o PDF agora");
    } finally {
      setExportBusy("");
    }
  };

  const exportPptx = async (deck) => {
    setExportBusy(`${deck.id}:pptx`);
    try {
      const { downloadPresentationPptx } = await import(
        "./features/presentations/presentationPptx.js"
      );
      await downloadPresentationPptx(deck, {
        author: business?.name || db.user?.name || "Seu Funcionário",
        company: business?.name || "Seu Funcionário",
      });
      setToast("Apresentação exportada em PPTX");
      trackProductEvent("presentation_exported", {
        module: "apresentacoes",
        format: "pptx",
      });
    } catch {
      setToast("Não foi possível gerar o PPTX agora");
    } finally {
      setExportBusy("");
    }
  };

  useEffect(() => {
    if (!viewingDeck) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === " ")
        setSlideIndex((i) => Math.min((viewingDeck.slides.length || 1) - 1, i + 1));
      else if (e.key === "ArrowLeft") setSlideIndex((i) => Math.max(0, i - 1));
      else if (e.key === "Escape") setViewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingDeck]);

  const current = viewingDeck?.slides?.[slideIndex];

  return (
    <div className="page presentations-page">
      <header className="page-head">
        <div>
          <h1>Apresentações</h1>
          <p className="page-sub">
            Descreva o tema e a IA monta os slides. Edite, apresente em tela
            cheia e baixe em PDF ou PowerPoint — tudo gratuito.
          </p>
        </div>
      </header>

      <div className="card presentation-generator">
        <div className="notice">
          <Layers />
          <span>
            Ideal para propostas, pitch de vendas, treinamentos e aulas. A IA
            não inventa preços nem resultados que você não informar.
          </span>
        </div>
        <div className="form-grid">
          <Field label="Sobre o que é a apresentação?">
            <textarea
              rows={2}
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              placeholder="Ex.: Serviço de organização residencial para famílias ocupadas"
            />
          </Field>
          <Field label="Objetivo">
            <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
              {PRESENTATION_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Para quem (público)">
            <input
              value={publico}
              onChange={(e) => setPublico(e.target.value)}
              placeholder="Ex.: donas de casa, síndicos, pequenas empresas"
            />
          </Field>
          <Field label="Quantidade de slides">
            <select
              value={numSlides}
              onChange={(e) => setNumSlides(Number(e.target.value))}
            >
              {[4, 5, 6, 7, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n} slides
                </option>
              ))}
            </select>
          </Field>
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="form-actions">
          <button className="btn primary" onClick={generate} disabled={busy}>
            <Sparkles size={16} />
            {busy ? "Montando slides..." : "Gerar apresentação"}
          </button>
        </div>
      </div>

      {decks.length === 0 ? (
        <div className="empty-state">
          <Layers />
          <h3>Nenhuma apresentação ainda</h3>
          <p>Descreva um tema acima e crie a primeira em segundos.</p>
        </div>
      ) : (
        <div className="presentation-grid">
          {decks.map((deck) => (
            <article key={deck.id} className="card presentation-card">
              <div className="presentation-thumb" aria-hidden="true">
                <span className="presentation-thumb-title">
                  {deck.slides?.[0]?.title || deck.title}
                </span>
                <span className="presentation-thumb-count">
                  {deck.slides?.length || 0} slides
                </span>
              </div>
              <div className="presentation-card-body">
                <h3>{deck.title}</h3>
                <p className="presentation-meta">{deck.objetivo}</p>
              </div>
              <div className="presentation-card-actions">
                <button
                  className="btn primary sm"
                  onClick={() => {
                    setViewing(deck.id);
                    setSlideIndex(0);
                  }}
                >
                  <Play size={15} /> Apresentar
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => setEditing(structuredClone(deck))}
                >
                  <Pencil size={15} /> Editar
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => exportPdf(deck)}
                  disabled={!!exportBusy}
                >
                  <Download size={15} />
                  {exportBusy === `${deck.id}:pdf` ? "Gerando..." : "PDF"}
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => exportPptx(deck)}
                  disabled={!!exportBusy}
                >
                  <Download size={15} />
                  {exportBusy === `${deck.id}:pptx` ? "Gerando..." : "PPTX"}
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => duplicateDeck(deck)}
                  title="Duplicar"
                >
                  <Copy size={15} />
                </button>
                <button
                  className="btn ghost sm danger"
                  onClick={() => removeDeck(deck.id)}
                  title="Excluir"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {viewingDeck && current && (
        <div
          className="presenter-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Apresentação: ${viewingDeck.title}`}
        >
          <div className="presenter-slide">
            <h2>{current.title}</h2>
            {current.bullets?.length > 0 && (
              <ul>
                {current.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {current.notes && (
              <p className="presenter-notes">
                <strong>Fale:</strong> {current.notes}
              </p>
            )}
          </div>
          <div className="presenter-bar">
            <button
              className="btn ghost"
              onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
              disabled={slideIndex === 0}
            >
              <ChevronLeft size={18} /> Anterior
            </button>
            <span className="presenter-count">
              {slideIndex + 1} / {viewingDeck.slides.length}
            </span>
            <button
              className="btn ghost"
              onClick={() =>
                setSlideIndex((i) =>
                  Math.min(viewingDeck.slides.length - 1, i + 1),
                )
              }
              disabled={slideIndex === viewingDeck.slides.length - 1}
            >
              Próximo <ChevronRight size={18} />
            </button>
            <button className="btn" onClick={() => setViewing(null)}>
              <X size={18} /> Fechar
            </button>
          </div>
        </div>
      )}

      {editing && (
        <PresentationEditor
          deck={editing}
          onChange={setEditing}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PresentationEditor({ deck, onChange, onSave, onClose }) {
  const setSlide = (idx, patch) =>
    onChange({
      ...deck,
      slides: deck.slides.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  const addSlide = () =>
    onChange({
      ...deck,
      slides: [...deck.slides, { title: "Novo slide", bullets: [], notes: "" }],
    });
  const removeSlide = (idx) =>
    onChange({ ...deck, slides: deck.slides.filter((_, i) => i !== idx) });
  const moveSlide = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= deck.slides.length) return;
    const slides = [...deck.slides];
    [slides[idx], slides[j]] = [slides[j], slides[idx]];
    onChange({ ...deck, slides });
  };
  return (
    <Modal title="Editar apresentação" wide onClose={onClose}>
      <div className="modal-body">
        <Field label="Título da apresentação">
          <input
            value={deck.title}
            onChange={(e) => onChange({ ...deck, title: e.target.value })}
          />
        </Field>
        <div className="editor-slides">
          {deck.slides.map((slide, idx) => (
            <div key={idx} className="editor-slide">
              <div className="editor-slide-head">
                <span className="editor-slide-num">Slide {idx + 1}</span>
                <div className="editor-slide-tools">
                  <button
                    className="btn ghost sm"
                    onClick={() => moveSlide(idx, -1)}
                    disabled={idx === 0}
                    title="Subir"
                  >
                    ↑
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => moveSlide(idx, 1)}
                    disabled={idx === deck.slides.length - 1}
                    title="Descer"
                  >
                    ↓
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => removeSlide(idx)}
                    disabled={deck.slides.length <= 1}
                    title="Excluir slide"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <input
                className="editor-slide-title"
                value={slide.title}
                onChange={(e) => setSlide(idx, { title: e.target.value })}
                placeholder="Título do slide"
              />
              <textarea
                rows={4}
                value={(slide.bullets || []).join("\n")}
                onChange={(e) =>
                  setSlide(idx, {
                    bullets: e.target.value
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Um tópico por linha"
              />
              <input
                className="editor-slide-notes"
                value={slide.notes || ""}
                onChange={(e) => setSlide(idx, { notes: e.target.value })}
                placeholder="Nota do apresentador (o que falar)"
              />
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn ghost" onClick={addSlide}>
            <Plus size={16} /> Adicionar slide
          </button>
          <button className="btn primary" onClick={() => onSave(deck)}>
            Salvar apresentação
          </button>
        </div>
      </div>
    </Modal>
  );
}



function EmailComposer({ onClose, setToast, initial }) {
  const [form, setForm] = useState({
    to: initial?.to || "",
    subject: initial?.subject || "",
    body: initial?.body || "",
  });
  const [googleId, setGoogleId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setGoogleId(d.googleClientId || ""))
      .catch(() => {});
  }, []);
  const logEmail = () =>
    logInteraction({
      channel: "email",
      direction: "out",
      contactId: initial?.contactId || "",
      contactName: initial?.contactName || "",
      contactHandle: form.to.trim(),
      subject: form.subject,
      body: form.body,
    });
  const sendReal = async () => {
    if (!form.to.trim() || sending) return;
    setSending(true);
    setSendError("");
    try {
      await sendGmailReal(googleId, form);
      logEmail();
      setToast("E-mail enviado pela sua conta Google");
      onClose();
    } catch (error) {
      setSendError(error.message || "Não foi possível enviar agora.");
    } finally {
      setSending(false);
    }
  };
  const params = () =>
    `to=${encodeURIComponent(form.to)}&su=${encodeURIComponent(form.subject)}&body=${encodeURIComponent(form.body)}`;
  const openGmail = () => {
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&${params()}`,
      "_blank",
      "noopener",
    );
    logEmail();
    setToast("Rascunho aberto no Gmail para sua confirmação");
  };
  const openOutlook = () => {
    window.open(
      `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(form.to)}&subject=${encodeURIComponent(form.subject)}&body=${encodeURIComponent(form.body)}`,
      "_blank",
      "noopener",
    );
    logEmail();
    setToast("Rascunho aberto no Outlook para sua confirmação");
  };
  const openClient = () => {
    logEmail();
    location.href = `mailto:${encodeURIComponent(form.to)}?subject=${encodeURIComponent(form.subject)}&body=${encodeURIComponent(form.body)}`;
  };
  return (
    <Modal title="Escrever e-mail" wide onClose={onClose}>
      <div className="modal-body">
        <div className="notice">
          <ShieldCheck />
          <span>
            &quot;Enviar pelo Gmail&quot; pede sua permissão do Google e envia direto
            pela sua conta. As demais opções só preparam um rascunho para você
            revisar e enviar manualmente.
          </span>
        </div>
        <div className="form-grid">
          <Field label="Para">
            <input
              type="email"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              placeholder="cliente@empresa.com"
            />
          </Field>
          <Field label="Assunto">
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Assunto do e-mail"
            />
          </Field>
        </div>
        <Field label="Usar um modelo pronto (opcional)">
          <select
            value=""
            onChange={(e) => {
              const tpl = EMAIL_TEMPLATES.find((t) => t.id === e.target.value);
              if (tpl) setForm({ ...form, subject: tpl.subject, body: tpl.body });
            }}
          >
            <option value="">Escolha um modelo...</option>
            {EMAIL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.category} — {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mensagem">
          <textarea
            className="email-body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="Escreva ou cole sua mensagem..."
          />
        </Field>
        {sendError && (
          <div className="ask-error">
            <CircleAlert /> {sendError}
          </div>
        )}
        <div className="email-actions">
          <Button
            icon={Send}
            onClick={sendReal}
            disabled={sending || !form.to.trim()}
          >
            {sending ? "Enviando..." : "Enviar pelo Gmail"}
          </Button>
          <Button variant="secondary" icon={Mail} onClick={openGmail}>
            Abrir rascunho no Gmail
          </Button>
          <Button variant="secondary" icon={Mail} onClick={openOutlook}>
            Abrir no Outlook
          </Button>
          <Button variant="ghost" icon={ExternalLink} onClick={openClient}>
            Usar aplicativo padrão
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TranslatorModal({ onClose, setToast }) {
  const [text, setText] = useState(""),
    [lang, setLang] = useState("Inglês"),
    [mode, setMode] = useState("traduzir"),
    [out, setOut] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const langs = [
    "Inglês",
    "Espanhol",
    "Francês",
    "Italiano",
    "Alemão",
    "Português",
    "Chinês (Mandarim)",
    "Japonês",
    "Coreano",
    "Árabe",
    "Russo",
    "Holandês",
  ];
  const translate = async () => {
    if (text.trim().length < 1 || busy) return;
    setBusy(true);
    setErr("");
    setOut("");
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          prompt:
            mode === "traduzir"
              ? `Detecte automaticamente o idioma do texto abaixo e traduza-o para ${lang}. Responda SOMENTE com a tradução, mantendo o tom e a formatação, sem aspas e sem comentários.\n\n${text.trim()}`
              : `A mensagem abaixo foi recebida de um cliente ou parceiro (detecte o idioma automaticamente). 1) Traduza a mensagem para português. 2) Sugira uma resposta profissional e cordial em ${lang}, pronta para enviar. 3) Mostre a tradução da resposta em português para conferência. Use títulos curtos para as três partes. Não invente informações que não estejam na mensagem.\n\n${text.trim()}`,
          specialist: "Redator",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível traduzir agora.");
      setOut((d.content || "").trim());
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Funcionário Bilíngue — Tradutor" wide onClose={onClose}>
      <div className="modal-body">
        <div className="notice">
          <Languages />
          <span>
            Tradução por IA, gratuita. Ideal para e-mails, propostas, descrições
            e atendimento a clientes de outros países.
          </span>
        </div>
        <div className="form-grid">
          <Field label="O que você precisa">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="traduzir">Traduzir um texto (detecta o idioma sozinho)</option>
              <option value="responder">Recebi uma mensagem — traduzir e sugerir resposta</option>
            </select>
          </Field>
          <Field label={mode === "traduzir" ? "Texto para traduzir" : "Mensagem recebida"}>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 5000))}
              placeholder="Cole ou escreva o texto..."
            />
          </Field>
          <Field label="Traduzir para">
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {langs.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        {err && (
          <div className="ask-error">
            <CircleAlert />
            {err}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            icon={busy ? RefreshCw : Languages}
            disabled={busy || !text.trim()}
            onClick={translate}
          >
            {busy ? "Traduzindo..." : "Traduzir"}
          </Button>
        </div>
        {out && (
          <div className="translate-out">
            <div className="translate-head">
              <span>Tradução ({lang})</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(out);
                  setToast("Tradução copiada");
                }}
              >
                <Copy />
                Copiar
              </button>
            </div>
            <pre>{out}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RouterModal({ onClose, setToast }) {
  const [stops, setStops] = useState(["", ""]),
    [mode, setMode] = useState("driving"),
    [busy, setBusy] = useState(false);
  const [sugg, setSugg] = useState({});
  const [eta, setEta] = useState("");
  const suggTimer = useRef(null);
  const suggest = (i, q) => {
    clearTimeout(suggTimer.current);
    if (q.trim().length < 4) return;
    suggTimer.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=br&q=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } },
      )
        .then((r) => (r.ok ? r.json() : []))
        .then((list) =>
          setSugg((cur) => ({ ...cur, [i]: (list || []).map((x) => x.display_name) })),
        )
        .catch(() => {});
    }, 550);
  };
  const calcEta = async () => {
    const pts = clean();
    if (pts.length < 2) {
      setToast("Informe ao menos origem e destino");
      return;
    }
    setEta("calculando");
    try {
      const coords = [];
      for (const p of pts) {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(p)}`,
          { headers: { accept: "application/json" } },
        );
        const j = await r.json();
        if (!j[0]) throw new Error(`Endereço não encontrado: ${p.slice(0, 40)}`);
        coords.push(`${j[0].lon},${j[0].lat}`);
      }
      const or = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords.join(";")}?overview=false`,
      );
      const oj = await or.json();
      const route = oj.routes && oj.routes[0];
      if (!route) throw new Error("Não foi possível traçar a rota.");
      const min = Math.round(route.duration / 60);
      const h = Math.floor(min / 60);
      const km = (route.distance / 1000).toFixed(1);
      setEta(
        `≈ ${h > 0 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`} de carro · ${km} km (sem trânsito · dados © OpenStreetMap)`,
      );
    } catch (e) {
      setEta("");
      setToast(e.message || "Não foi possível calcular agora");
    }
  };
  const setStop = (i, v) => setStops((s) => s.map((x, j) => (j === i ? v : x)));
  const addStop = () =>
    setStops((s) =>
      s.length < 12 ? [...s.slice(0, -1), "", s[s.length - 1]] : s,
    );
  const removeStop = (i) =>
    setStops((s) => (s.length > 2 ? s.filter((_, j) => j !== i) : s));
  const clean = () => stops.map((s) => s.trim()).filter(Boolean);
  const buildUrl = (pts) =>
    `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pts[0])}&destination=${encodeURIComponent(pts[pts.length - 1])}${pts.length > 2 ? "&waypoints=" + pts.slice(1, -1).map(encodeURIComponent).join("%7C") : ""}&travelmode=${mode}`;
  const open = () => {
    const pts = clean();
    if (pts.length < 2) {
      setToast("Informe ao menos origem e destino");
      return;
    }
    window.open(buildUrl(pts), "_blank", "noopener");
    setToast("Rota aberta no Google Maps");
  };
  const optimize = async () => {
    const pts = clean();
    if (pts.length < 3) {
      setToast("Adicione paradas para otimizar");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          prompt: `Sou entregador. Ordene os endereços abaixo na sequência mais eficiente de rota, mantendo o primeiro como ponto de partida. Responda SOMENTE com a lista numerada dos endereços na nova ordem, sem comentários.\n\n${pts.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
          specialist: "Logística",
        }),
      });
      const d = await r.json();
      if (r.ok && d.content) {
        const reordered = d.content
          .split("\n")
          .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
          .filter(Boolean);
        if (reordered.length >= pts.length) {
          setStops([...reordered.slice(0, pts.length), ""]);
          setToast("Ordem sugerida pela IA aplicada");
        }
      }
    } catch {
      setToast("Não foi possível otimizar agora");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Logística — Roteirizador" wide onClose={onClose}>
      <div className="modal-body">
        <div className="notice">
          <Route />
          <span>
            Monte a rota com várias paradas e abra direto no Google Maps para
            navegar. Gratuito, sem cadastro. Tempo de trajeto, trânsito e pedágios aparecem no Maps ao abrir a rota.
          </span>
        </div>
        <div className="route-list">
          {stops.map((s, i) => (
            <div className="route-row" key={i}>
              <span className="route-dot">
                {i === 0 ? (
                  <MapPin />
                ) : i === stops.length - 1 ? (
                  <Navigation />
                ) : (
                  i
                )}
              </span>
              <input
                list={`route-sugg-${i}`}
                value={s}
                onChange={(e) => {
                  setStop(i, e.target.value);
                  suggest(i, e.target.value);
                }}
                placeholder={
                  i === 0
                    ? "Origem (endereço de partida)"
                    : i === stops.length - 1
                      ? "Destino final"
                      : `Parada ${i}`
                }
              />
              <datalist id={`route-sugg-${i}`}>
                {(sugg[i] || []).map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {stops.length > 2 && (
                <button
                  className="icon-button danger"
                  onClick={() => removeStop(i)}
                >
                  <X />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="text-button" onClick={addStop}>
          <Plus size={16} />
          Adicionar parada
        </button>
        {eta && (
          <div className="route-eta">
            {eta === "calculando" ? "Calculando rota..." : eta}
          </div>
        )}
        <div className="route-mode">
          <span>Como vai se deslocar:</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="driving">Carro/moto</option>
            <option value="walking">A pé</option>
            <option value="bicycling">Bicicleta</option>
            <option value="transit">Transporte público</option>
          </select>
        </div>
        <div className="modal-actions">
          <Button
            variant="secondary"
            icon={busy ? RefreshCw : Sparkles}
            disabled={busy}
            onClick={optimize}
          >
            {busy ? "Otimizando..." : "Sugerir melhor ordem (IA)"}
          </Button>
          <Button variant="secondary" icon={Clock3} onClick={calcEta}>
            Tempo e distância
          </Button>
          <Button icon={Navigation} onClick={open}>
            Abrir rota no Maps
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const aiTools = {
  price: {
    title: "Financeiro — Calculadora de preço",
    icon: DollarSign,
    specialist: "Precificador",
    cta: "Calcular preço",
    outTitle: "Preço sugerido",
    hint: "Calcula o preço de venda com base apenas nos números que você informar. Mostra a fórmula e separa custo, margem e estimativas.",
    fields: [
      {
        key: "produto",
        label: "Produto ou serviço",
        type: "input",
        required: true,
        placeholder: "Ex.: Bolo de pote 250ml",
      },
      {
        key: "custo",
        label: "Custo direto por unidade (R$)",
        type: "input",
        required: true,
        placeholder: "Ex.: 4,50",
      },
      {
        key: "tempo",
        label: "Tempo/mão de obra por unidade",
        type: "input",
        placeholder: "Ex.: 20 min a R$ 25/h",
      },
      {
        key: "fixas",
        label: "Despesas fixas a ratear (R$)",
        type: "input",
        placeholder: "Ex.: aluguel/luz por unidade, se souber",
      },
      {
        key: "margem",
        label: "Margem de lucro desejada (%)",
        type: "input",
        placeholder: "Ex.: 40",
      },
    ],
    build: (v) =>
      `Calcule um preço de venda sugerido usando SOMENTE estes números. Mostre a fórmula, some custo direto + mão de obra + rateio de despesas, aplique a margem, e separe claramente o que é fato informado do que é estimativa. Não invente valores ausentes — se faltar algo, aponte.\n\nProduto: ${v.produto}\nCusto direto/unidade: R$ ${v.custo}\nMão de obra/tempo: ${v.tempo || "não informado"}\nDespesas fixas a ratear: ${v.fixas || "não informado"}\nMargem desejada: ${v.margem || "não informada"}%`,
  },
  post: {
    title: "Marketing — Gerador de posts",
    icon: Megaphone,
    specialist: "Marketing",
    cta: "Gerar posts",
    outTitle: "Legendas prontas",
    hint: "Cria opções de legenda com hashtags para suas redes, a partir do que você vende e do tom da marca.",
    fields: [
      {
        key: "oferta",
        label: "O que você quer divulgar",
        type: "textarea",
        required: true,
        placeholder: "Ex.: Nova linha de bolos no pote, sabores de inverno",
      },
      {
        key: "rede",
        label: "Rede social",
        type: "select",
        options: [
          "Instagram",
          "Facebook",
          "LinkedIn",
          "TikTok",
          "WhatsApp Status",
        ],
      },
      {
        key: "objetivo",
        label: "Objetivo",
        type: "select",
        options: [
          "Vender",
          "Engajar/interagir",
          "Divulgar novidade",
          "Educar o público",
        ],
      },
      {
        key: "tom",
        label: "Tom da marca",
        type: "input",
        placeholder: "Ex.: acolhedor e divertido",
      },
    ],
    build: (v) =>
      `Crie 3 opções de legenda para ${v.rede} com o objetivo de ${v.objetivo}. Tom: ${v.tom || "profissional e próximo"}. Use emojis adequados e, ao final de cada opção, 5 a 8 hashtags relevantes. Não invente preços, promoções, prazos ou resultados que não foram informados.\n\nAssunto: ${v.oferta}`,
  },
  contract: {
    title: "Jurídico — Gerador de contrato",
    icon: BriefcaseBusiness,
    specialist: "Jurídico",
    cta: "Gerar minuta",
    outTitle: "Minuta de contrato",
    hint: "Monta uma minuta de contrato de prestação de serviços com seus dados, em cláusulas, pronta para revisão de um advogado.",
    fields: [
      {
        key: "contratante",
        label: "Contratante (quem contrata)",
        type: "input",
        required: true,
        placeholder: "Nome/empresa e, se tiver, CNPJ/CPF",
      },
      {
        key: "contratado",
        label: "Contratado (quem presta o serviço)",
        type: "input",
        required: true,
        placeholder: "Nome/empresa e, se tiver, CNPJ/CPF",
      },
      {
        key: "servico",
        label: "Serviço a ser prestado",
        type: "textarea",
        required: true,
        placeholder: "Descreva o objeto do contrato",
      },
      {
        key: "valor",
        label: "Valor e forma de pagamento",
        type: "input",
        placeholder: "Ex.: R$ 1.500 em 3x, via Pix",
      },
      {
        key: "prazo",
        label: "Prazo / vigência",
        type: "input",
        placeholder: "Ex.: 30 dias a partir da assinatura",
      },
    ],
    build: (v) =>
      `Monte uma minuta de CONTRATO DE PRESTAÇÃO DE SERVIÇOS em cláusulas numeradas (objeto, obrigações das partes, valor e pagamento, prazo, confidencialidade, rescisão, foro), usando SOMENTE os dados abaixo e deixando lacunas [entre colchetes] onde faltar informação. Ao final, inclua uma observação de que a minuta deve ser revisada por um advogado antes da assinatura. Não cite números de leis específicas nem invente cláusulas com valores não informados.\n\nContratante: ${v.contratante}\nContratado: ${v.contratado}\nServiço: ${v.servico}\nValor/pagamento: ${v.valor || "[a definir]"}\nPrazo: ${v.prazo || "[a definir]"}`,
  },
  sales: {
    title: "Vendas — Roteiro e follow-up",
    icon: TrendingUp,
    specialist: "Vendas",
    cta: "Gerar roteiro",
    outTitle: "Roteiro de vendas",
    hint: "Cria script de abordagem, respostas a objeções e mensagens de acompanhamento para fechar mais vendas.",
    fields: [
      {
        key: "oferta",
        label: "Produto ou serviço",
        type: "textarea",
        required: true,
        placeholder: "O que você vende e o principal benefício",
      },
      {
        key: "cliente",
        label: "Cliente ideal",
        type: "input",
        placeholder: "Ex.: mães que compram por encomenda",
      },
      {
        key: "canal",
        label: "Canal de contato",
        type: "select",
        options: [
          "WhatsApp",
          "E-mail",
          "Telefone",
          "Presencial",
          "Instagram Direct",
        ],
      },
    ],
    build: (v) =>
      `Crie um roteiro de vendas prático para ${v.canal}, com: 1) abordagem inicial, 2) 3 perguntas de qualificação, 3) apresentação de valor, 4) 3 objeções comuns com respostas prontas, 5) 2 mensagens de follow-up (com intervalo sugerido). Seja específico e ético. Não invente depoimentos, resultados ou preços não informados.\n\nProduto/serviço: ${v.oferta}\nCliente ideal: ${v.cliente || "não informado"}`,
  },
  rh: {
    title: "RH — Vaga e entrevista",
    icon: UserCog,
    specialist: "Pessoas",
    cta: "Gerar",
    outTitle: "Descrição de vaga + entrevista",
    hint: "Cria a descrição de uma vaga e um roteiro de entrevista, sem usar critérios discriminatórios.",
    fields: [
      {
        key: "cargo",
        label: "Cargo",
        type: "input",
        required: true,
        placeholder: "Ex.: Auxiliar de confeitaria",
      },
      {
        key: "responsa",
        label: "Principais responsabilidades",
        type: "textarea",
        placeholder: "O que a pessoa vai fazer no dia a dia",
      },
      {
        key: "requisitos",
        label: "Requisitos desejados",
        type: "input",
        placeholder: "Ex.: experiência com massas, disponibilidade manhã",
      },
      {
        key: "tipo",
        label: "Tipo de contratação",
        type: "select",
        options: ["CLT", "PJ", "Estágio", "Freelancer", "Temporário"],
      },
    ],
    build: (v) =>
      `Crie: 1) uma descrição de vaga profissional e atrativa e 2) um roteiro com 8 perguntas de entrevista (comportamentais e técnicas). Não use critérios discriminatórios (idade, gênero, estado civil, aparência). Não invente benefícios ou salários não informados.\n\nCargo: ${v.cargo}\nResponsabilidades: ${v.responsa || "não informadas"}\nRequisitos: ${v.requisitos || "não informados"}\nContratação: ${v.tipo}`,
  },
  ops: {
    title: "Operações — Passo a passo (POP)",
    icon: Workflow,
    specialist: "Operações",
    cta: "Gerar POP",
    outTitle: "Procedimento operacional",
    hint: "Transforma uma tarefa recorrente em um procedimento padrão com checklist, para qualquer pessoa executar igual.",
    fields: [
      {
        key: "processo",
        label: "Processo a padronizar",
        type: "input",
        required: true,
        placeholder: "Ex.: Preparo e entrega de encomendas",
      },
      {
        key: "objetivo",
        label: "Objetivo / resultado esperado",
        type: "input",
        placeholder: "Ex.: entregar no prazo e sem erros",
      },
      {
        key: "quem",
        label: "Quem executa",
        type: "input",
        placeholder: "Ex.: auxiliar e entregador",
      },
    ],
    build: (v) =>
      `Crie um Procedimento Operacional Padrão (POP) para o processo abaixo: passos numerados na ordem correta, responsáveis por etapa, pontos de atenção e um checklist final de conferência. Seja prático e específico.\n\nProcesso: ${v.processo}\nObjetivo: ${v.objetivo || "não informado"}\nExecutores: ${v.quem || "não informado"}`,
  },
  support: {
    title: "Atendimento — Respostas prontas",
    icon: Headphones,
    specialist: "Atendimento",
    cta: "Gerar respostas",
    outTitle: "Modelos de resposta",
    hint: "Gera modelos de resposta com empatia e foco em resolução, para você adaptar e enviar.",
    fields: [
      {
        key: "situacao",
        label: "Situação do cliente",
        type: "textarea",
        required: true,
        placeholder: "Ex.: cliente reclamando de atraso na entrega",
      },
      {
        key: "canal",
        label: "Canal",
        type: "select",
        options: [
          "WhatsApp",
          "E-mail",
          "Instagram Direct",
          "Telefone (roteiro)",
        ],
      },
      {
        key: "tom",
        label: "Tom desejado",
        type: "input",
        placeholder: "Ex.: educado, acolhedor e objetivo",
      },
    ],
    build: (v) =>
      `Crie 3 modelos de resposta para ${v.canal} para a situação abaixo, com empatia e foco em resolução. Ofereça uma solução concreta ou próximo passo. Não prometa reembolsos, prazos ou condições não informados.\n\nSituação: ${v.situacao}\nTom: ${v.tom || "educado e objetivo"}`,
  },
  dados: {
    title: "Dados — Análise de números",
    icon: Filter,
    specialist: "Dados",
    cta: "Analisar",
    outTitle: "Análise dos dados",
    hint: "Cole seus números (vendas, despesas, visitas...) e receba padrões, comparações e recomendações baseadas apenas no que você informar.",
    fields: [
      {
        key: "dados",
        label: "Cole seus dados",
        type: "textarea",
        required: true,
        placeholder:
          "Ex.:\nJan: 42 vendas, R$ 3.100\nFev: 38 vendas, R$ 2.900\nMar: 55 vendas, R$ 4.400",
      },
      {
        key: "pergunta",
        label: "O que você quer descobrir?",
        type: "input",
        placeholder: "Ex.: por que março cresceu? o que devo repetir?",
      },
    ],
    build: (v) =>
      `Analise APENAS os dados abaixo, sem inventar nenhum número: identifique padrões, variações relevantes (com percentuais calculados), possíveis causas a investigar e 3 recomendações práticas baseadas em evidências. Se os dados forem insuficientes para alguma conclusão, diga claramente.\n\nDados:\n${v.dados}\n\nPergunta principal: ${v.pergunta || "visão geral"}`,
  },
  ecommerce: {
    title: "E-commerce — Descrição de produto",
    icon: ShoppingBag,
    specialist: "E-commerce",
    cta: "Gerar descrição",
    outTitle: "Anúncio pronto",
    hint: "Cria título otimizado, descrição vendedora e palavras-chave para sua loja ou marketplace.",
    fields: [
      {
        key: "produto",
        label: "Produto",
        type: "input",
        required: true,
        placeholder: "Ex.: Kit 4 bolos de pote sabores sortidos",
      },
      {
        key: "caracteristicas",
        label: "Características e diferenciais",
        type: "textarea",
        placeholder:
          "Tamanho, sabor, material, prazo de validade, o que o torna especial...",
      },
      {
        key: "plataforma",
        label: "Onde vai vender",
        type: "select",
        options: [
          "Mercado Livre",
          "Shopee",
          "Amazon",
          "Loja própria / site",
          "Instagram / WhatsApp",
        ],
      },
      {
        key: "publico",
        label: "Público-alvo",
        type: "input",
        placeholder: "Ex.: presentes corporativos, festas infantis",
      },
    ],
    build: (v) =>
      `Crie um anúncio otimizado para ${v.plataforma}: 1) título com palavras-chave (respeitando o estilo da plataforma), 2) descrição vendedora e escaneável com bullets, 3) lista de 8 palavras-chave de busca, 4) sugestão de pergunta frequente com resposta. Não invente medidas, prazos, garantias ou certificações não informadas.\n\nProduto: ${v.produto}\nCaracterísticas: ${v.caracteristicas || "não detalhadas"}\nPúblico: ${v.publico || "geral"}`,
  },
  compras: {
    title: "Compras — Comparador de cotações",
    icon: Boxes,
    specialist: "Compras",
    cta: "Comparar",
    outTitle: "Comparativo e recomendação",
    hint: "Cole as cotações recebidas e receba uma comparação estruturada com recomendação e pontos de negociação.",
    fields: [
      {
        key: "item",
        label: "O que você está comprando",
        type: "input",
        required: true,
        placeholder: "Ex.: 500 embalagens para bolo de pote",
      },
      {
        key: "cotacoes",
        label: "Cotações recebidas",
        type: "textarea",
        required: true,
        placeholder:
          "Ex.:\nFornecedor A: R$ 0,90/un, prazo 10 dias, frete grátis\nFornecedor B: R$ 0,75/un, prazo 20 dias, frete R$ 80",
      },
      {
        key: "prioridade",
        label: "Sua prioridade",
        type: "select",
        options: [
          "Menor custo total",
          "Prazo mais rápido",
          "Equilíbrio custo x prazo",
          "Qualidade/confiabilidade",
        ],
      },
    ],
    build: (v) =>
      `Compare as cotações abaixo em uma tabela (custo total calculado, prazo, condições), aponte a melhor opção considerando a prioridade "${v.prioridade}", os riscos de cada fornecedor e 3 pontos para negociar antes de fechar. Use somente os valores informados; calcule totais quando possível e mostre o cálculo.\n\nItem: ${v.item}\nCotações:\n${v.cotacoes}`,
  },
};

function AIToolModal({ config, db: _db, update, onClose, setToast, business }) {
  const [vals, setVals] = useState(
    Object.fromEntries(
      config.fields.map((f) => [f.key, f.type === "select" ? f.options[0] : ""]),
    ),
  );
  const [out, setOut] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const [chat, setChat] = useState([]);
  const [ask, setAsk] = useState("");
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));
  const saveOutput = (destination) => {
    const now = new Date().toISOString();
    update((current) => {
      if (destination === "document")
        return {
          ...current,
          documents: [
            {
              id: uid(),
              title: config.title,
              type: config.docType || "Material de trabalho",
              content: out,
              businessId: business?.id || null,
              updatedAt: now,
              versions: [],
            },
            ...current.documents,
          ],
        };
      if (destination === "task")
        return {
          ...current,
          tasks: [
            {
              id: uid(),
              title: `Revisar: ${config.title}`,
              description: out.slice(0, 800),
              priority: "Média",
              status: "A fazer",
              due: "",
              area: config.specialist || "Operação",
              assignee: "",
              project: config.title,
              archived: false,
              businessId: business?.id || null,
              createdAt: now,
              updatedAt: now,
            },
            ...current.tasks,
          ],
        };
      return {
        ...current,
        history: [
          {
            id: uid(),
            title: config.title,
            request: config.build(vals),
            result: out,
            specialist: config.specialist,
            businessId: business?.id || null,
            type: "Ferramenta inteligente",
            status: "Concluído",
            createdAt: now,
            updatedAt: now,
            archived: false,
          },
          ...current.history,
        ],
      };
    });
    setToast(
      destination === "document"
        ? "Resultado salvo em Documentos"
        : destination === "task"
          ? "Resultado transformado em tarefa"
          : "Resultado salvo em Projetos",
    );
  };
  const Icon = config.icon;
  const call = async (prompt, messages) => {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        prompt,
        specialist: config.specialist,
        messages,
        ...aiWorkspaceContext(business),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Não foi possível gerar agora.");
    return (d.content || "").trim();
  };
  const run = async () => {
    const missing = config.fields.filter(
      (f) => f.required && !String(vals[f.key]).trim(),
    );
    if (missing.length) {
      setErr("Preencha: " + missing.map((f) => f.label).join(", "));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const prompt = config.build(vals);
      const content = await call(prompt, []);
      setOut(content);
      setChat([{ role: "user", content: prompt }, { role: "assistant", content }]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refine = async () => {
    const q = ask.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr("");
    try {
      const messages = [...chat, { role: "user", content: q }].slice(-10);
      const content = await call(q, messages);
      setOut(content);
      setChat((c) => [...c, { role: "user", content: q }, { role: "assistant", content }]);
      setAsk("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={config.title} wide onClose={onClose}>
      <div className="modal-body">
        <div className="notice">
          <Icon />
          <span>{config.hint}</span>
        </div>
        <div className="form-grid">
          {config.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {f.type === "textarea" ? (
                <textarea value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
              ) : f.type === "select" ? (
                <select value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
              )}
            </Field>
          ))}
        </div>
        {err && (
          <div className="ask-error">
            <CircleAlert />
            {err}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button icon={busy && !out ? RefreshCw : Sparkles} disabled={busy} onClick={run}>
            {busy && !out ? "Gerando..." : out ? "Gerar de novo" : config.cta}
          </Button>
        </div>
        {out && (
          <div className="translate-out">
            <div className="translate-head">
              <span>{config.outTitle}</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(out);
                  setToast("Copiado");
                }}
              >
                <Copy />
                Copiar
              </button>
            </div>
            <div className="translate-body">
              <Markdown text={out} />
            </div>
            <div className="tool-followup">
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); refine(); } }}
                placeholder="Tire uma dúvida ou peça um ajuste (ex.: deixe mais curto, mude o tom...)"
              />
              <Button icon={busy ? RefreshCw : Send} disabled={busy || !ask.trim()} onClick={refine}>
                {busy ? "..." : "Enviar"}
              </Button>
            </div>
            <div className="result-destinations">
              <Button
                variant="secondary"
                icon={FileText}
                onClick={() => saveOutput("document")}
              >
                Salvar documento
              </Button>
              <Button
                variant="secondary"
                icon={ListTodo}
                onClick={() => saveOutput("task")}
              >
                Criar tarefa
              </Button>
              <Button icon={Save} onClick={() => saveOutput("project")}>
                Salvar projeto
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const blankWaTemplate = { name: "", category: "Contato", body: "" };

// As 12 ferramentas inteligentes agrupadas pelo objetivo de quem procura —
// espelha as categorias do menu lateral em vez de uma parede plana de cartões.
const smartToolGroups = [
  {
    label: "Vendas e clientes",
    items: [
      ["sales", "Roteiro de vendas", TrendingUp, "Abordagem, objeções e follow-up para fechar mais.", "g5"],
      ["support", "Respostas de atendimento", Headphones, "Modelos com empatia para responder clientes.", "g8"],
      ["ecommerce", "Descrição de produto", ShoppingBag, "Anúncio otimizado para marketplace ou loja.", "g10"],
      ["post", "Gerador de posts", Megaphone, "Legendas com hashtags para as suas redes sociais.", "g3"],
    ],
  },
  {
    label: "Dinheiro e números",
    items: [
      ["price", "Calculadora de preço", DollarSign, "Descubra o preço de venda ideal a partir dos seus custos.", "g2"],
      ["dados", "Análise de números (Dados)", Filter, "Cole vendas e despesas e descubra padrões.", "g9"],
      ["compras", "Comparador de cotações", Boxes, "Compare fornecedores e saiba o que negociar.", "g11"],
    ],
  },
  {
    label: "Documentos e textos",
    items: [
      ["contract", "Gerador de contrato", BriefcaseBusiness, "Minuta de prestação de serviços pronta para revisão.", "g4"],
      ["translate", "Funcionário Bilíngue", Languages, "Traduza textos, e-mails e propostas para 12 idiomas com IA.", "g0"],
    ],
  },
  {
    label: "Equipe e operação",
    items: [
      ["rh", "Vaga e entrevista (RH)", UserCog, "Descrição de vaga e perguntas de entrevista.", "g6"],
      ["ops", "Passo a passo (Operações)", Workflow, "Procedimento padrão com checklist para a equipe.", "g7"],
      ["route", "Roteirizador de entregas", Route, "Monte rotas com várias paradas e abra no Google Maps.", "g1"],
    ],
  },
];

function ToolsHub({ db, update, business, setToast }) {
  const [smart, setSmart] = useState("");
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("Todas"),
    [emailOpen, setEmailOpen] = useState(false);
  const [waForm, setWaForm] = useState(blankWaTemplate);
  const [waEditing, setWaEditing] = useState(null);
  const waTemplates =
    db.waTemplates && db.waTemplates.length
      ? db.waTemplates
      : DEFAULT_WA_TEMPLATES;
  const saveWaTemplate = (e) => {
    e.preventDefault();
    if (!waForm.name.trim() || !waForm.body.trim()) return;
    const list = waTemplates;
    const next = waEditing
      ? list.map((t) =>
          t.id === waEditing ? { ...t, ...waForm, id: waEditing } : t,
        )
      : [...list, { ...waForm, id: uid() }];
    update((d) => ({ ...d, waTemplates: next }));
    setWaForm(blankWaTemplate);
    setWaEditing(null);
    setToast(waEditing ? "Modelo atualizado" : "Modelo criado");
  };
  const editWaTemplate = (t) => {
    setWaEditing(t.id);
    setWaForm({ name: t.name, category: t.category, body: t.body });
  };
  const deleteWaTemplate = (id) => {
    if (!confirm("Excluir este modelo?")) return;
    update((d) => ({ ...d, waTemplates: waTemplates.filter((t) => t.id !== id) }));
    if (waEditing === id) {
      setWaEditing(null);
      setWaForm(blankWaTemplate);
    }
    setToast("Modelo excluído");
  };
  const restoreWaTemplates = () => {
    update((d) => ({
      ...d,
      waTemplates: DEFAULT_WA_TEMPLATES.map((t) => ({ ...t })),
    }));
    setToast("Modelos padrão restaurados");
  };
  const plugged = db.pluggedTools || [];
  const togglePlug = (id) => {
    const on = plugged.includes(id);
    update((d) => ({
      ...d,
      pluggedTools: on
        ? (d.pluggedTools || []).filter((x) => x !== id)
        : [...(d.pluggedTools || []), id],
    }));
    setToast(
      on ? "Ferramenta desconectada" : "Ferramenta plugada no seu painel",
    );
  };
  const categories = ["Todas", ...new Set(toolCatalog.map((x) => x.category))];
  const filtered = toolCatalog.filter(
    (x) =>
      (category === "Todas" || x.category === category) &&
      `${x.name} ${x.description} ${x.keywords}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <PageTitle
      eyebrow="CENTRAL DE FERRAMENTAS"
      title="Tudo conectado ao trabalho que precisa acontecer"
      text="Encontre a ferramenta certa, abra o serviço oficial e continue a execução sem ficar preso em uma tela sem saída."
      action={
        <Button icon={Mail} onClick={() => setEmailOpen(true)}>
          Escrever e-mail
        </Button>
      }
    >
      <section className="smart-tools">
        <div className="section-head">
          <div>
            <span className="eyebrow">FERRAMENTAS INTELIGENTES · GRÁTIS</span>
            <h2>Funções que trabalham por dentro do app</h2>
          </div>
        </div>
        {smartToolGroups.map((group) => (
          <div className="smart-group" key={group.label}>
            <small className="smart-group-label">{group.label}</small>
            <div className="smart-grid">
              {group.items.map(([id, name, Icon, description, tone]) => (
                <button
                  className="smart-card"
                  key={id}
                  onClick={() => setSmart(id)}
                >
                  <span className={`smart-icon ${tone}`}>
                    <Icon />
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </div>
                  <ArrowUpRight />
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="panel wa-templates" id="wa-templates">
        <div className="panel-head">
          <div>
            <span className="eyebrow">WHATSAPP</span>
            <h2>Modelos de mensagem</h2>
          </div>
          <Button
            variant="ghost"
            icon={RotateCcw}
            onClick={restoreWaTemplates}
          >
            Restaurar padrão
          </Button>
        </div>
        <p className="das-intro">
          Crie mensagens reutilizáveis com variáveis entre chaves duplas. Ao
          enviar um WhatsApp a partir de um lead, contato, pedido ou
          agendamento, o app preenche as variáveis automaticamente e você só
          revisa antes de mandar.
        </p>
        <form className="wa-template-form" onSubmit={saveWaTemplate}>
          <Field label="Nome do modelo">
            <input
              value={waForm.name}
              onChange={(e) => setWaForm({ ...waForm, name: e.target.value })}
              placeholder="Ex.: Confirmação de pedido"
            />
          </Field>
          <Field label="Categoria">
            <select
              value={waForm.category}
              onChange={(e) =>
                setWaForm({ ...waForm, category: e.target.value })
              }
            >
              {WA_TEMPLATE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <div className="wa-template-body">
            <Field label="Mensagem">
              <textarea
                rows={3}
                value={waForm.body}
                onChange={(e) => setWaForm({ ...waForm, body: e.target.value })}
                placeholder="Olá {{nome}}, tudo bem? Aqui é da {{negocio}}..."
              />
            </Field>
          </div>
          <p className="wa-template-vars">
            Variáveis disponíveis: <code>{"{{nome}}"}</code>{" "}
            <code>{"{{negocio}}"}</code> <code>{"{{valor}}"}</code>{" "}
            <code>{"{{itens}}"}</code> <code>{"{{status}}"}</code>{" "}
            <code>{"{{servico}}"}</code> <code>{"{{data}}"}</code>{" "}
            <code>{"{{hora}}"}</code> <code>{"{{descricao}}"}</code>
          </p>
          <div className="wa-template-body">
            <div className="modal-actions">
              {waEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setWaEditing(null);
                    setWaForm(blankWaTemplate);
                  }}
                >
                  Cancelar edição
                </Button>
              )}
              <Button
                type="submit"
                icon={waEditing ? Save : Plus}
                disabled={!waForm.name.trim() || !waForm.body.trim()}
              >
                {waEditing ? "Salvar modelo" : "Adicionar modelo"}
              </Button>
            </div>
          </div>
        </form>
        <div className="wa-template-list">
          {waTemplates.map((t) => (
            <div className="wa-template-item" key={t.id}>
              <div>
                <span className="tag">{t.category}</span>
                <strong>{t.name}</strong>
                <p>{t.body}</p>
              </div>
              <span className="task-actions">
                <button
                  className="icon-button"
                  aria-label={`Editar modelo ${t.name}`}
                  title="Editar"
                  onClick={() => editWaTemplate(t)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Excluir modelo ${t.name}`}
                  title="Excluir"
                  onClick={() => deleteWaTemplate(t.id)}
                >
                  <Trash2 />
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="tool-hero">
        <div>
          <span className="eyebrow light">REDIRECIONADOR INTELIGENTE</span>
          <h2>
            O Seu Funcionário faz o que pode aqui.
            <br />
            Quando não pode, leva você ao lugar certo.
          </h2>
        </div>
        <div className="search tool-search">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: emitir nota fiscal, enviar e-mail, criar design..."
          />
        </div>
      </div>
      <div className="category-tabs">
        {categories.map((x) => (
          <button
            className={category === x ? "active" : ""}
            onClick={() => setCategory(x)}
            key={x}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="tools-grid">
        {filtered.map((tool) => {
          const on = plugged.includes(tool.id);
          return (
            <article key={tool.id}>
              <button
                className={on ? "plug-toggle on" : "plug-toggle"}
                title={on ? "Desconectar" : "Plugar no meu painel"}
                onClick={() => togglePlug(tool.id)}
              >
                <Plug />
              </button>
              <span className="tool-icon">
                <DynamicIcon icon={tool.icon} />
              </span>
              <div>
                <span className="tag">{tool.category}</span>
                <h3>{tool.name}</h3>
                <p>{tool.description}</p>
                <small>{toolBadgeLabel(tool)}</small>
              </div>
              <a href={tool.url} target="_blank" rel="noreferrer">
                Abrir ferramenta <ExternalLink />
              </a>
            </article>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <Empty
          icon={Search}
          title="Nenhuma ferramenta encontrada"
          text="Tente buscar pelo objetivo, como nota fiscal, CRM, design ou agenda."
        />
      )}
      <section className="nf-guide">
        <span className="tool-icon">
          <ReceiptText />
        </span>
        <div>
          <span className="eyebrow">ATALHO FISCAL</span>
          <h2>Qual nota fiscal você precisa?</h2>
          <p>
            <strong>Prestação de serviços:</strong> use a NFS-e Nacional.{" "}
            <strong>Venda de produtos:</strong> use NF-e, como o emissor
            gratuito do Sebrae. Obrigações variam conforme atividade, município
            e regime; valide dúvidas tributárias com um contador.
          </p>
        </div>
        <div>
          <a
            href="https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica"
            target="_blank"
            rel="noreferrer"
          >
            Emitir NFS-e
          </a>
          <a
            href="https://emissornfe.sebrae.com.br/"
            target="_blank"
            rel="noreferrer"
          >
            Emitir NF-e
          </a>
        </div>
      </section>
      {emailOpen && (
        <EmailComposer
          onClose={() => setEmailOpen(false)}
          setToast={setToast}
        />
      )}
      {smart === "translate" && (
        <TranslatorModal onClose={() => setSmart("")} setToast={setToast} />
      )}
      {smart === "route" && (
        <RouterModal onClose={() => setSmart("")} setToast={setToast} />
      )}
      {aiTools[smart] && (
        <AIToolModal
          config={aiTools[smart]}
          db={db}
          onClose={() => setSmart("")}
          setToast={setToast}
          update={update}
          business={business}
        />
      )}
    </PageTitle>
  );
}

function CreativeStudio({ db, update, business, setToast }) {
  const [type, setType] = useState("logo"),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0),
    [videoEnabled, setVideoEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((config) => setVideoEnabled(!!config.videoEnabled))
      .catch(() => setVideoEnabled(false));
  }, []);
  const items = useMemo(
    () =>
      (db.media || []).filter(
        (x) => !business || x.businessId === business.id,
      ),
    [business, db.media],
  );
  useEffect(() => {
    let active = true;
    const savedVideos = items.filter(
      (item) => item.type === "video" && item.requestId,
    );
    if (!savedVideos.length) return () => {};
    Promise.all(
      savedVideos.map(async (item) => {
        const response = await fetch(
          `/api/media?request_id=${encodeURIComponent(item.requestId)}`,
          { headers: authHeaders() },
        );
        const status = await response.json().catch(() => ({}));
        return response.ok ? { id: item.id, ...status } : null;
      }),
    )
      .then((statuses) => {
        if (!active) return;
        const available = statuses.filter(Boolean);
        if (!available.length) return;
        update((current) => ({
          ...current,
          media: (current.media || []).map((item) => {
            const status = available.find((entry) => entry.id === item.id);
            if (!status) return item;
            return {
              ...item,
              status: status.status || item.status,
              url: status.url || item.url,
              duration: status.duration || item.duration,
            };
          }),
        }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // Consulta novamente sempre que o usuário volta ao estúdio ou troca de negócio.
  }, [business?.id, items, update]);
  const generate = async () => {
    if (prompt.trim().length < 5 || busy || (type === "video" && !videoEnabled))
      return;
    setBusy(true);
    setError("");
    setProgress(5);
    try {
      const response = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          type,
          prompt: prompt.trim(),
          quality: type === "video" ? "advanced" : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Não foi possível gerar o material.");
      const item = {
        id: uid(),
        type,
        prompt: prompt.trim(),
        status: data.status,
        url: data.url || null,
        requestId: data.requestId || null,
        freeTier: !!data.freeTier,
        businessId: business?.id || null,
        ownerId: db.user.id,
        visibility: "privado",
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, media: [item, ...(d.media || [])] }));
      if (type === "video" && data.requestId) {
        let finished = false;
        for (let i = 0; i < 180; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const check = await fetch(
              `/api/media?request_id=${encodeURIComponent(data.requestId)}`,
              { headers: authHeaders() },
            ),
            status = await check.json();
          if (!check.ok)
            throw new Error(
              status.error || "Não foi possível consultar a geração.",
            );
          setProgress(status.progress || Math.min(96, 8 + Math.round(i * 0.5)));
          if (status.status === "done" && status.url) {
            update((d) => ({
              ...d,
              media: (d.media || []).map((x) =>
                x.id === item.id
                  ? {
                      ...x,
                      status: "done",
                      url: status.url,
                      duration: status.duration,
                    }
                  : x,
              ),
            }));
            setToast("Vídeo generativo concluído");
            finished = true;
            break;
          }
          if (status.status === "failed" || status.status === "expired")
            throw new Error(
              status.error || "A geração do vídeo não foi concluída.",
            );
        }
        if (!finished)
          throw new Error(
            "A geração continua no servidor. Ela permanecerá na fila; tente consultar novamente em alguns minutos.",
          );
      } else
        setToast(
          data.freeTier
            ? type === "logo"
              ? "Logo criado na infraestrutura gratuita"
              : "Imagem criada na infraestrutura gratuita"
            : type === "logo"
              ? "Conceito de logo criado"
              : "Imagem criada",
        );
      setPrompt("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };
  const labels = {
    logo: {
      title: "Criador de logos",
      text: "Descreva nome, segmento, personalidade, cores e símbolos que devem ser evitados.",
      placeholder:
        "Ex.: Logo para uma confeitaria artesanal chamada Doce Norte, elegante, acolhedora, terracota e creme...",
    },
    image: {
      title: "Gerador de imagens",
      text: "Crie imagens para campanhas, sites, produtos e redes sociais.",
      placeholder:
        "Ex.: Fotografia editorial de uma mesa com bolos artesanais, luz natural suave...",
    },
    video: {
      title: "Gerador de vídeos",
      text: "Gere um vídeo curto de seis segundos a partir de uma descrição.",
      placeholder:
        "Ex.: Câmera se aproxima lentamente de uma vitrine de confeitaria ao amanhecer...",
    },
  }[type];
  const changeType = (next) => {
    setType(next);
    setError("");
  };
  return (
    <PageTitle
      eyebrow="ESTÚDIO CRIATIVO"
      title="Crie materiais visuais com IA"
      text="Logos e imagens usam a infraestrutura de IA disponível. Vídeo próprio só é liberado quando um servidor GPU é conectado."
    >
      <div className="studio-tabs">
        <button
          className={type === "logo" ? "active" : ""}
          onClick={() => changeType("logo")}
        >
          <Palette />
          Logos
        </button>
        <button
          className={type === "image" ? "active" : ""}
          onClick={() => changeType("image")}
        >
          <ImageIcon />
          Imagens
        </button>
        <button
          className={type === "video" ? "active" : ""}
          onClick={() => changeType("video")}
        >
          <Video />
          Vídeos
        </button>
      </div>
      <section className="studio-creator">
        <div className="studio-copy">
          <span className="spark-dot">
            <WandSparkles />
          </span>
          <h2>{labels.title}</h2>
          <p>{labels.text}</p>
          <div className="studio-points">
            <span>
              <CheckCircle2 />
              Prompt aprimorado automaticamente
            </span>
            <span>
              <CheckCircle2 />
              {type === "video"
                ? videoEnabled
                  ? "Geração de vídeo disponível"
                  : "Alternativa gratuita externa disponível"
                : "Geração visual gratuita quando disponível"}
            </span>
            <span>
              <ShieldCheck />
              Sem marcas ou depoimentos inventados
            </span>
          </div>
        </div>
        <div className="studio-form">
          <Field label="Descreva o que deseja criar">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 3000))}
              placeholder={labels.placeholder}
            />
          </Field>
          {type === "video" && (
            <>
              <div className="notice">
                <Video />
                <span>
                  {videoEnabled
                    ? "A geração acontece na nuvem, sem usar o seu computador."
                    : "A geração integrada ainda não está disponível. Use a alternativa gratuita abaixo; ela pode ter fila."}
                </span>
              </div>
              <a
                className="button secondary"
                href="https://huggingface.co/spaces/Lightricks/LTX-2-3"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={17} />
                <span>Abrir gerador de vídeo gratuito</span>
              </a>
              <small>
                Serviço externo gratuito, sujeito à disponibilidade e fila.
              </small>
            </>
          )}
          {error && (
            <div className="ask-error">
              <CircleAlert />
              {error}
            </div>
          )}
          <Button
            icon={busy ? RefreshCw : WandSparkles}
            disabled={
              busy ||
              prompt.trim().length < 5 ||
              (type === "video" && !videoEnabled)
            }
            onClick={generate}
          >
            {busy
              ? type === "video"
                ? `Gerando vídeo${progress ? ` · ${progress}%` : ""}`
                : "Criando..."
              : type === "video" && !videoEnabled
                ? "Servidor de vídeo indisponível"
                : "Gerar agora"}
          </Button>
        </div>
      </section>
      {items.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">CRIAÇÕES</span>
              <h2>Galeria do negócio</h2>
            </div>
          </div>
          <div className="media-grid">
            {items.map((item) => (
              <article key={item.id}>
                {item.status === "done" && item.url ? (
                  item.type === "video" ? (
                    <video controls src={item.url}>
                      <track kind="captions" />
                    </video>
                  ) : (
                    <img src={item.url} alt={item.prompt} />
                  )
                ) : (
                  <div className="media-pending">
                    <RefreshCw />
                    <span>Processando</span>
                  </div>
                )}
                <div>
                  <span className="tag">
                    {item.type === "logo"
                      ? "Logo"
                      : item.type === "image"
                        ? "Imagem"
                        : "Vídeo"}
                  </span>
                  <p>{item.prompt}</p>
                  <small>
                    {item.status === "done"
                      ? "Material concluído"
                      : "Em produção"}
                  </small>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                    >
                      Abrir e baixar <Download />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </PageTitle>
  );
}

function HistoryPage({ db, update, business, setToast, go }) {
  const [open, setOpen] = useState(null),
    [search, setSearch] = useState(""),
    [visibility, setVisibility] = useState("Ativos"),
    [typeFilter, setTypeFilter] = useState("Todos"),
    [rename, setRename] = useState(""),
    [busy, setBusy] = useState(false);
  const types = [
    ...new Set(db.history.map((item) => item.type).filter(Boolean)),
  ];
  const items = db.history.filter(
    (x) =>
      (!business || x.businessId === business.id) &&
      `${x.title} ${x.result || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (visibility === "Todos" ||
        (visibility === "Arquivados" ? !!x.archived : !x.archived)) &&
      (typeFilter === "Todos" || x.type === typeFilter),
  );
  const changeProject = (id, changes) =>
    update((d) => ({
      ...d,
      history: d.history.map((item) =>
        item.id === id
          ? { ...item, ...changes, updatedAt: new Date().toISOString() }
          : item,
      ),
    }));
  const openProject = (item) => {
    setOpen(item.id);
    setRename(item.title);
  };
  const duplicate = (item) => {
    const now = new Date().toISOString();
    update((d) => ({
      ...d,
      history: [
        {
          ...item,
          id: uid(),
          title: `${item.title} (cópia)`,
          createdAt: now,
          updatedAt: now,
          archived: false,
        },
        ...d.history,
      ],
    }));
    setToast("Projeto duplicado");
  };
  const continueProject = (item) => {
    const conversationId = uid();
    const now = new Date().toISOString();
    update((d) => ({
      ...d,
      selectedConversationId: conversationId,
      conversations: [
        {
          id: conversationId,
          title: item.title,
          businessId: item.businessId,
          specialist: item.specialist || "Diretor",
          ownerId: db.user.id,
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: uid(),
              role: "user",
              content: item.request || `Continue o projeto ${item.title}`,
              createdAt: item.createdAt || now,
            },
            {
              id: uid(),
              role: "assistant",
              content: item.result,
              createdAt: item.updatedAt || item.createdAt || now,
            },
          ],
        },
        ...(d.conversations || []),
      ],
    }));
    setOpen(null);
    go("inicio");
  };
  const refineProject = async (item) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          specialist: item.specialist || "Diretor",
          prompt: `Revise e aprofunde o projeto abaixo. Preserve fatos e números fornecidos, elimine generalidades e acrescente próximas ações verificáveis. Entregue a versão final completa em Markdown.\n\n${item.result}`,
          ...aiWorkspaceContext(business),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao refinar");
      changeProject(item.id, {
        result: data.content,
        versions: [
          {
            result: item.result,
            at: new Date().toISOString(),
          },
          ...(item.versions || []),
        ],
      });
      setToast("Projeto refinado; a versão anterior foi preservada");
    } catch (error) {
      setToast(error.message || "Não foi possível refinar agora");
    } finally {
      setBusy(false);
    }
  };
  const transform = (x, type) => {
    if (type === "task")
      update((d) => ({
        ...d,
        tasks: [
          {
            id: uid(),
            title: x.title,
            description: x.result.slice(0, 240),
            priority: "Média",
            status: "A fazer",
            due: "",
            area: "Estratégia",
            businessId: x.businessId,
          },
          ...d.tasks,
        ],
      }));
    else
      update((d) => ({
        ...d,
        documents: [
          {
            id: uid(),
            title: x.title,
            type: "Plano de ação",
            content: x.result,
            businessId: x.businessId,
            updatedAt: new Date().toISOString(),
            versions: [],
          },
          ...d.documents,
        ],
      }));
    setToast(type === "task" ? "Tarefa criada" : "Documento criado");
  };
  return (
    <PageTitle
      eyebrow="HISTÓRICO"
      title="Tudo o que você escolheu guardar, pronto para continuar"
      text="As conversas ficam no chat; somente respostas que você salvar entram aqui."
    >
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar no histórico"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option>Todos</option>
          {types.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option>Ativos</option>
          <option>Arquivados</option>
          <option>Todos</option>
        </select>
      </div>
      {items.length === 0 ? (
        <Empty
          icon={History}
          title="Seu histórico está vazio"
          text="No chat, use “Salvar em projetos” apenas nas respostas que quiser manter aqui."
        />
      ) : (
        <div className="history-list">
          {items.map((x) => (
            <div
              key={x.id}
              className="history-card"
              role="button"
              tabIndex={0}
              onClick={() => openProject(x)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openProject(x);
                }
              }}
            >
              <span className="doc-icon">
                <Sparkles />
              </span>
              <span>
                <span className="tag">{x.specialist}</span>
                <h3>{x.title}</h3>
                <small>
                  {new Date(x.createdAt).toLocaleString("pt-BR")} · {x.type}
                </small>
              </span>
              <span className="project-card-actions">
                <button
                  aria-label="Duplicar projeto"
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicate(x);
                  }}
                >
                  <Copy />
                </button>
                <button
                  aria-label={
                    x.archived ? "Desarquivar projeto" : "Arquivar projeto"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    changeProject(x.id, { archived: !x.archived });
                  }}
                >
                  <Archive />
                </button>
              </span>
              <ChevronRight />
            </div>
          ))}
        </div>
      )}
      {open &&
        (() => {
          const x = db.history.find((i) => i.id === open);
          const promptRename = () => {
            const t = prompt("Novo nome para este item:", x.title);
            if (!t || !t.trim()) return;
            update((d) => ({ ...d, history: d.history.map((i) => (i.id === x.id ? { ...i, title: t.trim() } : i)) }));
            setToast("Renomeado");
          };
          const duplicate = () => {
            update((d) => ({ ...d, history: [{ ...x, id: uid(), title: `${x.title} (cópia)`, createdAt: new Date().toISOString() }, ...d.history] }));
            setToast("Duplicado");
          };
          const removeItem = () => {
            if (!confirm("Excluir este item do histórico?")) return;
            setOpen(null);
            update((d) => ({ ...d, history: d.history.filter((i) => i.id !== x.id) }));
            setToast("Excluído");
          };
          const continueChat = () => {
            const cid = uid();
            update((d) => ({
              ...d,
              selectedConversationId: cid,
              conversations: [
                { id: cid, title: x.title.slice(0, 55), businessId: x.businessId, specialist: x.specialist, ownerId: db.user.id, createdAt: new Date().toISOString(), messages: [
                  { id: uid(), role: "user", content: x.request || x.title, createdAt: x.createdAt },
                  { id: uid(), role: "assistant", content: x.result, provider: x.provider, model: x.model, createdAt: new Date().toISOString() },
                ] },
                ...(d.conversations || []),
              ],
            }));
            setOpen(null);
            setToast("Conversa retomada — abra o Início para continuar de onde parou");
          };
          return (
            <Modal wide title={x.title} onClose={() => setOpen(null)}>
              <div className="result">
                <div className="project-title-editor">
                  <input
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    icon={Save}
                    disabled={!rename.trim() || rename.trim() === x.title}
                    onClick={() => {
                      changeProject(x.id, { title: rename.trim() });
                      setToast("Projeto renomeado");
                    }}
                  >
                    Renomear
                  </Button>
                </div>
                <div className="result-meta">
                  <span>
                    <Building2 />
                    {db.businesses.find((b) => b.id === x.businessId)?.name ||
                      "Sem negócio"}
                  </span>
                  <span>
                    <Sparkles />
                    {x.specialist}
                  </span>
                </div>
                <Markdown text={x.result} />
                {(x.versions || []).length > 0 && (
                  <small className="version-note">
                    {x.versions.length} versão(ões) anterior(es) preservada(s).
                  </small>
                )}
                <div className="modal-actions spread">
                  <Button
                    variant="ghost"
                    icon={Copy}
                    onClick={() => {
                      navigator.clipboard?.writeText(x.result);
                      setToast("Resultado copiado");
                    }}
                  >
                    Copiar
                  </Button>
                  <div>
                    <Button
                      variant="secondary"
                      icon={MessageSquareText}
                      onClick={() => continueProject(x)}
                    >
                      Continuar no chat
                    </Button>
                    <Button
                      variant="secondary"
                      icon={busy ? RefreshCw : WandSparkles}
                      disabled={busy}
                      onClick={() => refineProject(x)}
                    >
                      {busy ? "Refinando..." : "Refinar"}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={ListTodo}
                      onClick={() => transform(x, "task")}
                    >
                      Virar tarefa
                    </Button>
                    <Button icon={FileText} onClick={() => transform(x, "doc")}>
                      Virar documento
                    </Button>
                    <Button
                      variant="ghost"
                      icon={Copy}
                      onClick={() => duplicate(x)}
                    >
                      Duplicar
                    </Button>
                    <Button
                      variant="ghost"
                      icon={Archive}
                      onClick={() => {
                        changeProject(x.id, { archived: !x.archived });
                        setOpen(null);
                      }}
                    >
                      {x.archived ? "Desarquivar" : "Arquivar"}
                    </Button>
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => {
                        if (!confirm("Excluir este projeto definitivamente?"))
                          return;
                        update((d) => ({
                          ...d,
                          history: d.history.filter((item) => item.id !== x.id),
                        }));
                        setOpen(null);
                        setToast("Projeto excluído");
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
                <div className="modal-actions history-extra">
                  <Button variant="secondary" icon={MessageSquareText} onClick={continueChat}>
                    Continuar no chat
                  </Button>
                  <Button variant="ghost" icon={Edit3} onClick={promptRename}>
                    Renomear
                  </Button>
                  <Button variant="ghost" icon={Copy} onClick={duplicate}>
                    Duplicar
                  </Button>
                  <Button variant="ghost" icon={Trash2} onClick={removeItem}>
                    Excluir
                  </Button>
                </div>
              </div>
            </Modal>
          );
        })()}
    </PageTitle>
  );
}

function certificateDocument(cert) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(cert.title)}</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#eee;font-family:Arial,sans-serif;color:#18142b}.sheet{width:297mm;height:210mm;margin:auto;background:#fff;padding:13mm;position:relative;overflow:hidden}.frame{height:100%;border:2px solid #2b2051;padding:8mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative}.frame:before,.frame:after{content:'';position:absolute;width:100mm;height:100mm;border-radius:50%;filter:blur(2px);opacity:.12}.frame:before{background:#0b9f8f;left:-50mm;top:-55mm}.frame:after{background:#16b8a6;right:-48mm;bottom:-58mm}.mark{width:18mm;height:18mm;border-radius:5mm;background:linear-gradient(135deg,#0b9f8f,#16b8a6);color:white;display:grid;place-items:center;font-size:9mm;font-weight:bold;margin-bottom:5mm}.issuer{font-size:4mm;letter-spacing:.16em;text-transform:uppercase;font-weight:bold;color:#0b9f8f}.sub{font-size:3.1mm;color:#665f75;margin-top:2mm}.rule{width:35mm;height:.6mm;background:linear-gradient(90deg,#0b9f8f,#16b8a6);margin:6mm}.label{font-size:3.5mm;color:#665f75}.name{font-family:Georgia,serif;font-size:12mm;margin:4mm 0;color:#211846}.text{font-size:4mm;line-height:1.6;max-width:205mm;color:#413a50}.title{font-size:7mm;font-weight:bold;color:#0b9f8f;margin:3mm 0}.footer{display:flex;gap:24mm;margin-top:10mm}.footer div{min-width:55mm;border-top:.4mm solid #aaa;padding-top:2mm;font-size:3.2mm}.code{position:absolute;bottom:6mm;font-size:2.8mm;color:#777}.note{position:absolute;left:10mm;bottom:5mm;font-size:2.5mm;color:#888;max-width:65mm;text-align:left}@media print{body{background:#fff}.sheet{margin:0}}</style></head><body><main class="sheet"><section class="frame"><div class="mark">P</div><div class="issuer">Academia Praxis</div><div class="sub">Competências Aplicadas para Negócios</div><div class="rule"></div><div class="label">CERTIFICADO DE COMPETÊNCIA PRÁTICA</div><h1 class="name">${escapeHtml(cert.name)}</h1><div class="text">concluiu os marcos verificáveis da trilha e demonstrou competência aplicada em</div><h2 class="title">${escapeHtml(cert.title)}</h2><div class="text">por estruturar briefing e conteúdo, personalizar a experiência, validar a responsividade e concluir a publicação de um projeto funcional.</div><div class="footer"><div><strong>${new Date(cert.issuedAt).toLocaleDateString("pt-BR")}</strong><br>Data de emissão</div><div><strong>Academia Praxis</strong><br>Unidade formativa</div></div><div class="note">Programa formativo integrado ao aplicativo Seu Funcionário. Certificado de realização prática; não equivale a diploma acadêmico ou habilitação profissional regulamentada.</div><div class="code">Credencial ${escapeHtml(cert.code)} · Projeto: ${escapeHtml(cert.projectName)}</div></section></main></body></html>`;
}

function CertificateView({ cert, onClose }) {
  const download = () => {
    const blob = new Blob([certificateDocument(cert)], {
        type: "text/html;charset=utf-8",
      }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `certificado-${slugify(cert.name)}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(certificateDocument(cert));
    w.document.close();
    setTimeout(() => w.print(), 350);
  };
  return (
    <Modal wide title="Sua credencial" onClose={onClose}>
      <div className="certificate">
        <div className="certificate-inner">
          <div className="praxis-mark">P</div>
          <span className="praxis-name">ACADEMIA PRAXIS</span>
          <small>Competências Aplicadas para Negócios</small>
          <i />
          <span className="certificate-label">
            CERTIFICADO DE COMPETÊNCIA PRÁTICA
          </span>
          <h2>{cert.name}</h2>
          <p>
            concluiu os marcos verificáveis da trilha e demonstrou competência
            aplicada em
          </p>
          <h3>{cert.title}</h3>
          <p>
            por estruturar briefing e conteúdo, personalizar a experiência,
            validar a responsividade e concluir a publicação de um projeto
            funcional.
          </p>
          <div className="certificate-signatures">
            <span>
              <strong>
                {new Date(cert.issuedAt).toLocaleDateString("pt-BR")}
              </strong>
              <small>Data de emissão</small>
            </span>
            <span>
              <strong>Academia Praxis</strong>
              <small>Unidade formativa</small>
            </span>
          </div>
          <code>
            Credencial {cert.code} · Projeto: {cert.projectName}
          </code>
        </div>
      </div>
      <div className="certificate-disclaimer">
        <ShieldCheck />
        <span>
          Programa formativo integrado ao Seu Funcionário. Esta credencial
          comprova a conclusão de atividades práticas dentro da plataforma; não
          é diploma acadêmico nem habilitação regulamentada.
        </span>
      </div>
      <div className="modal-actions">
        <Button variant="ghost" icon={Printer} onClick={print}>
          Imprimir ou salvar em PDF
        </Button>
        <Button icon={Download} onClick={download}>
          Baixar certificado
        </Button>
      </div>
    </Modal>
  );
}

function Certifications({ db, update, business, setToast, go }) {
  const relevant = db.sites.filter(
    (x) => !business || x.businessId === business.id,
  );
  const ranked = [...relevant].sort(
    (a, b) =>
      websiteMilestones(b).filter((x) => x.done).length -
      websiteMilestones(a).filter((x) => x.done).length,
  );
  const [siteId, setSiteId] = useState(ranked[0]?.id || "");
  const [view, setView] = useState(null);
  const site = relevant.find((x) => x.id === siteId) || ranked[0];
  const milestones = websiteMilestones(site),
    done = milestones.filter((x) => x.done).length,
    complete = done === milestones.length;
  const issued = db.certificates.find(
    (x) => x.track === "website-no-code" && x.projectId === site?.id,
  );
  const issue = () => {
    if (!complete || issued) return;
    const cert = {
      id: uid(),
      track: "website-no-code",
      projectId: site.id,
      projectName: site.name,
      name: db.user.name,
      title: "Competência Aplicada em Criação de Websites No-Code",
      ownerId: db.user.id,
      visibility: "privado",
      issuedAt: new Date().toISOString(),
      code: `PRX-WEB-${new Date().getFullYear()}-${site.id.slice(0, 8).toUpperCase()}`,
    };
    update((d) => ({ ...d, certificates: [cert, ...(d.certificates || [])] }));
    setView(cert);
    setToast("Certificado emitido pela Academia Praxis");
  };
  const certs = db.certificates || [];
  const myCompletedPlans = (db.developmentPlans || []).filter(
    (p) => p.assigneeId === db.user.id && p.status === "Concluído",
  );
  const issuePlanCertificate = (plan) => {
    const alreadyIssued = certs.some(
      (c) => c.track === "development-plan" && c.projectId === plan.id,
    );
    if (alreadyIssued) return;
    const cert = {
      id: uid(),
      track: "development-plan",
      projectId: plan.id,
      projectName: plan.title,
      name: db.user.name,
      title: `Plano de Desenvolvimento Concluído: ${plan.title}`,
      ownerId: db.user.id,
      visibility: "privado",
      issuedAt: new Date().toISOString(),
      code: `PRX-DEV-${new Date().getFullYear()}-${plan.id.slice(0, 8).toUpperCase()}`,
    };
    update((d) => ({ ...d, certificates: [cert, ...(d.certificates || [])] }));
    setView(cert);
    setToast("Certificado emitido");
  };
  return (
    <PageTitle
      eyebrow="ACADEMIA PRAXIS"
      title="Competências que você consegue demonstrar"
      text="As credenciais são liberadas por evidências do trabalho realizado — não por tempo de uso ou cliques aleatórios."
    >
      <div className="issuer-banner">
        <div className="praxis-mark">P</div>
        <div>
          <span className="eyebrow">UNIDADE FORMATIVA DO SEU FUNCIONÁRIO</span>
          <h2>Academia Praxis</h2>
          <p>Competências Aplicadas para Negócios</p>
        </div>
        <BadgeCheck />
      </div>
      <section className="cert-track">
        <div className="track-head">
          <span className="track-icon">
            <Globe2 />
          </span>
          <div>
            <span className="tag">TRILHA PRÁTICA</span>
            <h2>Criação de Websites No-Code</h2>
            <p>
              Da definição do objetivo à publicação de uma página funcional.
            </p>
          </div>
          <div className="track-score">
            <strong>
              {done}/{milestones.length}
            </strong>
            <small>marcos</small>
          </div>
        </div>
        {relevant.length > 1 && (
          <Field label="Projeto avaliado">
            <select
              value={site?.id || ""}
              onChange={(e) => setSiteId(e.target.value)}
            >
              {relevant.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="milestone-list">
          {milestones.map((m, i) => (
            <div className={m.done ? "done" : ""} key={m.id}>
              <span>{m.done ? <CheckCircle2 /> : <LockKeyhole />}</span>
              <div>
                <small>Marco {i + 1}</small>
                <strong>{m.title}</strong>
                <p>{m.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="track-footer">
          <div>
            <div className="meter">
              <span style={{ width: `${(done / milestones.length) * 100}%` }} />
            </div>
            <small>
              {complete
                ? "Todos os critérios foram comprovados."
                : `Faltam ${milestones.length - done} marcos para liberar a credencial.`}
            </small>
          </div>
          {!site ? (
            <Button icon={Globe2} onClick={() => go("sites")}>
              Criar primeiro site
            </Button>
          ) : issued ? (
            <Button icon={Award} onClick={() => setView(issued)}>
              Ver certificado
            </Button>
          ) : (
            <Button icon={GraduationCap} disabled={!complete} onClick={issue}>
              Emitir certificado
            </Button>
          )}
        </div>
      </section>
      {myCompletedPlans.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">DESENVOLVIMENTO</span>
              <h2>Planos concluídos</h2>
            </div>
          </div>
          <div className="data-list">
            {myCompletedPlans.map((p) => {
              const alreadyIssued = certs.some(
                (c) => c.track === "development-plan" && c.projectId === p.id,
              );
              const existingCert = certs.find(
                (c) => c.track === "development-plan" && c.projectId === p.id,
              );
              return (
                <article key={p.id}>
                  <span>
                    <strong>{p.title}</strong>
                    <small>Plano de desenvolvimento concluído</small>
                  </span>
                  {alreadyIssued ? (
                    <Button icon={Award} onClick={() => setView(existingCert)}>
                      Ver certificado
                    </Button>
                  ) : (
                    <Button
                      icon={GraduationCap}
                      onClick={() => issuePlanCertificate(p)}
                    >
                      Emitir certificado
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {certs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">CREDENCIAIS EMITIDAS</span>
              <h2>Meus certificados</h2>
            </div>
          </div>
          <div className="credential-grid">
            {certs.map((c) => (
              <button key={c.id} onClick={() => setView(c)}>
                <span>
                  <Award />
                </span>
                <div>
                  <strong>{c.title}</strong>
                  <small>
                    {new Date(c.issuedAt).toLocaleDateString("pt-BR")} ·{" "}
                    {c.code}
                  </small>
                </div>
                <ChevronRight />
              </button>
            ))}
          </div>
        </section>
      )}
      {view && <CertificateView cert={view} onClose={() => setView(null)} />}
    </PageTitle>
  );
}

function Businesses({ db, update, setToast, go }) {
  const [modal, setModal] = useState(false),
    [editing, setEditing] = useState(null);
  const save = (b) => {
    update((d) => {
      const exists = d.businesses.some((x) => x.id === b.id);
      return {
        ...d,
        businesses: exists
          ? d.businesses.map((x) => (x.id === b.id ? b : x))
          : [b, ...d.businesses],
        selectedBusinessId: b.id,
      };
    });
    setModal(false);
    setToast("Perfil do negócio salvo");
  };
  return (
    <PageTitle
      eyebrow="PERFIS DE NEGÓCIO"
      title="Seus negócios"
      text="Mantenha cada contexto separado e alterne quando precisar."
      action={
        <Button
          icon={Plus}
          onClick={() => {
            setEditing(null);
            setModal(true);
          }}
        >
          Novo negócio
        </Button>
      }
    >
      <div className="business-grid">
        {db.businesses.map((b) => (
          <article
            className={db.selectedBusinessId === b.id ? "selected" : ""}
            key={b.id}
          >
            <div>
              <span className="business-avatar">{b.name[0]}</span>
              {db.selectedBusinessId === b.id && (
                <span className="selected-badge">
                  <Check />
                  Selecionado
                </span>
              )}
            </div>
            <h3>{b.name}</h3>
            <p>{b.industryActivity || b.segment || "Segmento não informado"}</p>
            <small>{b.stage}</small>
            <footer>
              <Button
                variant="ghost"
                onClick={() => update({ ...db, selectedBusinessId: b.id })}
              >
                Usar este
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  update((d) => ({ ...d, selectedBusinessId: b.id }));
                  go("perfil-negocio");
                }}
              >
                Configurar funções
              </Button>
              <button
                className="icon-button"
                onClick={() => {
                  setEditing(b);
                  setModal(true);
                }}
              >
                <Edit3 />
              </button>
              <button
                className="icon-button danger"
                onClick={() => {
                  if (
                    confirm(
                      `Excluir ${b.name}? Os itens vinculados não serão apagados.`,
                    )
                  )
                    update((d) => ({
                      ...d,
                      businesses: d.businesses.filter((x) => x.id !== b.id),
                      selectedBusinessId:
                        d.selectedBusinessId === b.id
                          ? d.businesses.find((x) => x.id !== b.id)?.id || null
                          : d.selectedBusinessId,
                    }));
                }}
              >
                <Trash2 />
              </button>
            </footer>
          </article>
        ))}
      </div>
      {db.businesses.length === 0 && (
        <Empty
          icon={Building2}
          title="Nenhum negócio cadastrado"
          text="Crie um perfil para personalizar ferramentas e organizar os dados."
          action="Criar negócio"
          onAction={() => setModal(true)}
        />
      )}{" "}
      {modal && (
        <Modal
          wide
          title={editing ? "Editar negócio" : "Criar negócio"}
          onClose={() => setModal(false)}
        >
          <BusinessForm
            value={editing}
            onSave={save}
            onClose={() => setModal(false)}
          />
        </Modal>
      )}
    </PageTitle>
  );
}

function PublicSite({ site, page = "" }) {
  const selectedPage = site?.pages?.find((item) => item.slug === page);
  if (!site || !site.published || (page && !selectedPage))
    return (
      <main className="public-missing">
        <Logo />
        <CircleAlert />
        <h1>Esta página não está disponível</h1>
        <p>O endereço pode estar incorreto ou o site foi despublicado.</p>
      </main>
    );
  return (
    <iframe
      className="public-frame"
      sandbox="allow-forms allow-popups allow-top-navigation-by-user-activation"
      title={site.name}
      srcDoc={selectedPage?.html || site.html}
    />
  );
}

function switchSpace(id, name) {
  try {
    if (id) {
      localStorage.setItem("sf-space", id);
      localStorage.setItem("sf-space-name", name || "Espaço compartilhado");
    } else {
      localStorage.removeItem("sf-space");
      localStorage.removeItem("sf-space-name");
    }
  } catch {}
  location.reload();
}

const BOND_TYPES = [
  "Funcionário",
  "Freelancer",
  "Prestador",
  "Assistente",
  "Estagiário",
  "Aprendiz",
  "Temporário",
  "Parceiro",
  "Outro",
];

const INVITE_STATUS_LABELS = {
  enviado: "Aguardando ativação",
  expirado: "Expirado",
  ativo: "Ativo",
  cancelado: "Cancelado",
};

const blankInviteForm = {
  name: "",
  email: "",
  functionTitle: "",
  bondType: "",
  role: "colaborador",
  directManagerId: "",
};

const AUDIT_ACTION_LABELS = {
  convite_criado: "Convite enviado",
  convite_reenviado: "Convite reenviado",
  convite_cancelado: "Convite cancelado",
  convite_aceito: "Convite aceito",
  colaborador_suspenso: "Acesso suspenso",
  colaborador_reativado: "Acesso reativado",
  papel_alterado: "Papel alterado",
  colaborador_removido: "Colaborador removido",
};

function Collaborators({ db, update, setToast }) {
  const [data, setData] = useState({
    members: [],
    invites: [],
    spaces: [],
    canManage: true,
  });
  const [form, setForm] = useState(blankInviteForm);
  const [sending, setSending] = useState(false);
  // Link do último convite criado/reenviado, para o admin copiar e enviar por
  // onde quiser — o acesso não depende do e-mail chegar.
  const [inviteLink, setInviteLink] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", memberIds: [] });
  const [editingTeam, setEditingTeam] = useState(null);
  const [tab, setTab] = useState("colaboradores");
  const active = activeSpaceId();
  const collabQuery = active ? `?owner=${encodeURIComponent(active)}` : "";
  const teams = db.teams || [];
  const saveTeam = (e) => {
    e.preventDefault();
    if (!teamForm.name.trim()) return;
    update((d) => {
      const item = {
        id: editingTeam || uid(),
        name: teamForm.name.trim(),
        memberIds: teamForm.memberIds,
      };
      return {
        ...d,
        teams: editingTeam
          ? (d.teams || []).map((t) => (t.id === editingTeam ? item : t))
          : [...(d.teams || []), item],
      };
    });
    setToast(editingTeam ? "Equipe atualizada" : "Equipe criada");
    setTeamForm({ name: "", memberIds: [] });
    setEditingTeam(null);
  };
  const editTeam = (team) => {
    setEditingTeam(team.id);
    setTeamForm({ name: team.name, memberIds: team.memberIds || [] });
  };
  const cancelTeamEdit = () => {
    setEditingTeam(null);
    setTeamForm({ name: "", memberIds: [] });
  };
  const removeTeam = (id) => {
    if (!confirm("Excluir esta equipe?")) return;
    update((d) => ({ ...d, teams: (d.teams || []).filter((t) => t.id !== id) }));
    if (editingTeam === id) cancelTeamEdit();
    setToast("Equipe excluída");
  };
  const toggleTeamMember = (id) => {
    setTeamForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((x) => x !== id)
        : [...current.memberIds, id],
    }));
  };
  const load = useCallback(
    () =>
      fetch(`/api/collab${collabQuery}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) =>
          d &&
          setData({
            members: d.members || [],
            invites: d.invites || [],
            spaces: d.spaces || [],
            canManage: d.canManage !== false,
          }),
      )
        .catch(() => {}),
    [collabQuery],
  );
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);
  const sendInvite = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/collab/invite${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível enviar o convite.");
      const alvo = form.email;
      setForm(blankInviteForm);
      if (d.link) setInviteLink({ url: d.link, email: alvo, emailSent: d.emailSent });
      load();
      setToast(
        d.emailSent
          ? `Convite enviado para ${alvo}. O link também está aqui para copiar.`
          : `Convite criado. Copie o link e envie para ${alvo}.`,
      );
    } catch (e) {
      setToast(e.message);
    } finally {
      setSending(false);
    }
  };
  const resend = async (id) => {
    try {
      const r = await fetch(`/api/collab/resend${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível reenviar.");
      if (d.link) setInviteLink({ url: d.link, email: "", emailSent: d.emailSent });
      load();
      setToast(d.emailSent ? "Convite reenviado. Link novo pronto para copiar." : "Link novo gerado — copie e envie.");
    } catch (e) {
      setToast(e.message);
    }
  };
  const copiarLinkConvite = async () => {
    if (!inviteLink?.url) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setToast("Link do convite copiado.");
    } catch {
      setToast("Não consegui copiar automaticamente — selecione o link e copie.");
    }
  };
  const cancelInvite = async (id) => {
    if (!confirm("Cancelar este convite?")) return;
    try {
      const r = await fetch(`/api/collab/cancel${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível cancelar.");
      load();
      setToast("Convite cancelado");
    } catch (e) {
      setToast(e.message);
    }
  };
  const setMemberStatus = async (memberId, status) => {
    try {
      const r = await fetch(`/api/collab/member-status${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ memberId, status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível atualizar o acesso.");
      load();
      setToast(status === "suspenso" ? "Colaborador suspenso" : "Acesso reativado");
    } catch (e) {
      setToast(e.message);
    }
  };
  const setMemberRole = async (memberId, role) => {
    try {
      const r = await fetch(`/api/collab/member-role${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ memberId, role }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível atualizar o papel.");
      load();
      setToast("Papel atualizado");
    } catch (e) {
      setToast(e.message);
    }
  };
  const remove = async (id) => {
    if (!confirm("Remover esta pessoa do espaço?")) return;
    try {
      const r = await fetch(`/api/collab/remove${collabQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ memberId: id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível remover.");
      load();
      setToast("Colaborador removido");
    } catch (e) {
      setToast(e.message);
    }
  };
  const toggleAudit = async () => {
    if (auditOpen) {
      setAuditOpen(false);
      return;
    }
    setAuditLoading(true);
    try {
      const r = await fetch(`/api/collab/audit${collabQuery}`, {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível carregar o histórico.");
      setAuditLogs(d.logs || []);
      setAuditOpen(true);
    } catch (e) {
      setToast(e.message || "Não foi possível carregar o histórico.");
    } finally {
      setAuditLoading(false);
    }
  };
  const pendingInvites = data.invites.filter(
    (i) => i.status !== "ativo" && i.status !== "cancelado",
  );
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <span className="eyebrow">PESSOAS</span>
          <h2>Convide colaboradores reais</h2>
        </div>
      </div>
      {active && data.canManage && (
        <div className="notice">
          <CircleAlert />
          <span>
            Você está administrando o espaço de outra pessoa como
            administrador convidado. Convites, papéis e remoções abaixo
            afetam a equipe desse espaço, não a sua.
          </span>
        </div>
      )}
      {active && !data.canManage && (
        <div className="notice">
          <CircleAlert />
          <span>
            Você está visualizando outro espaço, mas só quem é dono ou
            administrador convidado pode gerenciar convites, papéis e
            remoções por aqui.
          </span>
        </div>
      )}
      <div className="view-toggle">
        <button
          className={tab === "colaboradores" ? "active" : ""}
          onClick={() => setTab("colaboradores")}
        >
          <UserRound />
          Colaboradores
        </button>
        <button
          className={tab === "equipes" ? "active" : ""}
          onClick={() => setTab("equipes")}
        >
          <Users />
          Equipes
        </button>
        <button
          className={tab === "espacos" ? "active" : ""}
          onClick={() => setTab("espacos")}
        >
          <Layers />
          Espaços de trabalho
        </button>
        <button
          className={tab === "historico" ? "active" : ""}
          onClick={() => setTab("historico")}
        >
          <History />
          Histórico
        </button>
      </div>
      <div className="collab-grid">
        {tab === "colaboradores" && (
        <div className="collab-card wide">
          <h3>
            <UserRound />
            Convidar colaborador
          </h3>
          <p>
            A pessoa recebe um link seguro para criar a própria senha e ativar
            a conta. Enviamos por e-mail quando configurado, mas o link também
            aparece aqui para você copiar e mandar por onde quiser — o acesso
            nunca fica preso à entrega do e-mail.
          </p>
          <form className="invite-form" onSubmit={sendInvite}>
            <div className="form-grid">
            <Field label="Nome">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Função">
              <input
                value={form.functionTitle}
                onChange={(e) =>
                  setForm({ ...form, functionTitle: e.target.value })
                }
                placeholder="Ex.: Atendimento, Vendas..."
              />
            </Field>
            <Field label="Tipo de vínculo">
              <select
                value={form.bondType}
                onChange={(e) => setForm({ ...form, bondType: e.target.value })}
              >
                <option value="">Não informado</option>
                {BOND_TYPES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Papel inicial">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="colaborador">Colaborador</option>
                <option value="gestor">Gestor</option>
                <option value="admin">Administrador</option>
              </select>
            </Field>
            {data.members.length > 0 && (
              <Field label="Responsável direto (opcional)">
                <select
                  value={form.directManagerId}
                  onChange={(e) =>
                    setForm({ ...form, directManagerId: e.target.value })
                  }
                >
                  <option value="">Nenhum</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            </div>
            <Button type="submit" icon={Send} disabled={sending || !data.canManage}>
              {sending ? "Enviando..." : "Enviar convite"}
            </Button>
          </form>
          {inviteLink && (
            <div className="invite-link-box">
              <small>
                {inviteLink.emailSent
                  ? `Convite enviado por e-mail${inviteLink.email ? ` para ${inviteLink.email}` : ""}. Este link também vale — copie e mande direto se preferir:`
                  : `Copie este link e envie para a pessoa${inviteLink.email ? ` (${inviteLink.email})` : ""}. Ela abre e define a senha:`}
              </small>
              <div className="invite-link-row">
                <input readOnly value={inviteLink.url} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
                <Button type="button" icon={Copy} onClick={copiarLinkConvite}>Copiar</Button>
              </div>
              <button type="button" className="invite-link-dismiss" onClick={() => setInviteLink(null)}>Fechar</button>
            </div>
          )}
          {pendingInvites.length > 0 && (
            <div className="member-list">
              <small className="member-title">Convites</small>
              {pendingInvites.map((inv) => (
                <div key={inv.id}>
                  <span className="avatar">{inv.name[0]}</span>
                  <span>
                    <strong>{inv.name}</strong>
                    <small>
                      {inv.email} · {INVITE_STATUS_LABELS[inv.status] || inv.status}
                    </small>
                  </span>
                  <span className="task-actions">
                    {(inv.status === "enviado" || inv.status === "expirado") && (
                      <>
                        <button
                          className="icon-button"
                          title="Reenviar convite"
                          disabled={!data.canManage}
                          onClick={() => resend(inv.id)}
                        >
                          <RefreshCw />
                        </button>
                        <button
                          className="icon-button danger"
                          title="Cancelar convite"
                          disabled={!data.canManage}
                          onClick={() => cancelInvite(inv.id)}
                        >
                          <X />
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {data.members.length > 0 && (
            <div className="member-list">
              <small className="member-title">
                {active ? "Neste espaço" : "No seu espaço"}
              </small>
              {data.members.map((m) => (
                <div key={m.id}>
                  <span className="avatar">{m.name[0]}</span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {m.email} · {m.status === "suspenso" ? "Suspenso" : "Ativo"}
                    </small>
                  </span>
                  <select
                    value={m.role}
                    aria-label={`Papel de ${m.name}`}
                    disabled={!data.canManage}
                    onChange={(e) => setMemberRole(m.id, e.target.value)}
                  >
                    <option value="colaborador">Colaborador</option>
                    <option value="gestor">Gestor</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <span className="task-actions">
                    <button
                      className="icon-button"
                      title={m.status === "suspenso" ? "Reativar acesso" : "Suspender acesso"}
                      disabled={!data.canManage}
                      onClick={() =>
                        setMemberStatus(
                          m.id,
                          m.status === "suspenso" ? "ativo" : "suspenso",
                        )
                      }
                    >
                      {m.status === "suspenso" ? <Play /> : <Clock3 />}
                    </button>
                    <button
                      className="icon-button danger"
                      title="Remover"
                      disabled={!data.canManage}
                      onClick={() => remove(m.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {tab === "espacos" && (
        <div className="collab-card wide">
          <h3>
            <Layers />
            Espaços de trabalho
          </h3>
          <p>Alterne entre o seu espaço e os espaços aos quais você foi adicionado.</p>
          <div className="space-list">
            <button
              className={!active ? "active" : ""}
              onClick={() => switchSpace("")}
            >
              <span className="business-avatar small">
                <Building2 />
              </span>
              <span>
                <strong>Meu espaço</strong>
                <small>Seus próprios projetos</small>
              </span>
              {!active && <Check />}
            </button>
            {data.spaces.map((s) => (
              <button
                key={s.ownerId}
                className={active === s.ownerId ? "active" : ""}
                onClick={() => switchSpace(s.ownerId, s.ownerName)}
              >
                <span className="business-avatar small">{s.ownerName[0]}</span>
                <span>
                  <strong>{s.ownerName}</strong>
                  <small>{s.ownerEmail}</small>
                </span>
                {active === s.ownerId && <Check />}
              </button>
            ))}
          </div>
        </div>
        )}
        {tab === "equipes" && (
        <div className="collab-card wide">
          <h3>
            <Users />
            Equipes
          </h3>
          <p>
            Agrupe colaboradores em equipes para compartilhar tarefas,
            documentos e sites com todo o grupo de uma vez.
          </p>
          <form className="invite-form" onSubmit={saveTeam}>
            <Field label="Nome da equipe">
              <input
                required
                value={teamForm.name}
                onChange={(e) =>
                  setTeamForm({ ...teamForm, name: e.target.value })
                }
              />
            </Field>
            {data.members.length > 0 && (
              <div className="field">
                <span>Integrantes</span>
                <div className="checkbox-list">
                  {data.members.map((m) => (
                    <label key={m.id} className="cost-check">
                      <input
                        type="checkbox"
                        checked={teamForm.memberIds.includes(m.id)}
                        onChange={() => toggleTeamMember(m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="task-actions">
              <Button type="submit" icon={editingTeam ? Save : Plus}>
                {editingTeam ? "Salvar equipe" : "Criar equipe"}
              </Button>
              {editingTeam && (
                <Button variant="ghost" type="button" onClick={cancelTeamEdit}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
          {teams.length > 0 && (
            <div className="member-list">
              <small className="member-title">Suas equipes</small>
              {teams.map((t) => (
                <div key={t.id}>
                  <span className="avatar">{t.name[0]}</span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {(t.memberIds || []).length} integrante
                      {(t.memberIds || []).length === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span className="task-actions">
                    <button
                      className="icon-button"
                      title="Editar equipe"
                      onClick={() => editTeam(t)}
                    >
                      <Edit3 />
                    </button>
                    <button
                      className="icon-button danger"
                      title="Excluir equipe"
                      onClick={() => removeTeam(t.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {tab === "historico" && (
        <div className="collab-card wide">
          <h3>
            <History />
            Histórico de ações
          </h3>
          <p>Registro de convites, papéis e acessos alterados no seu espaço.</p>
          <Button
            variant="ghost"
            icon={History}
            onClick={toggleAudit}
            disabled={auditLoading}
          >
            {auditLoading
              ? "Carregando..."
              : auditOpen
                ? "Ocultar histórico"
                : "Ver histórico"}
          </Button>
          {auditOpen && (
            <div className="member-list">
              {auditLogs.length === 0 && (
                <small className="member-title">
                  Nenhuma ação registrada ainda.
                </small>
              )}
              {auditLogs.map((log) => (
                <div key={log.id}>
                  <span className="avatar">{log.actorName[0]}</span>
                  <span>
                    <strong>
                      {log.actorName} ·{" "}
                      {AUDIT_ACTION_LABELS[log.action] || log.action}
                    </strong>
                    <small>
                      {[log.target, log.details]
                        .filter(Boolean)
                        .join(" · ")}
                      {log.target || log.details ? " · " : ""}
                      {new Date(log.createdAt).toLocaleString("pt-BR")}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </section>
  );
}

function Team({ db, update, setToast }) {
  const [newEmployee, setNewEmployee] = useState(false);
  const active = db.preferences.specialist;
  const select = (name) => {
    update((d) => ({
      ...d,
      preferences: { ...d.preferences, specialist: name },
    }));
    setToast(`${name} agora está no comando`);
  };
  const dismiss = (name) => {
    if (
      !confirm(
        `Dispensar o funcionário de ${name}? O histórico de conversas é mantido.`,
      )
    )
      return;
    update((d) => ({
      ...d,
      customSpecialists: (d.customSpecialists || []).filter(
        (x) => x.name !== name,
      ),
      preferences: {
        ...d.preferences,
        specialist:
          d.preferences.specialist === name
            ? "Diretor"
            : d.preferences.specialist,
      },
    }));
    setToast("Funcionário dispensado");
  };
  return (
    <PageTitle
      eyebrow="MEU TIME"
      title="Monte a sua equipe digital"
      text="Escolha quem assume cada conversa. Contrate especialistas sob medida para o seu negócio a qualquer momento."
      action={
        <Button icon={Plus} onClick={() => setNewEmployee(true)}>
          Contratar funcionário
        </Button>
      }
    >
      <div className="team-hero">
        <span className="team-hero-icon">
          <Bot />
        </span>
        <div>
          <span className="eyebrow light">FUNCIONÁRIO ATIVO</span>
          <h2>{active}</h2>
          <p>
            {specialistData.find((s) => s[0] === active)?.[2] ||
              (db.customSpecialists || []).find((x) => x.name === active)
                ?.instructions ||
              "Especialista sob medida do seu time."}
          </p>
        </div>
      </div>
      <Collaborators db={db} update={update} setToast={setToast} />
      {(db.customSpecialists || []).length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">CONTRATADOS POR VOCÊ</span>
              <h2>Funcionários sob medida</h2>
            </div>
          </div>
          <div className="team-grid">
            {db.customSpecialists.map((c) => (
              <article
                className={active === c.name ? "active" : ""}
                key={c.name}
              >
                <span className="team-avatar custom">
                  <Sparkle />
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.instructions}</small>
                </div>
                <div className="team-actions">
                  <button
                    className={active === c.name ? "chip on" : "chip"}
                    onClick={() => select(c.name)}
                  >
                    {active === c.name ? (
                      <>
                        <Check />
                        No comando
                      </>
                    ) : (
                      "Colocar no comando"
                    )}
                  </button>
                  <button
                    className="icon-button danger"
                    title="Dispensar"
                    onClick={() => dismiss(c.name)}
                  >
                    <Trash2 />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">EQUIPE PADRÃO</span>
            <h2>{specialistData.length} especialistas sempre disponíveis</h2>
          </div>
        </div>
        <div className="team-grid">
          {specialistData.map(([n, I, d], i) => (
            <article className={active === n ? "active" : ""} key={n}>
              <span className={`team-avatar t${i % 6}`}>
                <I />
              </span>
              <div>
                <strong>{n}</strong>
                <small>{d}</small>
              </div>
              <button
                className={active === n ? "chip on" : "chip"}
                onClick={() => select(n)}
              >
                {active === n ? (
                  <>
                    <Check />
                    No comando
                  </>
                ) : (
                  "Colocar no comando"
                )}
              </button>
            </article>
          ))}
        </div>
      </section>
      {newEmployee && (
        <NewEmployeeModal
          onClose={() => setNewEmployee(false)}
          onSave={(emp) => {
            update((d) => ({
              ...d,
              customSpecialists: [
                ...(d.customSpecialists || []).filter(
                  (x) => x.name !== emp.name,
                ),
                emp,
              ],
              preferences: { ...d.preferences, specialist: emp.name },
            }));
            setNewEmployee(false);
            setToast(`Funcionário de ${emp.name} contratado`);
          }}
        />
      )}
    </PageTitle>
  );
}

function ExtensionCard({ setToast }) {
  const [shown, setShown] = useState(false);
  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(AUTH_TOKEN_KEY) || ""
      : "";
  const masked = token ? `${token.slice(0, 6)}${"•".repeat(12)}` : "";
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setToast("Token copiado — cole na extensão");
    } catch {
      setToast("Não foi possível copiar agora");
    }
  };
  return (
    <section className="settings-card" id="settings-extension">
      <div className="settings-card-head">
        <span className="settings-icon">
          <Plug />
        </span>
        <div>
          <h2>Extensão do navegador</h2>
          <p>Use a IA do app em qualquer página da internet.</p>
        </div>
      </div>
      <p className="settings-note">
        Instale a extensão (pasta <code>extension/</code> do projeto) e conecte
        com o token abaixo. Ele fica só no seu navegador e serve para a extensão
        falar com a mesma IA — sem custo extra.
      </p>
      <Field label="Seu token de acesso">
        <input
          value={shown ? token : masked}
          readOnly
          className="readonly"
          aria-label="Token de acesso"
        />
      </Field>
      <div className="settings-actions">
        <Button variant="secondary" onClick={() => setShown((s) => !s)}>
          {shown ? "Ocultar" : "Mostrar"}
        </Button>
        <Button icon={Copy} onClick={copy} disabled={!token}>
          Copiar token
        </Button>
      </div>
    </section>
  );
}

function AccountSettings({ db, update, setToast, go }) {
  const [name, setName] = useState(db.user.name);
  // Perfil: foto (lembrete forte, mas pulável) + status (emoji + frase).
  const [statusEmoji, setStatusEmoji] = useState(db.user.statusEmoji || "");
  const [statusText, setStatusText] = useState(db.user.statusText || "");
  const [fotoBusy, setFotoBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [errorLogs, setErrorLogs] = useState([]);
  const [errorLogsOpen, setErrorLogsOpen] = useState(false);
  const [errorLogsLoading, setErrorLogsLoading] = useState(false);
  const [errorLogsLoaded, setErrorLogsLoaded] = useState(false);
  const toggleErrorLogs = async () => {
    if (errorLogsOpen) {
      setErrorLogsOpen(false);
      return;
    }
    setErrorLogsOpen(true);
    if (errorLogsLoaded) return;
    setErrorLogsLoading(true);
    try {
      const r = await fetch("/api/errors", { headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Não foi possível carregar os erros.");
      setErrorLogs(d.logs || []);
      setErrorLogsLoaded(true);
    } catch (e) {
      setToast(e.message);
      setErrorLogsOpen(false);
    } finally {
      setErrorLogsLoading(false);
    }
  };
  const pushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushChecked, setPushChecked] = useState(false);
  const [supportEmail, setSupportEmail] = useState("");
  const [serviceStatus, setServiceStatus] = useState(null);
  const [usageMetrics, setUsageMetrics] = useState(null);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backupsBusy, setBackupsBusy] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setVapidPublicKey(d.vapidPublicKey || "");
        setSupportEmail(d.supportEmail || "");
      })
      .catch(() => {});
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setServiceStatus(d))
      .catch(() => setServiceStatus({ status: "indisponível" }));
    if (!pushSupported) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushSubscribed(!!subscription))
      .catch(() => {})
      .finally(() => setPushChecked(true));
  }, [pushSupported]);
  const loadUsageMetrics = async () => {
    setMetricsBusy(true);
    try {
      const space = activeSpaceId();
      const response = await fetch(
        `/api/events${space ? `?owner=${encodeURIComponent(space)}` : ""}`,
        { headers: authHeaders() },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Não foi possível carregar os indicadores.");
      setUsageMetrics(data);
    } catch (error) {
      setToast(error.message);
    } finally {
      setMetricsBusy(false);
    }
  };
  const backupUrl = () => {
    const space = activeSpaceId();
    return `/api/workspace/backups${space ? `?owner=${encodeURIComponent(space)}` : ""}`;
  };
  const loadBackups = async () => {
    setBackupsBusy(true);
    try {
      const response = await fetch(backupUrl(), { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Não foi possível carregar os backups.");
      setBackups(data.backups || []);
    } catch (error) {
      setToast(error.message);
    } finally {
      setBackupsBusy(false);
    }
  };
  const restoreBackup = async (backup) => {
    const when = new Date(backup.createdAt).toLocaleString("pt-BR");
    if (
      !confirm(
        `Restaurar a versão ${backup.revision}, salva em ${when}? A versão atual também será preservada no histórico.`,
      )
    )
      return;
    setBackupsBusy(true);
    try {
      const spaceKey = activeSpaceId() || db.user.id;
      const response = await fetch(backupUrl(), {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          snapshotId: backup.id,
          revision: readWorkspaceRevision(spaceKey),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Não foi possível restaurar o backup.");
      storeWorkspaceRevision(spaceKey, data.revision);
      setToast("Versão restaurada. Atualizando o espaço...");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      setToast(error.message);
      setBackupsBusy(false);
    }
  };
  const downloadDiagnostics = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      appVersion: serviceStatus?.version || "desconhecida",
      serviceStatus: serviceStatus?.status || "desconhecido",
      browser: navigator.userAgent,
      recentErrors: errorLogs.slice(0, 10),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "diagnostico-seu-funcionario.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setToast("Diagnóstico preparado para o suporte");
  };
  const enablePush = async () => {
    if (!vapidPublicKey) {
      setToast("Notificações do navegador não estão configuradas.");
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setToast("Permissão de notificação negada.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!r.ok) throw new Error("Não foi possível ativar as notificações.");
      setPushSubscribed(true);
      setToast("Notificações do navegador ativadas");
    } catch (e) {
      setToast(e.message || "Não foi possível ativar as notificações.");
    } finally {
      setPushBusy(false);
    }
  };
  const disablePush = async () => {
    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushSubscribed(false);
      setToast("Notificações do navegador desativadas");
    } catch (e) {
      setToast(e.message || "Não foi possível desativar as notificações.");
    } finally {
      setPushBusy(false);
    }
  };
  const workspaceSizeBytes = (() => {
    try {
      return new Blob([JSON.stringify(db)]).size;
    } catch {
      return 0;
    }
  })();
  const workspaceSizeLimit = 900_000;
  const workspaceSizePct = Math.min(
    100,
    Math.round((workspaceSizeBytes / workspaceSizeLimit) * 100),
  );
  const spaceBreakdown = workspaceBreakdown(db);
  const oldConversations = Math.max(
    0,
    (db.conversations || []).length - 5,
  );
  const freeUpSpace = () => {
    if (
      !confirm(
        `Isto vai apagar ${oldConversations} conversa(s) de IA mais antiga(s), mantendo as 5 mais recentes. O histórico apagado não pode ser recuperado — exporte seus dados antes se quiser guardá-lo. Continuar?`,
      )
    )
      return;
    update((d) => ({
      ...d,
      conversations: trimOldConversations(d.conversations, 5),
      selectedConversationId: null,
    }));
    setToast("Conversas de IA antigas removidas — espaço liberado");
  };
  const theme = db.preferences.theme;
  const setTheme = (t) =>
    update((d) => ({ ...d, preferences: { ...d.preferences, theme: t } }));
  const mode = db.preferences.mode || "business";
  const setMode = (m) => {
    if (m === mode) return;
    update((d) => ({
      ...d,
      preferences: { ...d.preferences, mode: m, modeChosen: true },
    }));
    setToast(
      m === "employee"
        ? "Modo alterado: me ajudar no meu trabalho"
        : "Modo alterado: administrar meu negócio",
    );
  };
  const saveName = async () => {
    const clean = name.trim();
    if (clean.length < 2) {
      setErr("Informe um nome válido.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: clean }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Não foi possível salvar.");
      update((d) => ({ ...d, user: { ...d.user, name: data.user.name } }));
      setToast("Nome atualizado");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  // Reduz a foto no cliente para um data URL pequeno (256px, JPEG) antes de
  // subir — a coluna guarda o data URL direto, sem blob store separado.
  const reduzirFoto = (arquivo) =>
    new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      leitor.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Imagem inválida."));
        img.onload = () => {
          const lado = 256;
          const canvas = document.createElement("canvas");
          canvas.width = lado;
          canvas.height = lado;
          const ctx = canvas.getContext("2d");
          const escala = Math.max(lado / img.width, lado / img.height);
          const w = img.width * escala;
          const h = img.height * escala;
          ctx.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  const enviarFoto = async (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setFotoBusy(true);
    setErr("");
    try {
      const avatarUrl = await reduzirFoto(arquivo);
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ avatarUrl }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Não foi possível salvar a foto.");
      update((d) => ({ ...d, user: { ...d.user, avatarUrl: data.user.avatarUrl } }));
      setToast("Foto de perfil atualizada");
    } catch (e) {
      setErr(e.message);
    } finally {
      setFotoBusy(false);
      if (evento.target) evento.target.value = "";
    }
  };
  const removerFoto = async () => {
    setFotoBusy(true);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ avatarUrl: "" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Não foi possível remover a foto.");
      update((d) => ({ ...d, user: { ...d.user, avatarUrl: "" } }));
    } catch (e) {
      setToast(e.message);
    } finally {
      setFotoBusy(false);
    }
  };
  const salvarStatus = async () => {
    setStatusBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ statusEmoji, statusText }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Não foi possível salvar o status.");
      update((d) => ({ ...d, user: { ...d.user, statusEmoji: data.user.statusEmoji, statusText: data.user.statusText } }));
      setToast("Status atualizado");
    } catch (e) {
      setErr(e.message);
    } finally {
      setStatusBusy(false);
    }
  };
  const exportData = () => {
    const { user: _user, spaceKey: _spaceKey, ...rest } = db;
    const blob = new Blob([JSON.stringify(rest, null, 2)], {
        type: "application/json",
      }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "seu-funcionario-dados.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setToast("Dados exportados");
    trackProductEvent("export_completed", {
      module: "config",
      kind: "workspace_json",
      success: true,
    });
  };
  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteErr("");
    try {
      const r = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível excluir sua conta.");
      }
      const userId = db.user.id;
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(ACTIVE_USER_KEY);
      localStorage.removeItem("sf-space");
      localStorage.removeItem("sf-space-name");
      localStorage.removeItem(userStorageKey(userId));
      update(() => cleanDb(null));
    } catch (e) {
      setDeleteErr(e.message);
      setDeleting(false);
    }
  };
  const plugged = (db.pluggedTools || []).length;
  return (
    <PageTitle
      eyebrow="CONFIGURAÇÕES"
      title="Seu espaço, do seu jeito"
      text="Cuide da sua conta, das preferências e da segurança em um só lugar."
      className="settings-title"
    >
      <div className="settings-page">
        <section className="settings-overview" aria-label="Resumo da conta">
          <div className="settings-overview-profile">
            <span className="settings-avatar" aria-hidden="true">
              {db.user.avatarUrl
                ? <img src={db.user.avatarUrl} alt="" className="settings-avatar-img" />
                : String(db.user.name || "U").trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <span className="eyebrow light">CONTA PRINCIPAL</span>
              <h2>{db.user.name}</h2>
              <p>{db.user.email}</p>
              {(db.user.statusEmoji || db.user.statusText) && (
                <p className="settings-status-line">
                  {db.user.statusEmoji ? `${db.user.statusEmoji} ` : ""}{db.user.statusText || ""}
                </p>
              )}
            </div>
          </div>
          <div className="settings-overview-status">
            <span
              className={`service-pill ${serviceStatus?.status === "operacional" ? "online" : ""}`}
            >
              <span aria-hidden="true" />
              {serviceStatus?.status === "operacional"
                ? "Tudo funcionando"
                : "Verificando serviço"}
            </span>
            <small>{serviceStatus?.version || "Versão atual"}</small>
          </div>
        </section>

        <nav
          className="settings-jump-nav"
          aria-label="Seções das configurações"
        >
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("settings-account")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <UserRound /> Conta
          </button>
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("settings-preferences")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Palette /> Preferências
          </button>
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("settings-workspace")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Layers /> Espaço e equipe
          </button>
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("settings-support")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <LifeBuoy /> Suporte
          </button>
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("settings-security")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <ShieldCheck /> Privacidade
          </button>
        </nav>

      <div className="settings-grid">
        <ExtensionCard setToast={setToast} />
        <section className="settings-card" id="settings-account">
          <div className="settings-card-head">
            <span className="settings-icon">
              <UserRound />
            </span>
            <div>
              <h2>Perfil</h2>
              <p>Como você aparece no aplicativo.</p>
            </div>
          </div>
          <div className="profile-photo-row">
            <span className="profile-photo">
              {db.user.avatarUrl
                ? <img src={db.user.avatarUrl} alt="Sua foto de perfil" />
                : <span className="profile-photo-initial">{String(db.user.name || "U").trim().charAt(0).toUpperCase()}</span>}
            </span>
            <div className="profile-photo-actions">
              <label className="profile-photo-btn">
                {fotoBusy ? "Enviando…" : (db.user.avatarUrl ? "Trocar foto" : "Adicionar foto")}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={enviarFoto} disabled={fotoBusy} hidden />
              </label>
              {db.user.avatarUrl && (
                <button type="button" className="profile-photo-remove" onClick={removerFoto} disabled={fotoBusy}>
                  Remover
                </button>
              )}
            </div>
          </div>
          {!db.user.avatarUrl && (
            <p className="profile-photo-nudge">
              Uma foto ajuda o time a te reconhecer. Não é obrigatória — dá pra deixar pra depois.
            </p>
          )}
          <Field label="Seu nome">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </Field>
          <Field label="E-mail">
            <input value={db.user.email} readOnly className="readonly" />
          </Field>
          <div className="profile-status">
            <Field label="Status (emoji)">
              <input
                value={statusEmoji}
                onChange={(e) => setStatusEmoji(e.target.value)}
                maxLength={16}
                placeholder="🟢"
                className="profile-status-emoji"
              />
            </Field>
            <Field label="Status (frase)">
              <input
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                maxLength={140}
                placeholder="Ex.: Focada em fechamento"
              />
            </Field>
          </div>
          <div className="settings-actions">
            <Button
              variant="ghost"
              disabled={statusBusy || (statusEmoji === (db.user.statusEmoji || "") && statusText === (db.user.statusText || ""))}
              onClick={salvarStatus}
            >
              {statusBusy ? "Salvando..." : "Salvar status"}
            </Button>
          </div>
          {err && (
            <div className="ask-error">
              <CircleAlert />
              {err}
            </div>
          )}
          <div className="settings-actions">
            <Button
              icon={Save}
              disabled={busy || name.trim() === db.user.name}
              onClick={saveName}
            >
              {busy ? "Salvando..." : "Salvar perfil"}
            </Button>
          </div>
        </section>
        <section className="settings-card" id="settings-preferences">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Palette />
            </span>
            <div>
              <h2>Aparência</h2>
              <p>Escolha o tema do aplicativo.</p>
            </div>
          </div>
          <div className="theme-choice">
            <button
              className={theme === "light" ? "active" : ""}
              onClick={() => setTheme("light")}
            >
              <span className="theme-preview light">
                <Sun />
              </span>
              <strong>Claro</strong>
              {theme === "light" && <CheckCircle2 className="theme-check" />}
            </button>
            <button
              className={theme === "dark" ? "active" : ""}
              onClick={() => setTheme("dark")}
            >
              <span className="theme-preview dark">
                <Moon />
              </span>
              <strong>Escuro</strong>
              {theme === "dark" && <CheckCircle2 className="theme-check" />}
            </button>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <BriefcaseBusiness />
            </span>
            <div>
              <h2>Modo de uso</h2>
              <p>Ajuste o aplicativo ao seu jeito de trabalhar.</p>
            </div>
          </div>
          <div className="theme-choice">
            <button
              className={mode === "business" ? "active" : ""}
              onClick={() => setMode("business")}
            >
              <span className="theme-preview light">
                <BriefcaseBusiness />
              </span>
              <strong>Administrar meu negócio</strong>
              {mode === "business" && <CheckCircle2 className="theme-check" />}
            </button>
            <button
              className={mode === "employee" ? "active" : ""}
              onClick={() => setMode("employee")}
            >
              <span className="theme-preview dark">
                <UserRound />
              </span>
              <strong>Me ajudar no meu trabalho</strong>
              {mode === "employee" && <CheckCircle2 className="theme-check" />}
            </button>
          </div>
          <small>Seus dados não são apagados nem ocultados ao trocar de modo.</small>
        </section>
        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Award />
            </span>
            <div>
              <h2>Gamificação</h2>
              <p>Pontos, níveis e conquistas de missões concluídas.</p>
            </div>
          </div>
          <label className="cost-check">
            <input
              type="checkbox"
              checked={db.preferences.gamificationEnabled !== false}
              onChange={(e) =>
                update((d) => ({
                  ...d,
                  preferences: {
                    ...d.preferences,
                    gamificationEnabled: e.target.checked,
                  },
                }))
              }
            />
            <span>Mostrar pontos, nível e conquistas no painel</span>
          </label>
        </section>
        <section className="settings-card" id="settings-workspace">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Layers />
            </span>
            <div>
              <h2>Time e ferramentas</h2>
              <p>Atalhos para configurar seu espaço.</p>
            </div>
          </div>
          <div className="settings-links">
            <div className="settings-stat">
              <Bot />
              <span>
                <strong>{(db.customSpecialists || []).length}</strong>{" "}
                funcionários contratados
              </span>
            </div>
            <div className="settings-stat">
              <Plug />
              <span>
                <strong>{plugged}</strong> ferramentas plugadas
              </span>
            </div>
            <div className="settings-stat">
              <Building2 />
              <span>
                <strong>{db.businesses.length}</strong> negócios cadastrados
              </span>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <TrendingUp />
            </span>
            <div>
              <h2>Indicadores de uso</h2>
              <p>Adoção real do espaço nos últimos 30 dias, sem armazenar o conteúdo do trabalho.</p>
            </div>
          </div>
          {usageMetrics ? (
            <div className="settings-links">
              <div className="settings-stat">
                <Users />
                <span>
                  <strong>{usageMetrics.activeUsers || 0}</strong> pessoas ativas
                </span>
              </div>
              {(usageMetrics.events || []).slice(0, 5).map((item) => (
                <div className="settings-stat" key={item.event}>
                  <Activity />
                  <span>
                    <strong>{item.total}</strong> {item.event.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">
              Carregue os indicadores para acompanhar ativação, uso da IA,
              importações, exportações e conclusão de ações.
            </p>
          )}
          <div className="settings-actions">
            <Button variant="secondary" onClick={loadUsageMetrics} disabled={metricsBusy}>
              {metricsBusy ? "Carregando..." : "Atualizar indicadores"}
            </Button>
          </div>
        </section>
        <section className="settings-card" id="settings-support">
          <div className="settings-card-head">
            <span className="settings-icon">
              <LifeBuoy />
            </span>
            <div>
              <h2>Ajuda e continuidade</h2>
              <p>Consulte o estado do serviço e leve um diagnóstico seguro ao suporte.</p>
            </div>
          </div>
          <div className="settings-stat">
            <Activity />
            <span>
              Serviço: <strong>{serviceStatus?.status || "verificando..."}</strong>
              {serviceStatus?.version ? ` · ${serviceStatus.version}` : ""}
            </span>
          </div>
          <div className="settings-actions">
            <Button variant="secondary" onClick={downloadDiagnostics}>
              Baixar diagnóstico
            </Button>
            {supportEmail && (
              <a
                className="button secondary"
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Suporte — Seu Funcionário")}`}
              >
                Enviar ao suporte
              </a>
            )}
            <a className="text-button" href="/api/status" target="_blank" rel="noreferrer">
              Ver estado técnico
            </a>
          </div>
        </section>
        <section className="settings-card" id="settings-security">
          <div className="settings-card-head">
            <span className="settings-icon">
              <ShieldCheck />
            </span>
            <div>
              <h2>Dados e segurança</h2>
              <p>Seus projetos são sincronizados com a sua conta.</p>
            </div>
          </div>
          <div className="settings-stat">
            <Boxes />
            <span>
              <strong>{workspaceSizePct}%</strong> do espaço de sincronização
              usado ({Math.round(workspaceSizeBytes / 1024)} KB de{" "}
              {Math.round(workspaceSizeLimit / 1024)} KB)
            </span>
          </div>
          {workspaceSizePct >= 70 && (
            <div className="notice">
              <CircleAlert />
              <span>
                {workspaceSizePct >= 90
                  ? "Seu espaço está quase cheio. Exporte ou arquive itens antigos (documentos, tarefas concluídas, histórico) para evitar falhas de sincronização."
                  : "Seu espaço de sincronização está enchendo. Vale exportar ou arquivar itens antigos com o tempo."}
              </span>
            </div>
          )}
          {spaceBreakdown.rows.length > 0 && (
            <div className="space-breakdown">
              <span className="space-breakdown-title">
                O que está usando o espaço
              </span>
              {spaceBreakdown.rows.slice(0, 6).map((row) => {
                const pct = spaceBreakdown.total
                  ? Math.round((row.bytes / spaceBreakdown.total) * 100)
                  : 0;
                return (
                  <div key={row.key} className="space-row">
                    <div className="space-row-head">
                      <span>{row.label}</span>
                      <small>
                        {Math.max(1, Math.round(row.bytes / 1024))} KB · {row.count}
                      </small>
                    </div>
                    <div className="space-bar">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {oldConversations > 0 && (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  onClick={freeUpSpace}
                >
                  Liberar espaço: apagar {oldConversations} conversa(s) de IA
                  antiga(s)
                </Button>
              )}
            </div>
          )}
          <div className="settings-actions col">
            <Button variant="secondary" icon={Download} onClick={exportData}>
              Exportar meus dados
            </Button>
            <Button
              variant="secondary"
              icon={History}
              onClick={loadBackups}
              disabled={backupsBusy}
            >
              {backupsBusy ? "Carregando versões..." : "Ver versões anteriores"}
            </Button>
            {backups.length > 0 && (
              <div className="settings-links">
                {backups.map((backup) => (
                  <div className="settings-stat" key={backup.id}>
                    <History />
                    <span>
                      <strong>Versão {backup.revision}</strong>
                      <small>
                        {new Date(backup.createdAt).toLocaleString("pt-BR")} ·{" "}
                        {Math.max(1, Math.round(backup.size / 1024))} KB
                      </small>
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => restoreBackup(backup)}
                      disabled={backupsBusy}
                    >
                      Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              icon={LogOut}
              onClick={() => {
                if (confirm("Encerrar esta sessão?")) {
                  endSession();
                  update(() => cleanDb(null));
                }
              }}
            >
              Sair da conta
            </Button>
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={() => {
                setDeleteConfirm("");
                setDeleteErr("");
                setDeleteOpen(true);
              }}
            >
              Excluir minha conta
            </Button>
          </div>
          <p className="settings-note">
            <ShieldCheck />A recuperação de senha por código de e-mail está
            disponível na tela de login.
          </p>
          <p className="settings-note">
            <FileText />
            <button
              type="button"
              className="link-button"
              onClick={() => go && go("legal")}
            >
              Termos de Uso e Política de Privacidade
            </button>
          </p>
        </section>
        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Bug />
            </span>
            <div>
              <h2>Erros técnicos</h2>
              <p>
                Falhas registradas automaticamente enquanto você usava o
                aplicativo nesta conta.
              </p>
            </div>
          </div>
          <div className="settings-actions">
            <Button
              variant="secondary"
              icon={Bug}
              onClick={toggleErrorLogs}
              disabled={errorLogsLoading}
            >
              {errorLogsLoading
                ? "Carregando..."
                : errorLogsOpen
                  ? "Ocultar"
                  : "Ver erros recentes"}
            </Button>
          </div>
          {errorLogsOpen &&
            (errorLogs.length === 0 ? (
              <p className="settings-note">
                <BadgeCheck />
                Nenhum erro registrado nesta conta até agora.
              </p>
            ) : (
              <div className="member-list">
                {errorLogs.map((log) => (
                  <details key={log.id} className="error-log-entry">
                    <summary>
                      <strong>{log.message}</strong>
                      <small>
                        {log.url ? `${log.url} · ` : ""}
                        {new Date(log.createdAt).toLocaleString("pt-BR")}
                      </small>
                    </summary>
                    {log.stack && <pre>{log.stack}</pre>}
                    {log.componentStack && <pre>{log.componentStack}</pre>}
                  </details>
                ))}
              </div>
            ))}
        </section>
        {pushSupported && (
          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon">
                <Bell />
              </span>
              <div>
                <h2>Notificações do navegador</h2>
                <p>
                  Receba um aviso mesmo com o aplicativo fechado — nova
                  missão, entrega aprovada, convite aceito e outras novidades.
                </p>
              </div>
            </div>
            <div className="settings-actions">
              <Button
                variant={pushSubscribed ? "ghost" : "secondary"}
                icon={Bell}
                onClick={pushSubscribed ? disablePush : enablePush}
                disabled={pushBusy || !pushChecked}
              >
                {pushBusy
                  ? "Aguarde..."
                  : pushSubscribed
                    ? "Desativar notificações"
                    : "Ativar notificações"}
              </Button>
            </div>
          </section>
        )}
      </div>
      </div>
      {deleteOpen && (
        <Modal title="Excluir minha conta" onClose={() => setDeleteOpen(false)}>
          <p>
            Esta ação apaga permanentemente sua conta e todos os dados do seu
            espaço de trabalho (negócios, tarefas, leads, contatos,
            agendamentos, produtos, financeiro, documentos e sites
            publicados). Não é possível desfazer.
          </p>
          <Field label='Para confirmar, digite "EXCLUIR"'>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="EXCLUIR"
              autoFocus
            />
          </Field>
          {deleteErr && (
            <div className="ask-error">
              <CircleAlert />
              {deleteErr}
            </div>
          )}
          <div className="settings-actions">
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              disabled={deleting || deleteConfirm.trim() !== "EXCLUIR"}
              onClick={deleteAccount}
            >
              {deleting ? "Excluindo..." : "Excluir permanentemente"}
            </Button>
          </div>
        </Modal>
      )}
    </PageTitle>
  );
}

export default function App() {
  // A rota que decide qual portal montar precisa ser reativa, e o hook tem de
  // ficar aqui em cima, antes de qualquer return antecipado — mesma razão do
  // comentário dos estados logo abaixo.
  const routePath = useRoutePath();
  const savedUi = (() => {
    try {
      return JSON.parse(localStorage.getItem("sf-ui") || "{}");
    } catch {
      return {};
    }
  })();
  const [
      db,
      update,
      workspaceConflict,
      syncing,
      syncError,
      retrySync,
      logoutFromExpiredSession,
      workspaceAction,
      sessionStatus,
      markSessionAuthenticated,
    ] = useDatabase(),
    [page, setPage] = useState("inicio"),
    [collapsed, setCollapsed] = useState(!!savedUi.collapsed),
    [mobile, setMobile] = useState(false),
    // Começa ABERTA de propósito. Fechar por padrão tiraria da vista itens que
    // a pessoa já sabe onde ficam — o menu escolhido é para destacar o que ela
    // usa, não para esconder o resto. Quem quiser a visão enxuta fecha uma vez,
    // e fica fechada. Precisa ficar aqui em cima, junto dos outros estados:
    // declarado depois dos returns antecipados, o React quebra a ordem dos
    // hooks entre renders e a tela trava.
    [showAllTools, setShowAllTools] = useState(
      db?.preferences?.menuExpanded !== false,
    ),
    [toast, setToast] = useState(""),
    [businessMenu, setBusinessMenu] = useState(false),
    [notifOpen, setNotifOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [searchQuery, setSearchQuery] = useState("");
  const [searchSeed, setSearchSeed] = useState("");
  const clearSearchSeed = () => setSearchSeed("");
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [changelogSeenId, setChangelogSeenId] = useState(
    () => localStorage.getItem("sf-changelog-seen") || "",
  );
  const hasUnseenChangelog =
    CHANGELOG_ENTRIES[0] && CHANGELOG_ENTRIES[0].id !== changelogSeenId;
  const business =
    db.businesses.find((x) => x.id === db.selectedBusinessId) ||
    db.businesses[0] ||
    null;
  const openChangelog = () => {
    setChangelogOpen(true);
    const latestId = CHANGELOG_ENTRIES[0]?.id || "";
    localStorage.setItem("sf-changelog-seen", latestId);
    setChangelogSeenId(latestId);
  };
  const [menuHidden, setMenuHidden] = useState(!!savedUi.menuHidden);
  const [updateAvailable, setUpdateAvailable] = useState(
    () => !!window.__SF_UPDATE_AVAILABLE__,
  );
  const [updateInfo, setUpdateInfo] = useState(() => ({
    latestVersion: window.__SF_LATEST_VERSION__ || "",
  }));
  const [sbw, setSbw] = useState(
    Math.min(380, Math.max(210, savedUi.sbw || 266)),
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        "sf-ui",
        JSON.stringify({ collapsed, menuHidden, sbw }),
      );
    } catch {}
  }, [collapsed, menuHidden, sbw]);
  useEffect(() => {
    const showUpdate = (event) => {
      setUpdateInfo({
        latestVersion:
          event.detail?.latestVersion || window.__SF_LATEST_VERSION__ || "",
      });
      setUpdateAvailable(true);
    };
    window.addEventListener("sf-app-update-available", showUpdate);
    return () =>
      window.removeEventListener("sf-app-update-available", showUpdate);
  }, []);
  useEffect(() => {
    const handler = (event) => {
      const link = event.detail?.link;
      if (link) {
        setPage(link);
        setMobile(false);
      }
    };
    window.addEventListener("sf-push-navigate", handler);
    return () => window.removeEventListener("sf-push-navigate", handler);
  }, []);
  // Sem isso, trocar de tela herda a profundidade de rolagem da tela
  // anterior — quem estava no fim de Ferramentas abria Configurações já
  // no rodapé, parecendo que a página carregou "pela metade".
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  // Lembrete automático do DAS do MEI. Só roda no espaço do próprio dono
  // (nunca ao visualizar o espaço de outra pessoa) e o dedup por mês+tipo
  // dentro de buildDasReminder evita repetição a cada carregamento.
  useEffect(() => {
    if (activeSpaceId() || !db.user?.id) return;
    const next = buildDasReminder(db.taxProfile, db.notifications, db.user.id);
    if (next) update((d) => ({ ...d, notifications: next }));
  }, [
    db.taxProfile?.isMEI,
    db.taxProfile?.dasHistory,
    db.taxProfile,
    db.notifications,
    db.user?.id,
    update,
  ]);
  // Contratos recorrentes: lembrete mensal dos manuais + lançamento automático
  // dos marcados como autoPost. Só no espaço do próprio dono, idempotente por
  // mês (history[ym] dentro de buildRecurringPostings/Reminder).
  useEffect(() => {
    if (activeSpaceId() || !db.user?.id) return;
    const reminder = buildRecurringReminder(
      db.recurring,
      db.notifications,
      db.user.id,
    );
    const postings = buildRecurringPostings(db.recurring, {
      userId: db.user.id,
    });
    if (!reminder && postings.length === 0) return;
    update((d) => {
      const next = { ...d };
      if (reminder) next.notifications = reminder;
      if (postings.length) {
        const ym = today().slice(0, 7);
        const postedIds = new Set(postings.map((p) => p.contractId));
        next.transactions = [
          ...postings.map((p) => p.transaction),
          ...(d.transactions || []),
        ];
        next.recurring = (d.recurring || []).map((c) =>
          postedIds.has(c.id)
            ? {
                ...c,
                history: {
                  ...(c.history || {}),
                  [ym]: { postedAt: new Date().toISOString() },
                },
              }
            : c,
        );
      }
      return next;
    });
  }, [db.notifications, db.recurring, db.user?.id, update]);
  // Automações: regras agendadas que criam tarefas ou lembretes sozinhas.
  // Só no espaço do próprio dono, idempotente por período (history na regra).
  useEffect(() => {
    if (activeSpaceId() || !db.user?.id) return;
    const { rules, intents } = runAutomations(db.automations || []);
    if (intents.length === 0) return;
    update((d) => {
      const tasks = intents
        .filter((i) => i.actionType === "task")
        .map((i) =>
          taskFromIdea(i.text, { businessId: business?.id, ownerId: d.user.id }),
        );
      const notifs = intents
        .filter((i) => i.actionType === "reminder")
        .map((i) => ({
          id: uid(),
          assigneeId: d.user.id,
          ownerId: d.user.id,
          message: i.text,
          link: "automacoes",
          read: false,
          createdAt: new Date().toISOString(),
        }));
      return {
        ...d,
        automations: rules,
        tasks: [...tasks, ...(d.tasks || [])],
        notifications: [...notifs, ...(d.notifications || [])],
      };
    });
  }, [business?.id, db.automations, db.user?.id, update]);
  const startResize = (e) => {
    e.preventDefault();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev) => setSbw(Math.min(380, Math.max(210, ev.clientX)));
    const up = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = db.preferences.theme;
  }, [db.preferences.theme]);
  // No universo To Do Green (login, vertical e portais) a aba mostra a marca
  // da To Do Green; fora dele, o ícone padrão do Seu Funcionário.
  useEffect(() => {
    const p = routePath || "/";
    const authed =
      sessionStatus === "authenticated" ||
      (!/^\/todogreen(?:\/|$)/.test(p) && Boolean(db.user));
    const isTodoGreenView =
      /^\/(?:todogreen|portal-tms|portal-cliente|portal-motorista|central-motorista|central-frota|motorista-frota)(?:\/|$)/.test(p) ||
      (!authed && p === "/");
    setFavicon(isTodoGreenView ? TDG_FAVICON : DEFAULT_FAVICON);
  }, [routePath, sessionStatus, db.user]);
  useEffect(() => {
    if (!db.user?.id) return;
    const key = `sf-session-event:${db.user.id}:${db.spaceKey || "own"}:${today()}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    trackProductEvent("session_started", {
      module: "app",
      mode: db.preferences.mode || "business",
    });
  }, [db.user?.id, db.spaceKey, db.preferences.mode]);
  useEffect(() => {
    if (!db.user) return;
    const m = location.search.match(/[?&]convite=([^&]+)/);
    if (!m) return;
    const code = decodeURIComponent(m[1]);
    history.replaceState({}, "", location.pathname);
    fetch("/api/collab/join", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ownerId) setToast(`Você entrou no espaço de ${d.ownerName}`);
        else if (d && d.error) setToast(d.error);
      })
      .catch(() => {});
  }, [db.user, setToast]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 2400);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!db.user) return;
    if (db.preferences.modeChosen) return;
    if (!hasAnyWorkspaceData(db)) return;
    update((d) => ({
      ...d,
      preferences: {
        ...d.preferences,
        mode: d.preferences.mode || "business",
        modeChosen: true,
      },
    }));
  }, [db, db.preferences.modeChosen, db.user, update]);
  // A vertical To Do Green nunca confia no usuário guardado no navegador:
  // só abre após o Worker confirmar o token atual. As demais telas mantêm a
  // restauração local histórica enquanto a sessão é revalidada.
  const isTodoGreenRoute = /^\/todogreen(?:\/|$)/.test(routePath);
  const primaryRoute = resolvePrimaryRoute(
    routePath,
    sessionStatus === "authenticated" || (!isTodoGreenRoute && Boolean(db.user)),
  );
  if (primaryRoute.kind !== "workspace")
    return (
      <PrimaryAppRouter
        route={primaryRoute}
        db={db}
        update={update}
        setToast={setToast}
        authHeaders={authHeaders}
        onAuthenticated={markSessionAuthenticated}
        PublicSite={PublicSite}
        AcceptInvite={AcceptInvite}
        Login={Login}
      />
    );
  if (!db.preferences.modeChosen && !hasAnyWorkspaceData(db))
    return <ModeOnboarding update={update} />;
  const mode = db.preferences.mode || "business";
  if (
    mode === "business" &&
    db.preferences.needsBusinessOnboarding === true
  )
    return <Onboarding db={db} update={update} />;
  const isEmployeeMode = mode === "employee";
  const visibleNav = navForBusiness(mode, business);
  const myNotifications = (db.notifications || []).filter(
    (n) => n.assigneeId === db.user.id,
  );
  const normalizeSearch = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const searchableNav = [...visibleNav, ...navSecondary];
  const searchResults = searchQuery.trim()
    ? searchableNav.filter(([, label]) =>
        normalizeSearch(label).includes(normalizeSearch(searchQuery)),
      )
    : searchableNav;
  const contentSearchResults = (() => {
    const q = normalizeSearch(searchQuery);
    if (!q) return [];
    return [
      ...(db.tasks || [])
        .filter((t) =>
          normalizeSearch(`${t.title} ${t.description || ""}`).includes(q),
        )
        .map((t) => ({
          kind: "task",
          key: `task-${t.id}`,
          icon: Workflow,
          title: t.title,
          subtitle: t.project || t.area || "Tarefa",
          page: "operacao",
        })),
      ...(db.leads || [])
        .filter((l) =>
          normalizeSearch(`${l.name} ${l.company || ""}`).includes(q),
        )
        .map((l) => ({
          kind: "lead",
          key: `lead-${l.id}`,
          icon: Handshake,
          title: l.name,
          subtitle: l.company || "Lead",
          page: "vendas",
        })),
      ...(db.documents || [])
        .filter((d) => normalizeSearch(d.title).includes(q))
        .map((d) => ({
          kind: "document",
          key: `doc-${d.id}`,
          icon: FileText,
          title: d.title,
          subtitle: d.type || "Documento",
          page: "documentos",
        })),
      ...(db.contacts || [])
        .filter((c) =>
          normalizeSearch(`${c.name} ${c.company || ""}`).includes(q),
        )
        .map((c) => ({
          kind: "contact",
          key: `contact-${c.id}`,
          icon: Users,
          title: c.name,
          subtitle: c.company || "Contato",
          page: "contatos",
        })),
    ].slice(0, 20);
  })();
  const openContentSearchResult = (result) => {
    setSearchSeed(result.title);
    go(result.page);
    setSearchOpen(false);
    setSearchQuery("");
  };
  const go = (p) => {
    setPage(p);
    setMobile(false);
    trackProductEvent("navigation", { module: p });
    // Conta a visita para poder sugerir depois o que a pessoa usa de verdade.
    // Fica no aparelho, fora do workspace: gravar o banco inteiro a cada clique
    // de navegação atropelava o estado de telas abertas.
    // A sugestão é só sugestão: o menu nunca se reorganiza sozinho, senão a
    // pessoa perde o botão que já tinha decorado.
    writeVisit(window.localStorage, p);
  };
  const content = () => {
    switch (page) {
      case "inicio":
        return (
          <Dashboard
            db={db}
            update={update}
            business={business}
            go={go}
            setToast={setToast}
            visibleNav={visibleNav}
          />
        );
      case "conversar":
        return (
          <PageTitle
            eyebrow="SEU FUNCIONÁRIO"
            title="Peça o que precisar"
            text="Escreva como você falaria com um funcionário: “manda a cobrança pro cliente atrasado”, “quanto entrou este mês”, “monta um orçamento”. Ele responde, faz e diz onde ficou."
          >
            <UniversalRequest
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </PageTitle>
        );
      case "comecar":
        return <Journeys db={db} update={update} go={go} />;
      case "estrategia":
      case "marketing":
        return (
          <Specialists
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            area={page}
          />
        );
      case "vendas":
        return (
          <CRM
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            searchSeed={searchSeed}
            clearSearchSeed={clearSearchSeed}
            AreaToolkit={AreaToolkit}
            EmailComposer={EmailComposer}
            SharingFields={SharingFields}
            buildLeadWonSideEffects={buildLeadWonSideEffects}
            logInteraction={logInteraction}
            upsertContact={upsertContact}
            useWhatsappSender={useWhatsappSender}
          />
        );
      case "meu-trabalho":
        return (
          <MyWork db={db} update={update} business={business} setToast={setToast} go={go} />
        );
      case "resultados":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando dashboards...</div>}
          >
            <ConfigurableDashboard
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "chat-corporativo":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando conversas...</div>}
          >
            <CorporateChat
              db={db}
              update={update}
              business={business}
              go={go}
              setToast={setToast}
              authHeaders={authHeaders}
              ownerId={activeSpaceId()}
            />
          </Suspense>
        );
      case "orcamentos":
        return (
          <Quotes
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            authHeaders={authHeaders}
            buildOrderReceita={buildOrderReceita}
            logInteraction={logInteraction}
            orderFromQuote={orderFromQuote}
            quoteTotal={quoteTotal}
            SharingFields={SharingFields}
            upsertContact={upsertContact}
            useWhatsappSender={useWhatsappSender}
          />
        );
      case "precificacao":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando precificação...</div>}
          >
            <PricingImpactStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "compras":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando compras...</div>}
          >
            <Procurement
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              extractDocumentText={extractDocumentText}
              authHeaders={authHeaders}
            />
          </Suspense>
        );
      case "juridico": {
        // Deriva o papel do LegalHub a partir das permissões por área
        // (`db.memberPermissions`) — mesma regra do painel "Permissões" no
        // menu de Configurações. Sem permissão jurídica, cai em
        // "solicitante" e ainda assim pode abrir/acompanhar as próprias.
        const legalRole = permissionsToLegalRole(
          db.memberPermissions || {},
          db.user?.id,
        );
        const inheritedRole = db.user?.role || "colaborador";
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando Jurídico...</div>}
          >
            <LegalHub
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              pushNotification={pushNotification}
              viewer={{
                userId: db.user?.id,
                name: db.user?.name,
                role: legalRole !== "solicitante" ? legalRole : inheritedRole,
                isOwner: !activeSpaceId(),
              }}
            />
          </Suspense>
        );
      }
      case "caixa":
        return (
          <InboxHub
            update={update}
            setToast={setToast}
            go={go}
            authHeaders={authHeaders}
            activeSpaceId={activeSpaceId}
            inboxUrl={inboxUrl}
            logInteraction={logInteraction}
          />
        );
      case "contatos":
        return (
          <Contacts
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            searchSeed={searchSeed}
            clearSearchSeed={clearSearchSeed}
            authHeaders={authHeaders}
            inboxUrl={inboxUrl}
            parseDelimitedText={parseDelimitedText}
            trackProductEvent={trackProductEvent}
            SharingFields={SharingFields}
            EmailComposer={EmailComposer}
            useWhatsappSender={useWhatsappSender}
          />
        );
      case "agendamentos":
        return (
          <Appointments
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            SharingFields={SharingFields}
            createGoogleCalendarEventReal={createGoogleCalendarEventReal}
            googleCalendarUrl={googleCalendarUrl}
            upsertContact={upsertContact}
            useWhatsappSender={useWhatsappSender}
          />
        );
      case "produtos":
        return (
          <Catalog
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            upsertContact={upsertContact}
            useWhatsappSender={useWhatsappSender}
          />
        );
      case "frota":
        return (
          <Fleet
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
          />
        );
      case "horas":
        return (
          <TimeTracking
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "financeiro":
        return (
          <Finance
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            AreaToolkit={AreaToolkit}
            pushNotification={pushNotification}
          />
        );
      case "operacao":
        return (
          <Tasks
            // Injetado aqui, no ponto onde a aplicação é composta: extrair o
            // AreaToolkit junto arrastaria o catálogo de ferramentas e quatro
            // modais para dentro da tela de tarefas.
            AreaToolkit={AreaToolkit}
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            searchSeed={searchSeed}
            clearSearchSeed={clearSearchSeed}
            workspaceAction={workspaceAction}
          />
        );
      case "estrutura":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando estrutura...</div>}
          >
            <WorkStructure
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "quadro-rapido":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando quadro...</div>}
          >
            <QuickWhiteboard
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "diagramas":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando diagramas...</div>}
          >
            <DiagramStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "quadro":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando quadro...</div>}
          >
            <CanvasBoard
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "reunioes":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando reuniões...</div>}
          >
            <Meetings
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "resultado-mes":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando resultado...</div>}
          >
            <MonthlyStatement db={db} business={business} />
          </Suspense>
        );
      case "funil":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando funil...</div>}
          >
            <SalesPipeline
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "contas":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando contas...</div>}
          >
            <Bills
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "analise-dados":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando análise...</div>}
          >
            <DataLab db={db} business={business} />
          </Suspense>
        );
      case "memoria-busca":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando memória...</div>}
          >
            <KnowledgeCenter
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              go={go}
            />
          </Suspense>
        );
      case "personalizar-menu":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando menu...</div>}
          >
            <MenuSettings
              db={db}
              update={update}
              nav={visibleNav}
              groups={navGroups}
              setToast={setToast}
              go={go}
            />
          </Suspense>
        );
      case "meu-plano":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando plano...</div>}
          >
            <PlanPanel setToast={setToast} />
          </Suspense>
        );
      case "agentes":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando agentes...</div>}
          >
            <AgentStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              workspaceOwnerId={activeSpaceId() || db.user?.id || ""}
            />
          </Suspense>
        );
      case "portfolio":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando portfólio...</div>}
          >
            <PortfolioBoard
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "notas-conectadas":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando notas...</div>}
          >
            <ConnectedNotes
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "planejar":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando planejamento...</div>}
          >
            <DayPlanner
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "metas":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando metas...</div>}
          >
            <Goals
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "processos":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando processos...</div>}
          >
            <ProcessStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "formularios-publicos":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Carregando formulários...</div>
            }
          >
            <PublicFormsStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              ownerId={activeSpaceId()}
            />
          </Suspense>
        );
      case "portal-cliente":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">
                Carregando portal do cliente...
              </div>
            }
          >
            <ClientPortalStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              ownerId={activeSpaceId()}
            />
          </Suspense>
        );
      case "capacidade":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando capacidade...</div>}
          >
            <CapacityPlanner
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "desenvolvimento":
        return (
          <DevelopmentPlans
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
          />
        );
      case "sites":
        return (
          <Sites
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            AreaToolkit={AreaToolkit}
          />
        );
      case "documentos":
        return (
          <Documents
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
            searchSeed={searchSeed}
            clearSearchSeed={clearSearchSeed}
            AreaToolkit={AreaToolkit}
          />
        );
      case "apresentacoes":
        return (
          <Presentations
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "conteudo":
        return (
          <ContentPlanner
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "planilhas":
        return (
          <SheetBuilder
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "analise":
        return (
          <Analyzer
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "ideias":
        return (
          <MindMap
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
          />
        );
      case "assinatura":
        return (
          <EmailSignature
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "cobranca":
        return (
          <PixCharge
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "bases":
        return (
          <DataBases
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "wiki":
        return (
          <Wiki
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "automacoes":
        return (
          <Automations
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "ferramentas":
        return (
          <ToolsHub
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "time":
        return <Team db={db} update={update} setToast={setToast} />;
      case "permissoes":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando permissões...</div>}
          >
            <PermissionsPanel
              db={db}
              update={update}
              setToast={setToast}
              authHeaders={authHeaders}
              go={go}
            />
          </Suspense>
        );
      case "config":
        return (
          <AccountSettings db={db} update={update} setToast={setToast} go={go} />
        );
      case "legal":
        return <LegalPage go={go} />;
      case "criacao-local":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Carregando ferramentas...</div>
            }
          >
            <CreativeToolkit business={business} setToast={setToast} />
          </Suspense>
        );
      case "laboratorio-gratuito":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Carregando laboratório...</div>
            }
          >
            <FreeSuite
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              ownerId={activeSpaceId()}
            />
          </Suspense>
        );
      case "central-crescimento":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Carregando central...</div>
            }
          >
            <PlatformSuite
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
              ownerId={activeSpaceId()}
            />
          </Suspense>
        );
      case "editor-codigo":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando editor...</div>}
          >
            <CodeStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "notebook":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando notebook...</div>}
          >
            <DataNotebook
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "integracoes":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Carregando integrações...</div>
            }
          >
            <IntegrationsHub
              db={db}
              update={update}
              business={business}
              setToast={setToast}
              authHeaders={authHeaders}
            />
          </Suspense>
        );
      case "midia":
        return (
          <Suspense
            fallback={<div className="inbox-loading">Carregando mídia...</div>}
          >
            <MediaStudio
              db={db}
              update={update}
              business={business}
              setToast={setToast}
            />
          </Suspense>
        );
      case "estudio":
        return (
          <CreativeStudio
            db={db}
            update={update}
            business={business}
            setToast={setToast}
          />
        );
      case "historico":
        return (
          <HistoryPage
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
          />
        );
      case "certificacoes":
        return (
          <Certifications
            db={db}
            update={update}
            business={business}
            setToast={setToast}
            go={go}
          />
        );
      case "perfil-negocio":
        return (
          <Suspense
            fallback={
              <div className="inbox-loading">Preparando seu negócio...</div>
            }
          >
            <BusinessProfileStudio
              key={business?.id || "sem-negocio"}
              business={business}
              update={update}
              go={go}
              setToast={setToast}
            />
          </Suspense>
        );
      case "businesses":
        return (
          <Businesses
            db={db}
            update={update}
            setToast={setToast}
            go={go}
          />
        );
      default:
        return null;
    }
  };
  return (
    <div
      className={`app ${collapsed ? "collapsed" : ""} ${menuHidden ? "menu-hidden" : ""}`}
      style={{ "--sbw": `${sbw}px` }}
    >
      <aside className={mobile ? "open" : ""}>
        <div className="side-top">
          <Logo compact={collapsed} />
          <button
            className="icon-button mobile-close"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <nav>
          {(() => {
            // O menu principal é escolhido por quem usa. O que fica de fora NÃO
            // perde acesso: cai em "Todas as ferramentas", logo abaixo, e
            // continua achável pela busca. Escolher menu é organizar atalho.
            const { main, rest } = buildNavigation(
              visibleNav,
              db.preferences?.mainMenu,
              navGroups,
            );
            const Botao = ([id, label, I]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => go(id)}
                title={collapsed ? label : undefined}
              >
                <I />
                <span>{label}</span>
              </button>
            );
            return (
              <>
                <div className="nav-group">{main.map(Botao)}</div>
                {rest.length > 0 && (
                  <div className="nav-group nav-rest">
                    {!collapsed && (
                      <button
                        type="button"
                        className="nav-rest-toggle"
                        aria-expanded={showAllTools}
                        onClick={() => {
                          const proximo = !showAllTools;
                          setShowAllTools(proximo);
                          update({
                            ...db,
                            preferences: {
                              ...db.preferences,
                              menuExpanded: proximo,
                            },
                          });
                        }}
                      >
                        <ChevronDown
                          className={showAllTools ? "aberto" : ""}
                          size={15}
                        />
                        <span>Todas as ferramentas</span>
                      </button>
                    )}
                    {(showAllTools || collapsed) &&
                      rest.map((group, gi) => (
                        <div
                          className="nav-group"
                          key={group.label || `r${gi}`}
                        >
                          {group.label && !collapsed && (
                            <span className="nav-group-label">
                              {group.label}
                            </span>
                          )}
                          {group.items.map(Botao)}
                        </div>
                      ))}
                  </div>
                )}
              </>
            );
          })()}
          <div className="nav-divider" />
          {navSecondary.map(([id, label, I]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => go(id)}
              title={collapsed ? label : undefined}
            >
              <I />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <button
            onClick={() =>
              update((d) => ({
                ...d,
                preferences: {
                  ...d.preferences,
                  theme: d.preferences.theme === "light" ? "dark" : "light",
                },
              }))
            }
          >
            {db.preferences.theme === "light" ? <Moon /> : <Sun />}
            <span>
              {db.preferences.theme === "light" ? "Modo escuro" : "Modo claro"}
            </span>
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  "Encerrar esta sessão? Seus projetos continuarão protegidos na sua conta.",
                )
              ) {
                endSession();
                update(() => cleanDb(null));
              }
            }}
          >
            <LogOut />
            <span>Sair</span>
          </button>
          <div className="side-controls">
            <button
              className="icon-button desktop-collapse"
              title={collapsed ? "Expandir menu" : "Modo compacto"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronRight /> : <ChevronLeft />}
            </button>
            <button
              className="icon-button desktop-close"
              title="Fechar menu"
              onClick={() => setMenuHidden(true)}
            >
              <X />
            </button>
          </div>
        </div>
        <div className="sb-resize" onPointerDown={startResize} />
      </aside>
      {mobile && (
        <div
          className="mobile-overlay"
          role="button"
          tabIndex={0}
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ")
              setMobile(false);
          }}
        />
      )}
      <main className="workspace">
        {workspaceConflict && (
          <div className="workspace-conflict" role="alert">
            <CircleAlert />
            <div>
              <strong>Alterações encontradas em outro dispositivo ou aba</strong>
              <span>
                Esta versão não foi enviada e continua salva neste navegador.
                Nenhum dado remoto foi substituído; não fazemos merge
                automático.
              </span>
            </div>
          </div>
        )}
        {syncError && (
          <div className="workspace-conflict" role="alert">
            <CircleAlert />
            <div>
              <strong>
                {syncError.code === "auth"
                  ? "Sua sessão expirou"
                  : "Suas alterações não foram salvas"}
              </strong>
              <span>{syncError.message}</span>
            </div>
            {syncError.code === "auth" ? (
              <Button variant="secondary" onClick={logoutFromExpiredSession}>
                Entrar novamente
              </Button>
            ) : (
              <Button variant="secondary" onClick={retrySync}>
                Tentar agora
              </Button>
            )}
          </div>
        )}
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(true)}
            aria-label="Menu principal"
          >
            <Menu />
          </button>
          {/* No celular o menu lateral fica fechado, então nada identificaria o
              app no topo. O mascote resolve isso sozinho — sem escrever o nome,
              que não cabe e sairia cortado. */}
          <div className="topbar-mobile-brand">
            <Logo />
          </div>
          {menuHidden && (
            <button
              className="icon-button desktop-open"
              title="Abrir menu"
              onClick={() => setMenuHidden(false)}
            >
              <Menu />
            </button>
          )}
          <div className="top-business">
            <span>{isEmployeeMode ? "Meu trabalho" : "Negócio ativo"}</span>
            <button onClick={() => setBusinessMenu(!businessMenu)}>
              <span className="business-avatar small">
                {business?.name?.[0] || "+"}
              </span>
              <strong>{business?.name || "Criar negócio"}</strong>
              <ChevronRight className={businessMenu ? "rotated" : ""} />
            </button>
            {businessMenu && (
              <div className="business-popover">
                {db.businesses.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      update((d) => ({ ...d, selectedBusinessId: b.id }));
                      setBusinessMenu(false);
                    }}
                  >
                    <span className="business-avatar small">{b.name[0]}</span>
                    <span>
                      <strong>{b.name}</strong>
                      <small>
                        {b.industryActivity || b.segment || "Sem segmento"}
                      </small>
                    </span>
                    {business?.id === b.id && <Check />}
                  </button>
                ))}
                <button
                  className="manage"
                  onClick={() => {
                    go("businesses");
                    setBusinessMenu(false);
                  }}
                >
                  <Building2 />
                  Gerenciar negócios
                </button>
              </div>
            )}
          </div>
          <div className="top-actions">
            {syncing && (
              <span className="sync-indicator" role="status">
                <RefreshCw />
                Sincronizando...
              </span>
            )}
            <button
              className="icon-button search-trigger"
              aria-label="Buscar em tudo"
              title="Buscar (Ctrl+K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </button>
            <button
              className="icon-button changelog-trigger"
              aria-label="Novidades"
              title="Novidades"
              onClick={openChangelog}
            >
              <Megaphone />
              {hasUnseenChangelog && <span className="notif-dot" />}
            </button>
            {activeSpaceId() && (
              <button
                className="space-badge"
                onClick={() => switchSpace("")}
                title="Voltar ao meu espaço"
              >
                <Users />
                <span>
                  {localStorage.getItem("sf-space-name") ||
                    "Espaço compartilhado"}
                </span>
                <X />
              </button>
            )}
            <div className="notif-wrap">
              <button
                className="icon-button"
                aria-label="Notificações"
                onClick={() => setNotifOpen((v) => !v)}
              >
                <Bell />
                {myNotifications.some((n) => !n.read) && (
                  <span className="notif-dot" />
                )}
              </button>
              {notifOpen && (
                <div className="notif-popover">
                  {myNotifications.length === 0 ? (
                    <p className="notif-empty">Nenhuma notificação por aqui.</p>
                  ) : (
                    myNotifications.slice(0, 20).map((n) => (
                      <button
                        key={n.id}
                        className={n.read ? "" : "unread"}
                        onClick={() => {
                          update((d) => ({
                            ...d,
                            notifications: (d.notifications || []).map((x) =>
                              x.id === n.id ? { ...x, read: true } : x,
                            ),
                          }));
                          setNotifOpen(false);
                          if (n.link) go(n.link);
                        }}
                      >
                        {n.message}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              className="icon-button"
              onClick={() =>
                update((d) => ({
                  ...d,
                  preferences: {
                    ...d.preferences,
                    theme: d.preferences.theme === "light" ? "dark" : "light",
                  },
                }))
              }
            >
              {db.preferences.theme === "light" ? <Moon /> : <Sun />}
            </button>
            <button className="user-chip" onClick={() => go("config")}>
              <span>{db.user.name[0]}</span>
              <div>
                <strong>{db.user.name}</strong>
                <small>{db.user.email}</small>
              </div>
            </button>
          </div>
        </header>
        {searchOpen && (
          <Modal
            title="Buscar em tudo"
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
          >
            <div className="global-search">
              <input
                autoFocus
                aria-label="Buscar seção"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Digite o nome de uma ferramenta ou seção..."
              />
              {searchResults.length === 0 && contentSearchResults.length === 0 ? (
                <p className="notif-empty">Nada encontrado.</p>
              ) : (
                <>
                  {contentSearchResults.length > 0 && (
                    <div className="global-search-results">
                      <p className="global-search-group-label">Resultados</p>
                      {contentSearchResults.map((result) => (
                        <button
                          key={result.key}
                          onClick={() => openContentSearchResult(result)}
                        >
                          <result.icon />
                          <span>
                            {result.title}
                            <small>{result.subtitle}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="global-search-results">
                      {searchQuery.trim() && contentSearchResults.length > 0 && (
                        <p className="global-search-group-label">Seções</p>
                      )}
                      {searchResults.map(([id, label, I]) => (
                    <button
                      key={id}
                      onClick={() => {
                        go(id);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <I />
                      <span>{label}</span>
                    </button>
                  ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Modal>
        )}
        {changelogOpen && (
          <Modal title="Novidades" onClose={() => setChangelogOpen(false)}>
            <div className="changelog-list">
              {CHANGELOG_ENTRIES.map((entry) => (
                <div key={entry.id} className="changelog-item">
                  <span className="changelog-date">
                    {new Date(`${entry.date}T00:00:00`).toLocaleDateString(
                      "pt-BR",
                      { day: "2-digit", month: "short" },
                    )}
                  </span>
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        )}
        <div className="page" key={page}>
          {content()}
        </div>
      </main>
      <AppUpdate
        visible={updateAvailable}
        latestVersion={updateInfo.latestVersion}
      />
      <Toast toast={toast} />
    </div>
  );
}
