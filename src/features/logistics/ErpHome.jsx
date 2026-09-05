import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, MapPinned, Settings2, Truck, X } from "lucide-react";
import { buildTodoGreenDecisionCenter } from "./decisionCenterDomain.js";
import { cenariosAbaixoDoPiso, resumoDeMargem } from "./marginDomain.js";
import { operacoesCriticas } from "./operationsEfficiencyDomain.js";
import {
  ERP_HOME_AREAS,
  ERP_HOME_WIDGETS,
  ERP_SHORTCUTS,
  alertsForArea,
  homeArea,
  normalizeHomePreferences,
  tasksForCollaborator,
} from "./erpHomeDomain.js";
import "./ErpHome.css";
import { comRotulo } from "./rotulosDomain.js";
import WidgetChart from "./pages/DashboardCharts.jsx";

// Os gráficos do painel da home: puro SVG (CSP-safe), alimentados pelos mesmos
// dados da vertical. Dão o "dashboard" e o dinamismo que faltavam — um número
// solto não conta a tendência; a linha e a rosca sim.
const PAINEL_HOME = [
  { metric: "receita", type: "line", titulo: "Receita por mês", subtitulo: "evolução realizada" },
  { metric: "pipeline", type: "donut", titulo: "Pipeline por estágio", subtitulo: "oportunidades abertas" },
  { metric: "operacoes", type: "bar", titulo: "Operações por mês", subtitulo: "entregas registradas" },
];

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const ROLE_LABEL = {
  owner: "Proprietário", admin: "Administração", lideranca_comercial: "Liderança Comercial",
  vendedor: "Comercial", pricing: "Precificação", produtos: "Produtos", planejamento: "Planejamento",
  financeiro: "Financeiro", operacoes: "Operações", marketing: "Marketing",
  sustentabilidade: "Sustentabilidade", auditor: "Auditoria", rh: "DP/RH",
  desenvolvedor: "Desenvolvedor",
};

const dueLabel = (task) => {
  const value = task.due || task.dueDate || task.deadline;
  if (!value) return "Sem prazo";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "Sem prazo";
};

