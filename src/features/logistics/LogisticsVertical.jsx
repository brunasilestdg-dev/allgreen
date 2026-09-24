import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  House,
  ListChecks,
  ListTodo,
  LockKeyhole,
  LogOut,
  Search,
  SlidersHorizontal,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
} from "lucide-react";
import {
  LOGISTICS_PRODUCTS,
  TODO_GREEN_MODULE_AREAS,
  TODO_GREEN_MODULE_CATALOG,
  ehPerfilDesenvolvedor,
  hasTodoGreenPermission,
  summarizeTodoGreenDashboard,
} from "./logisticsVerticalDomain.js";
import { endSession } from "../../session/armazenamento.js";
import { useSaidaPorInatividade } from "../../session/useSaidaPorInatividade.js";
import { useVerticalRecords, descreverAreasComErro } from "./useVerticalRecords.js";
import { buildTodoGreenDecisionCenter } from "./decisionCenterDomain.js";
import {
  agruparModulosPorTela,
  grupoAtendeBusca,
  ordenarPorRelevancia,
  resumirAssuntos,
} from "./moduleGroupingDomain.js";
import Semente from "./Semente.jsx";
import Modal from "../../components/Modal.jsx";
import ErpHome from "./ErpHome.jsx";
import TodoGreenProfile from "./TodoGreenProfile.jsx";
import {
  aplicarEdicaoPlannerNaTarefa,
  contextoComercialDaTarefa,
  desvincularTarefaDoPlanner,
} from "./plannerIntegrationDomain.js";
import { IMPLEMENTED_MODULE_IDS, MODULE_IMPLEMENTATION } from "./shell/catalogoDeModulos.js";
import {
  PRIMARY_NAVIGATION,
  AREA_DO_CADASTRO,
  secaoDaRota,
  MANAGEMENT_TOOLS,
  navigationModules,
  navigationFor,
  permissaoDaPagina,
  podeAcessarFuncionalidade,
  TITULOS_POR_TELA,
  sidebarFunctionLabel,
} from "./shell/navegacao.js";
import {
  todoGreenPath,
  produtoDaRota,
  todoGreenRouteToPage,
  workspaceToolFromPath,
  navigate,
} from "./shell/rotas.js";
import { ownerId, ACESSO, lerRespostaDeAcesso } from "./shell/acesso.js";
import { montarDadosDaVertical } from "./shell/dadosDaVertical.js";
import {
  AcessoEmVerificacao,
  AccessDenied,
  AreaSection,
  ProductCard,
  DashboardPanel,
} from "./journeys/compartilhados.jsx";
import PricingPanel from "./journeys/PricingPanel.jsx";
import ProposalPanel from "./journeys/ProposalPanel.jsx";
import EsgPanel, { MethodologyPanel } from "./journeys/EsgPanel.jsx";
import AccessPanel from "./journeys/AccessPanel.jsx";

// Estes nomes eram declarados aqui e continuam exportados daqui: testes e
// quem mais os importava seguem funcionando. A fonte agora é o módulo puro de
// cada assunto em ./shell/.
export { secaoDaRota, permissaoDaPagina, trilhaDaPagina } from "./shell/navegacao.js";
export { produtoDaRota, todoGreenRouteToPage } from "./shell/rotas.js";
export { ACESSO, lerRespostaDeAcesso } from "./shell/acesso.js";

