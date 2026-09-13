import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  Building2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Leaf,
  ListChecks,
  Plus,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  MetricCard,
  PageHeader,
} from "../../design-system/index.js";
import VerticalSwitcher from "../verticals/VerticalSwitcher.jsx";
import {
  GREEN_ON_CLIENT_SEGMENTS,
  GREEN_ON_ENERGY_SOURCES,
  GREEN_ON_PIPELINE_STAGES,
  createGreenOnOpportunity,
  createGreenOnSite,
  isOpen,
  operationalSummary,
  opportunityAlerts,
  pipelineSummary,
  stageById,
  stageMetrics,
} from "./greenOnCrmDomain.js";
import "./greenOn.css";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const NAV_TABS = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard },
  { id: "crm", label: "CRM Green On", icon: Users },
  { id: "pipeline", label: "Funil", icon: ClipboardList },
  { id: "sites", label: "Sites", icon: Building2 },
  { id: "operacao", label: "Operação", icon: Activity },
];

const OPERATIONAL_LINKS = [
  {
    id: "pontos",
    title: "Pontos de recarga",
    description: "Cadastro dos carregadores próprios (Ground, GreenOn e parceiros) que entram no mapa e no roteirizador.",
    href: "/todogreen/pontos-recarga",
    icon: BatteryCharging,
  },
  {
    id: "sessoes",
    title: "Sessões de recarga",
    description: "Sessões medidas — kWh, duração, valor — vindas do CSMS ou lançamento manual.",
    href: "/todogreen/energia",
    icon: Zap,
  },
  {
    id: "energia",
    title: "Energia",
    description: "Consumo, fonte (rede/solar/BESS), tarifa e janelas de ponta.",
    href: "/todogreen/energia",
    icon: Leaf,
  },
];

function readGreenOn(db) {
  const raw = db?.greenOn || {};
  return {
    opportunities: Array.isArray(raw.opportunities) ? raw.opportunities : [],
    sites: Array.isArray(raw.sites) ? raw.sites : [],
  };
}

function writeGreenOn(update, mutator) {
  update((current) => {
    const previous = readGreenOn(current);
    const next = mutator(previous) || previous;
    return { ...current, greenOn: next };
  });
}

function AtalhoVoltar() {
  return (
    <a href="/todogreen" className="green-on-back" aria-label="Voltar ao ambiente To Do Green">
      <ArrowLeft size={16} aria-hidden="true" />
      <span>Voltar ao ERP</span>
    </a>
  );
}

function DashboardPanel({ data }) {
  const resumo = useMemo(() => pipelineSummary(data.opportunities), [data.opportunities]);
  const operacao = useMemo(
    () => operationalSummary(data.opportunities, data.sites),
    [data.opportunities, data.sites],
  );

  return (
    <div className="green-on-grid">
      <MetricCard
        label="Oportunidades abertas"
        value={number.format(resumo.open)}
        hint={`${resumo.won} em operação · ${resumo.lost} perdidas`}
        icon={ClipboardList}
      />
      <MetricCard
        label="Forecast anual (ponderado)"
        value={BRL.format(resumo.forecastAnnualRevenue)}
        hint="Receita esperada de energia e serviço"
        icon={Gauge}
      />
      <MetricCard
        label="CAPEX em avaliação"
        value={BRL.format(resumo.pipelineCapex)}
        hint="Investimento previsto para os sites em construção"
        icon={Zap}
      />
      <MetricCard
        label="Carregadores planejados"
        value={number.format(resumo.plannedChargers)}
        hint={`${operacao.sitesEmConstrucao} sites em construção`}
        icon={BatteryCharging}
      />
      <MetricCard
        label="Sites em operação"
        value={number.format(operacao.sitesEmOperacao)}
        hint={`${operacao.sitesAtivos} sites ativos no cadastro`}
        icon={Building2}
      />
      <MetricCard
        label="Potência contratada"
        value={`${number.format(operacao.potenciaContratadaKw)} kW`}
        hint="Somatório dos sites ativos"
        icon={Activity}
      />
    </div>
  );
}