export default function ErpHome({ role, user, data, dashboard, tasks, products = [], preferences, onSave, onNavigate }) {
  const profile = useMemo(() => normalizeHomePreferences(role, preferences), [role, preferences]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const area = homeArea(profile.areaId);
  const decision = useMemo(() => buildTodoGreenDecisionCenter({ data, dashboard, tasks }), [data, dashboard, tasks]);
  const hasOperationalData = decision.hasData;
  const margin = useMemo(() => resumoDeMargem({ cenarios: data.pricingScenarios }), [data.pricingScenarios]);
  const myTasks = useMemo(() => tasksForCollaborator(tasks, user), [tasks, user]);
  const alerts = useMemo(() => alertsForArea(decision.alerts, area.id), [decision.alerts, area.id]);
  const operationalRisks = useMemo(() => [
    ...cenariosAbaixoDoPiso({ cenarios: data.pricingScenarios, limite: 3 }).map((item) => ({
      id: `margin-${item.id}`,
      tone: "risk",
      title: `${item.cliente} está ${NUM.format(item.distanciaDoPiso)} p.p. abaixo do piso`,
      detail: `Margem ${NUM.format(item.margemPercent)}% · piso ${NUM.format(item.piso)}%`,
      action: "Abrir precificação",
      route: "/todogreen/precificacao",
    })),
    ...operacoesCriticas({ operacoes: data.operations, limite: 3 }).map((item) => ({
      id: `occupancy-${item.id}`,
      tone: "risk",
      title: `${item.referencia} com ${NUM.format(item.ocupacaoPercent)}% de ocupação`,
      detail: "Revise consolidação, frequência ou alocação da rota.",
      action: "Abrir operação",
      route: "/todogreen/operacoes",
    })),
  ], [data.operations, data.pricingScenarios]);
  const contextualAlerts = ["owner", "admin"].includes(role)
    ? [...operationalRisks, ...decision.alerts]
    : [...operationalRisks, ...alerts].filter((alert) => alertsForArea([alert], area.id).length);
  const queue = [
    ...myTasks.slice(0, 5).map((task) => ({
      // Abre a ferramenta de tarefas do Espaço, não /central-trabalho — esse
      // alias é sequestrado pela Central de Implantação e abria uma tela vazia.
      id: `task-${task.id}`, tone: "task", title: task.title || "Tarefa sem título",
      detail: `${task.status || "Pendente"} · ${dueLabel(task)}`, action: "Abrir tarefa", route: "/todogreen/espaco?ferramenta=tarefas",
    })),
    ...contextualAlerts.slice(0, Math.max(0, 6 - myTasks.length)).map((alert) => ({
      id: `alert-${alert.id}`, tone: alert.tone, title: alert.title, detail: alert.detail, action: alert.action, route: alert.route,
    })),
  ];

  const metrics = {
    pipeline: ["Pipeline", BRL.format(decision.pipeline), `${decision.counts.openOpportunities} oportunidade(s) aberta(s)`],
    forecast: ["Forecast", BRL.format(decision.forecast), "ponderado pela probabilidade"],
    opportunities: ["Oportunidades", String(decision.counts.openOpportunities), "em andamento"],
    margin: ["Margem", margin.margemPercent === null ? "Sem cálculo" : `${NUM.format(margin.margemPercent)}%`, margin.leitura],
    scenarios: ["Simulações", String(data.pricingScenarios?.length || 0), "com premissas confirmadas"],
    approvals: ["Aprovações", String(dashboard.aprovacoesPendentes || 0), "pendentes de decisão comercial"],
    products: ["Produtos", String(products.length), "modelos logísticos ativos"],
    trips: ["Viagens", NUM.format(dashboard.viagens || 0), "registradas no período"],
    operations: ["Operações", String(data.operations?.length || 0), "registros operacionais"],
    occupancy: ["Ocupação", dashboard.ocupacao ? `${NUM.format(dashboard.ocupacao)}%` : "Sem medição", "média operacional"],
    deliveries: ["Entregas", NUM.format(dashboard.entregas || 0), "concluídas no período"],
    revenue: ["Receita", BRL.format(dashboard.receitaRealizada || dashboard.receitaPrevista || 0), "realizada e contratada"],
    cost: ["Custos", BRL.format(dashboard.custoTotal || 0), "vinculados às operações"],
    billing: ["Faturamento", BRL.format(dashboard.receitaRealizada || 0), "realizado"],
    tasks: ["Minhas tarefas", String(myTasks.length), "abertas e atribuídas"],
    goals: ["Metas", "Abrir", "acompanhamento individual"],
    clients: ["Clientes", String(data.clients?.length || 0), "na base da vertical"],
    impact: ["CO₂ evitado", dashboard.co2Evitado ? `${NUM.format(dashboard.co2Evitado / 1000)} t` : "Sem cálculo", "com operação vinculada"],
    greenScore: ["Green Score", dashboard.greenScore ? NUM.format(dashboard.greenScore) : "Sem cálculo", "média dos cenários"],
    distance: ["Quilometragem", `${NUM.format(dashboard.quilometragem || 0)} km`, "monitorada"],
  };

  const visible = (id) => profile.widgetIds.includes(id);
  const shortcuts = profile.shortcutIds.map((id) => ERP_SHORTCUTS.find((item) => item.id === id)).filter(Boolean);
  const save = () => {
    const normalized = normalizeHomePreferences(role, draft);
    onSave?.(normalized);
    setEditing(false);
  };

  return <section className="tdg-erp-home" aria-labelledby="tdg-home-title">
    <header className="tdg-home-welcome">
      <div>
        <span className="tdg-kicker">MEU ESPAÇO · {area.label.toUpperCase()}</span>
        <h2 id="tdg-home-title">Olá, {String(user?.name || "").split(" ")[0] || "colaborador"}</h2>
        <p>{profile.functionLabel}. Sua entrada reúne o que exige ação na sua rotina, sem misturar o trabalho das outras áreas.</p>
      </div>
      <div className="tdg-home-identity">
        <span>{comRotulo(ROLE_LABEL, role)}</span>
        <button type="button" onClick={() => onNavigate?.("/todogreen/rastreamento")}><MapPinned size={16} />Abrir TMS Tracker</button>
        <button type="button" onClick={() => { setDraft(profile); setEditing(true); }}><Settings2 size={16} />Configurar meu início</button>
      </div>
    </header>

    {!hasOperationalData && <div className="tdg-home-empty tdg-home-empty-operational" role="status" aria-live="polite"><CheckCircle2 size={20} /><span><strong>Sem dados operacionais</strong><small>Cadastre clientes, oportunidades ou simulações para alimentar o painel.</small></span></div>}

    {visible("metrics") && <div className="tdg-home-metrics" aria-label={`Indicadores de ${area.label}`}>
      {area.metrics.map((id) => {
        const metric = metrics[id];
        return metric ? <article key={id}><span>{metric[0]}</span><strong>{metric[1]}</strong><small>{metric[2]}</small></article> : null;
      })}
    </div>}

    {/* Painel visual: gráficos ao vivo dos mesmos dados. É o "dashboard" e o
        dinamismo que faltavam — a home tinha só números soltos. Só aparece com
        dado operacional; cada gráfico já mostra "sem dados" sozinho se faltar. */}
    {hasOperationalData && <section className="tdg-home-section tdg-home-painel-sec">
      <header><div><span>PANORAMA</span><h3>Painel visual</h3></div><button type="button" onClick={() => onNavigate?.("/todogreen/dashboards")}>Painéis completos<ArrowRight size={14} /></button></header>
      <div className="tdg-home-painel">
        {PAINEL_HOME.map((g) => (
          <article className="tdg-home-painel-card" key={g.metric}>
            <div className="tdg-home-painel-cab"><strong>{g.titulo}</strong><small>{g.subtitulo}</small></div>
            <WidgetChart widget={{ metric: g.metric, type: g.type }} data={data} />
          </article>
        ))}
      </div>
    </section>}

    <div className="tdg-home-grid">
      {visible("queue") && <section className="tdg-home-section tdg-home-queue">
        <header><div><span>TRABALHO</span><h3>Minha fila</h3></div><small>{queue.length} item(ns)</small></header>
        {queue.length ? queue.map((item) => <button type="button" onClick={() => onNavigate?.(item.route)} key={item.id}>
          <span className={item.tone === "risk" ? "risk" : ""}>{item.tone === "risk" ? <AlertTriangle size={17} /> : <ClipboardCheck size={17} />}</span>
          <span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.action}<ArrowRight size={14} /></b>
        </button>) : <div className="tdg-home-empty"><CheckCircle2 size={20} /><span><strong>Nenhuma pendência atribuída</strong><small>Itens da sua área aparecem aqui quando exigem ação.</small></span></div>}
      </section>}

    </div>

    {visible("shortcuts") && <section className="tdg-home-section tdg-home-shortcuts">
      <header><div><span>ACESSO RÁPIDO</span><h3>Ferramentas da minha rotina</h3></div><small>{shortcuts.length} atalho(s)</small></header>
      <div>{shortcuts.map((item) => <button type="button" onClick={() => onNavigate?.(item.route)} key={item.id}>{item.label}<ArrowRight size={14} /></button>)}</div>
    </section>}

    {/* O Portal TMS (/portal-tms) é um portal próprio, fora das rotas
        /todogreen — antes só dava para chegar nele digitando a URL. Como é
        outro topo de rota, o acesso é por link real, não pela navegação
        interna da vertical. */}
    <section className="tdg-home-section tdg-home-portais">
      <header><div><span>PORTAIS</span><h3>Portal TMS</h3></div></header>
      <a className="tdg-home-portal-link" href="/portal-tms">
        <span className="tdg-home-portal-icon"><Truck size={18} /></span>
        <span><strong>Abrir Portal TMS</strong><small>Controle, roteirização, despacho, fiscal e auditoria de transporte</small></span>
        <ArrowRight size={16} />
      </a>
    </section>

    {editing && <div className="tdg-home-config-backdrop" role="presentation">
      <section className="tdg-home-config" role="dialog" aria-modal="true" aria-labelledby="tdg-home-config-title">
        <header><div><span className="tdg-kicker">CONFIGURAÇÃO INDIVIDUAL</span><h2 id="tdg-home-config-title">Organizar meu início</h2><p>Esta escolha vale apenas para o seu usuário.</p></div><button type="button" aria-label="Fechar" onClick={() => setEditing(false)}><X size={19} /></button></header>
        <label><span>Minha área principal</span><select value={draft.areaId} onChange={(event) => {
          const nextArea = homeArea(event.target.value);
          setDraft((current) => ({ ...current, areaId: nextArea.id, functionLabel: nextArea.functionLabel, shortcutIds: nextArea.shortcuts }));
        }}>{ERP_HOME_AREAS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>Minha função</span><input value={draft.functionLabel} onChange={(event) => setDraft((current) => ({ ...current, functionLabel: event.target.value }))} /></label>
        <fieldset><legend>O que aparece no início</legend>{ERP_HOME_WIDGETS.map((item) => <label className="tdg-home-check" key={item.id}><input type="checkbox" checked={draft.widgetIds.includes(item.id)} onChange={(event) => setDraft((current) => ({ ...current, widgetIds: event.target.checked ? [...current.widgetIds, item.id] : current.widgetIds.filter((id) => id !== item.id) }))} /><span>{item.label}</span></label>)}</fieldset>
        <fieldset><legend>Meus atalhos</legend><div className="tdg-home-config-shortcuts">{ERP_SHORTCUTS.map((item) => <label className="tdg-home-check" key={item.id}><input type="checkbox" checked={draft.shortcutIds.includes(item.id)} onChange={(event) => setDraft((current) => ({ ...current, shortcutIds: event.target.checked ? [...current.shortcutIds, item.id] : current.shortcutIds.filter((id) => id !== item.id) }))} /><span>{item.label}</span></label>)}</div></fieldset>
        <footer><button type="button" onClick={() => setEditing(false)}>Cancelar</button><button className="tdg-action" type="button" onClick={save}>Salvar meu início</button></footer>
      </section>
    </div>}
  </section>;
}
