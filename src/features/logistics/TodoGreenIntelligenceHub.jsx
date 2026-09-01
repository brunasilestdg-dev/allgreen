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
  Send,
  UserRoundSearch,
} from "lucide-react";
import EnterpriseWorkflowPanel from "./pages/EnterpriseWorkflowPanel.jsx";
import { buildTodoGreenWorkspaceIntelligence } from "./todoGreenWorkspaceDomain.js";
import {
  TEMAS_DE_NOTICIA,
  extrairDataDaNoticia,
  limparResumoDeBusca,
  temaDaNoticia,
} from "./noticiaDomain.js";

const formatDate = (value) => {
  if (!value) return "Data da pesquisa não registrada";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data da pesquisa não registrada"
    : `Pesquisa atualizada em ${date.toLocaleDateString("pt-BR")}`;
};

const dataLegivel = (iso) => {
  const [ano, mes, dia] = String(iso || "").split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
};

const TEMA_LABEL = Object.fromEntries(TEMAS_DE_NOTICIA);

const staleInfo = (value) => {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return { stale: true, label: "Atualização necessária" };
  const ageDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  return ageDays > 3
    ? { stale: true, label: `Fonte com ${ageDays} dia(s)` }
    : { stale: false, label: "Fonte recente" };
};

const host = (value) => {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return "fonte externa"; }
};

function EmptyIntelligence({ type, onNavigate }) {
  const copy = type === "contacts"
    ? ["Nenhum contato disponível", "Os contatos aparecem quando são registrados no CRM ou confirmados pela pesquisa da conta."]
    : ["Nenhuma fonte disponível", "Pesquise o mercado ou uma conta para trazer fontes verificáveis para esta visão."];
  return (
    <div className="tdg-intelligence-empty">
      <FileSearch size={24} />
      <strong>{copy[0]}</strong>
      <span>{copy[1]}</span>
      <button type="button" onClick={() => onNavigate?.("/todogreen/clientes")}>Abrir CRM</button>
    </div>
  );
}

