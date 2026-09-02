import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CalendarDays,
  ClipboardList,
  Globe2,
  Megaphone,
  MessageSquareText,
  Receipt,
  ScanSearch,
  Shapes,
  Stethoscope,
  FlaskConical,
  Clapperboard,
  PenLine,
  Boxes,
  BriefcaseBusiness,
  CircleAlert,
  CircleHelp,
  Database,
  GanttChartSquare,
  GitBranch,
  LayoutDashboard,
  FileText,
  Network,
  Newspaper,
  MoreHorizontal,
  Plug,
  Plus,
  Sparkles,
  UserRoundSearch,
  Users,
  ListChecks,
  Workflow,
} from "lucide-react";
import {
  TODO_GREEN_WORKSPACE_TOOLS,
  buildTodoGreenWorkspaceSummary,
} from "./todoGreenWorkspaceDomain.js";
import { TODO_GREEN_AI_SPECIALISTS } from "./todoGreenAiSpecialists.js";

const ConnectedNotes = lazy(() => import("../notes/ConnectedNotes.jsx"));
const Documents = lazy(() => import("../documents/DocumentsScreen.jsx"));
const TodoGreenAutomations = lazy(() => import("./TodoGreenAutomations.jsx"));
const TodoGreenIntelligenceHub = lazy(() => import("./TodoGreenIntelligenceHub.jsx"));
const TodoGreenGuides = lazy(() => import("./TodoGreenGuides.jsx"));
const WorkStructure = lazy(() => import("../work/WorkStructure.jsx"));
const TasksScreen = lazy(() => import("../tasks/TasksScreen.jsx"));
const WorkViews = lazy(() => import("./pages/WorkViews.jsx"));
const DataBases = lazy(() => import("../databases/DataBasesScreen.jsx"));
const ProcessStudio = lazy(() => import("../processes/ProcessStudio.jsx"));
const CapacityPlanner = lazy(() => import("../resources/CapacityPlanner.jsx"));
const CanvasBoard = lazy(() => import("../canvas/CanvasBoard.jsx"));
// Reaproveitados do app, operando no negócio To Do Green (regra 5: não recriar).
const TodoGreenEspecialistas = lazy(() => import("./TodoGreenEspecialistas.jsx"));
const CorporateChat = lazy(() => import("../chat/CorporateChat.jsx"));
const Meetings = lazy(() => import("../meetings/Meetings.jsx"));
const DayPlanner = lazy(() => import("../planner/DayPlanner.jsx"));
const Quotes = lazy(() => import("../omnichannel/Quotes.jsx"));
const CreativeToolkit = lazy(() => import("../creative/CreativeToolkit.jsx"));
const PublicFormsStudio = lazy(() => import("../forms/PublicFormsStudio.jsx"));
const SitesScreen = lazy(() => import("../sites/SitesScreen.jsx"));
const AgentStudio = lazy(() => import("../agents/AgentStudio.jsx"));
const DiagramStudio = lazy(() => import("../diagrams/DiagramStudio.jsx"));
const QuickWhiteboard = lazy(() => import("../whiteboard/QuickWhiteboard.jsx"));
const MediaStudio = lazy(() => import("../media/MediaStudio.jsx"));
const DataLab = lazy(() => import("../analytics/DataLab.jsx"));

const TOOL_ICONS = {
  "visao-geral": LayoutDashboard,
  inteligencia: Newspaper,
  contatos: UserRoundSearch,
  notas: BookOpen,
  paginas: FileText,
  automacoes: Workflow,
  ajuda: CircleHelp,
  estrutura: Network,
  tarefas: ListChecks,
  visoes: GanttChartSquare,
  bases: Database,
  processos: GitBranch,
  capacidade: Users,
  "quadro-livre": Boxes,
  especialistas: Bot,
  chat: MessageSquareText,
  reunioes: ClipboardList,
  agenda: CalendarDays,
  orcamentos: Receipt,
  diagnostico: Stethoscope,
  marketing: Megaphone,
  captacao: ScanSearch,
  site: Globe2,
  agentes: Sparkles,
  diagramas: Shapes,
  "quadro-rapido": PenLine,
  midia: Clapperboard,
  laboratorio: FlaskConical,
};

