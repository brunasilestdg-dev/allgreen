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
  blocosDaHome,
  homeArea,
  moverBloco,
  normalizeHomePreferences,
  tasksForCollaborator,
} from "./erpHomeDomain.js";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./ErpHome.css";
import { comRotulo } from "./rotulosDomain.js";
import WidgetChart from "./pages/DashboardCharts.jsx";
import { WORKDAY_FILTERS, WORKDAY_ROUTES, origemDaTarefa, workdayTasks } from "./workdayDomain.js";

// Os gráficos do painel da home: puro SVG (CSP-safe), alimentados pelos mesmos
// dados da vertical. Dão o "dashboard" e o dinamismo que faltavam — um número
// solto não conta a tendência; a linha e a rosca sim.
// Cada área tem seu próprio painel de gráficos (pedido da titular: "as áreas
// devem ter seus dashboards com gráficos" + "gosto de gráficos dinâmicos,
// barras, pizza"). Os gráficos usam só os indicadores com série/distribuição
// naturais (receita, custo, margem, pipeline, propostas, operações, clientes);
// área sem painel próprio cai no panorama geral acima.
const GRAFICOS = {
  receita: { metric: "receita", type: "line", titulo: "Receita por mês", subtitulo: "evolução realizada" },
  custo: { metric: "custo", type: "line", titulo: "Custos por mês", subtitulo: "vinculados às operações" },
  margem: { metric: "margem", type: "line", titulo: "Margem por mês", subtitulo: "receita menos custo" },
  pipeline: { metric: "pipeline", type: "donut", titulo: "Pipeline por estágio", subtitulo: "oportunidades abertas" },
  propostas: { metric: "propostas", type: "donut", titulo: "Propostas por situação", subtitulo: "carteira comercial" },
  operacoes: { metric: "operacoes", type: "bar", titulo: "Operações por mês", subtitulo: "entregas registradas" },
  clientes: { metric: "clientes", type: "bar", titulo: "Clientes ativos por mês", subtitulo: "com movimento no razão" },
};
const PAINEL_POR_AREA = {
  commercial: ["pipeline", "propostas", "clientes"],
  products: ["pipeline", "margem", "propostas"],
  planning: ["operacoes", "pipeline", "custo"],
  operations: ["operacoes", "custo", "clientes"],
  incidents: ["operacoes", "custo"],
  supply: ["custo", "operacoes"],
  finance: ["receita", "custo", "margem"],
  marketing: ["pipeline", "clientes", "propostas"],
  esg: ["operacoes", "clientes"],
  hr: ["operacoes", "custo"],
  management: ["receita", "pipeline", "operacoes"],
  indicators: ["receita", "pipeline", "operacoes"],
};
const painelDaArea = (areaId) =>
  (PAINEL_POR_AREA[areaId] || ["receita", "pipeline", "operacoes"])
    .map((chave) => GRAFICOS[chave])
    .filter(Boolean);

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const ROLE_LABEL = {
  owner: "Proprietário", admin: "Administração", lideranca_comercial: "Liderança Comercial",
  vendedor: "Comercial", pricing: "Precificação", produtos: "Produtos", planejamento: "Planejamento",
  financeiro: "Financeiro", operacoes: "Operações", marketing: "Marketing",
  sustentabilidade: "Sustentabilidade", auditor: "Auditoria", rh: "DP/RH",
  colaborador: "Colaborador", desenvolvedor: "Desenvolvedor",
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
  const [taskFilter, setTaskFilter] = useState("all");
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
  const focusedTasks = workdayTasks(myTasks, taskFilter);
  // A fila tem DUAS naturezas e elas não podem se misturar: tarefa é cartão do
  // quadro; pendência é situação lida dos dados (conta atrasada, negócio sem
  // próximo passo). Empilhadas na mesma lista, o contador dizia "0 tarefa(s)" com
  // duas linhas na tela e o quadro abria vazio — foi exatamente o que a titular
  // relatou. Continuam juntas na mesma seção, mas separadas e rotuladas.
  const tarefasDaFila = focusedTasks.slice(0, 5).map((task) => ({
    // Abre a ferramenta de tarefas do Espaço, não /central-trabalho — esse
    // alias é sequestrado pela Central de Implantação e abria uma tela vazia.
    id: `task-${task.id}`, tone: "task", title: task.title || "Tarefa sem título",
    // Abre a tarefa ESPECÍFICA no quadro (?task=<id>), não o quadro em geral —
    // clicar "minha tarefa" tem de cair nela, não numa lista para caçar.
    detail: `${task.status || "Pendente"} · ${dueLabel(task)} · ${origemDaTarefa(task)}`, action: "Abrir tarefa",
    route: `/todogreen/espaco?ferramenta=tarefas&task=${encodeURIComponent(task.id)}`,
  }));
  const pendenciasDaFila = contextualAlerts.slice(0, Math.max(0, 6 - focusedTasks.length)).map((alert) => ({
    id: `alert-${alert.id}`, tone: alert.tone, title: alert.title, detail: alert.detail, action: alert.action, route: alert.route,
  }));
  const linhaDaFila = (item) => <button type="button" onClick={() => onNavigate?.(item.route)} key={item.id}>
    <span className={item.tone === "risk" ? "risk" : ""}>{item.tone === "risk" ? <AlertTriangle size={17} /> : <ClipboardCheck size={17} />}</span>
    <span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.action}<ArrowRight size={14} /></b>
  </button>;

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

  // Cada indicador leva ao lugar onde a pessoa age sobre ele (pedido da titular:
  // "quero poder clicar nessa pipeline"). Sem rota, o cartão continua estático.
  const rotaDoIndicador = {
    pipeline: "/todogreen/funil",
    forecast: "/todogreen/funil",
    opportunities: "/todogreen/oportunidades",
    margin: "/todogreen/precificacao",
    scenarios: "/todogreen/precificacao",
    approvals: "/todogreen/deal-desk",
    products: "/todogreen/produtos",
    clients: "/todogreen/clientes",
    tasks: "/todogreen/espaco?ferramenta=tarefas",
    goals: "/todogreen/metas",
    revenue: "/todogreen/faturamento",
    billing: "/todogreen/faturamento",
    cost: "/todogreen/custos",
    trips: "/todogreen/operacoes",
    operations: "/todogreen/operacoes",
    occupancy: "/todogreen/operacoes",
    deliveries: "/todogreen/operacoes",
    distance: "/portal-tms/mapa",
    impact: "/todogreen/central-esg",
    greenScore: "/todogreen/central-esg",
  };

  // Clicar num gráfico do painel leva à tela onde aquele número vive (pedido da
  // titular: "clicar nos gráficos"). As chaves são as do painel (GRAFICOS).
  const rotaDoGrafico = {
    receita: "/todogreen/faturamento",
    custo: "/todogreen/custos",
    margem: "/todogreen/precificacao",
    pipeline: "/todogreen/funil",
    propostas: "/todogreen/propostas",
    operacoes: "/todogreen/operacoes",
    clientes: "/todogreen/clientes",
  };

  const shortcuts = profile.shortcutIds.map((id) => ERP_SHORTCUTS.find((item) => item.id === id)).filter(Boolean);
  const save = () => {
    const normalized = normalizeHomePreferences(role, draft);
    onSave?.(normalized);
    setEditing(false);
  };

  // Cada bloco da Visão geral desenhado sob demanda, para a home ser montada na
  // ordem e com os blocos que a pessoa escolheu (#118). O painel visual só
  // aparece com dado operacional (cada gráfico já trata o vazio sozinho).
  const renderBloco = (id) => {
    if (id === "metrics") {
      return <div className="tdg-home-metrics" aria-label={`Indicadores de ${area.label}`} key="metrics">
        {area.metrics.map((mid) => {
          const metric = metrics[mid];
          if (!metric) return null;
          const rota = rotaDoIndicador[mid];
          const conteudo = <><span>{metric[0]}</span><strong>{metric[1]}</strong><small>{metric[2]}</small></>;
          return rota
            ? <button type="button" className="tdg-home-metric-link" onClick={() => onNavigate?.(rota)} key={mid} title={`Abrir ${metric[0]}`}>{conteudo}</button>
            : <article key={mid}>{conteudo}</article>;
        })}
      </div>;
    }
    if (id === "painel") {
      return <section className="tdg-home-section tdg-home-painel-sec" key="painel">
        <header><div><span>PANORAMA · {area.label.toUpperCase()}</span><h3>Painel visual da área</h3></div><button type="button" onClick={() => onNavigate?.("/todogreen/dashboards")}>Painéis completos<ArrowRight size={14} /></button></header>
        {!hasOperationalData && <p className="tdg-home-painel-vazio">Os gráficos preenchem conforme a operação roda. Abaixo, a estrutura de cada indicador — clique para abrir a tela onde o número vive.</p>}
        <div className="tdg-home-painel">
          {painelDaArea(area.id).map((g) => (
            <article className="tdg-home-painel-card" key={g.metric}>
              <div className="tdg-home-painel-cab"><strong>{g.titulo}</strong><small>{g.subtitulo}</small></div>
              <WidgetChart widget={{ metric: g.metric, type: g.type }} data={data} onSelecionar={rotaDoGrafico[g.metric] ? () => onNavigate?.(rotaDoGrafico[g.metric]) : undefined} />
            </article>
          ))}
        </div>
      </section>;
    }
    if (id === "queue") {
      return <div className="tdg-home-grid" key="queue">
        <section className="tdg-home-section tdg-home-queue">
          <header><div><span>MEU DIA</span><h3>Minha fila</h3></div><small>{focusedTasks.length} tarefa(s) no filtro · {pendenciasDaFila.length} pendência(s)</small></header>
          <div className="tdg-workday-filters" role="group" aria-label="Filtrar minhas tarefas por prazo">
            {WORKDAY_FILTERS.map((filter) => <button type="button" key={filter.id} aria-pressed={taskFilter === filter.id} onClick={() => setTaskFilter(filter.id)}>
              {filter.label} <span>{workdayTasks(myTasks, filter.id).length}</span>
            </button>)}
          </div>
          {tarefasDaFila.length ? tarefasDaFila.map(linhaDaFila) : <div className="tdg-home-empty"><CheckCircle2 size={20} /><span><strong>{myTasks.length ? "Nenhuma tarefa neste filtro" : "Nenhuma tarefa no seu quadro"}</strong><small>{myTasks.length ? "Escolha outro prazo para continuar." : "O quadro abre vazio mesmo: crie uma tarefa ou receba uma atribuição para ela aparecer aqui."}</small></span></div>}
          <button type="button" className="tdg-workday-all" onClick={() => onNavigate?.("/todogreen/espaco?ferramenta=tarefas")}>Abrir quadro de tarefas<ArrowRight size={16} /></button>
          {pendenciasDaFila.length > 0 && <div className="tdg-home-fila-sep">
            <span>PENDÊNCIAS DA OPERAÇÃO</span>
            <small>Lidas dos seus dados — não são cartões do quadro de tarefas. Cada uma abre a tela onde se resolve, já filtrada nos registros que a acenderam.</small>
          </div>}
          {pendenciasDaFila.map(linhaDaFila)}
        </section>
      </div>;
    }
    if (id === "shortcuts") {
      return <section className="tdg-home-section tdg-home-shortcuts" key="shortcuts">
        <header><div><span>ACESSO RÁPIDO</span><h3>Ferramentas da minha rotina</h3></div><small>{shortcuts.length} atalho(s)</small></header>
        <div>{shortcuts.map((item) => <button type="button" onClick={() => onNavigate?.(item.route)} key={item.id}>{item.label}<ArrowRight size={14} /></button>)}</div>
      </section>;
    }
    if (id === "portais") {
      return <section className="tdg-home-section tdg-home-portais" key="portais">
        <header><div><span>PORTAIS</span><h3>Portal TMS</h3></div></header>
        <a className="tdg-home-portal-link" href="/portal-tms">
          <span className="tdg-home-portal-icon"><Truck size={18} /></span>
          <span><strong>Abrir Portal TMS</strong><small>Controle, roteirização, despacho, fiscal e auditoria de transporte</small></span>
          <ArrowRight size={16} />
        </a>
      </section>;
    }
    return null;
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
        <button type="button" onClick={() => onNavigate?.("/portal-tms")}><MapPinned size={16} />Abrir Torre TMS</button>
        <button type="button" onClick={() => { setDraft(profile); setEditing(true); }}><Settings2 size={16} />Configurar meu início</button>
      </div>
    </header>

    <nav className="tdg-workday-routes" aria-label="Onde você quer trabalhar?">
      {WORKDAY_ROUTES.map((item) => <button type="button" key={item.id} onClick={() => onNavigate?.(item.route)}>
        <strong>{item.title}<ArrowRight size={17} /></strong><span>{item.description}</span>
      </button>)}
    </nav>

    {!hasOperationalData && <div className="tdg-home-empty tdg-home-empty-operational" role="status" aria-live="polite"><CheckCircle2 size={20} /><span><strong>Sem dados operacionais</strong><small>Cadastre clientes, oportunidades ou simulações para alimentar o painel.</small></span></div>}

    {/* A Visão geral é montada na ordem e com os blocos que a pessoa escolheu
        em "Configurar meu início". Bloco desligado nem entra na lista. */}
    {blocosDaHome(profile).map((id) => renderBloco(id))}

    {editing && <div className="tdg-home-config-backdrop" role="presentation">
      <section className="tdg-home-config" role="dialog" aria-modal="true" aria-labelledby="tdg-home-config-title">
        <header><div><span className="tdg-kicker">CONFIGURAÇÃO INDIVIDUAL</span><h2 id="tdg-home-config-title">Organizar meu início</h2><p>Esta escolha vale apenas para o seu usuário.</p></div><button type="button" aria-label="Fechar" onClick={() => setEditing(false)}><X size={19} /></button></header>
        <label><span>Minha área principal</span><select value={draft.areaId} onChange={(event) => {
          const nextArea = homeArea(event.target.value);
          setDraft((current) => ({ ...current, areaId: nextArea.id, functionLabel: nextArea.functionLabel, shortcutIds: nextArea.shortcuts }));
        }}>{ERP_HOME_AREAS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>Minha função</span><input value={draft.functionLabel} onChange={(event) => setDraft((current) => ({ ...current, functionLabel: event.target.value }))} /></label>
        {/* Montar a home: cada bloco liga/desliga e sobe/desce. A lista é
            desenhada na ORDEM salva (não na ordem fixa do catálogo), para a
            pessoa ver a home como ela vai ficar. */}
        <fieldset><legend>Blocos da minha Visão geral</legend>
          <small className="tdg-home-config-dica">Ligue os blocos que quer e use as setas para pôr na ordem que preferir.</small>
          <ul className="tdg-home-config-blocos">
            {(draft.widgetOrder || ERP_HOME_WIDGETS.map((w) => w.id)).map((id, indice, lista) => {
              const bloco = ERP_HOME_WIDGETS.find((w) => w.id === id);
              if (!bloco) return null;
              const ligado = draft.widgetIds.includes(id);
              return <li key={id} className={ligado ? "ligado" : ""}>
                <label className="tdg-home-check">
                  <input type="checkbox" checked={ligado} onChange={(event) => setDraft((current) => ({ ...current, widgetIds: event.target.checked ? [...current.widgetIds, id] : current.widgetIds.filter((w) => w !== id) }))} />
                  <span>{bloco.label}</span>
                </label>
                <span className="tdg-home-config-setas">
                  <button type="button" aria-label={`Subir ${bloco.label}`} disabled={indice === 0} onClick={() => setDraft((current) => ({ ...current, widgetOrder: moverBloco(current.widgetOrder, id, "cima") }))}><ChevronUp size={15} /></button>
                  <button type="button" aria-label={`Descer ${bloco.label}`} disabled={indice === lista.length - 1} onClick={() => setDraft((current) => ({ ...current, widgetOrder: moverBloco(current.widgetOrder, id, "baixo") }))}><ChevronDown size={15} /></button>
                </span>
              </li>;
            })}
          </ul>
        </fieldset>
        <fieldset><legend>Meus atalhos</legend><div className="tdg-home-config-shortcuts">{ERP_SHORTCUTS.map((item) => <label className="tdg-home-check" key={item.id}><input type="checkbox" checked={draft.shortcutIds.includes(item.id)} onChange={(event) => setDraft((current) => ({ ...current, shortcutIds: event.target.checked ? [...current.shortcutIds, item.id] : current.shortcutIds.filter((id) => id !== item.id) }))} /><span>{item.label}</span></label>)}</div></fieldset>
        <footer><button type="button" onClick={() => setEditing(false)}>Cancelar</button><button className="tdg-action" type="button" onClick={save}>Salvar meu início</button></footer>
      </section>
    </div>}
  </section>;
}
