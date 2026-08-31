import { Suspense, lazy, useMemo, useState } from "react";
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
  Workflow,
} from "lucide-react";
import { makeNote } from "../notes/notesDomain.js";
import {
  TODO_GREEN_WORKSPACE_TOOLS,
  buildTodoGreenWorkspaceSummary,
  findLinkedDocument,
  findLinkedNote,
  linkedEntityFor,
} from "./todoGreenWorkspaceDomain.js";

const ConnectedNotes = lazy(() => import("../notes/ConnectedNotes.jsx"));
const Documents = lazy(() => import("../documents/DocumentsScreen.jsx"));
const TodoGreenAutomations = lazy(() => import("./TodoGreenAutomations.jsx"));
const TodoGreenIntelligenceHub = lazy(() => import("./TodoGreenIntelligenceHub.jsx"));
const TodoGreenGuides = lazy(() => import("./TodoGreenGuides.jsx"));
const WorkStructure = lazy(() => import("../work/WorkStructure.jsx"));
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
const BusinessProfileStudio = lazy(() => import("../business-profile/BusinessProfileStudio.jsx"));
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
  { id: "estrutura", label: "Estrutura de trabalho" },
  { id: "visoes", label: "Visualizações e gráficos" },
  { id: "agentes", label: "Agentes e funções" },
]);

