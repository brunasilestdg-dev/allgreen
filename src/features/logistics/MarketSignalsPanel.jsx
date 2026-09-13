import { useEffect, useState } from "react";
import { Briefcase, ExternalLink, Radar, RefreshCw, Settings2 } from "lucide-react";

// Sinais de mercado ESTRUTURADOS (PNCP · Compras.gov.br · GDELT), lidos de
// GET /api/todogreen/market-signals. Cada sinal traz score explicável (os
// motivos aparecem), origem, prazo e a triagem do espaço. Complementa o radar
// por busca web da mesma tela — não o substitui.

const FONTE = { pncp: "PNCP", "compras-gov": "Compras.gov.br", gdelt: "GDELT", web: "Busca web" };
const STATUS_REF = { ok: "atualizada", stale: "desatualizada", error: "falhou", never: "nunca rodou", not_configured: "desligada" };
const data = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function MarketSignalsPanel({ authHeaders, setToast }) {
  const [dados, setDados] = useState(null);
  const [estado, setEstado] = useState("carregando");
  const [ocupado, setOcupado] = useState("");
  const [fonte, setFonte] = useState("");
  // Preferências do espaço (termos PNCP/GDELT, UFs de foco): editadas aqui,
  // gravadas em PUT /market-signals/prefs; vazio = padrão do código.
  const [prefsForm, setPrefsForm] = useState(null);
  const [salvandoPrefs, setSalvandoPrefs] = useState(false);

  const cabecalhos = () => authHeaders?.() || {};
  const carregar = async (f = fonte) => {
    const params = new URLSearchParams({ limit: "60" });
    if (f) params.set("source", f);
    const r = await fetch(`/api/todogreen/market-signals?${params}`, { headers: cabecalhos() }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    return r && Array.isArray(r.signals) ? r : null;
  };

  useEffect(() => {
    let vivo = true;
    carregar("").then((r) => { if (!vivo) return; setDados(r); setEstado("ok"); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const filtrar = async (f) => {
    setFonte(f);
    setDados(await carregar(f));
  };

  const sincronizar = async (source) => {
    setOcupado(source);
    try {
      const r = await fetch("/api/todogreen/market-signals/sync", { method: "POST", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify({ source }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || corpo.resultado?.error || `${FONTE[source]} não respondeu.`);
      setToast?.(`${FONTE[source]}: ${corpo.resultado?.records ?? 0} item(ns) lidos, ${corpo.resultado?.aceitos ?? 0} sinal(is) aceito(s).`);
      setDados(await carregar());
    } catch (erro) {
      setToast?.(erro.message);
    } finally {
      setOcupado("");
    }
  };

  // Sinal → oportunidade pela MESMA esteira de records/opportunities (o
  // servidor cria e marca a triagem como convertida).
  const converter = async (sinal) => {
    setOcupado(`opp:${sinal.id}`);
    try {
      const r = await fetch(`/api/todogreen/market-signals/${sinal.id}/opportunity`, { method: "POST", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify({}) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não foi possível criar a oportunidade.");
      setToast?.(corpo.created ? `Oportunidade criada a partir do sinal (${corpo.opportunity?.cliente || "cliente"}). Veja em Comercial → Oportunidades.` : "Este sinal já tinha sido convertido em oportunidade.");
      setDados(await carregar());
    } catch (erro) {
      setToast?.(erro.message);
    } finally {
      setOcupado("");
    }
  };

  const abrirPrefs = () => {
    const p = dados?.prefs || {};
    setPrefsForm({ termosPncp: (p.termosPncp || []).join("\n"), termosGdelt: (p.termosGdelt || []).join("\n"), ufsFoco: (p.ufsFoco || []).join(", ") });
  };
  const salvarPrefs = async () => {
    setSalvandoPrefs(true);
    try {
      const r = await fetch("/api/todogreen/market-signals/prefs", { method: "PUT", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify(prefsForm) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não foi possível salvar as preferências do radar.");
      setToast?.("Preferências do radar salvas — valem na próxima sincronização.");
      setPrefsForm(null);
      setDados(await carregar());
    } catch (erro) {
      setToast?.(erro.message);
    } finally {
      setSalvandoPrefs(false);
    }
  };

  const triar = async (sinal, status) => {
    try {
      const r = await fetch(`/api/todogreen/market-signals/${sinal.id}`, { method: "PATCH", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Não foi possível triar o sinal.");
      setDados(await carregar());
    } catch (erro) {
      setToast?.(erro.message);
    }
  };

  if (estado === "carregando") return <p className="tdg-intelligence-policy">Carregando sinais estruturados (PNCP · Compras.gov · GDELT)…</p>;
  if (!dados) return <p className="tdg-intelligence-policy"><strong>Sinais estruturados:</strong> indisponíveis neste servidor (o endpoint não respondeu). Nada foi estimado no lugar.</p>;

  const fontes = dados.fontes || {};
  const canResearch = Boolean(dados.access?.canResearch);
  const linhaFonte = (id, f) => `${FONTE[id]}: ${STATUS_REF[f?.status] || "—"}${f?.lastSuccessAt ? ` (${data(f.lastSuccessAt)})` : ""}`;

  return (
    <section className="tdg-intelligence-signals" data-testid="tdg-market-signals">
      <header>
        <div>
          <strong><Radar size={15} /> Sinais estruturados</strong>
          <small>{linhaFonte("pncp", fontes.pncp)} · {linhaFonte("compras-gov", fontes.comprasGov)} · {linhaFonte("gdelt", fontes.gdelt)} · {fontes.sinais?.total ?? 0} sinais no total</small>
        </div>
        <div className="tdg-intelligence-signals-acoes">
          <select aria-label="Filtrar por fonte" value={fonte} onChange={(e) => filtrar(e.target.value)}>
            <option value="">Todas as fontes</option>
            <option value="pncp">PNCP</option>
            <option value="compras-gov">Compras.gov.br</option>
            <option value="gdelt">GDELT (notícias)</option>
          </select>
          {canResearch && ["pncp", "compras-gov", "gdelt"].map((s) => (
            <button type="button" key={s} disabled={Boolean(ocupado)} onClick={() => sincronizar(s)}><RefreshCw size={12} /> {ocupado === s ? "…" : FONTE[s]}</button>
          ))}
          {canResearch && <button type="button" onClick={prefsForm ? () => setPrefsForm(null) : abrirPrefs} aria-expanded={Boolean(prefsForm)}><Settings2 size={12} /> Termos e UFs</button>}
        </div>
      </header>
      {prefsForm && (
        <form className="tdg-intelligence-signals-prefs" data-testid="tdg-market-prefs" onSubmit={(e) => { e.preventDefault(); salvarPrefs(); }}>
          <label>
            <span>Termos PNCP (um por linha; vazio = padrão: {(dados.prefs?.padrao?.termosPncp || []).join(", ")})</span>
            <textarea rows={3} value={prefsForm.termosPncp} onChange={(e) => setPrefsForm((v) => ({ ...v, termosPncp: e.target.value }))} />
          </label>
          <label>
            <span>Termos GDELT (um por linha; aspas mantêm a expressão exata)</span>
            <textarea rows={3} value={prefsForm.termosGdelt} onChange={(e) => setPrefsForm((v) => ({ ...v, termosGdelt: e.target.value }))} />
          </label>
          <label>
            <span>UFs de foco (bônus no score da sincronização manual, ex.: SP, MG)</span>
            <input value={prefsForm.ufsFoco} onChange={(e) => setPrefsForm((v) => ({ ...v, ufsFoco: e.target.value }))} placeholder="SP, RJ, MG" />
          </label>
          <div>
            <button type="submit" disabled={salvandoPrefs}>{salvandoPrefs ? "Salvando…" : "Salvar preferências"}</button>
            <small>O cron continua cobrindo os termos padrão + os de todos os espaços; estas preferências valem na sincronização manual e no filtro.</small>
          </div>
        </form>
      )}
      <p className="tdg-intelligence-policy"><strong>Critério:</strong> licitação só com objeto de transporte/logística e proposta ainda aberta; notícia só com transporte ou eletrificação. Fora de escopo, bitrem/rodotrem e processo encerrado são rejeitados. O score explica cada ponto.</p>
      {dados.signals.length === 0 ? (
        <div className="tdg-intelligence-empty"><Radar size={22} /><strong>Nenhum sinal estruturado ainda</strong><span>O cron sincroniza PNCP a cada 6 h, Compras.gov diariamente e GDELT a cada hora. Quem tem permissão de pesquisa pode sincronizar agora.</span></div>
      ) : (
        <div className="tdg-intelligence-source-list">
          {dados.signals.map((s) => (
            <article key={s.id} className={s.triage?.status === "dismissed" ? "is-stale" : ""}>
              <div className="tdg-intelligence-source-icon"><Radar size={19} /></div>
              <div>
                <span>{(s.sources || [s.source]).map((x) => FONTE[x] || x).join(" + ")} · {s.kind === "licitacao" ? "licitação" : "notícia"} · score {s.score}/100{s.uf ? ` · ${s.uf}` : ""}{s.triage?.status && s.triage.status !== "new" ? ` · ${s.triage.status}` : ""}</span>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title} <ExternalLink size={13} /></a> : <strong>{s.title}</strong>}
                {s.summary && s.summary !== s.title && <p>{s.summary}</p>}
                <small>
                  {s.orgao ? `${s.orgao} · ` : ""}{s.municipio ? `${s.municipio}/${s.uf} · ` : ""}{s.modalidade ? `${s.modalidade} · ` : ""}
                  {s.kind === "licitacao" ? `propostas até ${data(s.prazoProposta)} · ` : `${s.dominio || ""} · `}publicado {data(s.publicadoEm)}
                  {s.valorEstimado ? ` · ${moeda.format(s.valorEstimado)}` : ""}{s.seenCount > 1 ? ` · visto ${s.seenCount}×` : ""}
                </small>
                {s.scoreReasons?.length > 0 && <small>{s.scoreReasons.join(" · ")}</small>}
              </div>
              {canResearch && (
                <div className="tdg-intelligence-signals-triagem">
                  <button type="button" onClick={() => triar(s, "triaged")}>Triar</button>
                  <button type="button" onClick={() => triar(s, "dismissed")}>Descartar</button>
                  {s.triage?.status === "converted" && s.triage.opportunityId
                    ? <small>Oportunidade criada</small>
                    : <button type="button" disabled={ocupado === `opp:${s.id}`} onClick={() => converter(s)}><Briefcase size={12} /> {ocupado === `opp:${s.id}` ? "…" : "Criar oportunidade"}</button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
