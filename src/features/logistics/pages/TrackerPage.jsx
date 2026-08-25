import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Save, Satellite, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  TRACKER_DEFAULT_CONFIG,
  normalizeTrackerConfig,
  trackerOperationalSummary,
  trackerRequirements,
  trackerStatusLabel,
  trackerVehicleState,
} from "../trackerIntegrationDomain.js";
import "./TodoGreenPages.css";

const request = async (path, authHeaders, options = {}) => {
  const result = await fetch(`/api/todogreen/tracker${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível acessar o TMS Tracker.");
  return payload;
};

const editableConfig = (integration) => normalizeTrackerConfig(integration || TRACKER_DEFAULT_CONFIG);
const dateTime = (value) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "Ainda não ocorreu";

export default function TrackerPage({ authHeaders, setToast }) {
  const [form, setForm] = useState(() => editableConfig());
  const [integration, setIntegration] = useState(null);
  const [summary, setSummary] = useState(() => trackerOperationalSummary());
  const [requirements, setRequirements] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [access, setAccess] = useState({ canManage: false });
  const [busy, setBusy] = useState("loading");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy("loading");
    setError("");
    try {
      const [data, fleet] = await Promise.all([
        request("", authHeaders),
        request("/vehicles", authHeaders),
      ]);
      setIntegration(data.integration || null);
      setForm(editableConfig(data.integration));
      setSummary(trackerOperationalSummary(data.summary));
      setRequirements(data.requirements || {});
      setAccess(data.access || {});
      setVehicles(fleet.vehicles || []);
      setBusy("");
    } catch (reason) {
      setError(reason.message);
      setBusy("");
    }
  };

  useEffect(() => { load(); }, []);

  const checks = useMemo(
    () => trackerRequirements(form, requirements),
    [form, requirements],
  );
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateProvider = (field, value) => setForm((current) => ({
    ...current,
    providerConfig: { ...current.providerConfig, [field]: value },
  }));

  const run = async (action) => {
    setBusy(action);
    setError("");
    try {
      const result = await request(`/${action}`, authHeaders, { method: "POST" });
      setToast?.(action === "test"
        ? `Conexão validada. ${result.itemsFound || 0} veículos encontrados.`
        : `Sincronização iniciada. ${result.processed || result.accepted || 0} registros processados.`);
      await load();
    } catch (reason) {
      setError(reason.message);
      setBusy("");
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      const payload = await request("/config", authHeaders, {
        method: "PUT",
        body: JSON.stringify({ ...form, revision: integration?.revision }),
      });
      setIntegration(payload.integration);
      setForm(editableConfig(payload.integration));
      setToast?.("Configuração do Tracker salva.");
      setBusy("");
    } catch (reason) {
      setError(reason.message);
      setBusy("");
    }
  };

  return (
    <section className="tdg-panel tdg-page tdg-tracker-page">
      <header className="tdg-page-title">
        <div>
          <span>FROTA E RASTREAMENTO</span>
          <h2>Integração com o TMS Tracker</h2>
          <p>Posições da frota em modo leitura; credenciais protegidas.</p>
        </div>
        <div className={`tdg-tracker-status status-${integration?.status || "draft"}`}>
          <Satellite size={18} />
          <strong>{trackerStatusLabel(integration?.status)}</strong>
        </div>
      </header>

      {error && <div className="tdg-page-error">{error}</div>}

      <div className="tdg-tracker-metrics">
        <article><small>Veículos conectados</small><strong>{summary.linkedVehicles}</strong></article>
        <article><small>Posições recebidas</small><strong>{summary.positions}</strong></article>
        <article><small>Eventos recebidos</small><strong>{summary.events}</strong></article>
        <article><small>Última posição</small><strong>{dateTime(summary.latestPositionAt)}</strong></article>
      </div>

      <div className="tdg-tracker-layout">
        <form className="tdg-dashboard-form tdg-tracker-config" onSubmit={save}>
          <div><h3>Configuração da conexão</h3><p>Use os endereços e nomes de campos fornecidos pelo seu contrato com a Sistemas Tracker.</p></div>
          <div className="tdg-form-row">
            <label><span>Nome da integração</span><input value={form.name} disabled={!access.canManage} onChange={(event) => update("name", event.target.value)} /></label>
            <label><span>Conta externa</span><input value={form.externalAccountId} disabled={!access.canManage} onChange={(event) => update("externalAccountId", event.target.value)} /></label>
          </div>
          <label><span>URL base da API</span><input type="url" placeholder="https://api.exemplo.com" value={form.baseUrl} disabled={!access.canManage} onChange={(event) => update("baseUrl", event.target.value)} /></label>
          <div className="tdg-form-row">
            <label><span>Endpoint de veículos e posições</span><input placeholder="v1/vehicles" value={form.providerConfig.vehiclesPath} disabled={!access.canManage} onChange={(event) => updateProvider("vehiclesPath", event.target.value)} /></label>
            <label><span>Caminho da lista no JSON</span><input placeholder="data.items" value={form.providerConfig.collectionPath} disabled={!access.canManage} onChange={(event) => updateProvider("collectionPath", event.target.value)} /></label>
          </div>
          <div className="tdg-form-row">
            <label><span>Autenticação</span><select value={form.authMode} disabled={!access.canManage} onChange={(event) => update("authMode", event.target.value)}><option value="bearer">Bearer token</option><option value="api_key">Chave de API</option><option value="basic">Usuário e token</option></select></label>
            <label><span>Nome do segredo no Cloudflare</span><input value={form.tokenEnvKey} disabled={!access.canManage} onChange={(event) => update("tokenEnvKey", event.target.value.toUpperCase())} /></label>
          </div>
          {form.authMode === "api_key" && <label><span>Nome do cabeçalho da chave</span><input value={form.providerConfig.authHeaderName} disabled={!access.canManage} onChange={(event) => updateProvider("authHeaderName", event.target.value)} /></label>}
          <div className="tdg-form-row">
            <label><span>Atualização</span><select value={form.syncMode} disabled={!access.canManage} onChange={(event) => update("syncMode", event.target.value)}><option value="manual">Manual</option><option value="polling">Automática por intervalo</option><option value="webhook">Recebimento em tempo real</option></select></label>
            {form.syncMode === "polling" && <label><span>Intervalo em minutos</span><input type="number" min="60" max="1440" value={form.pollingIntervalMinutes} disabled={!access.canManage} onChange={(event) => update("pollingIntervalMinutes", Number(event.target.value))} /></label>}
          </div>
          {form.syncMode === "webhook" && <div className="tdg-form-row"><label><span>Caminho da lista no webhook</span><input placeholder="events" value={form.providerConfig.webhookCollectionPath} disabled={!access.canManage} onChange={(event) => updateProvider("webhookCollectionPath", event.target.value)} /></label><label><span>Segredo de assinatura</span><input value={form.webhookSecretEnvKey} disabled={!access.canManage} onChange={(event) => update("webhookSecretEnvKey", event.target.value.toUpperCase())} /></label></div>}
          {access.canManage && <div className="tdg-page-actions"><button className="tdg-action" disabled={Boolean(busy)}><Save size={17} />Salvar</button><button type="button" className="tdg-secondary-action" disabled={Boolean(busy) || !integration} onClick={() => run("test")}><ShieldCheck size={17} />Testar conexão</button><button type="button" className="tdg-secondary-action" disabled={Boolean(busy) || !integration} onClick={() => run("sync")}><RefreshCw size={17} />Sincronizar agora</button></div>}
        </form>

        <aside className="tdg-tracker-checklist">
          <h3>O que falta</h3>
          {checks.map((item) => <div className={item.ready ? "ready" : "pending"} key={item.id}>{item.ready ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}<span><strong>{item.label}</strong>{item.optional && <small>Opcional no modo atual</small>}</span></div>)}
          <p>A estrutura da integração está pronta. A ativação real depende da URL, formato dos dados e credencial fornecidos pela Sistemas Tracker.</p>
          {integration?.lastError && <div className="tdg-page-error">Último erro: {integration.lastError}</div>}
          <small>Último teste: {dateTime(integration?.lastTestAt)}</small>
          <small>Última sincronização: {dateTime(integration?.lastSyncAt)}</small>
        </aside>
      </div>

      <section className="tdg-tracker-fleet">
        <div><h3>Veículos recebidos</h3><p>Última posição disponível na integração.</p></div>
        {vehicles.length === 0 && <p>Nenhum veículo sincronizado.</p>}
        <div className="tdg-tracker-vehicles">
          {vehicles.map((vehicle) => <article key={vehicle.id}><header><strong>{vehicle.prefix || vehicle.plate || vehicle.name}</strong><span>{trackerVehicleState(vehicle)}</span></header><p>{vehicle.vehicle || vehicle.name}</p><small>{vehicle.position?.address || "Endereço não informado"}</small><small>{dateTime(vehicle.position?.recordedAt)}</small></article>)}
        </div>
      </section>
    </section>
  );
}