const WORKSPACE_PRIMARY_IDS = new Set(WORKSPACE_PRIMARY_TOOLS.map((item) => item.id));

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `nt-${crypto.randomUUID()}`
    : `nt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const LoadingTool = () => <section className="tdg-space-loading">Abrindo a ferramenta...</section>;

function WorkspaceOverview({ verticalData, summary, onOpenTool, onNavigate, onCreateLinkedNote, onCreateLinkedPage }) {
  const [clientId, setClientId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const clients = verticalData.clients || [];
  const opportunities = verticalData.opportunities || [];
  const selectedClient = clients.find((item) => item.id === clientId);
  const selectedOpportunity = opportunities.find((item) => item.id === opportunityId);

  const metricCards = [
    ["Clientes", summary.clients, () => onNavigate("/todogreen/clientes")],
    ["Oportunidades abertas", summary.openOpportunities, () => onNavigate("/todogreen/oportunidades")],
    ["Tarefas abertas", summary.openTasks, () => onNavigate("/todogreen/central-trabalho")],
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
    ["Central de implementação", "Implantações, projetos, tarefas, marcos e dependências", "/todogreen/central-trabalho"],
  ];

  return (
    <div className="tdg-space-overview">
      <section className="tdg-space-hero">
        <div>
          <span className="tdg-kicker">ESPAÇO DE TRABALHO</span>
          <h2>O contexto fica junto do trabalho</h2>
          <p>
            Notas, bases, processos, estrutura, capacidade e quadros usam os mesmos projetos e tarefas. O CRM continua sendo a fonte de clientes e oportunidades.
          </p>
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
          <button type="button" onClick={() => onNavigate("/todogreen/central-trabalho")}>Abrir implementação</button>
        </section>
      )}

      <section className="tdg-space-context">
        <header>
          <div><Sparkles size={19} /><span><strong>Começar com contexto</strong><small>Crie uma nota rápida ou uma página completa conectada a um registro real.</small></span></div>
        </header>
        <div className="tdg-space-context-grid">
          <div>
            <span>Cliente</span>
            <select aria-label="Cliente para conectar à nota" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Selecione um cliente</option>
              {clients.map((client) => <option value={client.id} key={client.id}>{client.name || client.company || "Cliente sem nome"}</option>)}
            </select>
            <div className="tdg-space-context-actions">
              <button type="button" disabled={!selectedClient} onClick={() => onCreateLinkedNote("client", selectedClient)}>Nota</button>
              <button type="button" disabled={!selectedClient} onClick={() => onCreateLinkedPage("client", selectedClient)}>Página</button>
            </div>
          </div>
          <div>
            <span>Oportunidade</span>
            <select aria-label="Oportunidade para conectar à nota" value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}>
              <option value="">Selecione uma oportunidade</option>
              {opportunities.map((opportunity) => <option value={opportunity.id} key={opportunity.id}>{opportunity.title || opportunity.name || "Oportunidade sem título"}</option>)}
            </select>
            <div className="tdg-space-context-actions">
              <button type="button" disabled={!selectedOpportunity} onClick={() => onCreateLinkedNote("opportunity", selectedOpportunity)}>Nota</button>
              <button type="button" disabled={!selectedOpportunity} onClick={() => onCreateLinkedPage("opportunity", selectedOpportunity)}>Página</button>
            </div>
          </div>
        </div>
        {clients.length === 0 && opportunities.length === 0 && (
          <p className="tdg-space-empty">Cadastre um cliente ou uma oportunidade para criar conhecimento conectado à carteira do ERP.</p>
        )}
      </section>

      <section className="tdg-space-tools">
        <header><div><span className="tdg-kicker">FERRAMENTAS</span><h3>Um lugar, várias formas de trabalhar</h3></div></header>
        <div>
          {TODO_GREEN_WORKSPACE_TOOLS.filter((tool) => tool.id !== "visao-geral").map((tool) => {
            const Icon = TOOL_ICONS[tool.id];
            return (
              <button type="button" onClick={() => onOpenTool(tool.id)} key={tool.id}>
                <span className="tdg-space-tool-icon"><Icon size={20} /></span>
                <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
                <b>{toolCounts[tool.id]}</b><ArrowRight size={16} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="tdg-space-routines">
        <header><div><span className="tdg-kicker">ROTINAS PRESERVADAS</span><h3>O que já existia continua acessível</h3></div></header>
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
  const [tool, setTool] = useState(initialTool);
  const [focusNoteId, setFocusNoteId] = useState("");
  const [focusPageId, setFocusPageId] = useState("");
  const business = useMemo(() => ({ id: "todogreen", name: "To Do Green" }), []);
  const summary = useMemo(
    () => buildTodoGreenWorkspaceSummary({ db, verticalData, businessId: business.id }),
    [db, verticalData, business.id],
  );

  const createLinkedNote = (type, record) => {
    const entity = linkedEntityFor(type, record);
    if (!entity) return;
    const existing = findLinkedNote(
      (db.notes || []).filter((note) => note.businessId === business.id),
      entity,
    );
    if (existing) {
      setFocusNoteId(existing.id);
      setTool("notas");
      setToast?.("Nota conectada aberta");
      return;
    }
    const note = makeNote(newId(), {
      title: `${entity.type === "client" ? "Cliente" : "Oportunidade"} · ${entity.name}`,
      content: `#${entity.type === "client" ? "cliente" : "oportunidade"}\n\nDecisões\n\nPróximas ações\n\nRegistros relacionados`,
      businessId: business.id,
      linkedEntities: [entity],
    });
    update((current) => ({ ...current, notes: [note, ...(current.notes || [])] }));
    setFocusNoteId(note.id);
    setTool("notas");
    setToast?.("Nota conectada criada");
  };

  const createLinkedPage = (type, record) => {
    const entity = linkedEntityFor(type, record);
    if (!entity) return;
    const existing = findLinkedDocument(
      (db.documents || []).filter((document) => document.businessId === business.id),
      entity,
    );
    if (existing) {
      setFocusPageId(existing.id);
      setTool("paginas");
      setToast?.("Página conectada aberta");
      return;
    }
    const page = {
      id: newId().replace(/^nt-/, "doc-"),
      title: `${entity.type === "client" ? "Cliente" : "Oportunidade"} · ${entity.name}`,
      type: "Página de conhecimento",
      content: "Contexto\n\nDecisões\n\nPróximas ações\n\nRegistros relacionados",
      blocks: [],
      signatures: [],
      versions: [],
      visibility: "privado",
      sharingPermission: "visualizar",
      sharedWith: [],
      sharedTeams: [],
      project: "",
      businessId: business.id,
      ownerId: db.user?.id || null,
      linkedEntities: [entity],
      updatedAt: new Date().toISOString(),
    };
    update((current) => ({ ...current, documents: [page, ...(current.documents || [])] }));
    setFocusPageId(page.id);
    setTool("paginas");
    setToast?.("Página conectada criada");
  };

  const openTool = (nextTool) => {
    if (nextTool === "paginas") setFocusPageId("");
    // "estrutura" NÃO navega: /central-trabalho é a rota da Central de
    // Trabalho (os quadros), que é outra tela com outra dona. Mandar a jornada
    // para lá foi o que deixou duas telas empilhadas, cada uma com metade
    // (defeito apontado pela titular, 31/08). A hierarquia abre aqui dentro.
    const directRoutes = {
      "visao-geral": "/todogreen/espaco",
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
        <div className="tdg-space-toolbar-title">
          <span>TO DO GREEN</span>
          <h2>Workspace corporativo</h2>
          <p>Projetos, tarefas, visualizações, agentes e integrações em uma única navegação.</p>
        </div>
        <nav className="tdg-space-tabs" aria-label="Jornadas principais do workspace">
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
          <details className="tdg-space-more">
            <summary><MoreHorizontal size={16} /> Mais funções</summary>
            <div>
              {TODO_GREEN_WORKSPACE_TOOLS.filter((item) => !WORKSPACE_PRIMARY_IDS.has(item.id)).map((item) => {
                const Icon = TOOL_ICONS[item.id] || BriefcaseBusiness;
                return (
                  <button type="button" className={tool === item.id ? "active" : ""} onClick={() => openTool(item.id)} key={item.id}>
                    <Icon size={16} /> {item.label}
                  </button>
                );
              })}
            </div>
          </details>
        </nav>
      </header>

      {tool === "visao-geral" && (
        <WorkspaceOverview
          verticalData={verticalData}
          summary={summary}
          onOpenTool={openTool}
          onNavigate={onNavigate}
          onCreateLinkedNote={createLinkedNote}
          onCreateLinkedPage={createLinkedPage}
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
          {tool === "contatos" && <TodoGreenIntelligenceHub key="contatos" verticalData={verticalData} initialView="contacts" onNavigate={onNavigate} />}
          {tool === "ajuda" && <TodoGreenGuides mode="ajuda" onNavigate={onNavigate} />}
          {tool === "estrutura" && <WorkStructure {...commonProps} />}
          {tool === "visoes" && <WorkViews setToast={setToast} profiles={db?.resourceProfiles || []} />}
          {tool === "bases" && <DataBases {...commonProps} excludedTemplates={["Clientes"]} />}
          {tool === "processos" && <ProcessStudio {...commonProps} />}
          {tool === "capacidade" && <CapacityPlanner {...commonProps} />}
          {tool === "quadro-livre" && <CanvasBoard {...commonProps} />}
          {tool === "especialistas" && <TodoGreenEspecialistas authHeaders={authHeaders} setToast={setToast} />}
          {tool === "chat" && <CorporateChat {...commonProps} />}
          {tool === "reunioes" && <Meetings {...commonProps} />}
          {tool === "agenda" && <DayPlanner {...commonProps} />}
          {tool === "orcamentos" && <Quotes {...commonProps} />}
          {tool === "diagnostico" && <BusinessProfileStudio business={business} update={update} db={db} setToast={setToast} go={() => openTool("visao-geral")} />}
          {tool === "marketing" && <CreativeToolkit business={business} setToast={setToast} db={db} update={update} />}
          {tool === "captacao" && <PublicFormsStudio {...commonProps} />}
          {tool === "site" && <SitesScreen {...commonProps} go={() => openTool("visao-geral")} />}
          {tool === "agentes" && <AgentStudio {...commonProps} />}
          {tool === "diagramas" && <DiagramStudio {...commonProps} />}
          {tool === "quadro-rapido" && <QuickWhiteboard {...commonProps} />}
          {tool === "midia" && <MediaStudio {...commonProps} />}
          {tool === "laboratorio" && <DataLab db={db} business={business} />}
        </div>
      </Suspense>
    </section>
  );
}
