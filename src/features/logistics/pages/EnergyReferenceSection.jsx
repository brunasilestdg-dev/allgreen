import { useEffect, useState } from "react";
import { CalendarClock, Fuel, Loader2, RefreshCw, Settings2, Zap } from "lucide-react";

// Referências públicas de energia (P4): tarifa pela hierarquia (contrato >
// informada > ANEEL > fallback), melhor hora (financeira/energética/recomendada,
// com ONS), preço de diesel (contrato > frota > ANP município/UF/região/país >
// fallback) e o plano de recarga por veículo. Tudo vem de
// GET /api/todogreen/energy/plan — a regra mora no servidor (domínios puros),
// a tela só mostra a origem, a data e a confiança de cada número. Sem dado, a
// tela diz "indisponível" — nunca inventa.

const moedaKwh = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const moeda2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const TIER_TARIFA = { contractual: "Contrato com a distribuidora", informed: "Informada pela operação", aneel: "ANEEL — tarifa homologada", fallback: "Fallback declarado" };
const TIER_DIESEL = { contractual: "Contrato", fleet: "Frota informada", anp_municipal: "ANP — município", anp_state: "ANP — UF", anp_region: "ANP — região", anp_national: "ANP — Brasil", fallback: "Fallback declarado" };
const STATUS_REF = { ok: "Atualizada", stale: "Desatualizada", error: "Falhou", never: "Nunca sincronizada", not_configured: "Sem perfil" };
const CONFIANCA = { HIGH: "alta", MEDIUM: "média", LOW: "baixa", UNKNOWN: "desconhecida" };
const AVISOS = {
  ONS_NOT_AVAILABLE: "Sem perfil de carga do ONS: a hora energética não é calculada e a recomendada iguala a financeira.",
  TARIFA_INDISPONIVEL: "Sem curva tarifária: cadastre contrato, tarifa informada ou o perfil ANEEL.",
  TARIFA_PLANA_SEM_GANHO_HORARIO: "Tarifa plana: não há ganho em escolher a hora — o critério passa a ser a carga do sistema.",
  JANELA_MAIOR_QUE_DISPONIBILIDADE: "A recarga precisa de mais horas do que a frota fica parada.",
  SEM_PONTOS_ATIVOS: "Nenhum ponto de recarga ativo cadastrado.",
  DEMANDA_LIMITANTE: "A demanda contratada limitou a potência de recarga.",
  VEICULOS_INCOMPLETOS: "Há veículos que não fecham a energia antes da saída.",
};
const data = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
const dataHora = (iso) => (iso ? `${data(iso)} ${String(iso).slice(11, 16)}` : "—");

const CAMPOS_TEXTO = ["distribuidora", "subgrupo", "modalidade", "uf", "municipio", "regiao", "subsistemaOns", "dieselProduto", "tarifaContratualData", "tarifaInformadaData", "dieselContratualData", "dieselFrotaData"];
const CAMPOS_NUMERO = ["demandaContratadaKw", "tarifaContratualKwh", "tarifaInformadaKwh", "tarifaFallbackKwh", "dieselContratualL", "dieselFrotaL", "dieselFallbackL", "saidaHora", "chegadaHora", "socChegadaPercent"];
const formDoPerfil = (perfil = {}) => {
  const f = {};
  for (const k of CAMPOS_TEXTO) f[k] = perfil[k] ?? "";
  for (const k of CAMPOS_NUMERO) f[k] = perfil[k] === null || perfil[k] === undefined ? "" : String(perfil[k]);
  return f;
};

function Badge({ status }) {
  return <span className={`tdg-eref-badge ${status || "never"}`}>{STATUS_REF[status] || status || "—"}</span>;
}

function Janela({ titulo, janela, icone }) {
  if (!janela) return (
    <div className="tdg-recarga-card"><small>{icone}{titulo}</small><strong>—</strong><em>indisponível</em></div>
  );
  return (
    <div className="tdg-recarga-card">
      <small>{icone}{titulo}</small>
      <strong>{janela.rotulo}</strong>
      <em>{janela.criterio}{janela.tarifaMedia ? ` · ${moedaKwh.format(janela.tarifaMedia)}/kWh` : ""}{janela.confidence ? ` · confiança ${CONFIANCA[janela.confidence] || janela.confidence}` : ""}{janela.foraDaDisponibilidade ? " · fora das horas paradas" : ""}</em>
    </div>
  );
}