function PipelineBoard({ data }) {
  const metricas = useMemo(() => stageMetrics(data.opportunities), [data.opportunities]);
  const abertas = useMemo(() => data.opportunities.filter(isOpen), [data.opportunities]);

  return (
    <div className="green-on-pipeline">
      <div className="green-on-pipeline-summary">
        {metricas.map((etapa) => (
          <div key={etapa.id} className={`green-on-stage ${etapa.closed ? "is-closed" : ""}`}>
            <div className="green-on-stage-title">{etapa.name}</div>
            <div className="green-on-stage-count">{etapa.total}</div>
            <div className="green-on-stage-hint">
              CAPEX {BRL.format(etapa.pipelineCapex)} · Forecast {BRL.format(etapa.forecastRevenue)}
            </div>
          </div>
        ))}
      </div>
      <Card
        title="Oportunidades em curso"
        kicker={`${abertas.length} abertas`}
      >
        {abertas.length === 0 && (
          <p className="green-on-empty">Sem oportunidades abertas. Cadastre uma no CRM.</p>
        )}
        {abertas.length > 0 && (
          <ul className="green-on-list">
            {abertas.map((opp) => {
              const stage = stageById(opp.stageId);
              const alertas = opportunityAlerts(opp);
              return (
                <li key={opp.id}>
                  <div className="green-on-list-title">
                    <strong>{opp.title || "Oportunidade sem título"}</strong>
                    <Badge>{stage?.name || opp.stageId}</Badge>
                  </div>
                  <div className="green-on-list-meta">
                    {opp.clientName || "Cliente não informado"} · {opp.estimatedChargers || 0} carregadores ·{" "}
                    {BRL.format(opp.monthlyRevenueBRL || 0)}/mês
                  </div>
                  {alertas.length > 0 && (
                    <div className="green-on-list-alerts" role="status">
                      {alertas.map((a) => (
                        <span key={a}>{a}</span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

const NEW_OPP = () => ({
  title: "",
  clientName: "",
  siteId: "",
  stageId: "lead",
  estimatedChargers: "",
  estimatedKw: "",
  capexBRL: "",
  monthlyRevenueBRL: "",
  ownerId: "",
  expectedGoLive: "",
  notes: "",
});

function CrmPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_OPP());
  const [saving, setSaving] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim() && !form.clientName.trim()) {
      setToast?.("Informe título ou nome do cliente antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      const nova = createGreenOnOpportunity(form);
      writeGreenOn(update, (current) => ({
        ...current,
        opportunities: [...current.opportunities, nova],
      }));
      setForm(NEW_OPP());
      setToast?.("Oportunidade Green On registrada.");
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível salvar a oportunidade.");
    } finally {
      setSaving(false);
    }
  };

  const mudarEtapa = (opp, stageId) => {
    writeGreenOn(update, (current) => ({
      ...current,
      opportunities: current.opportunities.map((item) =>
        item.id === opp.id ? { ...item, stageId, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const remover = (opp) => {
    writeGreenOn(update, (current) => ({
      ...current,
      opportunities: current.opportunities.filter((item) => item.id !== opp.id),
    }));
    setToast?.("Oportunidade removida.");
  };

  return (
    <div className="green-on-crm">
      <Card
        title="Nova oportunidade"
        kicker="Pipeline Green On (energia)"
      >
        <form className="green-on-form" onSubmit={submit}>
          <label>
            Título
            <input
              type="text"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Ex.: Instalação de 6 carregadores no Shopping X"
            />
          </label>
          <label>
            Cliente
            <input
              type="text"
              value={form.clientName}
              onChange={(event) => setForm({ ...form, clientName: event.target.value })}
            />
          </label>
          <label>
            Etapa
            <select
              value={form.stageId}
              onChange={(event) => setForm({ ...form, stageId: event.target.value })}
            >
              {GREEN_ON_PIPELINE_STAGES.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.name}</option>
              ))}
            </select>
          </label>
          <label>
            Carregadores estimados
            <input
              type="number"
              min="0"
              value={form.estimatedChargers}
              onChange={(event) => setForm({ ...form, estimatedChargers: event.target.value })}
            />
          </label>
          <label>
            Potência total (kW)
            <input
              type="number"
              min="0"
              value={form.estimatedKw}
              onChange={(event) => setForm({ ...form, estimatedKw: event.target.value })}
            />
          </label>
          <label>
            CAPEX estimado (R$)
            <input
              type="number"
              min="0"
              value={form.capexBRL}
              onChange={(event) => setForm({ ...form, capexBRL: event.target.value })}
            />
          </label>
          <label>
            Receita mensal esperada (R$)
            <input
              type="number"
              min="0"
              value={form.monthlyRevenueBRL}
              onChange={(event) => setForm({ ...form, monthlyRevenueBRL: event.target.value })}
            />
          </label>
          <label>
            Previsão de operação
            <input
              type="date"
              value={form.expectedGoLive}
              onChange={(event) => setForm({ ...form, expectedGoLive: event.target.value })}
            />
          </label>
          <label className="green-on-form-full">
            Observações
            <textarea
              rows="2"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <div className="green-on-form-actions">
            <Button type="submit" icon={Plus} loading={saving}>Salvar oportunidade</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Oportunidades registradas"
        kicker={`${data.opportunities.length} no total`}
      >
        {data.opportunities.length === 0 && (
          <p className="green-on-empty">Nenhuma oportunidade cadastrada ainda.</p>
        )}
        {data.opportunities.length > 0 && (
          <table className="green-on-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Cliente</th>
                <th>Etapa</th>
                <th>Receita/mês</th>
                <th>CAPEX</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {data.opportunities.map((opp) => (
                <tr key={opp.id}>
                  <td>{opp.title || "—"}</td>
                  <td>{opp.clientName || "—"}</td>
                  <td>
                    <select
                      value={opp.stageId}
                      onChange={(event) => mudarEtapa(opp, event.target.value)}
                    >
                      {GREEN_ON_PIPELINE_STAGES.map((stage) => (
                        <option key={stage.id} value={stage.id}>{stage.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>{BRL.format(opp.monthlyRevenueBRL || 0)}</td>
                  <td>{BRL.format(opp.capexBRL || 0)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => remover(opp)}
                      aria-label={`Remover ${opp.title || opp.clientName || "oportunidade"}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const NEW_SITE = () => ({
  name: "",
  clientName: "",
  segment: "",
  city: "",
  state: "",
  energySource: "",
  contractedDemandKw: "",
  chargerCount: "",
});

function SitesPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_SITE());
  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setToast?.("Informe o nome do site.");
      return;
    }
    const novo = createGreenOnSite(form);
    writeGreenOn(update, (current) => ({
      ...current,
      sites: [...current.sites, novo],
    }));
    setForm(NEW_SITE());
    setToast?.("Site Green On registrado.");
  };
  const remover = (site) => {
    writeGreenOn(update, (current) => ({
      ...current,
      sites: current.sites.filter((item) => item.id !== site.id),
    }));
    setToast?.("Site removido.");
  };

  return (
    <div className="green-on-sites">
      <Card title="Novo site" kicker="Cadastro do local de recarga">
        <form className="green-on-form" onSubmit={submit}>
          <label>
            Nome do site
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            Cliente
            <input
              type="text"
              value={form.clientName}
              onChange={(event) => setForm({ ...form, clientName: event.target.value })}
            />
          </label>
          <label>
            Segmento
            <select
              value={form.segment}
              onChange={(event) => setForm({ ...form, segment: event.target.value })}
            >
              <option value="">Selecione...</option>
              {GREEN_ON_CLIENT_SEGMENTS.map((seg) => (
                <option key={seg} value={seg}>{seg}</option>
              ))}
            </select>
          </label>
          <label>
            Cidade
            <input
              type="text"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
          </label>
          <label>
            UF
            <input
              type="text"
              maxLength="2"
              value={form.state}
              onChange={(event) => setForm({ ...form, state: event.target.value })}
            />
          </label>
          <label>
            Fonte de energia
            <select
              value={form.energySource}
              onChange={(event) => setForm({ ...form, energySource: event.target.value })}
            >
              <option value="">Selecione...</option>
              {GREEN_ON_ENERGY_SOURCES.map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </label>
          <label>
            Demanda contratada (kW)
            <input
              type="number"
              min="0"
              value={form.contractedDemandKw}
              onChange={(event) => setForm({ ...form, contractedDemandKw: event.target.value })}
            />
          </label>
          <label>
            Carregadores instalados
            <input
              type="number"
              min="0"
              value={form.chargerCount}
              onChange={(event) => setForm({ ...form, chargerCount: event.target.value })}
            />
          </label>
          <div className="green-on-form-actions">
            <Button type="submit" icon={Plus}>Salvar site</Button>
          </div>
        </form>
      </Card>
      <Card title="Sites cadastrados" kicker={`${data.sites.length} no total`}>
        {data.sites.length === 0 && (
          <p className="green-on-empty">Nenhum site cadastrado ainda.</p>
        )}
        {data.sites.length > 0 && (
          <table className="green-on-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cliente</th>
                <th>Cidade/UF</th>
                <th>Fonte</th>
                <th>kW</th>
                <th>Carregadores</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {data.sites.map((site) => (
                <tr key={site.id}>
                  <td>{site.name}</td>
                  <td>{site.clientName || "—"}</td>
                  <td>{site.city}{site.state ? ` / ${site.state}` : ""}</td>
                  <td>{site.energySource || "—"}</td>
                  <td>{number.format(site.contractedDemandKw)}</td>
                  <td>{number.format(site.chargerCount)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => remover(site)}
                      aria-label={`Remover site ${site.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function OperationPanel() {
  return (
    <div className="green-on-operacao">
      <p className="green-on-help">
        A operação de recarga (pontos, sessões, energia e tarifas) usa a mesma
        infraestrutura do ambiente principal — a Green On abre estas telas
        diretamente para preservar dados, integrações e o roteirizador.
      </p>
      <div className="green-on-grid">
        {OPERATIONAL_LINKS.map(({ id, title, description, href, icon: Icon }) => (
          <a key={id} href={href} className="green-on-op-card">
            <div className="green-on-op-icon" aria-hidden="true"><Icon size={22} /></div>
            <div className="green-on-op-body">
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function GreenOnVertical({ db, update, setToast }) {
  const [tab, setTab] = useState("dashboard");
  const data = useMemo(() => readGreenOn(db), [db]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Green On | Recarga e energia";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="green-on-shell">
      <PageHeader
        kicker="Green On"
        title="Eletromobilidade e energia"
        subtitle="CRM próprio, funil de energia e conexão com a operação de recarga."
        actions={<AtalhoVoltar />}
      />
      <nav className="green-on-tabs" aria-label="Áreas da vertical Green On">
        {NAV_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`green-on-tab ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="green-on-content">
        {tab === "dashboard" && (
          <>
            <DashboardPanel data={data} />
            <Card title="Verticais da plataforma" kicker="Compartilham a mesma base de usuários, clientes e ativos">
              <VerticalSwitcher current="greenon" />
            </Card>
          </>
        )}
        {tab === "crm" && (
          <CrmPanel data={data} update={update} setToast={setToast} />
        )}
        {tab === "pipeline" && <PipelineBoard data={data} />}
        {tab === "sites" && (
          <SitesPanel data={data} update={update} setToast={setToast} />
        )}
        {tab === "operacao" && <OperationPanel />}
      </section>

      <footer className="green-on-foot">
        <ListChecks size={14} aria-hidden="true" />
        <span>
          Dados de CRM e sites da Green On ficam no espaço de trabalho.
          Sessões medidas, faturamento e OCPP continuam nas telas de operação.
        </span>
      </footer>
    </div>
  );
}