function SourceList({ items, empty, onNavigate }) {
  if (!items.length) return <EmptyIntelligence type={empty} onNavigate={onNavigate} />;
  return (
    <div className="tdg-intelligence-source-list">
      {items.map((item) => {
        const freshness = staleInfo(item.checkedAt);
        return (
          <article className={freshness.stale ? "is-stale" : ""} key={`${item.kind}-${item.url}`}>
            <div className="tdg-intelligence-source-icon">
              {item.kind === "rfq" ? <FileSearch size={19} /> : item.kind === "supplier" ? <Building2 size={19} /> : <Newspaper size={19} />}
            </div>
            <div>
              <span>{item.clientName} · {item.kind === "rfq" ? "RFQ" : item.kind === "company" ? "Empresa" : "Fonte"} · {freshness.label}</span>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title || host(item.url)} <ExternalLink size={13} /></a>
              {item.snippet && <p>{item.snippet}</p>}
              <small>{formatDate(item.checkedAt)} · {host(item.url)}</small>
            </div>
            <button type="button" onClick={() => onNavigate?.(`/todogreen/clientes?client=${encodeURIComponent(item.clientId)}`)}>
              {freshness.stale ? "Atualizar conta" : "Abrir conta"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function Contacts({ items, onNavigate, clients = [], authHeaders, setToast }) {
  const [query, setQuery] = useState("");
  const [composeAberto, setComposeAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({ clientId: "", para: "", contato: "", assunto: "", mensagem: "" });
  const clientesOrdenados = useMemo(
    () => [...clients].sort((a, b) => String(a.name || a.nome || "").localeCompare(String(b.name || b.nome || ""))),
    [clients],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => `${item.name || ""} ${item.title || ""} ${item.department || ""} ${item.clientName || ""} ${item.email || ""} ${item.phone || ""}`.toLowerCase().includes(term));
  }, [items, query]);

  const escreverPara = (contact) => {
    setForm({
      clientId: contact.clientId || "",
      para: contact.email || "",
      contato: contact.name || "",
      assunto: "",
      mensagem: "",
    });
    setComposeAberto(true);
  };

  const enviar = async (event) => {
    event.preventDefault();
    if (!authHeaders) { setToast?.("Envio indisponível nesta tela."); return; }
    const para = form.para.trim();
    if (!para || !para.includes("@")) { setToast?.("Informe um e-mail de destino válido."); return; }
    if (!form.assunto.trim() || !form.mensagem.trim()) { setToast?.("Preencha assunto e mensagem."); return; }
    setEnviando(true);
    try {
      const resposta = await fetch("/api/todogreen/send-email", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders() || {}) },
        body: JSON.stringify({ to: para, contato: form.contato.trim(), assunto: form.assunto.trim(), mensagem: form.mensagem.trim(), clientId: form.clientId || undefined }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.error || "Não foi possível enviar o e-mail.");
      setToast?.(dados.salvouContato ? "E-mail enviado e contato salvo no CRM." : "E-mail enviado.");
      setForm({ clientId: "", para: "", contato: "", assunto: "", mensagem: "" });
      setComposeAberto(false);
    } catch (erro) {
      setToast?.(erro.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="tdg-intelligence-contacts">
      <header className="tdg-intelligence-hero">
        <div>
          <span className="tdg-kicker">CRM REAL</span>
          <h2>Contatos e decisores</h2>
          <p>Contatos cadastrados e pessoas confirmadas pela pesquisa da conta, com vínculo e fonte.</p>
        </div>
        <div className="tdg-intelligence-hero-acoes">
          <button type="button" className="tdg-action" onClick={() => { setComposeAberto((a) => !a); }}>
            <Send size={16} />{composeAberto ? "Fechar" : "Enviar e-mail"}
          </button>
          <button type="button" className="tdg-action tdg-action-ghost" onClick={() => onNavigate?.("/todogreen/clientes")}>
            <UserRoundSearch size={16} />Abrir CRM completo
          </button>
        </div>
      </header>

      {composeAberto && (
        <form className="tdg-contact-compose" onSubmit={enviar}>
          <p className="tdg-contact-compose-nota">
            Dá para escrever para um e-mail que ainda não está salvo. Escolhendo a empresa, o
            contato entra no CRM dela automaticamente.
          </p>
          <div className="tdg-contact-compose-grid">
            <label><span>Empresa (para salvar o contato)</span>
              <select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>
                <option value="">Não salvar / sem empresa</option>
                {clientesOrdenados.map((c) => <option key={c.id} value={c.id}>{c.name || c.nome}</option>)}
              </select>
            </label>
            <label><span>Para (e-mail)</span>
              <input type="email" value={form.para} onChange={(event) => setForm({ ...form, para: event.target.value })} placeholder="pessoa@empresa.com" required />
            </label>
            <label><span>Nome do contato</span>
              <input value={form.contato} onChange={(event) => setForm({ ...form, contato: event.target.value })} placeholder="Opcional" />
            </label>
            <label className="tdg-contact-compose-wide"><span>Assunto</span>
              <input value={form.assunto} onChange={(event) => setForm({ ...form, assunto: event.target.value })} required />
            </label>
            <label className="tdg-contact-compose-wide"><span>Mensagem</span>
              <textarea rows={5} value={form.mensagem} onChange={(event) => setForm({ ...form, mensagem: event.target.value })} required />
            </label>
          </div>
          <button type="submit" className="tdg-action" disabled={enviando}>
            <Send size={16} />{enviando ? "Enviando..." : "Enviar e-mail"}
          </button>
        </form>
      )}
      <label className="tdg-intelligence-search">
        <Search size={17} />
        <input
          aria-label="Buscar contatos do espaço"
          placeholder="Buscar pessoa, empresa, cargo, e-mail ou telefone"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!visible.length ? (
        <EmptyIntelligence type="contacts" onNavigate={onNavigate} />
      ) : (
        <div className="tdg-intelligence-contact-grid">
          {visible.map((contact, index) => (
            <article key={contact.id || `${contact.clientId}-${contact.email || contact.name}-${index}`}>
              <header>
                <div className="tdg-intelligence-avatar">{String(contact.name || "?").trim().charAt(0).toUpperCase()}</div>
                <span><strong>{contact.name}</strong><small>{contact.title || contact.department || "Cargo não informado"}</small></span>
              </header>
              <button type="button" className="tdg-intelligence-account" onClick={() => onNavigate?.(`/todogreen/clientes?client=${encodeURIComponent(contact.clientId)}`)}>
                <Building2 size={14} />{contact.clientName}
              </button>
              <div className="tdg-intelligence-contact-links">
                {contact.email && <button type="button" className="tdg-contact-escrever" onClick={() => escreverPara(contact)}><Mail size={14} />{contact.email}</button>}
                {contact.phone && <a href={`tel:${String(contact.phone).replace(/[^+\d]/g, "")}`}><Phone size={14} />{contact.phone}</a>}
                {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />LinkedIn</a>}
                {!contact.email && !contact.phone && !contact.linkedinUrl && <small>Nenhum canal registrado</small>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketSourceList({ items, loading, onStatus }) {
  if (loading) return <div className="tdg-intelligence-empty"><Search size={24} /><strong>Carregando inteligência de mercado</strong></div>;
  if (!items.length) return <div className="tdg-intelligence-empty"><Globe2 size={24} /><strong>Nenhum sinal encontrado nesta visão</strong><span>Execute uma pesquisa. Notícias e decisores não dependem de a empresa estar cadastrada no CRM.</span></div>;
  return (
    <div className="tdg-intelligence-source-list">
      {items.map((item) => (
        <article key={item.id}>
          <div className="tdg-intelligence-source-icon">{item.kind === "decisors" ? <UserRoundSearch size={19} /> : <Newspaper size={19} />}</div>
          <div>
            <span>
              {item.kind === "decisors"
                ? `POSSÍVEL DECISOR${item.company ? ` · ${item.company}` : ""}`
                : `NOTÍCIA · ${(TEMA_LABEL[item.tema] || "Mercado").toUpperCase()}`}
              {" · "}
              {item.dataNoticia
                ? `Publicada em ${dataLegivel(item.dataNoticia)}`
                : item.checkedAt
                  ? `Coletada em ${dataLegivel(item.checkedAt)}`
                  : "Sem data"}
            </span>
            <a href={item.url} target="_blank" rel="noreferrer">{item.title || host(item.url)} <ExternalLink size={13} /></a>
            {item.snippet && <p>{item.snippet}</p>}
            <small>{formatDate(item.checkedAt)} · {host(item.url)} · valide a fonte antes de abordar</small>
          </div>
          <select aria-label={`Classificar ${item.title}`} value={item.status || "new"} onChange={(event) => onStatus(item.id, event.target.value)}>
            <option value="new">Novo</option>
            <option value="reviewed">Revisado</option>
            <option value="opportunity">Oportunidade</option>
            <option value="dismissed">Descartado</option>
          </select>
        </article>
      ))}
    </div>
  );
}

function MarketRadar({ authHeaders, onNavigate, setToast }) {
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("todos");

  const load = useCallback(async (term = "") => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (String(term).trim()) params.set("q", String(term).trim());
      const response = await fetch(`/api/todogreen/market-radar${params.size ? `?${params}` : ""}`, { headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível consultar RFQs e licitações.");
      setReport(payload);
    } catch (error) {
      setToast?.(error.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, setToast]);

  useEffect(() => { load(""); }, [load]);

  const opportunities = report?.opportunities || [];
  const visible = filter === "todos"
    ? opportunities
    : opportunities.filter((item) => String(item.kind).toLowerCase() === filter);
  const filters = [
    ["todos", "Todas"], ["rfq", "RFQ"], ["rfi", "RFI"], ["rfp", "RFP"],
    ["licitação", "Licitações"], ["concorrência", "Concorrências"],
  ];

  return (
    <section className="tdg-intelligence-market">
      <form className="tdg-intelligence-search" onSubmit={(event) => { event.preventDefault(); load(query); }}>
        <Search size={17} />
        <input
          aria-label="Buscar RFQs, RFIs e licitações"
          placeholder="Empresa, rota, região ou produto. Ex.: São Paulo, last mile"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={loading}>{loading ? "Buscando..." : "Buscar mercado"}</button>
      </form>
      <nav className="tdg-intelligence-tabs" aria-label="Tipos de processo">
        {filters.map(([id, label]) => (
          <button type="button" className={filter === id ? "active" : ""} onClick={() => setFilter(id)} key={id}>
            {label}<b>{id === "todos" ? opportunities.length : opportunities.filter((item) => String(item.kind).toLowerCase() === id).length}</b>
          </button>
        ))}
      </nav>
      {report?.policy && <p className="tdg-intelligence-policy"><strong>Critério:</strong> {report.policy}</p>}
      {loading && <div className="tdg-intelligence-empty"><Search size={24} /><strong>Pesquisando o mercado</strong></div>}
      {!loading && !visible.length && (
        <div className="tdg-intelligence-empty">
          <FileSearch size={24} />
          <strong>Nenhum processo elegível encontrado</strong>
          <span>O radar descarta vaga, conteúdo educativo, processo encerrado, Bitrem/Rodotrem e resultado sem evidência de participação aberta.</span>
        </div>
      )}
      {!loading && visible.length > 0 && (
        <div className="tdg-intelligence-source-list">
          {visible.map((item) => (
            <article key={item.id || item.url}>
              <div className="tdg-intelligence-source-icon"><FileSearch size={19} /></div>
              <div>
                <span>{item.source} · {item.kind} · confiança {item.confidence} · aderência {item.fitScore}/100</span>
                <a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={13} /></a>
                {item.snippet && <p>{item.snippet}</p>}
                <small>{item.deadline ? `Prazo identificado: ${item.deadline} · ` : ""}{host(item.url)} · {formatDate(item.checkedAt)}</small>
                {item.fitReasons?.length > 0 && <small>{item.fitReasons.join(" · ")}</small>}
              </div>
              <button type="button" onClick={() => onNavigate?.("/todogreen/oportunidades")}>Abrir pipeline</button>
            </article>
          ))}
        </div>
      )}
      {report && !loading && (
        <small className="tdg-intelligence-run">
          {opportunities.length} elegível(is) · {Number(report.rejected?.incompatibleFleet || 0)} incompatível(is) com frota · {Number(report.rejected?.closed || 0)} encerrado(s) · {Number(report.rejected?.vacancies || 0)} vaga(s) descartada(s)
        </small>
      )}
    </section>
  );
}

export default function TodoGreenIntelligenceHub({
  verticalData = {},
  initialView = "campaigns",
  onNavigate,
  authHeaders,
  setToast,
}) {
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
  const [temaAtivo, setTemaAtivo] = useState("todas");

  const nomesDeClientes = useMemo(
    () => (verticalData.clients || []).map((cliente) => cliente.nome || cliente.name).filter(Boolean),
    [verticalData.clients],
  );
  // Linhas antigas do banco chegam com texto cru de raspagem; a decoração
  // limpa, extrai a data mencionada pela fonte e classifica o tema das abas.
  const decorados = useMemo(() => marketItems.map((item) => {
    const title = limparResumoDeBusca(item.title);
    const snippet = limparResumoDeBusca(item.snippet);
    return {
      ...item,
      title,
      snippet,
      dataNoticia: extrairDataDaNoticia(`${title} ${snippet}`),
      tema: temaDaNoticia({ ...item, title, snippet }, nomesDeClientes),
    };
  }), [marketItems, nomesDeClientes]);

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

  if (initialView === "contacts") return <Contacts items={intelligence.contacts} onNavigate={onNavigate} clients={verticalData.clients || []} authHeaders={authHeaders} setToast={setToast} />;

  const options = [
    ["campaigns", "Campanhas", "workflow"],
    ["radar", "RFQs / RFIs", "ao vivo"],
    ["news", "Notícias", decorados.filter((item) => item.kind === "news").length],
    ["decisors", "LinkedIn e decisores", decorados.filter((item) => item.kind === "decisors").length],
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
        body: JSON.stringify({ kind: view === "decisors" ? "decisors" : "news", company }),
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
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível classificar o resultado.");
      setMarketItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    } catch (error) {
      setToast?.(error.message);
    }
  };

  const doTipo = decorados.filter((item) => item.kind === (view === "decisors" ? "decisors" : "news"));
  const visible = view === "news" && temaAtivo !== "todas"
    ? doTipo.filter((item) => item.tema === temaAtivo)
    : doTipo;
  const portfolioSources = view === "news" ? intelligence.news : [];
  const showSearchHeader = !["campaigns", "radar"].includes(view);

  return (
    <section className="tdg-intelligence">
      <header className="tdg-intelligence-hero">
        <div>
          <span className="tdg-kicker">MARKETING &amp; INTELIGÊNCIA COMERCIAL</span>
          <h2>Campanhas, mercado e geração de demanda</h2>
          <p>Planeje campanhas com aprovação e resultado; use o radar e a inteligência de mercado para alimentar Comercial.</p>
        </div>
        {showSearchHeader && (
          <button type="button" className="tdg-action" disabled={researching} onClick={research}>
            <Globe2 size={16} />{researching ? "Pesquisando..." : "Pesquisar agora"}
          </button>
        )}
      </header>
      <nav className="tdg-intelligence-tabs" aria-label="Visões de marketing e inteligência">
        {options.map(([id, label, count]) => (
          <button type="button" className={view === id ? "active" : ""} onClick={() => setView(id)} key={id}>{label}<b>{count}</b></button>
        ))}
      </nav>

      {view === "campaigns" && <EnterpriseWorkflowPanel domain="marketing" setToast={setToast} />}
      {view === "radar" && <MarketRadar authHeaders={authHeaders} onNavigate={onNavigate} setToast={setToast} />}
      {view === "decisors" && (
        <label className="tdg-intelligence-search">
          <Building2 size={17} />
          <input aria-label="Empresa para pesquisar decisores" placeholder="Nome da empresa, mesmo fora do CRM" value={company} onChange={(event) => setCompany(event.target.value)} />
          <button type="button" onClick={research} disabled={researching}>Pesquisar LinkedIn</button>
        </label>
      )}
      {view === "news" && (
        <nav className="tdg-intelligence-tabs" aria-label="Temas das notícias">
          {TEMAS_DE_NOTICIA.map(([id, label]) => (
            <button type="button" className={temaAtivo === id ? "active" : ""} onClick={() => setTemaAtivo(id)} key={id}>
              {label}<b>{id === "todas" ? doTipo.length : doTipo.filter((item) => item.tema === id).length}</b>
            </button>
          ))}
        </nav>
      )}
      {showSearchHeader && lastRun && (
        <small className="tdg-intelligence-run">
          Última pesquisa: {new Date(lastRun.createdAt).toLocaleString("pt-BR")} · {lastRun.resultCount} resultado(s)
        </small>
      )}
      {showSearchHeader && <MarketSourceList items={visible} loading={loading} onStatus={updateStatus} />}
      {portfolioSources.length > 0 && (
        <details className="tdg-intelligence-portfolio">
          <summary>Sinais já vinculados à carteira ({portfolioSources.length})</summary>
          <SourceList items={portfolioSources} empty={view} onNavigate={onNavigate} />
        </details>
      )}
    </section>
  );
}
