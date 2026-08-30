import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ExternalLink,
  FileSearch,
  Globe2,
  Mail,
  Newspaper,
  Phone,
  Search,
  UserRoundSearch,
} from "lucide-react";
import { buildTodoGreenWorkspaceIntelligence } from "./todoGreenWorkspaceDomain.js";

const formatDate = (value) => {
  if (!value) return "Data da pesquisa não registrada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data da pesquisa não registrada" : `Pesquisa atualizada em ${date.toLocaleDateString("pt-BR")}`;
};

const staleInfo = (value) => {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return { stale: true, label: "Atualização necessária" };
  const ageDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (ageDays > 3) return { stale: true, label: `Fonte com ${ageDays} dia(s)` };
  return { stale: false, label: "Fonte recente" };
};

const host = (value) => {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return "fonte externa"; }
};

function EmptyIntelligence({ type, onNavigate }) {
  const copy = type === "contacts"
    ? ["Nenhum contato disponível", "Os contatos aparecem aqui quando são registrados no CRM ou confirmados pela pesquisa da conta."]
    : ["Nenhuma fonte disponível", "As notícias, RFQs e páginas de fornecedores aparecem depois que uma conta é pesquisada no CRM."];
  return <div className="tdg-intelligence-empty">
    <FileSearch size={24} />
    <strong>{copy[0]}</strong>
    <span>{copy[1]}</span>
    <button type="button" onClick={() => onNavigate?.("/todogreen/clientes")}>Abrir CRM</button>
  </div>;
}

function SourceList({ items, empty, onNavigate }) {
  if (!items.length) return <EmptyIntelligence type={empty} onNavigate={onNavigate} />;
  return <div className="tdg-intelligence-source-list">
    {items.map((item) => {
      const freshness = staleInfo(item.checkedAt);
      return <article className={freshness.stale ? "is-stale" : ""} key={`${item.kind}-${item.url}`}>
        <div className="tdg-intelligence-source-icon">{item.kind === "rfq" ? <FileSearch size={19} /> : item.kind === "supplier" ? <Building2 size={19} /> : <Newspaper size={19} />}</div>
        <div>
          <span>{item.clientName} · {item.kind === "segment" ? "Setor" : item.kind === "company" ? "Empresa" : item.kind === "rfq" ? "RFQ" : "Fornecedores"} · {freshness.label}</span>
          <a href={item.url} target="_blank" rel="noreferrer">{item.title || host(item.url)} <ExternalLink size={13} /></a>
          {item.snippet && <p>{item.snippet}</p>}
          <small>{formatDate(item.checkedAt)} · {host(item.url)}</small>
        </div>
        <button type="button" onClick={() => onNavigate?.(`/todogreen/clientes?client=${encodeURIComponent(item.clientId)}`)}>{freshness.stale ? "Atualizar conta" : "Abrir conta"}</button>
      </article>;
    })}
  </div>;
}

function Contacts({ items, onNavigate }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => `${item.name || ""} ${item.title || ""} ${item.department || ""} ${item.clientName || ""} ${item.email || ""} ${item.phone || ""}`.toLowerCase().includes(term));
  }, [items, query]);

  return <section className="tdg-intelligence-contacts">
    <header className="tdg-intelligence-hero">
      <div><span className="tdg-kicker">CRM REAL</span><h2>Contatos e decisores</h2><p>Somente contatos ativos da carteira acessível. Resultado web só entra quando há vínculo atual, Brasil e fonte comprovada.</p></div>
      <button type="button" className="tdg-action" onClick={() => onNavigate?.("/todogreen/clientes")}><UserRoundSearch size={16} />Abrir CRM completo</button>
    </header>
    <label className="tdg-intelligence-search"><Search size={17} /><input aria-label="Buscar contatos do espaço" placeholder="Buscar pessoa, empresa, cargo, e-mail ou telefone" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {!visible.length ? <EmptyIntelligence type="contacts" onNavigate={onNavigate} /> : <div className="tdg-intelligence-contact-grid">
      {visible.map((contact, index) => <article key={contact.id || `${contact.clientId}-${contact.email || contact.name}-${index}`}>
        <header><div className="tdg-intelligence-avatar">{String(contact.name || "?").trim().charAt(0).toUpperCase()}</div><span><strong>{contact.name}</strong><small>{contact.title || contact.department || "Cargo não informado"}</small></span></header>
        <button type="button" className="tdg-intelligence-account" onClick={() => onNavigate?.(`/todogreen/clientes?client=${encodeURIComponent(contact.clientId)}`)}><Building2 size={14} />{contact.clientName}</button>
        <div className="tdg-intelligence-contact-links">
          {contact.email && <a href={`mailto:${contact.email}`}><Mail size={14} />{contact.email}</a>}
          {contact.phone && <a href={`tel:${String(contact.phone).replace(/[^+\d]/g, "")}`}><Phone size={14} />{contact.phone}</a>}
          {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />LinkedIn</a>}
          {!contact.email && !contact.phone && !contact.linkedinUrl && <small>Nenhum canal registrado</small>}
        </div>
      </article>)}
    </div>}
  </section>;
}

