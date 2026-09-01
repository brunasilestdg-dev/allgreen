import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rocket,
  Settings2,
} from "lucide-react";
import "./ClientActivationPage.css";
import ClientBriefingPanel from "./ClientBriefingPanel.jsx";

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
    const error = new Error(payload.error || "Não foi possível processar a solicitação.");
    error.payload = payload;
    throw error;
  }
  return payload;
};

const statusLabel = (status) => ({
  planning:"Planejamento",
  in_progress:"Em andamento",
  ready:"Pronta para go-live",
  go_live:"Go-live",
  completed:"Concluída",
  on_hold:"Em espera",
  cancelled:"Cancelada",
  pending:"Pendente",
  blocked:"Bloqueado",
  done:"Concluído",
  waived:"Dispensado",
}[status] || String(status || "Não informado").replaceAll("_", " "));

export default function ClientActivationPage({ authHeaders, setToast }) {
  const params = new URLSearchParams(location.search);
  const initialClient = params.get("client") || "";
  const [view, setView] = useState(params.get("mode") === "activation" ? "activation" : "implementation");
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(initialClient);
  const [snapshot, setSnapshot] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [gates, setGates] = useState([]);
  const [status, setStatus] = useState("loading");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState({ integrationStatus:"pending", trackingRequired:true });
  const [projectForm, setProjectForm] = useState({ title:"", contractId:"", operationId:"", targetGoLiveAt:"", ownerUserId:"" });
  const [gateForm, setGateForm] = useState({ phase:"", code:"", title:"", dueAt:"", blocking:true, evidenceRequired:false });
  // Implantar um cliente que ainda não está no CRM: cadastra na hora (mesmo
  // endpoint do CRM) e já seleciona. Antes o seletor só listava quem existia,
  // então não dava para iniciar a implantação de uma conta nova.
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoCliente, setNovoCliente] = useState({ nome:"", documento:"", contato:"", email:"", telefone:"" });

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || snapshot?.client || null,
    [clientId, clients, snapshot],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || projects[0] || null,
    [projects, selectedProjectId],
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

  const criarCliente = async (event) => {
    event.preventDefault();
    const nome = novoCliente.nome.trim();
    if (nome.length < 2) { setError("Informe o nome do cliente."); return; }
    setAction("create-client");
    setError("");
    try {
      const contato = novoCliente.contato.trim();
      const email = novoCliente.email.trim();
      const telefone = novoCliente.telefone.trim();
      const crm = (contato || email || telefone)
        ? { contacts: [{ name: contato || nome, email, phone: telefone, relationshipRole: "Decisor" }] }
        : {};
      const criado = await api("/api/todogreen/clients", authHeaders, {
        method: "POST",
        body: JSON.stringify({ nome, documento: novoCliente.documento.trim(), crm }),
      });
      await loadClients();
      if (criado?.id) setClientId(criado.id);
      setNovoCliente({ nome:"", documento:"", contato:"", email:"", telefone:"" });
      setNovoAberto(false);
      setToast?.("Cliente cadastrado no CRM e pronto para implantação.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setAction("");
    }
  };

  const loadActivation = async (id = clientId) => {
    if (!id) { setSnapshot(null); return; }
    setAction("loading");
    setError("");
    try {
      const data = await api(`/api/todogreen/client-activation?clientId=${encodeURIComponent(id)}`, authHeaders);
      setSnapshot(data);
      setConfig({
        integrationStatus:data.client?.activation?.integrationStatus || "pending",
        trackingRequired:data.client?.activation?.trackingRequired !== false,
      });
    } catch (reason) {
      setError(reason.message);
      setSnapshot(null);
    } finally {
      setAction("");
    }
  };

  const loadProjects = async (id = clientId) => {
    if (!id) { setProjects([]); setGates([]); return; }
    setAction("loading-projects");
    setError("");
    try {
      const data = await api(`/api/todogreen/master-data/implementation-projects?clientId=${encodeURIComponent(id)}&limit=200`, authHeaders);
      const list = data.records || [];
      setProjects(list);
      setSelectedProjectId((current) => list.some((project) => project.id === current) ? current : list[0]?.id || "");
      if (!projectForm.title && selectedClient?.name) {
        setProjectForm((current) => ({ ...current, title:`Implantação · ${selectedClient.name}` }));
      }
    } catch (reason) {
      setError(reason.message);
      setProjects([]);
    } finally {
      setAction("");
    }
  };

  const loadGates = async (projectId) => {
    if (!projectId) { setGates([]); return; }
    try {
      const data = await api(`/api/todogreen/master-data/implementation-gates?projectId=${encodeURIComponent(projectId)}&limit=200`, authHeaders);
      setGates(data.records || []);
    } catch (reason) {
      setError(reason.message);
      setGates([]);
    }
  };

  useEffect(() => { loadClients(); }, []);
  useEffect(() => {
    if (!clientId) return;
    if (view === "activation" || view === "briefing") loadActivation(clientId);
    else loadProjects(clientId);
  }, [clientId, view]);
  useEffect(() => {
    if (view === "implementation") loadGates(selectedProject?.id || "");
  }, [selectedProject?.id, view]);
  useEffect(() => {
    if (selectedClient?.name && !projects.length) {
      setProjectForm((current) => ({ ...current, title:current.title || `Implantação · ${selectedClient.name}` }));
    }
  }, [selectedClient?.name, projects.length]);

  const createProject = async (event) => {
    event.preventDefault();
    if (!clientId) return;
    setAction("create-project");
    setError("");
    try {
      const data = await api("/api/todogreen/master-data/implementation-projects", authHeaders, {
        method:"POST",
        body:JSON.stringify({ clientId, ...projectForm, status:"planning" }),
      });
      const project = data.record;
      setProjects((current) => [project, ...current]);
      setSelectedProjectId(project.id);
      setProjectForm({ title:`Implantação · ${selectedClient?.name || "cliente"}`, contractId:"", operationId:"", targetGoLiveAt:"", ownerUserId:"" });
      setToast?.("Projeto de implantação criado.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setAction("");
    }
  };

  const createGate = async (event) => {
    event.preventDefault();
    if (!selectedProject?.id) return;
    setAction("create-gate");
    setError("");
    try {
      const data = await api("/api/todogreen/master-data/implementation-gates", authHeaders, {
        method:"POST",
        body:JSON.stringify({ projectId:selectedProject.id, ...gateForm, status:"pending" }),
      });
      setGates((current) => [...current, data.record]);
      setGateForm({ phase:"", code:"", title:"", dueAt:"", blocking:true, evidenceRequired:false });
      setToast?.("Gate de implantação cadastrado.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setAction("");
    }
  };

  const runActivation = async (nextAction, body = {}) => {
    if (!clientId) return;
    setAction(nextAction);
    setError("");
    try {
      const data = await api(`/api/todogreen/client-activation?clientId=${encodeURIComponent(clientId)}`, authHeaders, {
        method:"POST",
        body:JSON.stringify({ action:nextAction, ...body }),
      });
      const nextSnapshot = data.snapshot || data;
      setSnapshot(nextSnapshot);
      setConfig({
        integrationStatus:nextSnapshot.client?.activation?.integrationStatus || "pending",
        trackingRequired:nextSnapshot.client?.activation?.trackingRequired !== false,
      });
      if (nextAction === "prepare") setToast?.("Checklist de ativação atualizado.");
      if (nextAction === "configure") setToast?.("Configuração de ativação salva.");
      if (nextAction === "activate") setToast?.("Cliente ativado.");
      if (nextAction === "briefing") setToast?.("Desenho da conta salvo.");
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
          <span className="ca-eyebrow">IMPLANTAÇÃO</span>
          <h1>Implantação e ativação</h1>
          <p>Implantação operacional é um projeto interno. Ativação é o gate final que libera o cliente para operar.</p>
        </div>
        {/* Tudo dentro da vertical, com a cara da To Do Green: nada de link
            para o app geral (o "Portfólio global" que saltava para fora). */}
        <div className="ca-head-acoes">
          <a href="/todogreen/clientes" className="ca-back"><ArrowLeft size={16}/>Voltar aos clientes</a>
          <a className="ca-portfolio-link" href="/todogreen/central-trabalho">Ver nos quadros de projetos</a>
        </div>
      </header>

      <section className="ca-client-picker">
        <label>
          <span>Processo</span>
          <select value={view} onChange={(event) => setView(event.target.value)}>
            <option value="implementation">Implantação operacional</option>
            <option value="briefing">Desenho da conta</option>
            <option value="activation">Ativação do cliente</option>
          </select>
        </label>
        <label>
          <span>Cliente</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={status === "loading"}>
            {!clients.length && <option value="">Nenhum cliente disponível</option>}
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.crm?.stage ? ` · ${client.crm.stage}` : ""}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => (view === "activation" || view === "briefing") ? loadActivation() : loadProjects()} disabled={!clientId || Boolean(action)}><RefreshCw size={16}/>Atualizar</button>
        <button type="button" className="ca-new-client-toggle" onClick={() => setNovoAberto((aberto) => !aberto)}><Plus size={16}/>{novoAberto ? "Fechar" : "Cliente novo"}</button>
      </section>

      {novoAberto && (
        <form className="ca-new-client" onSubmit={criarCliente}>
          <div className="ca-new-client-head">
            <span className="ca-eyebrow">CLIENTE NÃO CADASTRADO</span>
            <h3>Cadastrar e já implantar</h3>
            <p>O cliente entra no CRM automaticamente e fica selecionado para a implantação.</p>
          </div>
          <div className="ca-new-client-grid">
            <label><span>Nome do cliente *</span><input value={novoCliente.nome} onChange={(event) => setNovoCliente({ ...novoCliente, nome:event.target.value })} required/></label>
            <label><span>CNPJ / documento</span><input value={novoCliente.documento} onChange={(event) => setNovoCliente({ ...novoCliente, documento:event.target.value })}/></label>
            <label><span>Contato</span><input value={novoCliente.contato} onChange={(event) => setNovoCliente({ ...novoCliente, contato:event.target.value })} placeholder="Nome da pessoa"/></label>
            <label><span>E-mail do contato</span><input type="email" value={novoCliente.email} onChange={(event) => setNovoCliente({ ...novoCliente, email:event.target.value })}/></label>
            <label><span>Telefone</span><input value={novoCliente.telefone} onChange={(event) => setNovoCliente({ ...novoCliente, telefone:event.target.value })}/></label>
          </div>
          <button type="submit" disabled={action === "create-client"}><Plus size={15}/>{action === "create-client" ? "Cadastrando..." : "Cadastrar cliente"}</button>
        </form>
      )}

      {error && <div className="ca-error"><CircleAlert size={17}/><span>{error}</span></div>}
      {!clientId && status !== "loading" && <div className="ca-empty">Cadastre um cliente para iniciar.</div>}
      {status === "loading" && <div className="ca-loading"><LoaderCircle className="spin"/>Carregando clientes...</div>}

      {clientId && view === "implementation" && (
        <section className="ca-layout">
          <div className="ca-checklist">
            <header>
              <div><span className="ca-eyebrow">PROJETO INTERNO</span><h2>Implantação operacional</h2></div>
            </header>
            {!projects.length ? (
              <div className="ca-empty">Nenhuma implantação cadastrada para este cliente.</div>
            ) : (
              <div className="ca-checks">
                {projects.map((project) => (
                  <article key={project.id} className={project.status === "completed" ? "ready" : "blocked"}>
                    {project.status === "completed" ? <CheckCircle2/> : <Settings2/>}
                    <div>
                      <strong>{project.title}</strong>
                      <p>{statusLabel(project.status)} · Go-live alvo: {project.targetGoLiveAt ? new Date(project.targetGoLiveAt).toLocaleDateString("pt-BR") : "não definido"}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedProjectId(project.id)}>{selectedProject?.id === project.id ? "Selecionada" : "Abrir"}</button>
                  </article>
                ))}
              </div>
            )}

            {selectedProject && (
              <>
                <header><div><span className="ca-eyebrow">GATES</span><h2>{selectedProject.title}</h2></div></header>
                <div className="ca-checks">
                  {!gates.length && <div className="ca-empty">Nenhum gate cadastrado. Inclua os marcos reais da implantação abaixo.</div>}
                  {gates.map((gate) => (
                    <article key={gate.id} className={gate.status === "done" ? "ready" : "blocked"}>
                      {gate.status === "done" ? <CheckCircle2/> : <CircleAlert/>}
                      <div><strong>{gate.phase ? `${gate.phase} · ` : ""}{gate.title}</strong><p>{statusLabel(gate.status)}{gate.dueAt ? ` · prazo ${new Date(gate.dueAt).toLocaleDateString("pt-BR")}` : ""}{gate.blocking ? " · bloqueia go-live" : ""}</p></div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>

          <aside className="ca-side">
            <form onSubmit={createProject}>
              <span className="ca-eyebrow">NOVA IMPLANTAÇÃO</span>
              <h3>Projeto operacional</h3>
              <label><span>Nome</span><input value={projectForm.title} onChange={(event) => setProjectForm({ ...projectForm, title:event.target.value })} required/></label>
              <label><span>Contrato, quando disponível</span><input value={projectForm.contractId} onChange={(event) => setProjectForm({ ...projectForm, contractId:event.target.value })}/></label>
              <label><span>Operação, quando disponível</span><input value={projectForm.operationId} onChange={(event) => setProjectForm({ ...projectForm, operationId:event.target.value })}/></label>
              <label><span>Go-live alvo</span><input type="date" value={projectForm.targetGoLiveAt} onChange={(event) => setProjectForm({ ...projectForm, targetGoLiveAt:event.target.value })}/></label>
              <button type="submit" disabled={action === "create-project"}><Plus size={15}/>{action === "create-project" ? "Criando..." : "Criar implantação"}</button>
            </form>

            <form onSubmit={createGate}>
              <span className="ca-eyebrow">NOVO GATE</span>
              <h3>Marco da implantação</h3>
              <label><span>Fase</span><input value={gateForm.phase} onChange={(event) => setGateForm({ ...gateForm, phase:event.target.value })}/></label>
              <label><span>Código</span><input value={gateForm.code} onChange={(event) => setGateForm({ ...gateForm, code:event.target.value })}/></label>
              <label><span>Entrega / gate</span><input value={gateForm.title} onChange={(event) => setGateForm({ ...gateForm, title:event.target.value })} required/></label>
              <label><span>Prazo</span><input type="date" value={gateForm.dueAt} onChange={(event) => setGateForm({ ...gateForm, dueAt:event.target.value })}/></label>
              <label className="ca-check"><input type="checkbox" checked={gateForm.blocking} onChange={(event) => setGateForm({ ...gateForm, blocking:event.target.checked })}/><span>Bloqueia go-live se pendente</span></label>
              <label className="ca-check"><input type="checkbox" checked={gateForm.evidenceRequired} onChange={(event) => setGateForm({ ...gateForm, evidenceRequired:event.target.checked })}/><span>Exige evidência</span></label>
              <button type="submit" disabled={!selectedProject || action === "create-gate"}><Plus size={15}/>{action === "create-gate" ? "Criando..." : "Adicionar gate"}</button>
            </form>
          </aside>
        </section>
      )}

      {clientId && view === "briefing" && (
        <ClientBriefingPanel
          briefing={snapshot?.briefing}
          salvando={action === "briefing"}
          onSalvar={(briefing) => runActivation("briefing", { briefing, revision: snapshot?.client?.revision })}
        />
      )}

      {clientId && view === "activation" && !snapshot && action === "loading" && <div className="ca-loading"><LoaderCircle className="spin"/>Carregando ativação...</div>}

      {clientId && view === "activation" && snapshot && readiness && (
        <>
          <section className="ca-summary">
            <div className="ca-progress-copy">
              <span>{selectedClient?.name}</span>
              <strong>{readiness.completed} de {readiness.total} requisitos prontos</strong>
              <small>{readiness.ready ? "Pronto para ativar" : "Ainda há bloqueios de go-live"}</small>
            </div>
            <div className="ca-progress" aria-label={`${readiness.percentage}% concluído`}><span style={{ width:`${readiness.percentage}%` }}/></div>
            <b>{readiness.percentage}%</b>
          </section>

          <section className="ca-layout">
            <div className="ca-checklist">
              <header><div><span className="ca-eyebrow">ATIVAÇÃO</span><h2>Checklist final</h2></div><button type="button" className="ca-primary" onClick={() => runActivation("prepare")} disabled={Boolean(action)}><Settings2 size={16}/>{action === "prepare" ? "Preparando..." : "Atualizar checklist"}</button></header>
              <div className="ca-checks">
                {readiness.checks.map((check) => {
                  const link = CHECK_LINKS[check.id];
                  return (
                    <article key={check.id} className={check.ready ? "ready" : "blocked"}>
                      {check.ready ? <CheckCircle2/> : <CircleAlert/>}
                      <div><strong>{check.label}</strong><p>{check.detail}</p></div>
                      {link && <a href={link[1]}>{link[0]}<ExternalLink size={13}/></a>}
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="ca-side">
              <section>
                <span className="ca-eyebrow">PARAMETRIZAÇÃO DE ATIVAÇÃO</span>
                <h3>Integração e tracking</h3>
                <label><span>Integração</span><select value={config.integrationStatus} onChange={(event) => setConfig({ ...config, integrationStatus:event.target.value })}><option value="pending">Pendente</option><option value="ready">Validada</option><option value="not_required">Não necessária</option></select></label>
                <label className="ca-check"><input type="checkbox" checked={config.trackingRequired} onChange={(event) => setConfig({ ...config, trackingRequired:event.target.checked })}/><span>Tracking é obrigatório nesta operação</span></label>
                <button type="button" onClick={() => runActivation("configure", config)} disabled={Boolean(action)}>Salvar configuração</button>
              </section>

              <section className={readiness.ready ? "ca-go-live ready" : "ca-go-live"}>
                <Rocket/>
                <h3>{readiness.ready ? "Go-live liberado" : "Go-live bloqueado"}</h3>
                <p>{readiness.ready ? "Todos os requisitos de ativação foram validados." : `${readiness.missing.length} requisito(s) ainda impedem a mudança para Cliente ativo.`}</p>
                <button type="button" className="ca-primary" disabled={!readiness.ready || Boolean(action)} onClick={() => runActivation("activate")}>{action === "activate" ? "Ativando..." : "Ativar cliente"}</button>
              </section>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
