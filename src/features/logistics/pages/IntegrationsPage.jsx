import { useEffect, useState } from "react";
import { Cable, CheckCircle2, CircleDashed, Mail, MessageCircle, RefreshCw, Search, Workflow, Zap } from "lucide-react";
import AiKeysPanel from "../../integrations/AiKeysPanel.jsx";
import SearchKeysPanel from "../../integrations/SearchKeysPanel.jsx";
import "./TodoGreenPages.css";

const ProviderList = ({ title, icon: Icon, items = [], testing, onTest }) => (
  <section className="tdg-panel">
    <div className="tdg-section-head"><div><span className="tdg-kicker">INTEGRAÇÕES</span><h2>{title}</h2></div><Icon size={22} /></div>
    <div className="tdg-access-list">
      {items.map((item) => (
        <div className="tdg-access-row" key={item.id}>
          <span>{item.configured ? <CheckCircle2 size={16} /> : <CircleDashed size={16} />}<strong>{item.name || item.id}</strong><small>{item.detail || (item.configured ? "Configurado" : "Pendente de credencial")}</small></span>
          {onTest && <button type="button" disabled={!item.configured || testing === item.id} onClick={() => onTest(item.id)}>{testing === item.id ? "Testando..." : "Testar"}</button>}
        </div>
      ))}
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
  // O teste da busca não cabe em "respondeu em N ms": ela tem vários
  // provedores, e o desfecho que mais confunde é o provedor que responde
  // certinho e não traz nada — que se parece com estar fora do ar, sem ser.
  // Cada caso ganha uma frase que diz o que está acontecendo.
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
      setToast?.(
        data.searchTest
          ? resumoDaBusca(data.searchTest)
          : `${data.test.provider} respondeu em ${data.test.latencyMs} ms.`,
      );
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setTesting("");
    }
  };
  if (loading && !status) return <section className="tdg-panel" aria-busy="true">Carregando integrações...</section>;
  // "Configurada" respondia à pergunta errada. A pesquisa de empresa podia
  // falhar com a busca marcada como configurada, e a tela não tinha como
  // dizer o motivo — nem sequer QUAL fonte estava ligada. Agora cada provedor
  // aparece com nome, e o de "Pesquisa web" pode ser testado de verdade.
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
  const fontes = (status?.search?.providers || []).filter((p) => p.configured);
  const searchItems = [
    {
      id: "web-search",
      name: "Pesquisa web pública",
      configured: Boolean(status?.search?.configured),
      detail: status?.search?.configured
        ? `Fonte(s) ligada(s): ${fontes.map((p) => nomeDaFonte[p.id] || p.id).join(", ") || "nenhuma"}. Use "Testar" para ver se respondem e se trazem resultado.`
        : "Pendente de uma fonte de pesquisa",
    },
  ];
  return (
    <div className="tdg-page">
      <header className="tdg-page-title"><div><span>CONFIABILIDADE</span><h2>Integrações de IA, busca e automação</h2><p>O Plantû usa a cascata de IA e as fontes de busca configuradas. As automações essenciais rodam na própria Cloudflare.</p></div><button className="tdg-action" type="button" onClick={load}><RefreshCw size={16} />Atualizar</button></header>
      {/* As suas chaves de IA (Claude, GPT, Google e outras), guardadas no cofre
          e usadas pela cascata. É aqui que o usuário conecta a própria conta —
          antes só dava para ver o status, não para adicionar a chave. */}
      <AiKeysPanel setToast={setToast} authHeaders={authHeaders} />
      <ProviderList title="Cascata de IA (status)" icon={Zap} items={status?.ai} testing={testing} onTest={test} />
      <ProviderList title="Busca web" icon={Search} items={searchItems} testing={testing} onTest={test} />
      <section className="tdg-panel">
        <SearchKeysPanel authHeaders={authHeaders} setToast={setToast} />
      </section>
      <ProviderList title="WhatsApp" icon={MessageCircle} items={status?.messaging} />
      <ProviderList title="E-mail e produtividade" icon={Mail} items={status?.communication} />
      <ProviderList title="API e troca de dados" icon={Cable} items={status?.dataExchange} />
      <ProviderList title="Automação ativa na Cloudflare" icon={Workflow} items={status?.automation} />
      <section className="tdg-panel"><h2>Fora do escopo atual</h2><p>Whisper e geração de imagens permanecem desligados porque não fazem parte da jornada comercial, logística ou ESG.</p></section>
    </div>
  );
}
