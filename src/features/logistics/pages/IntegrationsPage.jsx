import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  CircleDashed,
  Database,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  ServerCog,
  Workflow,
  Zap,
} from "lucide-react";
import AiKeysPanel from "../../integrations/AiKeysPanel.jsx";
import McpConnectionsPanel from "../../integrations/McpConnectionsPanel.jsx";
import SearchKeysPanel from "../../integrations/SearchKeysPanel.jsx";
import MercadoLivrePanel from "./MercadoLivrePanel.jsx";
import "./TodoGreenPages.css";

const STATUS = {
  connected: { label: "Conectada e validada", Icon: CheckCircle2 },
  configured: { label: "Configurada, validação pendente", Icon: CircleDashed },
  requires_setup: { label: "Configuração necessária", Icon: CircleDashed },
  external_dependency: { label: "Depende de serviço externo", Icon: ServerCog },
  error: { label: "Erro na integração", Icon: AlertTriangle },
};

const ProviderList = ({ title, icon: Icon, items = [], testing, onTest, onConnect, healthById = new Map() }) => (
  <section className="tdg-panel">
    <div className="tdg-section-head">
      <div><span className="tdg-kicker">INTEGRAÇÕES</span><h2>{title}</h2></div>
      <Icon size={22} />
    </div>
    <div className="tdg-access-list">
      {items.length === 0 && <p>Nenhuma integração cadastrada nesta categoria.</p>}
      {items.map((item) => {
        const state = STATUS[item.status] || STATUS[item.configured ? "configured" : "requires_setup"];
        const StateIcon = state.Icon;
        const health = healthById.get(item.id) || {
          configured: Boolean(item.configured),
          authenticated: false,
          online: false,
          checkedAt: "",
          nextAction: item.configured
            ? "Execute o teste para validar autenticação e disponibilidade."
            : item.requirement || "Conclua a configuração desta integração.",
        };
        return (
          <div className="tdg-access-row" key={item.id}>
            <span>
              <StateIcon size={16} />
              <strong>{item.name || item.id}</strong>
              <small><b>{state.label}.</b> {item.detail || "Sem detalhe adicional."}</small>
              {Array.isArray(item.capabilities) && item.capabilities.length > 0 && (
                <small>Recursos: {item.capabilities.join(" · ")}</small>
              )}
              {item.requirement && <small>Necessário: {item.requirement}</small>}
              <small className="tdg-integration-health">Configurada: {health.configured ? "sim" : "não"} · Autenticada: {health.authenticated ? "sim" : "não"} · Online: {health.online ? "sim" : "não"}{health.checkedAt ? ` · Verificada: ${new Date(health.checkedAt).toLocaleString("pt-BR")}` : ""}</small>
              {health?.error && <small className="tdg-integration-error">Erro: {health.error}</small>}
              {health?.nextAction && <small>Ação disponível: {health.nextAction}</small>}
            </span>
            {onConnect && item.canConnect && (
              <button
                type="button"
                className="tdg-action"
                onClick={() => onConnect(item)}
              >
                {item.status === "connected" ? "Reconectar" : "Conectar"}
              </button>
            )}
            {onTest && item.canTest && (
              <button
                type="button"
                disabled={!item.configured || testing === item.id}
                onClick={() => onTest(item.id)}
              >
                {testing === item.id ? "Testando..." : "Testar"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  </section>
);

export default function IntegrationsPage({ authHeaders, setToast }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/todogreen/integrations", { headers: authHeaders?.() || {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as integrações.");
      setStatus(data);
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // monday.com e Mercado Livre devolvem o usuário para /todogreen/integracoes?<id>=...
  // após a autorização. Traduz o resultado num aviso e limpa o parâmetro para não repetir.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const avisos = {
      monday: {
        connected: "Conta monday.com conectada. Use “Testar” após mapear os boards.",
        denied: "A autorização com o monday.com foi cancelada.",
        error: "Não foi possível concluir a conexão com o monday.com.",
      },
      mercadolivre: {
        connected: "Conta do Mercado Livre conectada. Use “Testar” para confirmar o vínculo.",
        denied: "A autorização com o Mercado Livre foi cancelada.",
        error: "Não foi possível concluir a conexão com o Mercado Livre.",
      },
    };
    let mudou = false;
    for (const [id, textos] of Object.entries(avisos)) {
      const resultado = params.get(id);
      if (!resultado) continue;
      setToast?.(textos[resultado] || textos.error);
      params.delete(id);
      mudou = true;
    }
    if (!mudou) return;
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Inicia o OAuth: pede a URL de autorização (autenticado por Bearer, como o
  // resto do app) e só então navega o navegador até o provedor. Assim o botão
  // não depende do cookie de sessão e falhas viram aviso, não tela em branco.
  const connect = async (item) => {
    const path = item?.connectPath || "/api/todogreen/integrations/monday/oauth/start";
    try {
      const response = await fetch(path, { headers: authHeaders?.() || {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(data.error || `Não foi possível iniciar a conexão com ${item?.name || "a integração"}.`);
      }
      window.location.href = data.authorizeUrl;
    } catch (error) {
      setToast?.(error.message);
    }
  };

  const resumoDaBusca = (t) => {
    if (!t) return "Não foi possível testar a busca.";
    if (!t.configured) return "Nenhuma fonte de pesquisa está configurada.";
    const falhas = (t.failures || []).map((f) => `${f.provider}: ${f.error}`).join(" · ");
    if (!t.providers?.length)
      return `Nenhum provedor respondeu. ${falhas || "Sem detalhe do erro."}`;
    if (!t.resultCount)
      return `${t.providers.join(", ")} respondeu em ${t.latencyMs} ms, mas sem nenhum resultado.${falhas ? ` Falhas: ${falhas}` : ""}`;
    return `${t.providers.join(", ")}: ${t.resultCount} resultado(s) em ${t.latencyMs} ms.${falhas ? ` Falhas: ${falhas}` : ""}`;
  };

  const test = async (provider) => {
    setTesting(provider);
    try {
      const response = await fetch("/api/todogreen/integrations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "O provedor não respondeu.");
      if (data.mercadoLivreTest) {
        const t = data.mercadoLivreTest;
        setToast?.(t.ok
          ? `Mercado Livre respondeu em ${t.latencyMs} ms · conta ${t.nickname || t.userId}.`
          : `O Mercado Livre respondeu HTTP ${t.status}. Reconecte a conta.`);
        load();
      } else if (data.searchTest) {
        setToast?.(resumoDaBusca(data.searchTest));
      } else if (data.integrationTest?.skipped) {
        setToast?.(data.integrationTest.detail || "A integração ainda depende de configuração.");
      } else if (data.integrationTest) {
        setToast?.(`${data.integrationTest.provider} respondeu em ${data.integrationTest.latencyMs} ms.`);
      } else if (data.test) {
        setToast?.(`${data.test.provider} respondeu em ${data.test.latencyMs} ms.`);
      }
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setTesting("");
    }
  };

  const nomeDaFonte = {
    searxng: "SearXNG",
    brave: "Brave Search",
    tavily: "Tavily",
    serper: "Serper",
    exa: "Exa",
    jina: "Jina Search",
    google: "Google Search",
    firecrawl: "Firecrawl",
    search1: "Search1API",
    you: "You.com",
    serpapi: "SerpApi",
    duckduckgo: "DuckDuckGo (sem chave)",
    wikidata: "Wikidata (sem chave)",
    wikipedia: "Wikipédia (sem chave)",
  };

  const marketItems = useMemo(() => {
    const fontes = (status?.search?.providers || []).filter((provider) => provider.configured);
    return (status?.market || []).map((item) => item.id !== "web-search" ? item : {
      ...item,
      detail: item.configured
        ? `Fonte(s) ligada(s): ${fontes.map((provider) => nomeDaFonte[provider.id] || provider.id).join(", ") || "nenhuma"}. Use “Testar” para validar resposta e resultados.`
        : item.detail,
    });
  }, [status]);

  const healthById = useMemo(
    () => new Map((status?.health || []).map((item) => [item.integrationId, item])),
    [status],
  );

  const summary = useMemo(() => {
    const items = [
      ...(status?.ai || []),
      ...(status?.market || []),
      ...(status?.messaging || []),
      ...(status?.communication || []),
      ...(status?.operational || []),
      ...(status?.management || []),
      ...(status?.dataExchange || []),
      ...(status?.automation || []),
      ...Object.values(status?.external || {}).flat(),
    ];
    return {
      connected: items.filter((item) => item.status === "connected").length,
      configured: items.filter((item) => item.status === "configured").length,
      external: items.filter((item) => item.status === "external_dependency").length,
      errors: items.filter((item) => item.status === "error").length,
    };
  }, [status]);

  if (loading && !status)
    return <section className="tdg-panel" aria-busy="true">Carregando integrações...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CONFIABILIDADE</span>
          <h2>Central de Integrações</h2>
          <p>Conectores do ERP com estado real. “Configurada” não significa “validada”: serviços externos só ficam verdes depois de evidência de conexão ou execução.</p>
        </div>
        <button className="tdg-action" type="button" onClick={load}><RefreshCw size={16} />Atualizar</button>
      </header>

      <section className="tdg-panel">
        <div className="tdg-section-head"><div><span className="tdg-kicker">RESUMO</span><h2>Prontidão das integrações</h2></div><Cable size={22} /></div>
        <div className="tdg-access-list">
          <div className="tdg-access-row"><span><CheckCircle2 size={16} /><strong>{summary.connected} conectada(s) e validada(s)</strong><small>Há evidência de funcionamento no ERP.</small></span></div>
          <div className="tdg-access-row"><span><CircleDashed size={16} /><strong>{summary.configured} configurada(s)</strong><small>Credencial ou infraestrutura presente, ainda sem prova suficiente para chamar de conectada.</small></span></div>
          <div className="tdg-access-row"><span><ServerCog size={16} /><strong>{summary.external} dependência(s) externa(s)</strong><small>Exigem API, certificado, OAuth, servidor ou autorização do provedor.</small></span></div>
          {summary.errors > 0 && <div className="tdg-access-row"><span><AlertTriangle size={16} /><strong>{summary.errors} integração(ões) com erro</strong><small>Precisam de correção antes do uso operacional.</small></span></div>}
        </div>
      </section>

      <McpConnectionsPanel setToast={setToast} authHeaders={authHeaders} />
      <AiKeysPanel setToast={setToast} authHeaders={authHeaders} />
      <ProviderList title="Cascata de IA (status)" icon={Zap} items={status?.ai} testing={testing} onTest={test} healthById={healthById} />
      <ProviderList title="Mercado e prospecção" icon={Search} items={marketItems} testing={testing} onTest={test} healthById={healthById} />
      <section className="tdg-panel"><SearchKeysPanel authHeaders={authHeaders} setToast={setToast} /></section>

      <ProviderList title="CEP, CNPJ e cadastros" icon={Database} items={status?.external?.registration} testing={testing} onTest={test} healthById={healthById} />
      <ProviderList title="Dados públicos, clima e ESG" icon={Search} items={status?.external?.intelligence} testing={testing} onTest={test} healthById={healthById} />
      <ProviderList title="Roteirização própria" icon={ServerCog} items={status?.external?.routing} testing={testing} onTest={test} healthById={healthById} />
      <ProviderList title="IA local preparada" icon={Zap} items={status?.external?.localAi} testing={testing} onTest={test} healthById={healthById} />

      <ProviderList title="Mensageria" icon={MessageCircle} items={status?.messaging} healthById={healthById} />
      <ProviderList title="Comunicação e produtividade" icon={Mail} items={status?.communication} healthById={healthById} />
      <ProviderList title="Operação e fiscal" icon={ServerCog} items={status?.operational} testing={testing} onTest={test} onConnect={connect} healthById={healthById} />
      <MercadoLivrePanel authHeaders={authHeaders} setToast={setToast} onChange={load} />
      <ProviderList title="Dados e gestão" icon={Database} items={status?.management} testing={testing} onTest={test} onConnect={connect} healthById={healthById} />
      <ProviderList title="API e troca de dados" icon={Cable} items={status?.dataExchange} healthById={healthById} />
      <ProviderList title="Automação ativa na Cloudflare" icon={Workflow} items={status?.automation} healthById={healthById} />

      <section className="tdg-panel">
        <h2>Fora do escopo atual</h2>
        <p>Whisper e geração de imagens permanecem desligados porque não fazem parte da jornada comercial, logística ou ESG.</p>
      </section>
    </div>
  );
}