export default function EnergyReferenceSection({ authHeaders }) {
  const [plano, setPlano] = useState(null);
  const [perfilInfo, setPerfilInfo] = useState(null);
  const [form, setForm] = useState(formDoPerfil());
  const [estado, setEstado] = useState("carregando");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [distribuidoras, setDistribuidoras] = useState(null);
  const [formAberto, setFormAberto] = useState(false);

  const cabecalhos = () => authHeaders?.() || {};
  const carregar = async () => {
    const [p, pf] = await Promise.all([
      fetch("/api/todogreen/energy/plan", { headers: cabecalhos() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/todogreen/energy/profile", { headers: cabecalhos() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    return { p, pf };
  };

  useEffect(() => {
    let vivo = true;
    carregar().then(({ p, pf }) => {
      if (!vivo) return;
      setPlano(p && p.tarifa ? p : null);
      setPerfilInfo(pf && pf.perfil ? pf : null);
      if (pf && pf.perfil) setForm(formDoPerfil(pf.perfil));
      setEstado("ok");
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const recarregar = async () => {
    const { p, pf } = await carregar();
    setPlano(p && p.tarifa ? p : null);
    if (pf && pf.perfil) { setPerfilInfo(pf); setForm(formDoPerfil(pf.perfil)); }
  };

  const salvar = async (e) => {
    e.preventDefault();
    setOcupado("perfil");
    setMensagem("");
    try {
      const corpo = {};
      for (const k of CAMPOS_TEXTO) corpo[k] = form[k];
      for (const k of CAMPOS_NUMERO) corpo[k] = form[k] === "" ? null : form[k];
      const r = await fetch("/api/todogreen/energy/profile", { method: "PUT", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify(corpo) });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.error || "Não foi possível salvar o perfil.");
      setMensagem("Perfil de energia salvo. O plano foi recalculado.");
      await recarregar();
    } catch (erro) {
      setMensagem(erro.message);
    } finally {
      setOcupado("");
    }
  };

  const sincronizar = async (source) => {
    setOcupado(source);
    setMensagem("");
    try {
      const r = await fetch("/api/todogreen/energy/sync", { method: "POST", headers: { "content-type": "application/json", ...cabecalhos() }, body: JSON.stringify({ source }) });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.error || dados.resultado?.error || `A fonte ${source.toUpperCase()} não respondeu.`);
      setMensagem(`${source.toUpperCase()} sincronizada: ${dados.resultado?.records ?? 0} registro(s) da fonte.`);
      await recarregar();
    } catch (erro) {
      setMensagem(erro.message);
    } finally {
      setOcupado("");
    }
  };

  const carregarDistribuidoras = async () => {
    if (distribuidoras) return;
    const r = await fetch("/api/todogreen/energy/distribuidoras", { headers: cabecalhos() }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setDistribuidoras(r?.distribuidoras || []);
  };

  if (estado === "carregando") {
    return <div className="tdg-recarga tdg-eref"><p className="tdg-recarga-nota"><Loader2 className="girando" size={16} /> Carregando tarifa, melhor hora e plano de recarga...</p></div>;
  }
  if (!plano) {
    return <div className="tdg-recarga tdg-eref"><p className="tdg-recarga-nota">Plano de energia indisponível neste servidor (o endpoint não respondeu). Nada foi estimado no lugar.</p></div>;
  }

  const { tarifa, janelas, diesel, plano: recarga, referencias, perfil } = plano;
  const canWrite = Boolean(perfilInfo?.access?.canWrite);
  const opcoes = perfilInfo?.opcoes || { subgrupos: [], modalidades: [], subsistemas: {}, produtosDiesel: ["diesel_s10", "diesel"] };
  const campo = (k) => ({ value: form[k] ?? "", onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });

  return (
    <div className="tdg-recarga tdg-eref">
      <h3><Zap size={16} /> Tarifa de referência, melhor hora e plano de recarga</h3>
      <p className="tdg-recarga-nota">Cada número diz de onde veio e de quando é. Tarifa: contrato &gt; informada &gt; ANEEL (tarifas homologadas, dados abertos) &gt; fallback declarado. Diesel: contrato &gt; frota &gt; ANP por município/UF/região/Brasil &gt; fallback. A hora energética usa a curva de carga do ONS — um proxy de sistema mais leve, não medição de carbono.</p>

      <div className="tdg-recarga-grid">
        <div className="tdg-recarga-card destaque">
          <small><Zap size={13} /> Tarifa em uso</small>
          <strong>{tarifa.tarifaKwhBase !== null && tarifa.tarifaKwhBase !== undefined ? `${moedaKwh.format(tarifa.tarifaKwhBase)}/kWh` : "—"}</strong>
          <em>
            {TIER_TARIFA[tarifa.tier] || "Sem tarifa disponível"}
            {tarifa.detalhe?.distribuidora ? ` · ${tarifa.detalhe.distribuidora} ${tarifa.detalhe.subgrupo} ${tarifa.detalhe.modalidade}` : ""}
            {tarifa.detalhe?.vigenciaInicio ? ` · vigência ${data(tarifa.detalhe.vigenciaInicio)}–${data(tarifa.detalhe.vigenciaFim)}` : ""}
            {tarifa.provenance?.capturedAt ? ` · fonte de ${data(tarifa.provenance.capturedAt)}` : ""}
            {tarifa.stale ? " · DESATUALIZADA" : ""}
            {tarifa.fallbackDoMotor ? " · régua do motor: cadastre a distribuidora ou a tarifa do contrato" : ""}
          </em>
        </div>
        <div className="tdg-recarga-card">
          <small><Fuel size={13} /> Diesel de referência</small>
          <strong>{diesel?.resolved ? `${moeda2.format(diesel.priceRs)}/L` : "—"}</strong>
          <em>
            {diesel?.resolved
              ? `${TIER_DIESEL[diesel.tier] || diesel.tier} · ${diesel.produto === "diesel_s10" ? "diesel S10" : "diesel"}${diesel.provenance?.capturedAt ? ` · coleta ${data(diesel.provenance.capturedAt)}` : ""}${diesel.stale ? " · DESATUALIZADO" : ""}`
              : "Sem preço: sincronize a ANP ou informe o preço de contrato/frota no perfil."}
          </em>
        </div>
      </div>

      <h4 className="tdg-eref-sub"><CalendarClock size={15} /> Melhor hora para recarregar ({janelas.horasNecessarias}h{janelas.saidaHora !== null && janelas.saidaHora !== undefined ? ` · saída ${String(janelas.saidaHora).padStart(2, "0")}h` : ""})</h4>
      <div className="tdg-recarga-grid">
        <Janela titulo="Financeira" janela={janelas.financeira} />
        <Janela titulo="Energética (ONS)" janela={janelas.energetica} />
        <Janela titulo="Recomendada" janela={janelas.recomendada} />
      </div>
      {janelas.avisos?.length > 0 && (
        <ul className="tdg-eref-avisos">{janelas.avisos.map((a) => <li key={a}>{AVISOS[a] || a}</li>)}</ul>
      )}
      <details className="tdg-eref-metodo"><summary>Metodologia e premissas</summary>
        <ul>{(janelas.metodologia || []).map((m) => <li key={m}>{m}</li>)}{(janelas.assumptions || []).map((a) => <li key={a}>Premissa: {a.replaceAll("_", " ")}</li>)}</ul>
      </details>

      <h4 className="tdg-eref-sub"><RefreshCw size={15} /> Plano de recarga por veículo ({recarga.totais.completos}/{recarga.totais.veiculos} completos · pico {numero.format(recarga.totais.picoKw)} kW{recarga.demandaContratadaKw ? ` de ${numero.format(recarga.demandaContratadaKw)} kW contratados` : ""})</h4>
      {recarga.veiculos.length === 0 ? (
        <p className="tdg-recarga-nota">Sem veículos elétricos com bateria cadastrada para planejar{recarga.veiculosNaFrota ? ` (${recarga.veiculosNaFrota} na frota)` : ""}.</p>
      ) : (
        <div className="tdg-eref-tabela-wrap">
          <table className="tdg-eref-tabela">
            <thead><tr><th>Veículo</th><th>Energia</th><th>Sessões</th><th>Custo</th><th>Situação</th></tr></thead>
            <tbody>
              {recarga.veiculos.map((v) => (
                <tr key={v.id} className={v.completo ? "" : "incompleto"}>
                  <td>{v.rotulo}</td>
                  <td>{numero.format(v.alocadaKwh)}/{numero.format(v.energiaKwh)} kWh</td>
                  <td>{v.sessoes.length ? v.sessoes.map((s, i) => <div key={i}>{s.pontoNome} · {s.inicio}–{s.fim} · {numero.format(s.potenciaKw)} kW · {numero.format(s.kwh)} kWh</div>) : "—"}</td>
                  <td>{v.custo === null ? "—" : moeda2.format(v.custo)}</td>
                  <td>{v.completo ? "Completa" : "Incompleta"} — {v.motivo}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td>{numero.format(recarga.totais.alocadaKwh)} kWh</td><td>{recarga.totais.pontosAtivos} ponto(s) ativo(s)</td><td>{recarga.totais.custo === null ? "—" : moeda2.format(recarga.totais.custo)}</td><td>{recarga.totais.economia !== null && recarga.totais.economia !== undefined ? `economia de ${moeda2.format(recarga.totais.economia)} vs. tudo na hora mais cara` : "sem tarifa para custo"}</td></tr></tfoot>
          </table>
        </div>
      )}
      {recarga.naoPlanejados?.length > 0 && <p className="tdg-recarga-nota">Fora do plano: {recarga.naoPlanejados.map((n) => `${n.rotulo} (${n.motivo})`).join("; ")}.</p>}
      {recarga.avisos?.length > 0 && <ul className="tdg-eref-avisos">{recarga.avisos.map((a) => <li key={a}>{AVISOS[a] || a}</li>)}</ul>}

      <h4 className="tdg-eref-sub"><Settings2 size={15} /> Fontes e perfil de energia</h4>
      <ul className="tdg-eref-refs">
        {[["aneel", "ANEEL — tarifas homologadas"], ["ons", "ONS — curva de carga"], ["anp", "ANP — preços de diesel"]].map(([id, nome]) => {
          const f = referencias?.[id] || {};
          return (
            <li key={id}>
              <span>{nome}</span>
              <Badge status={f.status} />
              <small>{f.lastSuccessAt ? `ingerida ${dataHora(f.lastSuccessAt)}` : "sem ingestão"}{f.sourceUpdatedAt ? ` · fonte ${data(f.sourceUpdatedAt)}` : ""}{f.records ? ` · ${f.records} reg.` : ""}{f.error && f.status !== "ok" ? ` · ${f.error}` : ""}</small>
              {canWrite && (
                <button type="button" className="tdg-action tdg-action-ghost" disabled={Boolean(ocupado) || (id === "aneel" && !perfil?.configurado)} onClick={() => sincronizar(id)}>
                  {ocupado === id ? <Loader2 className="girando" size={13} /> : <RefreshCw size={13} />} Sincronizar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {mensagem && <p className="tdg-recarga-nota tdg-eref-msg">{mensagem}</p>}

      <details className="tdg-eref-form-wrap" open={formAberto} onToggle={(e) => setFormAberto(e.currentTarget.open)}>
        <summary>{perfil?.configurado ? `Perfil de energia: ${perfil.distribuidora} ${perfil.subgrupo} ${perfil.modalidade}` : "Perfil de energia (distribuidora, subgrupo, modalidade, demanda, horários, contratos)"}</summary>
        <form className="tdg-recarga-form" onSubmit={salvar}>
          <label><span>Distribuidora (sigla ANEEL)</span><input list="tdg-eref-distribuidoras" {...campo("distribuidora")} onFocus={carregarDistribuidoras} disabled={!canWrite} placeholder="ex.: CPFL-PAULISTA" />
            <datalist id="tdg-eref-distribuidoras">{(distribuidoras || []).map((d) => <option key={d} value={d} />)}</datalist></label>
          <label><span>Subgrupo</span><select {...campo("subgrupo")} disabled={!canWrite}><option value="">—</option>{(opcoes.subgrupos || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label><span>Modalidade</span><select {...campo("modalidade")} disabled={!canWrite}><option value="">—</option>{(opcoes.modalidades || []).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label><span>UF</span><input maxLength={2} {...campo("uf")} disabled={!canWrite} /></label>
          <label><span>Município (ANP)</span><input {...campo("municipio")} disabled={!canWrite} /></label>
          <label><span>Região (ANP)</span><select {...campo("regiao")} disabled={!canWrite}><option value="">—</option>{["N", "NE", "CO", "SE", "S"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label><span>Subsistema (ONS)</span><select {...campo("subsistemaOns")} disabled={!canWrite}>{Object.entries(opcoes.subsistemas || {}).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></label>
          <label><span>Demanda contratada (kW)</span><input type="number" min="0" step="1" {...campo("demandaContratadaKw")} disabled={!canWrite} /></label>
          <label><span>Saída da frota (h)</span><input type="number" min="0" max="23" {...campo("saidaHora")} disabled={!canWrite} /></label>
          <label><span>Retorno da frota (h)</span><input type="number" min="0" max="23" {...campo("chegadaHora")} disabled={!canWrite} /></label>
          <label><span>SOC de chegada (%)</span><input type="number" min="0" max="100" {...campo("socChegadaPercent")} disabled={!canWrite} placeholder="20" /></label>
          <label><span>Tarifa contratual (R$/kWh)</span><input type="number" min="0" step="0.0001" {...campo("tarifaContratualKwh")} disabled={!canWrite} /></label>
          <label><span>Data do contrato</span><input type="date" {...campo("tarifaContratualData")} disabled={!canWrite} /></label>
          <label><span>Tarifa informada (R$/kWh)</span><input type="number" min="0" step="0.0001" {...campo("tarifaInformadaKwh")} disabled={!canWrite} /></label>
          <label><span>Data da tarifa informada</span><input type="date" {...campo("tarifaInformadaData")} disabled={!canWrite} /></label>
          <label><span>Tarifa fallback (R$/kWh)</span><input type="number" min="0" step="0.0001" {...campo("tarifaFallbackKwh")} disabled={!canWrite} /></label>
          <label><span>Produto diesel</span><select {...campo("dieselProduto")} disabled={!canWrite}>{(opcoes.produtosDiesel || []).map((p) => <option key={p} value={p}>{p === "diesel_s10" ? "Diesel S10" : "Diesel"}</option>)}</select></label>
          <label><span>Diesel contratual (R$/L)</span><input type="number" min="0" step="0.01" {...campo("dieselContratualL")} disabled={!canWrite} /></label>
          <label><span>Data do diesel contratual</span><input type="date" {...campo("dieselContratualData")} disabled={!canWrite} /></label>
          <label><span>Diesel de frota (R$/L)</span><input type="number" min="0" step="0.01" {...campo("dieselFrotaL")} disabled={!canWrite} /></label>
          <label><span>Data do diesel de frota</span><input type="date" {...campo("dieselFrotaData")} disabled={!canWrite} /></label>
          <label><span>Diesel fallback (R$/L)</span><input type="number" min="0" step="0.01" {...campo("dieselFallbackL")} disabled={!canWrite} /></label>
          <p className="tdg-recarga-dica">Contrato e tarifa informada são INFORMED; ANEEL/ANP são EXTERNAL com data da fonte; fallback é DERIVED e aparece marcado. Sem retorno informado, a frota é considerada parada nas 12 h antes da saída (premissa declarada).</p>
          <div className="tdg-recarga-form-actions">
            <button type="submit" className="tdg-action" disabled={!canWrite || ocupado === "perfil"}>{ocupado === "perfil" ? "Salvando..." : "Salvar perfil"}</button>
          </div>
        </form>
      </details>
    </div>
  );
}