const WORKSPACE_PRIMARY_TOOLS = Object.freeze([
  { id: "visao-geral", label: "Visão geral" },
  { id: "tarefas", label: "To Do" },
  { id: "estrutura", label: "Estrutura de trabalho" },
  { id: "visoes", label: "Visualizações e gráficos" },
  { id: "agentes", label: "Agentes e funções" },
]);

const WORKSPACE_PRIMARY_IDS = new Set(WORKSPACE_PRIMARY_TOOLS.map((item) => item.id));
const WORKSPACE_TOOL_IDS = new Set(TODO_GREEN_WORKSPACE_TOOLS.map((item) => item.id));
const workspaceTool = (value) => WORKSPACE_TOOL_IDS.has(value) ? value : "visao-geral";

// As 28 ferramentas do espaço vinham numa grade única — um paredão de botões
// caindo todos no mesmo lugar. Agrupadas por propósito, cada uma tem seu galho.
// Toda ferramenta que não estiver num grupo nomeado cai em "Outras", então
// nenhuma some quando o catálogo do domínio muda.
const TOOL_GROUPS = Object.freeze([
  { title: "Conhecimento e dados", ids: ["inteligencia", "contatos", "notas", "paginas", "bases", "laboratorio"] },
  { title: "Planejamento e execução", ids: ["estrutura", "tarefas", "visoes", "processos", "capacidade", "agenda"] },
  { title: "IA e automação", ids: ["especialistas", "agentes", "automacoes"] },
  { title: "Comunicação", ids: ["chat", "reunioes", "ajuda"] },
  { title: "Criação e presença", ids: ["marketing", "site", "captacao", "midia", "diagramas", "quadro-livre", "quadro-rapido", "orcamentos", "diagnostico"] },
]);

const LoadingTool = () => <section className="tdg-space-loading">Abrindo a ferramenta...</section>;

// Para telas do app geral que exigem um kit de área: aqui ele não existe.
const FerramentaNula = () => null;

// #84: a tela de agentes só mostrava o estúdio de criação — a titular via "só
// vem criar agente e não funciona" e não achava os prontos. Os agentes prontos
// da To Do Green já existem (os especialistas do motor de IA) e já operam sobre
// os dados reais; aqui eles aparecem para lançar, e o estúdio de criação segue
// abaixo para quem quiser um agente sob medida.
function TodoGreenAgentes({ onOpenTool, commonProps }) {
  const prontos = Object.entries(TODO_GREEN_AI_SPECIALISTS).map(([nome, dados]) => ({ nome, ...dados }));
  return (
    <div className="tdg-agentes">
      <section className="tdg-agentes-prontos">
        <header>
          <span className="tdg-kicker">JÁ PRONTOS · TO DO GREEN</span>
          <h2>Agentes que já entendem a operação</h2>
          <p>
            Cada um lê os dados reais da To Do Green (carteira, preços, frota, ESG, fiscal) e
            responde na sua área. Clique para conversar — não precisa criar nada.
          </p>
        </header>
        <div className="tdg-agentes-grid">
          {prontos.map((agente) => (
            <button type="button" key={agente.nome} onClick={() => onOpenTool("especialistas")}>
              <span className="tdg-agentes-ic"><Bot size={18} /></span>
              <b>{agente.nome}</b>
              <small>{agente.instrucao.split(".")[0]}.</small>
            </button>
          ))}
        </div>
      </section>
      <section className="tdg-agentes-custom">
        <header>
          <span className="tdg-kicker">SOB MEDIDA</span>
          <h3>Criar um agente próprio</h3>
          <p>Precisa de algo específico? Monte um agente novo — ele usa a mesma IA conectada em Integrações.</p>
        </header>
        <AgentStudio {...commonProps} />
      </section>
    </div>
  );
}