function MarketSourceList({ items, loading, onStatus }) {
  if (loading) return <div className="tdg-intelligence-empty"><Search size={24} /><strong>Carregando inteligência de mercado</strong></div>;
  if (!items.length) return <div className="tdg-intelligence-empty"><Globe2 size={24} /><strong>Nenhum sinal encontrado nesta visão</strong><span>Execute uma pesquisa. Notícias e RFQs não dependem de a empresa estar cadastrada no CRM.</span></div>;
  return <div className="tdg-intelligence-source-list">
    {items.map((item) => <article key={item.id}>
      <div className="tdg-intelligence-source-icon">{item.kind === "rfq" ? <FileSearch size={19} /> : item.kind === "decisors" ? <UserRoundSearch size={19} /> : <Newspaper size={19} />}</div>
      <div>
        <span>{item.kind === "rfq" ? "CANDIDATO A RFQ ABERTA" : item.kind === "decisors" ? `POSSÍVEL DECISOR${item.company ? ` · ${item.company}` : ""}` : "NOTÍCIA DE MERCADO"} · {item.provider || "fonte pública"}</span>
        <a href={item.url} target="_blank" rel="noreferrer">{item.title || host(item.url)} <ExternalLink size={13} /></a>
        {item.snippet && <p>{item.snippet}</p>}
        <small>{formatDate(item.checkedAt)} · {host(item.url)} · valide a fonte antes de abordar ou participar</small>
      </div>
      <select aria-label={`Classificar ${item.title}`} value={item.status || "new"} onChange={(event) => onStatus(item.id, event.target.value)}>
        <option value="new">Novo</option><option value="reviewed">Revisado</option><option value="opportunity">Oportunidade</option><option value="dismissed">Descartado</option>
      </select>
    </article>)}
  </div>;
}

export default function TodoGreenIntelligenceHub({ verticalData = {}, initialView = "news", onNavigate, authHeaders, setToast }) {
  const intelligence = useMemo(
    () => buildTodoGreenWorkspaceIntelligence({ clients: verticalData.clients }),
    [verticalData.clients],
  );
  const [view, setView] = useState(initialView);
  const [marketItems, setMarketItems] = useState([]);
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [researching, setResearching] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const loadMarket = useCallback(async () => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization) return;
    setLoading(true);
    try {
      const response = await fetch("/api/todogreen/market-intelligence?limit=200", { headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a inteligência de mercado.");
      setMarketItems(payload.items || []);
      setLastRun(payload.lastRun || null);
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, setToast]);

  useEffect(() => { loadMarket(); }, [loadMarket]);

  if (initialView === "contacts") return <Contacts items={intelligence.contacts} onNavigate={onNavigate} />;

  const options = [
    ["news", "Notícias", marketItems.filter((item) => item.kind === "news").length],
    ["rfqs", "RFQs abertas", marketItems.filter((item) => item.kind === "rfq").length],
    ["decisors", "LinkedIn e decisores", marketItems.filter((item) => item.kind === "decisors").length],
  ];

  const research = async () => {
    if (view === "decisors" && company.trim().length < 2) {
      setToast?.("Informe a empresa para pesquisar possíveis decisores.");
      return;
    }
    const headers = authHeaders?.() || {};
    if (!headers.authorization) return;
    setResearching(true);
    try {
      const response = await fetch("/api/todogreen/market-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ kind: view === "rfqs" ? "rfq" : view === "decisors" ? "decisors" : "news", company }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "A pesquisa de mercado falhou.");
      setToast?.(`${payload.resultCount || 0} resultado(s) encontrado(s) com fonte.`);
      await loadMarket();
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setResearching(false);
    }
  };

  const updateStatus = async (id, status) => {
    const headers = authHeaders?.() || {};
    try {
      const response = await fetch("/api/todogreen/market-intelligence", {
        method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível classificar o resultado.");
      setMarketItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    } catch (error) { setToast?.(error.message); }
  };

  const visible = marketItems.filter((item) => item.kind === (view === "rfqs" ? "rfq" : view === "decisors" ? "decisors" : "news"));
  const portfolioSources = view === "rfqs" ? intelligence.rfqs : view === "news" ? intelligence.news : [];

  return <section className="tdg-intelligence">
    <header className="tdg-intelligence-hero">
      <div><span className="tdg-kicker">MERCADO INTEIRO · COM FONTE</span><h2>Notícias, RFQs e mercado</h2><p>A busca inclui possíveis decisores e olha o mercado relevante para logística sustentável, não apenas clientes da carteira. Cada resultado mantém URL, data e provedor para validação humana.</p></div>
      <button type="button" className="tdg-action" disabled={researching} onClick={research}><Globe2 size={16} />{researching ? "Pesquisando..." : "Pesquisar agora"}</button>
    </header>
    <nav className="tdg-intelligence-tabs" aria-label="Visões de inteligência">
      {options.map(([id, label, count]) => <button type="button" className={view === id ? "active" : ""} onClick={() => setView(id)} key={id}>{label}<b>{count}</b></button>)}
    </nav>
    {view === "decisors" && <label className="tdg-intelligence-search"><Building2 size={17} /><input aria-label="Empresa para pesquisar decisores" placeholder="Nome da empresa, mesmo que ainda não esteja no CRM" value={company} onChange={(event) => setCompany(event.target.value)} /><button type="button" onClick={research} disabled={researching}>Pesquisar LinkedIn</button></label>}
    {lastRun && <small className="tdg-intelligence-run">Última pesquisa: {new Date(lastRun.createdAt).toLocaleString("pt-BR")} · {lastRun.resultCount} resultado(s) · {(lastRun.providers || []).join(", ") || "nenhum provedor respondeu"}</small>}
    <MarketSourceList items={visible} loading={loading} onStatus={updateStatus} />
    {portfolioSources.length > 0 && <details className="tdg-intelligence-portfolio"><summary>Sinais já vinculados à carteira ({portfolioSources.length})</summary><SourceList items={portfolioSources} empty={view} onNavigate={onNavigate} /></details>}
  </section>;
}
