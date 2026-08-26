import { useEffect, useMemo, useState } from "react";
import { BarChart3, Plus, Save, Trash2 } from "lucide-react";
import WidgetChart from "./DashboardCharts.jsx";
import "./TodoGreenPages.css";

const METRICS = [
  ["clientes", "Clientes"], ["pipeline", "Pipeline"], ["receita", "Receita"],
  ["margem", "Margem"], ["propostas", "Propostas"], ["operacoes", "Operações"],
  ["co2-evitado", "CO₂ evitado"], ["green-score", "Green Score"],
  ["ocupacao", "Ocupação"], ["produtividade", "Produtividade"],
];
const TYPES = [["metric", "Número"], ["bar", "Barras"], ["line", "Evolução"], ["donut", "Distribuição"], ["table", "Tabela"]];
const blankWidget = () => ({ id: crypto.randomUUID(), title: "", type: "metric", metric: "clientes", size: "medium" });

const api = async (path, authHeaders, options = {}) => {
  const result = await fetch(`/api/todogreen/dashboards${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível salvar o painel.");
  return payload;
};

const metricValue = (metric, summary = {}) => ({
  clientes: summary.clientes ?? 0,
  pipeline: summary.pipeline ?? 0,
  receita: summary.receitaRealizada ?? summary.receitaPrevista ?? 0,
  margem: summary.margemOperacionalPercent ?? 0,
  propostas: summary.propostas ?? 0,
  operacoes: summary.operacoes ?? 0,
  "co2-evitado": summary.co2Evitado ?? 0,
  "green-score": summary.greenScore ?? 0,
  ocupacao: summary.ocupacao ?? 0,
  produtividade: summary.produtividade ?? 0,
}[metric] ?? 0);

export default function DashboardBuilderPage({ authHeaders, summary = {}, data = {}, setToast }) {
  const [dashboards, setDashboards] = useState([]);
  const [access, setAccess] = useState({ canManageTeam: false });
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ name: "", description: "", visibility: "personal", widgets: [blankWidget()] });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const selected = useMemo(() => dashboards.find((item) => item.id === selectedId), [dashboards, selectedId]);

  const load = async () => {
    setStatus("loading");
    try {
      const data = await api("", authHeaders);
      setDashboards(data.dashboards || []);
      setAccess(data.access || {});
      setStatus("ready");
    } catch (reason) { setError(reason.message); setStatus("error"); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setForm({ name: selected.name, description: selected.description, visibility: selected.visibility, widgets: selected.widgets, revision: selected.revision });
  }, [selected]);

  const updateWidget = (id, field, value) => setForm((current) => ({
    ...current,
    widgets: current.widgets.map((item) => item.id === id ? { ...item, [field]: value } : item),
  }));
  const save = async (event) => {
    event.preventDefault(); setError(""); setStatus("saving");
    try {
      const data = await api(selectedId ? `/${selectedId}` : "", authHeaders, {
        method: selectedId ? "PUT" : "POST", body: JSON.stringify(form),
      });
      setToast?.("Painel salvo.");
      setSelectedId(data.dashboard.id);
      await load();
    } catch (reason) { setError(reason.message); setStatus("error"); }
  };
  const remove = async () => {
    if (!selectedId) return;
    try {
      await api(`/${selectedId}`, authHeaders, { method: "DELETE" });
      setSelectedId(""); setForm({ name: "", description: "", visibility: "personal", widgets: [blankWidget()] });
      await load();
    } catch (reason) { setError(reason.message); }
  };

  return (
    <section className="tdg-panel tdg-page tdg-dashboard-builder">
      <header className="tdg-page-title">
        <div><span>COMERCIAL &amp; ESTRATÉGIA</span><h2>Meus painéis</h2><p>Monte visões diferentes para carteira, pipeline, resultado e indicadores ambientais.</p></div>
        <button type="button" className="tdg-action" onClick={() => { setSelectedId(""); setForm({ name: "", description: "", visibility: "personal", widgets: [blankWidget()] }); }}><Plus size={17} />Novo painel</button>
      </header>
      {error && <div className="tdg-page-error">{error}</div>}
      <div className="tdg-dashboard-layout">
        <aside className="tdg-dashboard-list">
          <strong>Painéis salvos</strong>
          {status === "loading" && <p>Carregando...</p>}
          {status !== "loading" && dashboards.length === 0 && <p>Nenhum painel criado.</p>}
          {dashboards.map((item) => <button type="button" className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)} key={item.id}><BarChart3 size={17} /><span><strong>{item.name}</strong><small>{item.visibility === "team" ? "Equipe" : "Pessoal"}</small></span></button>)}
        </aside>
        <form className="tdg-dashboard-form" onSubmit={save}>
          <div className="tdg-form-row"><label><span>Nome</span><input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label><span>Visibilidade</span><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="personal">Somente eu</option>{access.canManageTeam && <option value="team">Equipe</option>}</select></label></div>
          <label><span>Objetivo do painel</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="tdg-widget-editor-head"><strong>Indicadores</strong><button type="button" onClick={() => setForm({ ...form, widgets: [...form.widgets, blankWidget()] })}><Plus size={15} />Adicionar</button></div>
          <div className="tdg-widget-editor">
            {form.widgets.map((widget) => <article key={widget.id}>
              <input aria-label="Título do indicador" placeholder="Título" value={widget.title} onChange={(e) => updateWidget(widget.id, "title", e.target.value)} />
              <select aria-label="Métrica" value={widget.metric} onChange={(e) => updateWidget(widget.id, "metric", e.target.value)}>{METRICS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
              <select aria-label="Formato" value={widget.type} onChange={(e) => updateWidget(widget.id, "type", e.target.value)}>{TYPES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
              <button type="button" aria-label="Remover indicador" onClick={() => setForm({ ...form, widgets: form.widgets.filter((item) => item.id !== widget.id) })}><Trash2 size={16} /></button>
            </article>)}
          </div>
          <div className="tdg-dashboard-preview">
            {form.widgets.map((widget) => (
              <article className={`tdg-widget-card size-${widget.size}`} key={widget.id}>
                <header>
                  <small>{widget.title || METRICS.find(([id]) => id === widget.metric)?.[1]}</small>
                  <span>{TYPES.find(([id]) => id === widget.type)?.[1]}</span>
                </header>
                <WidgetChart widget={widget} data={data} valorEscalar={metricValue(widget.metric, summary)} />
              </article>
            ))}
          </div>
          <div className="tdg-page-actions"><button className="tdg-action" disabled={status === "saving" || form.widgets.length === 0}><Save size={17} />Salvar painel</button>{selectedId && <button type="button" className="tdg-danger-action" onClick={remove}><Trash2 size={17} />Excluir</button>}</div>
        </form>
      </div>
    </section>
  );
}