const EsgCenter = lazy(() => import("./EsgCenter.jsx"));
const PricingParametersPanel = lazy(() => import("./PricingParametersPanel.jsx"));
const DashboardBuilderPage = lazy(() => import("./pages/DashboardBuilderPage.jsx"));
const GoalsPage = lazy(() => import("./pages/GoalsPage.jsx"));
const SalesPerformancePage = lazy(() => import("./pages/SalesPerformancePage.jsx"));
const ClientsPage = lazy(() => import("./pages/ClientsPage.jsx"));
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
const SalesFunnelPage = lazy(() => import("./pages/SalesFunnelPage.jsx"));
// Ferramentas do app geral trazidas para dentro da vertical (Estúdio). Elas já
// recebem db/update/setToast; passamos um contexto de negócio To Do Green para
// os exemplos e prompts saírem no tom da transportadora.
const CreativeToolkit = lazy(() => import("../creative/CreativeToolkit.jsx"));
const MediaStudio = lazy(() => import("../media/MediaStudio.jsx"));
const CodeStudio = lazy(() => import("../code/CodeStudio.jsx"));
// Análise de textos e Mapa de ideias moram no App.jsx como funções de módulo
// (usam só props + helpers de módulo). Importamos por named export com lazy — o
// App.jsx não importa a vertical estaticamente, então não há ciclo.
const TextAnalyzer = lazy(() => import("../../App.jsx").then((m) => ({ default: m.Analyzer })));
const MindMapStudio = lazy(() => import("../../App.jsx").then((m) => ({ default: m.MindMap })));
// Contexto de negócio que o Estúdio usa para os exemplos e prompts saírem no
// tom da To Do Green (transportadora elétrica), em vez do exemplo genérico.
const negocioTDG = {
  id: "todogreen",
  name: "To Do Green",
  segment: "Transportadora rodoviária 100% elétrica (B2B)",
  goal: "Transporte de carga com frota elétrica, foco em ESG e redução de CO2",
  focusAreas: "logística, frota elétrica, ESG, transporte de cargas",
};
const ClientRequestsPage = lazy(() => import("./pages/ClientRequestsPage.jsx"));
const ReportsPage = lazy(() => import("./pages/ReportsPage.jsx"));
const TripViabilityPage = lazy(() => import("./pages/TripViabilityPage.jsx"));
const DealDeskPage = lazy(() => import("./pages/DealDeskPage.jsx"));
const DocumentVaultPage = lazy(() => import("./pages/DocumentVaultPage.jsx"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage.jsx"));
const BusinessConnectorsPage = lazy(() => import("./pages/BusinessConnectorsPage.jsx"));
const CommercialPanelPage = lazy(() => import("./pages/CommercialPanelPage.jsx"));
const SystemHealthPage = lazy(() => import("./pages/SystemHealthPage.jsx"));
const TodoGreenWorkspace = lazy(() => import("./TodoGreenWorkspace.jsx"));
const TodoGreenIntelligenceHub = lazy(() => import("./TodoGreenIntelligenceHub.jsx"));
const TodoGreenGuides = lazy(() => import("./TodoGreenGuides.jsx"));
const FinancePage = lazy(() => import("./pages/FinancePage.jsx"));
const OperationsPage = lazy(() => import("./pages/OperationsPage.jsx"));
const RoteirizacaoPage = lazy(() => import("./pages/RoteirizacaoPage.jsx"));
const ChargingPointsPage = lazy(() => import("./pages/ChargingPointsPage.jsx"));
const ChargingSessionsPage = lazy(() => import("./pages/ChargingSessionsPage.jsx"));
const ChargerReservationsPage = lazy(() => import("./pages/ChargerReservationsPage.jsx"));
const ChargingBillingPage = lazy(() => import("./pages/ChargingBillingPage.jsx"));
const EnergyPage = lazy(() => import("./pages/EnergyPage.jsx"));
const OperationEnginePage = lazy(() => import("./pages/OperationEnginePage.jsx"));
const GreenPayAdminPage = lazy(() => import("./pages/GreenPayAdminPage.jsx"));
const OccurrencesPage = lazy(() => import("./pages/OccurrencesPage.jsx"));
const QualityPage = lazy(() => import("./pages/QualityPage.jsx"));
// TDG LegalPage (antigo) permanece disponível como fallback do fluxo legado
// (aba "Fluxo antigo" dentro do LegalHub, se voltar). O menu do ERP passou
// a montar a Central Jurídica nova (`LegalHub`) por cima da mesma tabela
// canônica `todogreen_legal_records`. UM Jurídico só.
const LegalPage = lazy(() => import("./pages/LegalPage.jsx")); // eslint-disable-line no-unused-vars
const LegalHub = lazy(() => import("../legal/LegalHub.jsx"));
const GovernancePage = lazy(() => import("./pages/GovernancePage.jsx"));
const TransactionalSpinePage = lazy(() => import("./pages/TransactionalSpinePage.jsx"));
const EnterpriseAreaPage = lazy(() => import("./pages/EnterpriseAreaPage.jsx"));
const RasciMatrixPage = lazy(() => import("./pages/RasciMatrixPage.jsx"));
const FluxosPage = lazy(() => import("./pages/FluxosPage.jsx"));
const ErpManualPage = lazy(() => import("./pages/ErpManualPage.jsx"));
const ClientActivationPage = lazy(() => import("./ClientActivationPage.jsx"));
const DriverFleetCenterPage = lazy(() => import("./pages/DriverFleetCenterPage.jsx"));
// Páginas das 6 lacunas dos 26 blocos (aprimoramentos aditivos).
const TenantAccessPage = lazy(() => import("./pages/TenantAccessPage.jsx"));
const CorporateAccountPage = lazy(() => import("./pages/CorporateAccountPage.jsx"));
const RoamingPage = lazy(() => import("./pages/RoamingPage.jsx"));
const EnergyPeakSavingsPage = lazy(() => import("./pages/EnergyPeakSavingsPage.jsx"));
const AlertQueuePage = lazy(() => import("./pages/AlertQueuePage.jsx"));
const GreenmobRentalPage = lazy(() => import("./pages/GreenmobRentalPage.jsx"));
const SaasBillingPage = lazy(() => import("./pages/SaasBillingPage.jsx"));
// Páginas do roadmap P0/P1/P2 (rodada seguinte, também aditiva).
const GroupEntitiesPage = lazy(() => import("./pages/GroupEntitiesPage.jsx"));
const OcppConsolePage = lazy(() => import("./pages/OcppConsolePage.jsx"));
const GreenOnAppPage = lazy(() => import("./pages/GreenOnAppPage.jsx"));
const PhysicalSafetyPage = lazy(() => import("./pages/PhysicalSafetyPage.jsx"));

export default function LogisticsVertical({ db, update, setToast, access = {}, authHeaders }) {
  const [path, setPath] = useState(todoGreenPath());
  const [query, setQuery] = useState("");
  // O modo de navegação (por área × por funcionalidade) é preferência de quem
  // usa: persiste igual ao menu oculto, para não voltar a "área" a cada refresh.
  // Menu em acordeão (pedido da titular): áreas na frente; dentro de cada
  // área, o segundo nível com as funcionalidades dela. A área da tela atual
  // abre sozinha; as que a pessoa abrir à mão ficam na sessão.
  // Green Tech Core vem ABERTA por padrão para as 11 telas do roadmap
  // aparecerem sem depender de expandir um chevron (pedido da titular:
  // "eu acesso a plataforma e não vejo as alterações").
  const [areasAbertas, setAreasAbertas] = useState(() => new Set(["green-tech-core"]));
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
  // Personalizar o menu (pedido da titular: "quero que o usuário possa
  // selecionar o que deixar disponível"). A pessoa marca quais áreas aparecem;
  // desmarcadas somem da lateral (mas continuam acessíveis por link direto e
  // pela busca). Guardado por navegador. Vazio no storage = tudo visível.
  const [personalizando, setPersonalizando] = useState(false);
  const [areasOcultas, setAreasOcultas] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("todogreen-menu-areas-ocultas") || "[]");
      return new Set(Array.isArray(salvo) ? salvo : []);
    } catch { return new Set(); }
  });
  const alternarAreaVisivel = useCallback((id) => {
    setAreasOcultas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      try { localStorage.setItem("todogreen-menu-areas-ocultas", JSON.stringify([...proximo])); } catch { /* ok */ }
      return proximo;
    });
  }, []);
  // Itens (submenus) ocultos por usuária — ex.: "Aceito essa viagem?". Mesma
  // régua das áreas, mas por página. Persistido só neste navegador/usuária.
  const [itensOcultos, setItensOcultos] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("todogreen-menu-itens-ocultos") || "[]");
      return new Set(Array.isArray(salvo) ? salvo : []);
    } catch { return new Set(); }
  });
  const alternarItemVisivel = useCallback((id) => {
    setItensOcultos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      try { localStorage.setItem("todogreen-menu-itens-ocultos", JSON.stringify([...proximo])); } catch { /* ok */ }
      return proximo;
    });
  }, []);
  // Ordem PERSONALIZADA das áreas do menu (por usuário, persistida). Vazio =
  // ordem canônica do PRIMARY_NAVIGATION. Ao mover, salvamos a lista INTEIRA
  // (todas as áreas na ordem que a pessoa escolheu) — quando uma área nova
  // aparece no catálogo, ela vai para o fim automaticamente.
  const [areasOrdem, setAreasOrdem] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem("todogreen-menu-areas-ordem") || "[]");
      return Array.isArray(salvo) ? salvo : [];
    } catch { return []; }
  });
  const salvarOrdem = useCallback((lista) => {
    try { localStorage.setItem("todogreen-menu-areas-ordem", JSON.stringify(lista)); } catch { /* ok */ }
  }, []);
  const moverArea = useCallback((id, direcao) => {
    setAreasOrdem((atual) => {
      const idsCanonicos = PRIMARY_NAVIGATION.map((a) => a.id);
      // Se a pessoa ainda não personalizou, começamos da ordem canônica —
      // assim o primeiro clique já vira uma lista completa e persistente.
      const base = atual.length ? atual.filter((x) => idsCanonicos.includes(x)) : idsCanonicos.slice();
      for (const canon of idsCanonicos) if (!base.includes(canon)) base.push(canon);
      const idx = base.indexOf(id);
      if (idx < 0) return atual;
      const alvo = idx + direcao;
      if (alvo < 0 || alvo >= base.length) return atual;
      const proximo = base.slice();
      [proximo[idx], proximo[alvo]] = [proximo[alvo], proximo[idx]];
      salvarOrdem(proximo);
      return proximo;
    });
  }, [salvarOrdem]);
  const restaurarOrdem = useCallback(() => {
    setAreasOrdem([]);
    try { localStorage.removeItem("todogreen-menu-areas-ordem"); } catch { /* ok */ }
  }, []);
  const areasOrdenadas = useMemo(() => {
    if (!areasOrdem.length) return PRIMARY_NAVIGATION;
    const idsCanonicos = PRIMARY_NAVIGATION.map((a) => a.id);
    const listaValida = areasOrdem.filter((id) => idsCanonicos.includes(id));
    const emOrdem = listaValida
      .map((id) => PRIMARY_NAVIGATION.find((a) => a.id === id))
      .filter(Boolean);
    const resto = PRIMARY_NAVIGATION.filter((a) => !listaValida.includes(a.id));
    return [...emOrdem, ...resto];
  }, [areasOrdem]);
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
  const sairPorInatividade = useCallback(() => {
    endSession();
    window.location.assign("/");
  }, []);
  useSaidaPorInatividade(allowed ? sairPorInatividade : null);
  const role = allowed ? remoteAccess.role || "" : "";
  const page = todoGreenRouteToPage(path);
  const secaoDeCadastro = secaoDaRota(path);
  const primaryNavigation = navigationFor(page, secaoDeCadastro);
  // Ao navegar para uma área, abre o grupo dela no menu (preserva o
  // comportamento antigo de "a área da tela atual vem aberta"), mas sem travar:
  // o usuário ainda pode recolher pelo chevron, porque o efeito só dispara
  // quando a ÁREA muda, não a cada render.
  useEffect(() => {
    // abrirArea devolve o MESMO Set quando a área já está aberta, então o React
    // descarta o render — não há cascata apesar do aviso do lint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (primaryNavigation?.id) abrirArea(primaryNavigation.id);
  }, [primaryNavigation?.id, abrirArea]);
  const isOverview = page === "dashboard";
  const isWorkCenter = page === "espaco";
  const activeManagement = MANAGEMENT_TOOLS.find((item) => item.id === page) || null;
  const currentPage = activeManagement || MODULE_IMPLEMENTATION[page] || MODULE_IMPLEMENTATION.dashboard;
  // A permissão da tela é conferida AQUI, na rota, e não só no menu: o menu
  // esconde o botão, mas voltar no histórico, atualizar ou digitar a URL
  // chegam à tela sem passar por ele. A fonte é a mesma que o menu usa.
  const permissaoNecessaria = activeManagement ? activeManagement.permission : permissaoDaPagina(page);
  // A Central de Integrações é invisível para todos e só abre no perfil de
  // desenvolvedor (pedido da titular). A checagem ignora "*" e owner/admin de
  // propósito — daí `ehPerfilDesenvolvedor` e não a permissão comum da tela.
  const ehDev = ehPerfilDesenvolvedor(role, remoteAccess.permissions);
  const podeVerPagina = page === "integracoes"
    ? ehDev
    : podeAcessarFuncionalidade(role, remoteAccess.permissions, permissaoNecessaria);
  // Lazy-load WorkCenterV2 somente quando necessário (ARQ-01 otimização)
  useEffect(() => {
    if (isWorkCenter && podeVerPagina) {
      import("./LogisticsVerticalWorkCenterV2.js").catch((err) => console.error("Falha ao carregar Work Center:", err));
    }
  }, [isWorkCenter, podeVerPagina]);
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
    erros: errosDosRegistros,
    desatualizado: registrosDesatualizados,
    recarregar: recarregarRegistros,
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
  // Pendências acessíveis de qualquer tela (Onda 2): o Decision Center era
  // calculado só dentro da home e evaporava quando a pessoa saía dela. Aqui ele
  // vira um botão no cabeçalho, com o número no selo, para "o que precisa de mim
  // agora" nunca ficar a um retorno-à-home de distância.
  const decisao = useMemo(
    () => buildTodoGreenDecisionCenter({ data: verticalData, dashboard, tasks: db?.tasks || [] }),
    [verticalData, dashboard, db?.tasks],
  );
  const [pendenciasAbertas, setPendenciasAbertas] = useState(false);
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
          {/* O logo virou o retorno para o início a partir de qualquer tela: o
              texto do workspace + trilha + título + descrição saiu daqui a
              pedido da titular. O h1 e o parágrafo continuam no DOM como
              conteúdo acessível (sr-only) para o aria-labelledby="tdg-title"
              do <main> e para o leitor de tela ainda anunciar a página.
              Substituiu o ModuleBadge genérico numerado — a titular pediu o
              logo da marca To Do Green, não o símbolo do bloco 04. */}
          <button
            type="button"
            className="tdg-shell-logo"
            onClick={() => navigate("/todogreen/dashboard")}
            aria-label="Início — Painel To Do Green"
          >
            <img src="/logo-todo-green.png" alt="To Do Green" width="66" height="44" />
          </button>
          <h1 id="tdg-title" className="tdg-shell-sr-only">{currentPage.title}</h1>
          <p className="tdg-shell-sr-only">{currentPage.description}</p>
        </div>
        <div className="tdg-shell-actions">
          <TodoGreenProfile db={db} update={update} authHeaders={authHeaders} setToast={setToast} />
          {decisao.alerts.length > 0 && (
            <button className="tdg-shell-pendencias" type="button" onClick={() => setPendenciasAbertas(true)} aria-label={`Pendências — ${decisao.alerts.length} ponto(s) precisam de você`}>
              <ListChecks size={15} />Pendências<span className="tdg-shell-pendencias-selo">{decisao.alerts.length}</span>
            </button>
          )}
          <button className="tdg-shell-search" type="button" onClick={() => navigate("/todogreen/dashboard?ferramentas=1")}>
            <Search size={15} />Buscar ferramenta
          </button>
          <button
            className="tdg-shell-theme"
            type="button"
            title={db?.preferences?.theme === "dark" ? "Tema claro" : "Tema escuro"}
            aria-label={db?.preferences?.theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
            aria-pressed={db?.preferences?.theme === "dark"}
            onClick={() =>
              update((d) => ({
                ...d,
                preferences: {
                  ...d.preferences,
                  theme: d.preferences?.theme === "dark" ? "light" : "dark",
                },
              }))
            }
          >
            {db?.preferences?.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <details className="tdg-management-menu">
            <summary>Configurações</summary>
            <div data-tdg-management-tools="true">
              {MANAGEMENT_TOOLS
                // Projetos e tarefas não é configuração: já tem o cartão fixo
                // no topo do menu lateral. Aqui ficam só as ferramentas de
                // administração (integrações, usuários e acessos).
                .filter((item) => item.id !== "projects")
                // Integrações só aparece no menu para o perfil de desenvolvedor;
                // os demais itens seguem a permissão comum.
                .filter((item) => (item.id === "integracoes"
                  ? ehDev
                  : podeAcessarFuncionalidade(role, remoteAccess.permissions, item.permission)))
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
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Encerrar a sessão em TODOS os aparelhos? Quem estiver com esta conta aberta em qualquer lugar será desconectado.")) return;
                  await fetch("/api/auth/sessions", { method: "DELETE", headers: authHeaders?.() || {} }).catch(() => {});
                  endSession();
                  window.location.assign("/");
                }}
              >
                Sair de todos os aparelhos
              </button>
            </div>
          </details>
          <button
            className="tdg-shell-sair"
            type="button"
            onClick={() => {
              if (confirm("Sair da conta neste navegador? A sessão também é encerrada no servidor.")) {
                endSession();
                window.location.assign("/");
              }
            }}
          >
            <LogOut size={15} />Sair
          </button>
        </div>
      </header>

      {pendenciasAbertas && (
        <Modal title="Pendências — o que precisa de você agora" onClose={() => setPendenciasAbertas(false)}>
          <div className="tdg-pendencias-lista">
            {!decisao.alerts.length && <p className="tdg-pendencias-vazio">Nada aberto no momento. Sua operação está em dia.</p>}
            {decisao.alerts.map((alerta) => (
              <article className={`tdg-pendencia tom-${alerta.tone}`} key={alerta.id}>
                <div>
                  <strong>{alerta.title}</strong>
                  <small>{alerta.detail}</small>
                </div>
                {alerta.route && (
                  <button type="button" className="tdg-action" onClick={() => { setPendenciasAbertas(false); navigate(alerta.route); }}>
                    {alerta.action || "Abrir"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </Modal>
      )}

      <div className={`tdg-erp-layout${menuOculto ? " menu-oculto" : ""}`}>
        {menuOculto && (
          <button type="button" className="tdg-menu-mostrar" onClick={alternarMenu} aria-label="Mostrar menu lateral">
            <PanelLeftOpen size={16} />Menu
          </button>
        )}
        <aside className="tdg-erp-sidebar" hidden={menuOculto}>
          <div className="tdg-erp-sidebar-head">
            <div><strong>To Do Green</strong><small>Espaço corporativo</small></div>
            <div className="tdg-erp-sidebar-head-acoes">
              <button
                type="button"
                className={`tdg-menu-personalizar${personalizando ? " ativo" : ""}`}
                onClick={() => setPersonalizando((v) => !v)}
                aria-pressed={personalizando}
                aria-label="Escolher o que aparece e a ordem do menu"
                title="Escolher o que aparece e a ordem do menu"
              >
                <SlidersHorizontal size={15} />
              </button>
              <button type="button" className="tdg-menu-ocultar" onClick={alternarMenu} aria-label="Esconder menu lateral" title="Esconder menu">
                <PanelLeftClose size={16} />
              </button>
            </div>
          </div>
          {personalizando && (
            <div className="tdg-menu-personalizar-caixa">
              <p className="tdg-menu-personalizar-dica">
                Marque o que quer ver no menu; use ↑ ↓ para escolher a ordem. O que ficar desmarcado some daqui — mas continua no buscador e por link direto.
              </p>
              {areasOrdem.length > 0 && (
                <button type="button" className="tdg-menu-restaurar-ordem" onClick={restaurarOrdem}>
                  Restaurar ordem padrão
                </button>
              )}
            </div>
          )}
          {/* "Início": a titular sentiu falta de um botão de casa sempre à mão.
              "Principal" existe como área no meio da lista, mas de dentro de uma
              tela funda não havia o gesto óbvio de voltar ao painel. Este atalho
              fixo no topo leva sempre ao dashboard do ERP. */}
          <button
            type="button"
            className={`tdg-home-entry ${page === "dashboard" ? "active" : ""}`}
            onClick={() => navigate("/todogreen/dashboard")}
          >
            <House size={18} />
            <span><strong>Início</strong><small>Painel, indicadores e atalhos do ERP</small></span>
          </button>
          <button
            type="button"
            className={`tdg-work-entry ${isWorkCenter ? "active" : ""}`}
            onClick={() => navigate("/todogreen/espaco?ferramenta=tarefas")}
          >
            <ListTodo size={18} />
            <span><strong>Projetos e tarefas</strong><small>Boards, Kanban, Gantt e Workload</small></span>
          </button>
          {/* Verticais irmãs (Green On e Greenmob): quem opera nas três precisa
              trocar de ambiente sem digitar URL. A vertical de origem (To Do
              Green) preserva TODAS as suas telas; estes atalhos abrem apenas o
              shell específico de cada vertical. */}
          <div className="tdg-verticais-links" role="group" aria-label="Outras verticais da plataforma">
            <a href="/greenon" className="tdg-vertical-link">
              <strong>Green On</strong>
              <small>Recarga e energia — CRM, sites, operação</small>
            </a>
            <a href="/greenmob" className="tdg-vertical-link">
              <strong>Greenmob</strong>
              <small>Locação de veículos elétricos — CRM, frota, contratos</small>
            </a>
          </div>
          {/* Um menu só, do jeito que a titular pediu: as áreas na frente e,
              dentro de cada área, o segundo nível com todas as funcionalidades
              dela. A busca fica sempre à mão e, enquanto há termo digitado,
              mostra o resultado atravessando todas as áreas. */}
          <label className="tdg-sidebar-search">
            <Search size={15} />
            <input value={navigationQuery} onChange={(event) => setNavigationQuery(event.target.value)} placeholder="Buscar no menu" aria-label="Buscar funcionalidades" />
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
              {areasOrdenadas.map((item, idxNaLista) => {
                const ocultaDaLista = areasOcultas.has(item.id);
                // Fora do modo personalizar, área desmarcada não aparece.
                if (ocultaDaLista && !personalizando) return null;
                const ativa = primaryNavigation.id === item.id;
                // `aberta` vem SÓ do estado de abertas — não força a área ativa a
                // ficar aberta. Antes, `|| ativa` prendia aberta a área da tela
                // atual, então o chevron dela "abria mas não fechava". A área
                // ativa é auto-aberta ao navegar (efeito abaixo), o que pode ser
                // desfeito pelo chevron.
                const aberta = areasAbertas.has(item.id);
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
                  <div className={`tdg-nav-area${aberta ? " aberta" : ""}${personalizando && ocultaDaLista ? " oculta-preview" : ""}`} key={item.id}>
                    <div className="tdg-nav-area-cabeca">
                      {personalizando && (
                        <input
                          type="checkbox"
                          className="tdg-nav-area-check"
                          checked={!ocultaDaLista}
                          onChange={() => alternarAreaVisivel(item.id)}
                          aria-label={`Mostrar ${item.label} no menu`}
                          title={ocultaDaLista ? `Mostrar ${item.label}` : `Esconder ${item.label}`}
                        />
                      )}
                      {personalizando && (
                        <span className="tdg-nav-area-ordem" role="group" aria-label={`Reordenar ${item.label}`}>
                          <button
                            type="button"
                            className="tdg-nav-area-mover"
                            aria-label={`Mover ${item.label} para cima`}
                            title="Mover para cima"
                            disabled={idxNaLista === 0}
                            onClick={() => moverArea(item.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="tdg-nav-area-mover"
                            aria-label={`Mover ${item.label} para baixo`}
                            title="Mover para baixo"
                            disabled={idxNaLista === areasOrdenadas.length - 1}
                            onClick={() => moverArea(item.id, 1)}
                          >
                            ↓
                          </button>
                        </span>
                      )}
                      <button
                        type="button"
                        className={ativa ? "active" : ""}
                        onClick={() => {
                          if (personalizando) { alternarAreaVisivel(item.id); return; }
                          const temSubitens = paginas.length > 1 || (item.extras || []).length > 0;
                          // Já estou nesta área e ela tem subitens: clicar no NOME
                          // recolhe/expande. Antes o nome só ABRIA (abrirArea), então
                          // clicar de novo para fechar não fazia nada — só o chevrão
                          // de 14px fechava, e a titular clicava no nome. Como a área
                          // ativa só é auto-aberta quando o id MUDA (efeito abaixo),
                          // recolher aqui não é desfeito na sequência.
                          if (ativa && temSubitens) { alternarArea(item.id); return; }
                          navigate(item.route);
                          abrirArea(item.id);
                        }}
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
                    {(aberta || personalizando) && (paginas.length > 1 || (item.extras || []).length > 0) && (
                      <nav className="tdg-nav-area-itens" aria-label={`Seções de ${item.label}`}>
                        {paginas.length > 1 && paginas.map(([id, modulo]) => {
                          const itemOculto = itensOcultos.has(id);
                          if (itemOculto && !personalizando) return null;
                          if (personalizando) {
                            return (
                              <label className={`tdg-nav-item-personalizar${itemOculto ? " oculto-preview" : ""}`} key={id}>
                                <input type="checkbox" checked={!itemOculto} onChange={() => alternarItemVisivel(id)}
                                  aria-label={itemOculto ? `Mostrar ${modulo.navLabel || modulo.title}` : `Ocultar ${modulo.navLabel || modulo.title}`} />
                                {modulo.navLabel || modulo.title}
                              </label>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className={page === id ? "active" : ""}
                              onClick={() => navigate(modulo.route)}
                              key={id}
                            >
                              {modulo.navLabel || modulo.title}
                            </button>
                          );
                        })}
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
      {erroDosRegistros ? (
        <div className="tdg-alert" role="alert">
          <AlertTriangle size={18} />
          <span>Não foi possível carregar os dados agora. O que aparece abaixo pode estar incompleto.</span>
          <button type="button" className="tdg-action" onClick={() => { if (allowed) recarregarRegistros(); }}>Tentar novamente</button>
        </div>
      ) : errosDosRegistros && Object.keys(errosDosRegistros).length > 0 ? (
        <div className="tdg-alert" role="alert">
          <AlertTriangle size={18} />
          <span>Não foi possível carregar agora: <strong>{descreverAreasComErro(errosDosRegistros)}</strong>. Os números dessas áreas podem estar incompletos; as demais estão atualizadas.</span>
          <button type="button" className="tdg-action" onClick={() => { if (allowed) recarregarRegistros(); }}>Tentar novamente</button>
        </div>
      ) : registrosDesatualizados ? (
        <div className="tdg-alert" role="status">
          <AlertTriangle size={18} />
          <span>Mostrando os últimos dados carregados — a atualização mais recente falhou.</span>
          <button type="button" className="tdg-action" onClick={() => { if (allowed) recarregarRegistros(); }}>Atualizar</button>
        </div>
      ) : null}

      {!podeVerPagina && (
        <section className="tdg-panel tdg-sem-permissao" role="alert">
          <LockKeyhole size={20} />
          <div>
            <strong>Esta tela é restrita ao seu perfil.</strong>
            <p>Seu acesso não inclui {currentPage.title}. Fale com quem administra os acessos da To Do Green se precisar entrar aqui.</p>
            <button type="button" className="tdg-action" onClick={() => navigate("/todogreen/dashboard")}>Voltar ao painel</button>
          </div>
        </section>
      )}
      {podeVerPagina && (<>
      {page === "dashboard" && <ErpHome role={role} user={db?.user || {}} data={verticalData} dashboard={dashboard} tasks={db?.tasks || []} products={LOGISTICS_PRODUCTS} preferences={db?.preferences?.todoGreenHome} onSave={saveHomePreferences} onNavigate={navigate} />}
      {/* Espaço de trabalho é a dona única de /espaco e do link legado
          /central-trabalho. O alias é resolvido antes desta renderização. */}
      {["espaco", "visualizacoes", "agentes-funcoes"].includes(page) && (
        <Suspense fallback={<section className="tdg-panel">Abrindo o espaço de trabalho...</section>}>
          <TodoGreenWorkspace
            key={`${page}:${workspaceToolFromPath(path)}`}
            db={db}
            update={update}
            verticalData={verticalData}
            setToast={setToast}
            onNavigate={navigate}
            authHeaders={authHeaders}
            mostrarIntegracoes={ehDev}
            initialTool={page === "visualizacoes" ? "visoes" : page === "agentes-funcoes" ? "agentes" : workspaceToolFromPath(path)}
          />
        </Suspense>
      )}
      {page === "dashboards" && <Suspense fallback={<section className="tdg-panel">Carregando seus painéis...</section>}><DashboardBuilderPage authHeaders={authHeaders} summary={dashboard} data={registros} setToast={setToast} /></Suspense>}
      {page === "metas" && <Suspense fallback={<section className="tdg-panel">Carregando metas...</section>}><GoalsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "performance-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando performance comercial...</section>}><SalesPerformancePage authHeaders={authHeaders} onNavigate={navigate} /></Suspense>}
      {page === "playbook-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando playbook comercial...</section>}><TodoGreenGuides mode="playbook" onNavigate={navigate} /></Suspense>}
      {page === "solicitacoes" && <Suspense fallback={<section className="tdg-panel">Carregando solicitações...</section>}><ClientRequestsPage authHeaders={authHeaders} setToast={setToast} currentUserId={db?.user?.id} clientes={clientes} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} /></Suspense>}
      {page === "cadastros" && <Suspense fallback={<section className="tdg-panel">Carregando cadastros...</section>}><ErpRegistriesPage registros={registros} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} secao={secaoDeCadastro} areaLabel={AREA_DO_CADASTRO[secaoDeCadastro] ? primaryNavigation.label : ""} /></Suspense>}
      {page === "implantacao" && (
        <Suspense fallback={<section className="tdg-panel">Carregando implantação...</section>}>
          <ClientActivationPage db={db} update={update} authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "estoque" && <Suspense fallback={<section className="tdg-panel">Carregando estoque...</section>}><StockPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "compras" && <Suspense fallback={<section className="tdg-panel">Carregando compras...</section>}><PurchasingPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "fiscal" && <Suspense fallback={<section className="tdg-panel">Carregando fiscal...</section>}><FiscalPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "tesouraria" && <Suspense fallback={<section className="tdg-panel">Carregando a tesouraria...</section>}><TreasuryPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "greenpay" && <Suspense fallback={<section className="tdg-panel">Carregando o GreenPay...</section>}><GreenPayAdminPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
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
            authHeaders={authHeaders}
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
      {page === "clientes" && <Suspense fallback={<section className="tdg-panel">Carregando clientes...</section>}><ClientsPage authHeaders={authHeaders} opportunities={verticalData.opportunities} contracts={registros.contracts} operations={registros.operations} financial={registros.financial} tasks={db?.tasks || []} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} onNavigate={navigate} setToast={setToast} currentUserId={db?.user?.id} remetenteNome={db?.user?.name || ""} assinaturaEmail={db?.preferences?.assinaturaEmail || ""} espacoId={remoteAccess.ownerId || ""} onClientesChange={setClientes} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} onCompletarTarefa={(taskId) => update?.((current) => ({ ...current, tasks: (current.tasks || []).map((t) => t.id === taskId ? { ...t, status: "Concluído" } : t) }))} /></Suspense>}
      {page === "oportunidades" && <Suspense fallback={<section className="tdg-panel">Carregando oportunidades...</section>}><OpportunitiesPage currentUserId={db?.user?.id} espacoId={remoteAccess.ownerId || ""} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} clients={clientes} opportunities={verticalData.opportunities} scenarios={verticalData.pricingScenarios} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} authHeaders={authHeaders} onCreate={(registro) => criar("opportunities", registro)} onUpdate={(id, alteracoes) => atualizar("opportunities", id, alteracoes)} onDelete={(id) => arquivar("opportunities", id)} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "funil" && <Suspense fallback={<section className="tdg-panel">Carregando o funil...</section>}><SalesFunnelPage opportunities={verticalData.opportunities} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "estudio-criativo" && <Suspense fallback={<section className="tdg-panel">Carregando o estúdio...</section>}><div className="tdg-page tdg-estudio"><CreativeToolkit business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "midia" && <Suspense fallback={<section className="tdg-panel">Carregando a mídia...</section>}><div className="tdg-page tdg-estudio"><MediaStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "editor-codigo" && <Suspense fallback={<section className="tdg-panel">Carregando o editor...</section>}><div className="tdg-page tdg-estudio"><CodeStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "analise-texto" && <Suspense fallback={<section className="tdg-panel">Carregando a análise...</section>}><div className="tdg-page tdg-estudio"><TextAnalyzer db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "mapa-ideias" && <Suspense fallback={<section className="tdg-panel">Carregando o mapa...</section>}><div className="tdg-page tdg-estudio"><MindMapStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "propostas" && <ProposalPanel data={verticalData} criar={criar} atualizar={atualizar} pedidosDeAprovacao={pedidosDeAprovacao} setToast={setToast} />}
      {page === "precificacao" && <PricingPanel key={`${produtoDaRota(path) || "nova"}:${new URLSearchParams(path.split("?")[1] || "").get("opportunity") || "nova"}`} role={role} criar={criar} db={db} authHeaders={authHeaders} setToast={setToast} opportunities={verticalData.opportunities} />}
      {page === "esg" && <EsgPanel dashboard={dashboard} data={verticalData} onNavigate={navigate} />}
      {page === "regua" && (
        <Suspense fallback={<section className="tdg-panel">Carregando parâmetros do simulador...</section>}>
          <PricingParametersPanel authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "energia" && <Suspense fallback={<section className="tdg-panel">Carregando energia...</section>}><EnergyPage authHeaders={authHeaders} /></Suspense>}
      {page === "tenant-acessos" && <Suspense fallback={<section className="tdg-panel">Carregando perfis...</section>}><TenantAccessPage /></Suspense>}
      {page === "green-on-empresa" && <Suspense fallback={<section className="tdg-panel">Carregando conta corporativa...</section>}><CorporateAccountPage /></Suspense>}
      {page === "roaming-ocpi" && <Suspense fallback={<section className="tdg-panel">Carregando roaming...</section>}><RoamingPage /></Suspense>}
      {page === "energia-peak" && <Suspense fallback={<section className="tdg-panel">Carregando BESS e pico...</section>}><EnergyPeakSavingsPage /></Suspense>}
      {page === "fila-alertas" && <Suspense fallback={<section className="tdg-panel">Carregando fila de alertas...</section>}><AlertQueuePage /></Suspense>}
      {page === "greenmob-locacao" && <Suspense fallback={<section className="tdg-panel">Carregando Greenmob...</section>}><GreenmobRentalPage /></Suspense>}
      {page === "saas-billing" && <Suspense fallback={<section className="tdg-panel">Carregando billing...</section>}><SaasBillingPage /></Suspense>}
      {page === "core-grupo" && <Suspense fallback={<section className="tdg-panel">Carregando Core All Green...</section>}><GroupEntitiesPage /></Suspense>}
      {page === "ocpp-console" && <Suspense fallback={<section className="tdg-panel">Carregando OCPP...</section>}><OcppConsolePage /></Suspense>}
      {page === "green-on-app" && <Suspense fallback={<section className="tdg-panel">Carregando Green On App...</section>}><GreenOnAppPage /></Suspense>}
      {page === "seguranca-fisica" && <Suspense fallback={<section className="tdg-panel">Carregando segurança...</section>}><PhysicalSafetyPage /></Suspense>}
      {page === "central-esg" && (
        <Suspense fallback={<section className="tdg-panel">Carregando Central ESG...</section>}>
          <EsgCenter authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "produtos" && <Suspense fallback={<section className="tdg-panel">Carregando produtos...</section>}><EnterpriseAreaPage area="products" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {page === "motor-operacao" && <Suspense fallback={<section className="tdg-panel">Carregando o motor de HC e DRE...</section>}><OperationEnginePage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "planejamento" && <Suspense fallback={<section className="tdg-panel">Carregando planejamento...</section>}><EnterpriseAreaPage area="planning" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {/* O simulador de aceite tem tela própria de novo: ele nasceu em
          Financeiro → Custos, foi parar no rodapé do Planejamento e o menu
          "Aceite" apontava para Ordens de Serviço — na prática, sumiu. */}
      {page === "aceite-viagens" && <Suspense fallback={<section className="tdg-panel">Carregando o simulador de aceite...</section>}><TripViabilityPage authHeaders={authHeaders} /></Suspense>}
      {page === "operacoes" && <Suspense fallback={<section className="tdg-panel">Carregando operações...</section>}><OperationsPage operations={registros.operations} clients={clientes} contracts={registros.contracts} criar={criar} atualizar={atualizar} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "roteirizacao" && <Suspense fallback={<section className="tdg-panel">Carregando o mapa...</section>}><RoteirizacaoPage setToast={setToast} authHeaders={authHeaders} pontosProprios={registros.pontosRecarga} /></Suspense>}
      {page === "pontos-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando pontos de recarga...</section>}><ChargingPointsPage registros={registros.pontosRecarga} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} /></Suspense>}
      {page === "sessoes-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando sessões de recarga...</section>}><ChargingSessionsPage registros={registros.chargingSessions} pontos={registros.pontosRecarga} clientes={clientes} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "reservas-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando reservas...</section>}><ChargerReservationsPage registros={registros.chargerReservations} pontos={registros.pontosRecarga} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "cobranca-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando cobrança de recarga...</section>}><ChargingBillingPage regras={registros.chargingPrices} sessoes={registros.chargingSessions} clientes={clientes} criar={criar} arquivar={arquivar} setToast={setToast} /></Suspense>}
      {page === "motorista-frota" && <Suspense fallback={<section className="tdg-panel">Carregando frota e motoristas...</section>}><DriverFleetCenterPage authHeaders={authHeaders} operations={registros.operations} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "ocorrencias" && <Suspense fallback={<section className="tdg-panel">Carregando ocorrências...</section>}><OccurrencesPage operations={registros.operations} clients={clientes} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "ordens-servico" && <Suspense fallback={<section className="tdg-panel">Carregando ordens de serviço...</section>}><TransactionalSpinePage mode="service-orders" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "ciot" && <Suspense fallback={<section className="tdg-panel">Carregando CIOT...</section>}><TransactionalSpinePage mode="ciot" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "receita" && <Suspense fallback={<section className="tdg-panel">Carregando contas a receber...</section>}><FinancePage type="revenue" entries={registros.financial.filter((item) => item.tipo === "revenue")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "faturamento" && <Suspense fallback={<section className="tdg-panel">Carregando faturamento...</section>}><TransactionalSpinePage mode="billing" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "titulos" && <Suspense fallback={<section className="tdg-panel">Carregando títulos...</section>}><TransactionalSpinePage mode="titles" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "rateios" && <Suspense fallback={<section className="tdg-panel">Carregando rateios...</section>}><TransactionalSpinePage mode="costs" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "custos" && <Suspense fallback={<section className="tdg-panel">Carregando custos e margem...</section>}><FinancePage type="cost" entries={registros.financial.filter((item) => item.tipo === "cost")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "rasci" && <Suspense fallback={<section className="tdg-panel">Carregando matriz RASCI...</section>}><RasciMatrixPage /></Suspense>}
      {page === "fluxos" && <Suspense fallback={<section className="tdg-panel">Carregando fluxos...</section>}><FluxosPage onNavigate={navigate} /></Suspense>}
      {page === "manual" && <Suspense fallback={<section className="tdg-panel">Carregando manual do ERP...</section>}><ErpManualPage onNavigate={navigate} /></Suspense>}
      {page === "comissoes" && <Suspense fallback={<section className="tdg-panel">Carregando comissões...</section>}><FinancePage type="commission" entries={registros.financial.filter((item) => item.tipo === "commission")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "dp-rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP...</section>}><EnterpriseAreaPage area="dp" onNavigate={navigate} /></Suspense>}
      {page === "rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP/RH...</section>}><PeoplePage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "planner" && <Suspense fallback={<section className="tdg-panel">Carregando o Planner...</section>}><PlannerPage
        authHeaders={authHeaders}
        setToast={setToast}
        currentUserId={db?.user?.id}
        role={role}
        espacoId={remoteAccess.ownerId || ""}
        clientes={clientes}
        oportunidades={verticalData.opportunities}
        onNavigate={navigate}
        canonicalTasks={db?.tasks || []}
        onUpsertCanonicalTask={(tarefa, plano) => update?.((current) => {
          const tarefas = current.tasks || [];
          const rawId = tarefa.rawTaskId || tarefa.id;
          const existente = tarefas.find((item) => item.id === rawId)
            || tarefas.find((item) => item.canonicalTaskId && item.canonicalTaskId === tarefa.canonicalTaskId);
          const { clientId } = contextoComercialDaTarefa(tarefa);
          const cliente = clientes.find((item) => item.id === clientId);
          const canonica = aplicarEdicaoPlannerNaTarefa(tarefa, plano, existente || {}, {
            clientLabel: cliente?.name || cliente?.nome || existente?.clientLabel || "",
          });
          return {
            ...current,
            tasks: existente
              ? tarefas.map((item) => (item.id === existente.id ? canonica : item))
              : [canonica, ...tarefas],
          };
        })}
        onDeleteCanonicalTask={(taskId) => update?.((current) => ({
          ...current,
          tasks: (current.tasks || []).filter((item) => item.id !== taskId),
        }))}
        onDetachCanonicalPlanTasks={(planId) => update?.((current) => ({
          ...current,
          tasks: (current.tasks || []).map((item) => desvincularTarefaDoPlanner(item, planId)),
        }))}
      /></Suspense>}
      {page === "avancos" && <Suspense fallback={<section className="tdg-panel">Carregando os avanços da semana...</section>}><AvancosDaSemanaPage opportunities={verticalData.opportunities} comments={verticalData.comments} interactions={verticalData.interactions} onComment={(registro) => criar("comments", registro)} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "qualidade" && <Suspense fallback={<section className="tdg-panel">Carregando qualidade...</section>}><QualityPage registros={registros.quality} clients={clientes} operations={registros.operations} criar={criar} atualizar={atualizar} setToast={setToast} /></Suspense>}
      {page === "marketing" && <Suspense fallback={<section className="tdg-panel">Carregando inteligência de mercado...</section>}><TodoGreenIntelligenceHub verticalData={verticalData} onNavigate={navigate} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "juridico" && (
        <Suspense fallback={<section className="tdg-panel">Carregando jurídico...</section>}>
          <LegalHub
            db={db}
            update={update}
            business={db?.businesses?.find?.((b) => b.id === db?.activeBusiness) || null}
            setToast={setToast}
            authHeaders={authHeaders}
            tdgAvailable
            // Cada sub-item da sidebar do ERP aponta para /juridico?aba=xxx;
            // lemos a query aqui para abrir a Central na aba certa. Se não
            // vier query, o LegalHub cai no default (dashboard/solicitar).
            initialTab={(() => {
              if (typeof window === "undefined") return undefined;
              try {
                return new URL(window.location.href).searchParams.get("aba") || undefined;
              } catch {
                return undefined;
              }
            })()}
            viewer={{
              userId: db?.user?.id,
              name: db?.user?.name,
              // O jurídico canônico do TDG usa `compliance:manage` para saber
              // quem valida/aprova. Aqui traduzimos para o papel que a nova
              // UI entende (head_juridico = fila completa + aprovar).
              role: hasTodoGreenPermission(role, "compliance:manage", remoteAccess.permissions)
                ? "head_juridico"
                : hasTodoGreenPermission(role, "compliance:read", remoteAccess.permissions)
                  ? "juridico"
                  : "solicitante",
              isOwner: role === "owner",
            }}
          />
        </Suspense>
      )}
      {page === "indicadores" && <Suspense fallback={<section className="tdg-panel">Carregando indicadores...</section>}><EnterpriseAreaPage area="indicators" onNavigate={navigate} /></Suspense>}
      {page === "administracao" && <Suspense fallback={<section className="tdg-panel">Carregando administração...</section>}><EnterpriseAreaPage area="admin" onNavigate={navigate} /></Suspense>}
      {page === "relatorios" && <Suspense fallback={<section className="tdg-panel">Carregando relatórios...</section>}><ReportsPage dashboard={dashboard} data={verticalData} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "metodologia" && <MethodologyPanel authHeaders={authHeaders} setToast={setToast} />}
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
      {page === "conectores" && <Suspense fallback={<section className="tdg-panel">Carregando conectores...</section>}><BusinessConnectorsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "painel-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando painel comercial...</section>}><CommercialPanelPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "saude-sistema" && <Suspense fallback={<section className="tdg-panel">Carregando saúde do sistema...</section>}><SystemHealthPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {!Object.keys(MODULE_IMPLEMENTATION).includes(page) && !["central-trabalho", "custos", "comissoes"].includes(page) && <DashboardPanel data={verticalData} dashboard={dashboard} tasks={db?.tasks || []} onNavigate={navigate} />}

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
        aoAgir={() => { if (allowed) recarregarRegistros(); }}
      />
    </main>
  );
}
