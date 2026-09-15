import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  Building2,
  ClipboardList,
  Contact,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  Leaf,
  ListChecks,
  Newspaper,
  Plus,
  Star,
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
  GREEN_ON_ACCOUNT_STAGES,
  GREEN_ON_ACCOUNT_TEMPERATURES,
  GREEN_ON_ACCOUNT_TIERS,
  GREEN_ON_CLIENT_SEGMENTS,
  GREEN_ON_ENERGY_SOURCES,
  GREEN_ON_PIPELINE_STAGES,
  GREEN_ON_RELATIONSHIP_ROLES,
  buildGreenOnCommandCenter,
  createGreenOnAccount,
  createGreenOnContact,
  createGreenOnOpportunity,
  createGreenOnSite,
  isOpen,
  operationalSummary,
  opportunityAlerts,
  pipelineSummary,
  stageById,
  stageMetrics,
  weightedAnnualRevenue,
} from "./greenOnCrmDomain.js";
import {
  GREEN_ON_TEMAS_DE_NOTICIA,
  createGreenOnNoticia,
  filtrarFeedGreenOn,
  resumirFeedGreenOn,
} from "./greenOnNoticiaDomain.js";
import "./greenOn.css";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const NAV_TABS = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard },
  { id: "contas", label: "Contas", icon: Users },
  { id: "contatos", label: "Contatos", icon: Contact },
  { id: "oportunidades", label: "Oportunidades", icon: ClipboardList },
  { id: "pipeline", label: "Funil", icon: Gauge },
  { id: "noticias", label: "Notícias", icon: Newspaper },
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
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    opportunities: Array.isArray(raw.opportunities) ? raw.opportunities : [],
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    noticias: Array.isArray(raw.noticias) ? raw.noticias : [],
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
  accountId: "",
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

function OpportunitiesPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_OPP());
  const [saving, setSaving] = useState(false);
  const [filtroEtapa, setFiltroEtapa] = useState("todas");

  // Painel analítico da carteira — igual ao TDG, com resumo (abertas,
  // ganhas, perdidas), CAPEX e forecast, e por-etapa. Fica no topo da aba.
  const resumo = useMemo(() => pipelineSummary(data.opportunities), [data.opportunities]);
  const metricasEtapa = useMemo(() => stageMetrics(data.opportunities), [data.opportunities]);

  const listaFiltrada = useMemo(() => {
    if (filtroEtapa === "todas") return data.opportunities;
    if (filtroEtapa === "abertas") return data.opportunities.filter(isOpen);
    return data.opportunities.filter((opp) => opp.stageId === filtroEtapa);
  }, [data.opportunities, filtroEtapa]);

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

  const nomeDaConta = (id) => {
    const conta = data.accounts.find((c) => c.id === id);
    return conta ? (conta.legalName || conta.tradeName) : "";
  };

  return (
    <div className="green-on-crm">
      <div className="green-on-grid">
        <MetricCard label="Abertas" value={number.format(resumo.open)} hint={`${resumo.won} em operação · ${resumo.lost} perdidas`} icon={ClipboardList} />
        <MetricCard label="CAPEX no pipeline" value={BRL.format(resumo.pipelineCapex)} hint="Somatório das oportunidades abertas" icon={Zap} />
        <MetricCard label="Forecast anual" value={BRL.format(resumo.forecastAnnualRevenue)} hint="Receita anual esperada · ponderada" icon={Gauge} />
        <MetricCard label="Carregadores planejados" value={number.format(resumo.plannedChargers)} hint="Em oportunidades abertas" icon={BatteryCharging} />
      </div>

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
            Conta Green On (opcional)
            <select
              value={form.accountId}
              onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            >
              <option value="">Sem conta vinculada</option>
              {data.accounts.map((conta) => (
                <option key={conta.id} value={conta.id}>{conta.legalName || conta.tradeName}</option>
              ))}
            </select>
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
        kicker={`${listaFiltrada.length} / ${data.opportunities.length}`}
        actions={(
          <div className="green-on-filter" role="group" aria-label="Filtrar oportunidades por etapa">
            {[
              { id: "todas", label: "Todas" },
              { id: "abertas", label: "Abertas" },
              ...GREEN_ON_PIPELINE_STAGES.map((s) => ({ id: s.id, label: s.name })),
            ].map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => setFiltroEtapa(op.id)}
                className={`green-on-filter-btn ${filtroEtapa === op.id ? "is-active" : ""}`}
              >
                {op.label}
              </button>
            ))}
          </div>
        )}
      >
        {listaFiltrada.length === 0 && (
          <p className="green-on-empty">Nenhuma oportunidade nesse filtro.</p>
        )}
        {listaFiltrada.length > 0 && (
          <table className="green-on-table">
            <thead>
              <tr>
                <th>Título / Cliente</th>
                <th>Conta Green On</th>
                <th>Etapa</th>
                <th>Receita/mês</th>
                <th>CAPEX</th>
                <th>Forecast anual (ponderado)</th>
                <th>Alertas</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((opp) => {
                const alertas = opportunityAlerts(opp);
                const nomeConta = opp.accountId ? nomeDaConta(opp.accountId) : "";
                return (
                  <tr key={opp.id}>
                    <td>
                      <strong>{opp.title || "—"}</strong>
                      <br />
                      <small>{opp.clientName || "Cliente não informado"}</small>
                    </td>
                    <td>{nomeConta || <em>—</em>}</td>
                    <td>
                      <select
                        value={opp.stageId}
                        onChange={(event) => mudarEtapa(opp, event.target.value)}
                      >
                        {GREEN_ON_PIPELINE_STAGES.map((stage) => (
                          <option key={stage.id} value={stage.id}>{stage.name}</option>
                        ))}
                      </select>
                      <br />
                      <small>{stageById(opp.stageId)?.probability || 0}% de probabilidade</small>
                    </td>
                    <td>{BRL.format(opp.monthlyRevenueBRL || 0)}</td>
                    <td>{BRL.format(opp.capexBRL || 0)}</td>
                    <td>{BRL.format(weightedAnnualRevenue(opp))}</td>
                    <td>
                      {alertas.length === 0 ? (
                        <span className="green-on-saude green-on-saude--ok">OK</span>
                      ) : (
                        <ul className="green-on-list-alerts" aria-label="Alertas da oportunidade">
                          {alertas.map((a) => (<li key={a}><span>{a}</span></li>))}
                        </ul>
                      )}
                    </td>
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
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Distribuição por etapa"
        kicker="Ler a carteira etapa por etapa"
      >
        <div className="green-on-pipeline-summary">
          {metricasEtapa.map((etapa) => (
            <div key={etapa.id} className={`green-on-stage ${etapa.closed ? "is-closed" : ""}`}>
              <div className="green-on-stage-title">{etapa.name}</div>
              <div className="green-on-stage-count">{etapa.total}</div>
              <div className="green-on-stage-hint">
                CAPEX {BRL.format(etapa.pipelineCapex)} · Forecast {BRL.format(etapa.forecastRevenue)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===== Contas (empresas/clientes Green On) =====
//
// Painel espelha o CRM comercial da TDG: cadastro rico (tier, temperatura,
// estágio, potencial), notas de saúde (potencial estratégico, aderência
// energética, maturidade de eletrificação) e resumo por conta com pipeline,
// contatos ativos e classificação. Dados 100% independentes do CRM logístico.

const NEW_ACCOUNT = () => ({
  legalName: "",
  tradeName: "",
  document: "",
  segment: "",
  tier: "Enterprise",
  temperature: "",
  stage: "Mapeamento",
  headquarters: "",
  city: "",
  state: "",
  ownerId: "",
  strategicPotential: "",
  energyFit: "",
  electrificationMaturity: "",
  relationshipStrength: "",
  esgFit: "",
  dataQuality: "",
  regulatoryRisk: "",
  churnRisk: "",
  nextAction: "",
  nextActionAt: "",
  potentialAnnual: "",
  potentialChargers: "",
  potentialKw: "",
  source: "",
  notes: "",
});

const CLASSIFICACAO_BADGE = {
  critical: { label: "Crítica", tom: "risk" },
  attention: { label: "Atenção", tom: "warn" },
  healthy: { label: "Saudável", tom: "ok" },
};

function AccountsPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_ACCOUNT());
  const [saving, setSaving] = useState(false);
  const [filtroClass, setFiltroClass] = useState("todas");

  const painel = useMemo(
    () => buildGreenOnCommandCenter(data.accounts, data.contacts, data.opportunities),
    [data.accounts, data.contacts, data.opportunities],
  );

  const listaFiltrada = useMemo(() => {
    if (filtroClass === "todas") return painel.resumos;
    return painel.resumos.filter((r) => r.classificacao === filtroClass);
  }, [painel.resumos, filtroClass]);

  const submit = (event) => {
    event.preventDefault();
    if (!form.legalName.trim() && !form.tradeName.trim()) {
      setToast?.("Informe o nome legal ou fantasia da conta.");
      return;
    }
    setSaving(true);
    try {
      const nova = createGreenOnAccount(form);
      writeGreenOn(update, (current) => ({
        ...current,
        accounts: [...current.accounts, nova],
      }));
      setForm(NEW_ACCOUNT());
      setToast?.("Conta Green On registrada.");
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível salvar a conta.");
    } finally {
      setSaving(false);
    }
  };

  const mudarStage = (conta, stage) => {
    writeGreenOn(update, (current) => ({
      ...current,
      accounts: current.accounts.map((item) =>
        item.id === conta.id ? { ...item, stage, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const remover = (conta) => {
    writeGreenOn(update, (current) => ({
      ...current,
      accounts: current.accounts.filter((item) => item.id !== conta.id),
    }));
    setToast?.("Conta removida.");
  };

  return (
    <div className="green-on-crm">
      <div className="green-on-grid">
        <MetricCard label="Contas cadastradas" value={number.format(painel.total)} hint={`${painel.saudaveis} saudáveis`} icon={Users} />
        <MetricCard label="Contas críticas" value={number.format(painel.criticas)} hint={`${painel.atencao} em atenção`} icon={ListChecks} />
        <MetricCard label="CAPEX em pipeline" value={BRL.format(painel.pipelineCapex)} hint="Soma das oportunidades abertas" icon={Zap} />
        <MetricCard label="Forecast ponderado" value={BRL.format(painel.forecast)} hint="Receita anual esperada" icon={Gauge} />
      </div>

      <Card title="Nova conta Green On" kicker="CRM comercial · igual estrutura do ERP, dados independentes">
        <form className="green-on-form" onSubmit={submit}>
          <label>
            Nome legal
            <input type="text" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} />
          </label>
          <label>
            Nome fantasia
            <input type="text" value={form.tradeName} onChange={(event) => setForm({ ...form, tradeName: event.target.value })} />
          </label>
          <label>
            CNPJ
            <input type="text" value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} />
          </label>
          <label>
            Segmento
            <select value={form.segment} onChange={(event) => setForm({ ...form, segment: event.target.value })}>
              <option value="">Selecione...</option>
              {GREEN_ON_CLIENT_SEGMENTS.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
          <label>
            Tier
            <select value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value })}>
              {GREEN_ON_ACCOUNT_TIERS.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </label>
          <label>
            Temperatura
            <select value={form.temperature} onChange={(event) => setForm({ ...form, temperature: event.target.value })}>
              <option value="">—</option>
              {GREEN_ON_ACCOUNT_TEMPERATURES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </label>
          <label>
            Etapa
            <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
              {GREEN_ON_ACCOUNT_STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
          <label>
            Cidade
            <input type="text" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
          </label>
          <label>
            UF
            <input type="text" maxLength="2" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
          </label>
          <label>
            Potencial estratégico (0-100)
            <input type="number" min="0" max="100" value={form.strategicPotential} onChange={(event) => setForm({ ...form, strategicPotential: event.target.value })} />
          </label>
          <label>
            Aderência energética (0-100)
            <input type="number" min="0" max="100" value={form.energyFit} onChange={(event) => setForm({ ...form, energyFit: event.target.value })} />
          </label>
          <label>
            Maturidade de eletrificação (0-100)
            <input type="number" min="0" max="100" value={form.electrificationMaturity} onChange={(event) => setForm({ ...form, electrificationMaturity: event.target.value })} />
          </label>
          <label>
            Força do relacionamento (0-100)
            <input type="number" min="0" max="100" value={form.relationshipStrength} onChange={(event) => setForm({ ...form, relationshipStrength: event.target.value })} />
          </label>
          <label>
            Aderência ESG (0-100)
            <input type="number" min="0" max="100" value={form.esgFit} onChange={(event) => setForm({ ...form, esgFit: event.target.value })} />
          </label>
          <label>
            Qualidade dos dados (0-100)
            <input type="number" min="0" max="100" value={form.dataQuality} onChange={(event) => setForm({ ...form, dataQuality: event.target.value })} />
          </label>
          <label>
            Risco regulatório (0-100)
            <input type="number" min="0" max="100" value={form.regulatoryRisk} onChange={(event) => setForm({ ...form, regulatoryRisk: event.target.value })} />
          </label>
          <label>
            Risco de perda (0-100)
            <input type="number" min="0" max="100" value={form.churnRisk} onChange={(event) => setForm({ ...form, churnRisk: event.target.value })} />
          </label>
          <label>
            Próxima ação
            <input type="text" value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} />
          </label>
          <label>
            Data da próxima ação
            <input type="date" value={form.nextActionAt} onChange={(event) => setForm({ ...form, nextActionAt: event.target.value })} />
          </label>
          <label>
            Potencial anual (R$)
            <input type="number" min="0" value={form.potentialAnnual} onChange={(event) => setForm({ ...form, potentialAnnual: event.target.value })} />
          </label>
          <label>
            Potencial de carregadores
            <input type="number" min="0" value={form.potentialChargers} onChange={(event) => setForm({ ...form, potentialChargers: event.target.value })} />
          </label>
          <label className="green-on-form-full">
            Observações
            <textarea rows="2" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="green-on-form-actions">
            <Button type="submit" icon={Plus} loading={saving}>Salvar conta</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Carteira Green On"
        kicker={`${listaFiltrada.length} conta(s)`}
        actions={(
          <div className="green-on-filter" role="group" aria-label="Filtrar contas">
            {[
              { id: "todas", label: "Todas" },
              { id: "critical", label: "Críticas" },
              { id: "attention", label: "Atenção" },
              { id: "healthy", label: "Saudáveis" },
            ].map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => setFiltroClass(op.id)}
                className={`green-on-filter-btn ${filtroClass === op.id ? "is-active" : ""}`}
              >
                {op.label}
              </button>
            ))}
          </div>
        )}
      >
        {listaFiltrada.length === 0 && (
          <p className="green-on-empty">Nenhuma conta com esse filtro.</p>
        )}
        {listaFiltrada.length > 0 && (
          <table className="green-on-table">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tier</th>
                <th>Etapa</th>
                <th>Saúde</th>
                <th>CAPEX pipeline</th>
                <th>Próxima ação</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((conta) => {
                const contaCompleta = data.accounts.find((c) => c.id === conta.id);
                const badge = CLASSIFICACAO_BADGE[conta.classificacao] || CLASSIFICACAO_BADGE.attention;
                return (
                  <tr key={conta.id}>
                    <td>
                      <strong>{conta.legalName || conta.tradeName || "—"}</strong>
                      <br />
                      <small>{conta.city}{conta.state ? ` / ${conta.state}` : ""} · {conta.contactsCount} contato(s)</small>
                    </td>
                    <td>{conta.tier}</td>
                    <td>
                      <select
                        value={conta.stage}
                        onChange={(event) => mudarStage(contaCompleta, event.target.value)}
                      >
                        {GREEN_ON_ACCOUNT_STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
                      </select>
                    </td>
                    <td>
                      <span className={`green-on-saude green-on-saude--${badge.tom}`}>
                        {conta.score}
                        <small>{badge.label}</small>
                      </span>
                      {conta.alerts.length > 0 && (
                        <div className="green-on-list-alerts">
                          <span>{conta.alerts[0]}</span>
                        </div>
                      )}
                    </td>
                    <td>{BRL.format(conta.pipelineCapex)}</td>
                    <td>{conta.nextAction || <em>—</em>}<br /><small>{conta.nextActionAt || ""}</small></td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={() => remover(contaCompleta)}
                        aria-label={`Remover ${conta.legalName}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ===== Contatos (papéis de relacionamento no site/cliente) =====

const NEW_CONTACT = () => ({
  accountId: "",
  name: "",
  title: "",
  department: "",
  email: "",
  phone: "",
  linkedin: "",
  relationshipRole: "Decisor técnico",
  influence: "",
  supportLevel: "",
  accessLevel: "",
  preferredChannel: "",
  personalNotes: "",
  objections: "",
  priorities: "",
});

function ContactsPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_CONTACT());
  const [saving, setSaving] = useState(false);
  const [filtroConta, setFiltroConta] = useState("");

  const listaFiltrada = useMemo(() => {
    if (!filtroConta) return data.contacts;
    return data.contacts.filter((c) => c.accountId === filtroConta);
  }, [data.contacts, filtroConta]);

  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setToast?.("Informe o nome do contato.");
      return;
    }
    setSaving(true);
    try {
      const novo = createGreenOnContact(form);
      writeGreenOn(update, (current) => ({
        ...current,
        contacts: [...current.contacts, novo],
      }));
      setForm(NEW_CONTACT());
      setToast?.("Contato registrado.");
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível salvar o contato.");
    } finally {
      setSaving(false);
    }
  };

  const remover = (contato) => {
    writeGreenOn(update, (current) => ({
      ...current,
      contacts: current.contacts.filter((item) => item.id !== contato.id),
    }));
    setToast?.("Contato removido.");
  };

  const trocarPapel = (contato, relationshipRole) => {
    writeGreenOn(update, (current) => ({
      ...current,
      contacts: current.contacts.map((item) =>
        item.id === contato.id ? { ...item, relationshipRole, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const nomeDaConta = (id) => {
    const conta = data.accounts.find((c) => c.id === id);
    return conta ? (conta.legalName || conta.tradeName) : "Conta removida";
  };

  return (
    <div className="green-on-crm">
      <Card title="Novo contato" kicker="Contatos são vinculados a uma conta Green On">
        <form className="green-on-form" onSubmit={submit}>
          <label>
            Nome
            <input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Cargo
            <input type="text" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Área
            <input type="text" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
          </label>
          <label>
            Papel no relacionamento
            <select value={form.relationshipRole} onChange={(event) => setForm({ ...form, relationshipRole: event.target.value })}>
              {GREEN_ON_RELATIONSHIP_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </label>
          <label>
            Conta Green On
            <select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
              <option value="">Sem conta vinculada</option>
              {data.accounts.map((conta) => (
                <option key={conta.id} value={conta.id}>{conta.legalName || conta.tradeName}</option>
              ))}
            </select>
          </label>
          <label>
            E-mail
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Telefone
            <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            LinkedIn
            <input type="url" value={form.linkedin} onChange={(event) => setForm({ ...form, linkedin: event.target.value })} />
          </label>
          <label>
            Canal preferido
            <input type="text" value={form.preferredChannel} onChange={(event) => setForm({ ...form, preferredChannel: event.target.value })} placeholder="WhatsApp, e-mail, ligação" />
          </label>
          <label>
            Influência (0-100)
            <input type="number" min="0" max="100" value={form.influence} onChange={(event) => setForm({ ...form, influence: event.target.value })} />
          </label>
          <label>
            Nível de apoio (-100 a 100)
            <input type="number" min="-100" max="100" value={form.supportLevel} onChange={(event) => setForm({ ...form, supportLevel: event.target.value })} />
          </label>
          <label className="green-on-form-full">
            Prioridades da pessoa
            <textarea rows="2" value={form.priorities} onChange={(event) => setForm({ ...form, priorities: event.target.value })} />
          </label>
          <label className="green-on-form-full">
            Objeções conhecidas
            <textarea rows="2" value={form.objections} onChange={(event) => setForm({ ...form, objections: event.target.value })} />
          </label>
          <div className="green-on-form-actions">
            <Button type="submit" icon={Plus} loading={saving}>Salvar contato</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Contatos"
        kicker={`${listaFiltrada.length} contato(s)`}
        actions={(
          <select value={filtroConta} onChange={(event) => setFiltroConta(event.target.value)}>
            <option value="">Todas as contas</option>
            {data.accounts.map((conta) => (
              <option key={conta.id} value={conta.id}>{conta.legalName || conta.tradeName}</option>
            ))}
          </select>
        )}
      >
        {listaFiltrada.length === 0 && (
          <p className="green-on-empty">Nenhum contato cadastrado ainda.</p>
        )}
        {listaFiltrada.length > 0 && (
          <table className="green-on-table">
            <thead>
              <tr>
                <th>Contato</th>
                <th>Conta</th>
                <th>Papel</th>
                <th>Influência</th>
                <th>Apoio</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((contato) => (
                <tr key={contato.id}>
                  <td>
                    <strong>{contato.name}</strong>
                    <br />
                    <small>{contato.title || "—"}{contato.department ? ` · ${contato.department}` : ""}</small>
                    {contato.email && <><br /><small>{contato.email}</small></>}
                  </td>
                  <td>{contato.accountId ? nomeDaConta(contato.accountId) : <em>Sem conta</em>}</td>
                  <td>
                    <select value={contato.relationshipRole} onChange={(event) => trocarPapel(contato, event.target.value)}>
                      {GREEN_ON_RELATIONSHIP_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                    </select>
                  </td>
                  <td>{contato.influence || 0}</td>
                  <td>{contato.supportLevel || 0}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => remover(contato)}
                      aria-label={`Remover ${contato.name}`}
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

// ===== Notícias Green On =====
//
// Feed local (persistido no espaço de trabalho), com léxico próprio do core
// da vertical: recarga, energia, e-mobilidade e regulatório. Notícia de
// logística pura é filtrada como fora-de-escopo (essa é da TDG). A liderança
// pode destacar uma notícia (highlighted) para ela ficar no topo do feed e
// aparecer no contador do painel.

const NEW_NOTICIA = () => ({
  title: "",
  summary: "",
  source: "",
  url: "",
  publishedAt: "",
  accountId: "",
  highlighted: false,
});

function NoticiasPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_NOTICIA());
  const [filtroTema, setFiltroTema] = useState("todas");
  const feed = useMemo(
    () => filtrarFeedGreenOn(data.noticias, filtroTema),
    [data.noticias, filtroTema],
  );
  const resumo = useMemo(() => resumirFeedGreenOn(data.noticias), [data.noticias]);

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim() && !form.summary.trim()) {
      setToast?.("Informe título ou resumo da notícia.");
      return;
    }
    const nova = createGreenOnNoticia(form);
    writeGreenOn(update, (current) => ({
      ...current,
      noticias: [...(current.noticias || []), nova],
    }));
    setForm(NEW_NOTICIA());
    setToast?.("Notícia adicionada ao radar Green On.");
  };

  const destacar = (noticia) => {
    writeGreenOn(update, (current) => ({
      ...current,
      noticias: (current.noticias || []).map((item) =>
        item.id === noticia.id ? { ...item, highlighted: !item.highlighted, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const remover = (noticia) => {
    writeGreenOn(update, (current) => ({
      ...current,
      noticias: (current.noticias || []).filter((item) => item.id !== noticia.id),
    }));
    setToast?.("Notícia removida do radar.");
  };

  const nomeDaConta = (id) => {
    const conta = data.accounts.find((c) => c.id === id);
    return conta ? (conta.legalName || conta.tradeName) : "";
  };

  return (
    <div className="green-on-crm">
      <div className="green-on-grid">
        <MetricCard label="Notícias no radar" value={number.format(resumo.total)} icon={Newspaper} hint={`${resumo.ultimos7dias} nos últimos 7 dias`} />
        <MetricCard label="Destacadas" value={number.format(resumo.destacadas)} icon={Star} hint="Aparecem no topo do feed" />
        <MetricCard label="Recarga" value={number.format(resumo.porTema.recarga || 0)} icon={BatteryCharging} hint={`Energia: ${resumo.porTema.energia || 0}`} />
        <MetricCard label="Regulatório" value={number.format(resumo.porTema.regulatorio || 0)} icon={ListChecks} hint={`E-mobilidade: ${resumo.porTema["e-mobilidade"] || 0}`} />
      </div>

      <Card title="Nova notícia" kicker="Radar do core Green On (recarga, energia, e-mobilidade, regulatório)">
        <form className="green-on-form" onSubmit={submit}>
          <label className="green-on-form-full">
            Título
            <input
              type="text"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Ex.: ANEEL abre consulta pública sobre tarifa branca"
            />
          </label>
          <label className="green-on-form-full">
            Resumo
            <textarea
              rows="2"
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </label>
          <label>
            Fonte
            <input type="text" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="ex.: Canal Solar, ABVE, Valor" />
          </label>
          <label>
            URL
            <input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label>
            Data de publicação
            <input type="date" value={form.publishedAt} onChange={(event) => setForm({ ...form, publishedAt: event.target.value })} />
          </label>
          <label>
            Conta relacionada (opcional)
            <select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
              <option value="">Nenhuma</option>
              {data.accounts.map((conta) => (
                <option key={conta.id} value={conta.id}>{conta.legalName || conta.tradeName}</option>
              ))}
            </select>
          </label>
          <label className="green-on-form-full green-on-form-inline">
            <input type="checkbox" checked={form.highlighted} onChange={(event) => setForm({ ...form, highlighted: event.target.checked })} />
            Marcar como destaque (fica no topo do radar)
          </label>
          <div className="green-on-form-actions">
            <Button type="submit" icon={Plus}>Salvar notícia</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Radar Green On"
        kicker={`${feed.length} notícia(s) · filtro: ${GREEN_ON_TEMAS_DE_NOTICIA.find(([k]) => k === filtroTema)?.[1] || "Todas"}`}
        actions={(
          <div className="green-on-filter" role="group" aria-label="Filtrar notícias por tema">
            {GREEN_ON_TEMAS_DE_NOTICIA.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFiltroTema(key)}
                className={`green-on-filter-btn ${filtroTema === key ? "is-active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      >
        {feed.length === 0 && (
          <p className="green-on-empty">Sem notícias no radar (ou nada casou com o filtro). Notícias de logística/frete são filtradas como fora do escopo Green On.</p>
        )}
        {feed.length > 0 && (
          <ul className="green-on-noticias">
            {feed.map((noticia) => (
              <li key={noticia.id} className={noticia.highlighted ? "is-highlighted" : ""}>
                <div className="green-on-noticia-head">
                  <strong>{noticia.title || "(sem título)"}</strong>
                  <Badge>{GREEN_ON_TEMAS_DE_NOTICIA.find(([k]) => k === noticia.tema)?.[1] || "Outros"}</Badge>
                </div>
                {noticia.summary && <p className="green-on-noticia-body">{noticia.summary}</p>}
                <div className="green-on-noticia-meta">
                  {noticia.source && <span>{noticia.source}</span>}
                  {noticia.publishedAt && <span>· {noticia.publishedAt}</span>}
                  {noticia.accountId && <span>· Conta: {nomeDaConta(noticia.accountId)}</span>}
                </div>
                <div className="green-on-noticia-actions">
                  {noticia.url && (
                    <a href={noticia.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} aria-hidden="true" /> Abrir fonte
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Star}
                    onClick={() => destacar(noticia)}
                    aria-label={noticia.highlighted ? "Remover destaque" : "Marcar como destaque"}
                  >
                    {noticia.highlighted ? "Destacado" : "Destacar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => remover(noticia)}
                    aria-label={`Remover notícia ${noticia.title}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
      <div className="green-on-topbar">
        {/* Logo da To Do Green (marca do grupo) — mesma arte que aparece em
            todas as verticais; clicar volta ao painel principal da vertical
            atual, mantendo o gesto "logo = início" consistente. Substituiu o
            ModuleBadge numerado a pedido da titular. */}
        <a href="/greenon" className="green-on-brand" aria-label="Início — Green On">
          <img src="/logo-todo-green.png" alt="To Do Green" width="66" height="44" />
        </a>
        <AtalhoVoltar />
      </div>
      <PageHeader
        kicker="Green On"
        title="Eletromobilidade e energia"
        subtitle="CRM próprio, funil de energia e conexão com a operação de recarga."
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
        {tab === "contas" && (
          <AccountsPanel data={data} update={update} setToast={setToast} />
        )}
        {tab === "contatos" && (
          <ContactsPanel data={data} update={update} setToast={setToast} />
        )}
        {tab === "oportunidades" && (
          <OpportunitiesPanel data={data} update={update} setToast={setToast} />
        )}
        {tab === "pipeline" && <PipelineBoard data={data} />}
        {tab === "noticias" && (
          <NoticiasPanel data={data} update={update} setToast={setToast} />
        )}
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