// #88: o ERP é exclusivo da To Do Green. O antigo "diagnóstico" trazia o
// seletor genérico de segmento e pacotes herdado do Seu Funcionário — não faz
// sentido perguntar o ramo de quem já é uma transportadora 100% elétrica. Aqui
// a identidade é fixa e o aprofundamento vai para o dossiê real do negócio.
function NegocioTodoGreen({ onNavigate }) {
  return (
    <section className="tdg-negocio-exclusivo">
      <span className="tdg-kicker">ERP EXCLUSIVO</span>
      <h2>Este ERP é da To Do Green</h2>
      <p>
        Nada de escolher segmento ou montar pacote: o sistema já nasce para a
        operação de uma <strong>transportadora rodoviária 100% elétrica</strong>.
        Todas as telas — CRM, precificação, frota, fiscal, financeiro — vêm
        prontas para esse negócio.
      </p>
      <ul className="tdg-negocio-exclusivo-lista">
        <li>Segmento fixo: transporte rodoviário de cargas (logística verde).</li>
        <li>Funções e agentes já configurados para a To Do Green.</li>
        <li>O que a IA precisa saber do negócio fica no dossiê, não num setup genérico.</li>
      </ul>
      <div className="tdg-negocio-exclusivo-acoes">
        <button type="button" className="tdg-action" onClick={() => onNavigate?.("/todogreen/sobre-o-negocio")}>
          Abrir o dossiê do negócio <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function WorkspaceOverview({ summary, onOpenTool, onNavigate }) {
  const metricCards = [
    ["Clientes", summary.clients, () => onNavigate("/todogreen/clientes")],
    ["Oportunidades abertas", summary.openOpportunities, () => onNavigate("/todogreen/oportunidades")],
    ["Tarefas abertas", summary.openTasks, () => onNavigate("/todogreen/espaco?ferramenta=tarefas")],
    ["Casos em andamento", summary.openCases, () => onOpenTool("processos")],
  ];

  const toolCounts = {
    inteligencia: summary.news + summary.rfqs + summary.supplierLinks,
    contatos: summary.contacts,
    notas: summary.notes,
    paginas: summary.pages,
    automacoes: "Ao vivo",
    ajuda: "Abrir",
    estrutura: summary.workNodes,
    bases: summary.bases,
    processos: summary.processes,
    capacidade: summary.resources,
    "quadro-livre": summary.boards,
    especialistas: "Perguntar",
    chat: "Conversar",
    reunioes: "Abrir",
    agenda: "Hoje",
    orcamentos: "Abrir",
    diagnostico: "Abrir",
    marketing: "Abrir",
    captacao: "Abrir",
    site: "Abrir",
    agentes: "Abrir",
    diagramas: "Abrir",
    "quadro-rapido": "Abrir",
    midia: "Abrir",
    laboratorio: "Abrir",
  };

  const routineLinks = [
    ["Clientes e contatos", "Contas, decisores, histórico e inteligência", "/todogreen/clientes"],
    ["Oportunidades", "Pipeline, forecast e próximos passos", "/todogreen/oportunidades"],
    ["Precificação", "Custos, margem e preço recomendado", "/todogreen/precificacao"],
    ["Propostas", "Condições, aprovação e contratos", "/todogreen/propostas"],
    ["Operações", "Rotas, viagens, entregas e ocorrências", "/todogreen/operacoes"],
    ["ESG", "Green Score, emissões, método e evidências", "/todogreen/central-esg"],
    ["Relatórios", "Leitura executiva comercial, operacional e ambiental", "/todogreen/relatorios"],
    ["Projetos e tarefas", "To Do, Kanban, cronograma, marcos e dependências", "/todogreen/espaco?ferramenta=tarefas"],
  ];

  return (
    <div className="tdg-space-overview">
      <section className="tdg-space-hero">
        <div>
          <h2>Resumo de hoje</h2>
        </div>
        <button type="button" className="tdg-action" onClick={() => onOpenTool("notas")}>
          <Plus size={17} /> Abrir notas
        </button>
      </section>

      <section className="tdg-space-metrics" aria-label="Resumo do espaço">
        {metricCards.map(([label, value, action]) => (
          <button type="button" onClick={action} key={label}>
            <span>{label}</span><strong>{value}</strong><ArrowRight size={16} />
          </button>
        ))}
      </section>

      {/* #77: descobribilidade. A titular não achava agentes, comunicação
          interna nem onde conectar a chave da IA. Aqui ficam à mão. */}
      <section className="tdg-space-descubra" aria-label="Atalhos para agentes, comunicação e IA">
        <span className="tdg-kicker">DESCUBRA RÁPIDO</span>
        <div>
          <button type="button" onClick={() => onOpenTool("agentes")}>
            <span className="tdg-space-descubra-ic"><Bot size={18} /></span>
            <b>Agentes de IA</b>
            <small>Prontos da To Do Green e os que você criar</small>
          </button>
          <button type="button" onClick={() => onOpenTool("especialistas")}>
            <span className="tdg-space-descubra-ic"><Sparkles size={18} /></span>
            <b>Perguntar aos especialistas</b>
            <small>Comercial, fiscal, ESG e operação</small>
          </button>
          <button type="button" onClick={() => onOpenTool("chat")}>
            <span className="tdg-space-descubra-ic"><MessageSquareText size={18} /></span>
            <b>Comunicação interna</b>
            <small>Converse com o time no espaço</small>
          </button>
          <button type="button" onClick={() => onOpenTool("contatos")}>
            <span className="tdg-space-descubra-ic"><UserRoundSearch size={18} /></span>
            <b>Contatos e e-mail</b>
            <small>Pessoas, canais e envio direto</small>
          </button>
          <button type="button" onClick={() => onNavigate("/todogreen/integracoes")}>
            <span className="tdg-space-descubra-ic"><Plug size={18} /></span>
            <b>Conectar Claude / GPT</b>
            <small>Sua própria chave de IA em Integrações</small>
          </button>
        </div>
      </section>

      {(summary.overdueTasks > 0 || summary.openCases > 0) && (
        <section className="tdg-space-attention">
          <CircleAlert size={19} />
          <div>
            <strong>Precisa de atenção</strong>
            <span>
              {summary.overdueTasks > 0 ? `${summary.overdueTasks} tarefa(s) atrasada(s)` : "Nenhuma tarefa atrasada"}
              {summary.openCases > 0 ? ` · ${summary.openCases} caso(s) em andamento` : ""}
            </span>
          </div>
          <button type="button" onClick={() => onNavigate("/todogreen/espaco?ferramenta=tarefas")}>Abrir tarefas</button>
        </section>
      )}

      {/* O "pipeline de clientes" (seletor de Cliente/Oportunidade) saiu da Visão
          geral do Espaço a pedido da titular: carteira e oportunidades moram no
          CRM. A Visão geral fica com o trabalho — resumo, atenção e ferramentas. */}
      <section className="tdg-space-tools">
        <header><div><span className="tdg-kicker">FERRAMENTAS</span><h3>Um lugar, várias formas de trabalhar</h3></div></header>
        {(() => {
          const porId = new Map(
            TODO_GREEN_WORKSPACE_TOOLS.filter((tool) => tool.id !== "visao-geral").map((tool) => [tool.id, tool]),
          );
          const agrupadas = new Set();
          const grupos = TOOL_GROUPS.map((grupo) => ({
            title: grupo.title,
            tools: grupo.ids.map((id) => porId.get(id)).filter(Boolean),
          })).filter((grupo) => grupo.tools.length > 0);
          grupos.forEach((grupo) => grupo.tools.forEach((tool) => agrupadas.add(tool.id)));
          const outras = [...porId.values()].filter((tool) => !agrupadas.has(tool.id));
          if (outras.length) grupos.push({ title: "Outras", tools: outras });
          const cartao = (tool) => {
            const Icon = TOOL_ICONS[tool.id] || BriefcaseBusiness;
            return (
              <button type="button" onClick={() => onOpenTool(tool.id)} key={tool.id}>
                <span className="tdg-space-tool-icon"><Icon size={20} /></span>
                <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
                <b>{toolCounts[tool.id]}</b><ArrowRight size={16} />
              </button>
            );
          };
          return grupos.map((grupo) => (
            <div className="tdg-space-tool-group" key={grupo.title}>
              <h4>{grupo.title}</h4>
              <div>{grupo.tools.map(cartao)}</div>
            </div>
          ));
        })()}
      </section>

      <section className="tdg-space-routines">
        <header><div><span className="tdg-kicker">ATALHOS</span><h3>As áreas do dia a dia</h3></div></header>
        <div>{routineLinks.map(([label, description, route]) => <button type="button" onClick={() => onNavigate(route)} key={route}><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={16} /></button>)}</div>
      </section>
    </div>
  );
}

export default function TodoGreenWorkspace({
  db,
  update,
  verticalData,
  setToast,
  onNavigate,
  authHeaders,
  initialTool = "visao-geral",
}) {
  const [tool, setTool] = useState(() => workspaceTool(initialTool));
  const [focusNoteId] = useState("");
  const [focusPageId, setFocusPageId] = useState("");
  useEffect(() => setTool(workspaceTool(initialTool)), [initialTool]);
  // "Mais funções" é um menu controlado (não um <details> nativo, que a
  // titular reportou não abrir no ambiente publicado). Estado explícito +
  // fechar ao clicar fora e ao escolher uma função.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const aoClicarFora = (event) => {
      if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false);
    };
    const aoTeclar = (event) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [moreOpen]);
  const business = useMemo(() => ({ id: "todogreen", name: "To Do Green" }), []);
  const summary = useMemo(
    () => buildTodoGreenWorkspaceSummary({ db, verticalData, businessId: business.id }),
    [db, verticalData, business.id],
  );


  const openTool = (nextTool) => {
    setMoreOpen(false);
    if (nextTool === "paginas") setFocusPageId("");
    // As jornadas principais têm URL própria, para que um atalho, atualização
    // ou recarregamento abra a ferramenta certa, sem dividir uma mesma rota
    // entre duas telas concorrentes.
    const directRoutes = {
      "visao-geral": "/todogreen/espaco",
      tarefas: "/todogreen/espaco?ferramenta=tarefas",
      estrutura: "/todogreen/espaco?ferramenta=estrutura",
      visoes: "/todogreen/visualizacoes",
      agentes: "/todogreen/agentes",
    };
    if (directRoutes[nextTool] && nextTool !== tool) {
      onNavigate?.(directRoutes[nextTool]);
      return;
    }
    setTool(nextTool);
  };

  const commonProps = { db, update, business, setToast };

  return (
    <section className="tdg-space">
      <header className="tdg-space-toolbar">
        <nav className="tdg-space-tabs" aria-label="Jornadas principais do espaço de trabalho">
          {WORKSPACE_PRIMARY_TOOLS.map((item) => {
            const Icon = TOOL_ICONS[item.id] || BriefcaseBusiness;
            return (
              <button type="button" className={tool === item.id ? "active" : ""} onClick={() => openTool(item.id)} key={item.id}>
                <Icon size={16} /> {item.label}
              </button>
            );
          })}
          <button type="button" onClick={() => onNavigate?.("/todogreen/integracoes")}>
            <Plug size={16} /> Integrações
          </button>
          <div className={`tdg-space-more${moreOpen ? " is-open" : ""}`} ref={moreRef}>
            <button
              type="button"
              className="tdg-space-more-summary"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((aberto) => !aberto)}
            >
              <MoreHorizontal size={16} /> Mais funções
            </button>
            {moreOpen && (
              <div className="tdg-space-more-menu">
                {TODO_GREEN_WORKSPACE_TOOLS.filter((item) => !WORKSPACE_PRIMARY_IDS.has(item.id)).map((item) => {
                  const Icon = TOOL_ICONS[item.id] || BriefcaseBusiness;
                  return (
                    <button type="button" className={tool === item.id ? "active" : ""} onClick={() => openTool(item.id)} key={item.id}>
                      <Icon size={16} /> {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </header>

      {tool === "visao-geral" && (
        <WorkspaceOverview
          summary={summary}
          onOpenTool={openTool}
          onNavigate={onNavigate}
        />
      )}
      <Suspense fallback={<LoadingTool />}>
        <div className="tdg-space-embedded-tool">
          {tool === "notas" && <ConnectedNotes key={focusNoteId || "notas"} {...commonProps} initialNoteId={focusNoteId} onNavigate={onNavigate} />}
          {tool === "paginas" && (
            <Documents
              key={focusPageId || "paginas"}
              {...commonProps}
              initialDocumentId={focusPageId}
              onNavigate={onNavigate}
              hideMailMerge
              eyebrow="CONHECIMENTO"
              title="Páginas e documentos"
              text="Escreva por blocos, incorpore bases e tarefas e mantenha o histórico de cada versão."
              headingLevel="h2"
            />
          )}
          {tool === "automacoes" && (
            <TodoGreenAutomations setToast={setToast} onNavigate={onNavigate} />
          )}
          {tool === "inteligencia" && <TodoGreenIntelligenceHub verticalData={verticalData} onNavigate={onNavigate} authHeaders={authHeaders} setToast={setToast} />}
          {tool === "contatos" && <TodoGreenIntelligenceHub key="contatos" verticalData={verticalData} initialView="contacts" onNavigate={onNavigate} authHeaders={authHeaders} setToast={setToast} />}
          {tool === "ajuda" && <TodoGreenGuides mode="ajuda" onNavigate={onNavigate} />}
          {tool === "estrutura" && <WorkStructure {...commonProps} />}
          {tool === "tarefas" && (
            <TasksScreen
              {...commonProps}
              /* A tela nasceu no aplicativo geral e espera três coisas que o
                 espaço não tem: o kit da área (aqui não existe — componente
                 nulo), o `go` para telas do app geral (volta para a visão
                 geral do espaço) e a ação de mural compartilhado (devolve {}
                 e a tela cai no caminho local, que é o comportamento certo
                 para o To Do de uma pessoa). */
              AreaToolkit={FerramentaNula}
              go={() => openTool("visao-geral")}
              workspaceAction={async () => ({})}
            />
          )}
          {tool === "visoes" && <WorkViews setToast={setToast} profiles={db?.resourceProfiles || []} onOpenTool={openTool} />}
          {tool === "bases" && <DataBases {...commonProps} excludedTemplates={["Clientes"]} />}
          {tool === "processos" && <ProcessStudio {...commonProps} />}
          {tool === "capacidade" && <CapacityPlanner {...commonProps} />}
          {tool === "quadro-livre" && <CanvasBoard {...commonProps} />}
          {tool === "especialistas" && <TodoGreenEspecialistas authHeaders={authHeaders} setToast={setToast} />}
          {tool === "chat" && <CorporateChat {...commonProps} />}
          {tool === "reunioes" && <Meetings {...commonProps} />}
          {tool === "agenda" && <DayPlanner {...commonProps} />}
          {tool === "orcamentos" && <Quotes {...commonProps} />}
          {tool === "diagnostico" && <NegocioTodoGreen onNavigate={onNavigate} />}
          {tool === "marketing" && <CreativeToolkit business={business} setToast={setToast} db={db} update={update} />}
          {tool === "captacao" && <PublicFormsStudio {...commonProps} />}
          {tool === "site" && <SitesScreen {...commonProps} AreaToolkit={FerramentaNula} go={() => openTool("visao-geral")} />}
          {tool === "agentes" && <TodoGreenAgentes onOpenTool={openTool} commonProps={commonProps} />}
          {tool === "diagramas" && <DiagramStudio {...commonProps} />}
          {tool === "quadro-rapido" && <QuickWhiteboard {...commonProps} />}
          {tool === "midia" && <MediaStudio {...commonProps} />}
          {tool === "laboratorio" && <DataLab db={db} business={business} />}
        </div>
      </Suspense>
    </section>
  );
}
