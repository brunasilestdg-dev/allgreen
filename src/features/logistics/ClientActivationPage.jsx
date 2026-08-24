import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Settings2,
} from "lucide-react";
import "./ClientActivationPage.css";

const CHECK_LINKS = {
  contract: ["Contrato", "/todogreen/propostas"],
  priceTable: ["Precificação", "/todogreen/precificacao"],
  billing: ["Faturamento", "/todogreen/faturamento"],
  costCenter: ["Cadastros", "/todogreen/cadastros"],
  operation: ["Operações", "/todogreen/operacoes"],
  sla: ["Contrato", "/todogreen/propostas"],
  responsibles: ["Clientes", "/todogreen/clientes"],
  portal: ["Clientes", "/todogreen/clientes"],
  integrations: ["Integrações", "/todogreen/integracoes"],
  tracking: ["TMS Tracker", "/todogreen/rastreamento"],
  esg: ["Central ESG", "/todogreen/central-esg"],
  dashboard: ["Painéis", "/todogreen/dashboards"],
};

const api = async (path, authHeaders, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível processar a implantação.");
    error.payload = payload;
    throw error;
  }
  return payload;
};

const projectIdForClient = (clientId) => `todogreen-implantation-${clientId}`;

export default function ClientActivationPage({ db, update, authHeaders, setToast }) {
  const initialClient = new URLSearchParams(location.search).get("client") || "";
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(initialClient);
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState({ integrationStatus: "pending", trackingRequired: true });

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || snapshot?.client || null,
    [clientId, clients, snapshot],
  );

  const loadClients = async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await api("/api/todogreen/clients", authHeaders);
      const list = data.clientes || [];
      setClients(list);
      setClientId((current) => current || list[0]?.id || "");
      setStatus("ready");
    } catch (reason) {
      setError(reason.message);
      setStatus("error");
    }
  };

  const loadSnapshot = async (id = clientId) => {
    if (!id) {
      setSnapshot(null);
      return;
    }
    setAction("loading");
    setError("");
    try {
      const data = await api(`/api/todogreen/client-activation?clientId=${encodeURIComponent(id)}`, authHeaders);
      setSnapshot(data);
      setConfig({
        integrationStatus: data.client?.activation?.integrationStatus || "pending",
        trackingRequired: data.client?.activation?.trackingRequired !== false,
      });
    } catch (reason) {
      setError(reason.message);
      setSnapshot(null);
    } finally {
      setAction("");
    }
  };

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { if (clientId) loadSnapshot(clientId); }, [clientId]);

  const ensureImplementationProject = (client, readiness) => {
    if (!client?.id || !update) return;
    const id = projectIdForClient(client.id);
    update((current) => {
      const projects = current.projects || [];
      if (projects.some((project) => project.id === id)) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        projects: [
          {
            id,
            name: `Implantação · ${client.name}`,
            area: "Operações",
            description: "Projeto criado a partir do gate de implantação da To Do Green. A área pode ser alterada no Portfólio global.",
            objective: "Levar a conta do estágio de implantação para cliente ativo com todos os requisitos operacionais validados.",
            status: readiness?.ready ? "Concluído" : "Em andamento",
            priority: "Alta",
            manager: "",
            sponsor: "",
            startDate: new Date().toISOString().slice(0, 10),
            dueDate: "",
            milestones: [],
            risks: [],
            issues: [],
            decisions: [],
            changeRequests: [],
            sourceType: "todogreen_client_activation",
            sourceId: client.id,
            businessId: null,
            ownerId: current.user?.id || null,
            createdAt: now,
            updatedAt: now,
          },
          ...projects,
        ],
      };
    });
  };

  const syncProjectStatus = (client, completed) => {
    if (!client?.id || !update) return;
    const id = projectIdForClient(client.id);
    update((current) => ({
      ...current,
      projects: (current.projects || []).map((project) =>
        project.id === id
          ? { ...project, status: completed ? "Concluído" : project.status, actualEndDate: completed ? new Date().toISOString().slice(0, 10) : project.actualEndDate, updatedAt: new Date().toISOString() }
          : project,
      ),
    }));
  };

  const run = async (nextAction, body = {}) => {
    if (!clientId) return;
    setAction(nextAction);
    setError("");
    try {
      const data = await api(`/api/todogreen/client-activation?clientId=${encodeURIComponent(clientId)}`, authHeaders, {
        method: "POST",
        body: JSON.stringify({ action: nextAction, ...body }),
      });
      const nextSnapshot = data.snapshot || data;
      setSnapshot(nextSnapshot);
      setConfig({
        integrationStatus: nextSnapshot.client?.activation?.integrationStatus || "pending",
        trackingRequired: nextSnapshot.client?.activation?.trackingRequired !== false,
      });
      if (nextAction === "prepare") {
        ensureImplementationProject(nextSnapshot.client, nextSnapshot.readiness);
        setToast?.("Implantação preparada e checklist atualizado.");
      }
      if (nextAction === "configure") setToast?.("Configuração da implantação salva.");
      if (nextAction === "activate") {
        ensureImplementationProject(nextSnapshot.client, nextSnapshot.readiness);
        syncProjectStatus(nextSnapshot.client, true);
        setToast?.("Cliente ativado.");
      }
    } catch (reason) {
      if (reason.payload?.snapshot) setSnapshot(reason.payload.snapshot);
      setError(reason.message);
    } finally {
      setAction("");
    }
  };

  const readiness = snapshot?.readiness;

  return (
    <main className="ca-page">
      <header className="ca-head">
        <div>
          <a href="/todogreen/clientes" className="ca-back"><ArrowLeft size={16} />Clientes</a>
          <span className="ca-eyebrow">IMPLANTAÇÃO &amp; GO-LIVE</span>
          <h1>Ativação de cliente</h1>
          <p>“Cliente ativo” só é liberado quando contrato, operação, financeiro, portal, tracking, ESG e governança estão realmente prontos.</p>
        </div>
        <a className="ca-portfolio-link" href="/?page=portfolio"><ExternalLink size={16} />Portfólio global</a>
      </header>

      <section className="ca-client-picker">
        <label>
          <span>Cliente</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={status === "loading"}>
            {!clients.length && <option value="">Nenhum cliente disponível</option>}
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.crm?.stage ? ` · ${client.crm.stage}` : ""}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => loadSnapshot()} disabled={!clientId || action === "loading"}><RefreshCw size={16} />Atualizar</button>
      </section>

      {error && <div className="ca-error"><CircleAlert size={17} /><span>{error}</span></div>}

      {!clientId && status !== "loading" && <div className="ca-empty">Cadastre um cliente para iniciar a implantação.</div>}
      {(status === "loading" || action === "loading") && !snapshot && <div className="ca-loading"><LoaderCircle className="spin" />Carregando implantação...</div>}

      {snapshot && readiness && (
        <>
          <section className="ca-summary">
            <div className="ca-progress-copy">
              <span>{selectedClient?.name}</span>
              <strong>{readiness.completed} de {readiness.total} requisitos prontos</strong>
              <small>{readiness.ready ? "Pronto para ativar" : "Ainda há bloqueios de go-live"}</small>
            </div>
            <div className="ca-progress" aria-label={`${readiness.percentage}% concluído`}><span style={{ width: `${readiness.percentage}%` }} /></div>
            <b>{readiness.percentage}%</b>
          </section>

          <section className="ca-layout">
            <div className="ca-checklist">
              <header><div><span className="ca-eyebrow">GATE</span><h2>Checklist de ativação</h2></div><button type="button" className="ca-primary" onClick={() => run("prepare")} disabled={!!action}><Settings2 size={16} />{action === "prepare" ? "Preparando..." : "Preparar automaticamente"}</button></header>
              <div className="ca-checks">
                {readiness.checks.map((check) => {
                  const link = CHECK_LINKS[check.id];
                  return <article key={check.id} className={check.ready ? "ready" : "blocked"}>
                    {check.ready ? <CheckCircle2 /> : <CircleAlert />}
                    <div><strong>{check.label}</strong><p>{check.detail}</p></div>
                    {link && <a href={link[1]}>{link[0]}<ExternalLink size={13} /></a>}
                  </article>;
                })}
              </div>
            </div>

            <aside className="ca-side">
              <section>
                <span className="ca-eyebrow">CONFIGURAÇÃO DA IMPLANTAÇÃO</span>
                <h3>Integração e tracking</h3>
                <label><span>Integração</span><select value={config.integrationStatus} onChange={(event) => setConfig({ ...config, integrationStatus: event.target.value })}><option value="pending">Pendente</option><option value="ready">Validada</option><option value="not_required">Não necessária</option></select></label>
                <label className="ca-check"><input type="checkbox" checked={config.trackingRequired} onChange={(event) => setConfig({ ...config, trackingRequired: event.target.checked })} /><span>Tracking é obrigatório nesta operação</span></label>
                <button type="button" onClick={() => run("configure", config)} disabled={!!action}>Salvar configuração</button>
              </section>

              <section className={readiness.ready ? "ca-go-live ready" : "ca-go-live"}>
                <Rocket />
                <h3>{readiness.ready ? "Go-live liberado" : "Go-live bloqueado"}</h3>
                <p>{readiness.ready ? "Todos os requisitos foram validados. A ativação registra a mudança e conclui o projeto de implantação." : `${readiness.missing.length} requisito(s) ainda impedem a mudança para Cliente ativo.`}</p>
                <button type="button" className="ca-primary" disabled={!readiness.ready || !!action} onClick={() => run("activate")}>{action === "activate" ? "Ativando..." : "Ativar cliente"}</button>
              </section>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
