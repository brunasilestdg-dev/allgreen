// Componentes de apresentação compartilhados pela vertical: as telas de
// acesso em verificação/negado, os cartões de indicador, de rotina e de
// produto, e o Painel de Gerenciamento que abre quando a página não tem tela
// própria.
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
  House,
  Inbox,
  Languages,
  Leaf,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Network,
  PackageCheck,
  Landmark,
  LogOut,
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
} from "lucide-react";
import { buildTodoGreenDecisionCenter } from "../decisionCenterDomain.js";
import { cenariosAbaixoDoPiso, resumoDeMargem } from "../marginDomain.js";
import { operacoesCriticas, resumoDeOcupacao } from "../operationsEfficiencyDomain.js";
import { resumirAssuntos } from "../moduleGroupingDomain.js";
import { IMPLEMENTED_MODULE_IDS } from "../shell/catalogoDeModulos.js";
import { openFunctionPage } from "../shell/rotas.js";
import { BRL, number } from "./formatos.js";

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
  House,
  Inbox,
  Languages,
  Leaf,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Network,
  PackageCheck,
  Landmark,
  LogOut,
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

// Enquanto a API não respondeu, a tela não afirma nada. Mostrar o painel e
// depois retirá-lo seria pior do que esperar: a pessoa já teria visto números
// que talvez não sejam dela.
export function AcessoEmVerificacao() {
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

export function AccessDenied({ db }) {
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

export function MetricCard({ label, value, detail, tone = "neutral" }) {
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

export function AreaSection({ area, grupos }) {
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

export function ProductCard({ product, active, onSelect }) {
  return (
    <button className={`tdg-product-card ${active ? "active" : ""}`} type="button" onClick={() => onSelect(product.id)}>
      <span>{product.code}</span>
      <strong>{product.name}</strong>
      <small>{product.billingUnit} · {product.requiredFields.length} premissas</small>
    </button>
  );
}

export function DashboardPanel({ data, dashboard, tasks, onNavigate }) {
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
