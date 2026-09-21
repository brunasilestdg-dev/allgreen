import { Fragment, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, KanbanSquare, Truck, CircleDashed, X, ExternalLink } from "lucide-react";
import { comparativosDeSerie, agruparSlaPorBase } from "../commercialPanelDomain.js";
import { rotuloDoTipo, RESULTADOS_DA_INTERACAO } from "../interacoesDomain.js";
import "./TodoGreenPages.css";

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlFull = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v) => (Number(v) || 0).toLocaleString("pt-BR");
const pctN = (v, casas = 1) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(casas)}%`);
const pctFrac = (v, casas = 1) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(casas)}%`);
const varLabel = (v) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const mesLabel = (mes) => {
  const s = String(mes || "");
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return s; // já vem "Fev/26" do artefato
  const nomes = ["", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m[2])] || m[2]}/${m[1].slice(2)}`;
};

// Paleta categórica validada (dataviz): distinta e CVD-safe em claro/escuro.
// Cores por CSS var → o modo escuro troca sozinho. "Outros" fica neutro.
const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-outros)"];

const RESULTADO_ROTULO = new Map(RESULTADOS_DA_INTERACAO.map((r) => [r.id, r.rotulo]));
const dataHora = (iso) => {
  const s = String(iso || "");
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("pt-BR", s.length > 10 ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
};

// Painel lateral que abre as interações reais de UMA oportunidade — o que o
// contador "💬 N" no Kanban/FUP prometia e não abria. Busca do servidor com o
// MESMO escopo do contador (tenant + opportunity_id), por isso bate com o "💬 N"
// mesmo para interações importadas sem client_id (a lista geral do front, por
// ser recortada por carteira, as escondia). Só leitura: registrar/editar segue
// na tela Oportunidades, para onde o rodapé leva.
function InteracoesDrawer({ oportunidade, authHeaders, onFechar, onAbrirOportunidades }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  useEffect(() => {
    if (!oportunidade?.id) return;
    let vivo = true;
    setCarregando(true); setErro("");
    fetch(`/api/todogreen/comercial/painel?opportunityId=${encodeURIComponent(oportunidade.id)}`, { headers: authHeaders?.() || {} })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Não foi possível carregar as interações."); return d; })
      .then((d) => { if (vivo) setLista(Array.isArray(d.interacoes) ? d.interacoes : []); })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [oportunidade, authHeaders]);
  if (!oportunidade) return null;
  return (
    <div className="tdg-drawer-overlay" onClick={onFechar}>
      <aside className="tdg-drawer" role="dialog" aria-label={`Interações de ${oportunidade.cliente}`} onClick={(e) => e.stopPropagation()}>
        <header className="tdg-drawer-head">
          <div><span className="tdg-kicker">INTERAÇÕES</span><h3>{oportunidade.cliente}</h3><small>{carregando ? "carregando…" : `${lista.length} registro(s)`}</small></div>
          <button type="button" className="tdg-mini" onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="tdg-drawer-corpo">
          {carregando ? (
            <p className="tdg-panel-vazio">Carregando interações…</p>
          ) : erro ? (
            <p className="tdg-panel-vazio">{erro}</p>
          ) : lista.length === 0 ? (
            <p className="tdg-panel-vazio">Nenhuma interação registrada nesta oportunidade ainda.</p>
          ) : lista.map((it) => (
            <article className="tdg-interacao" key={it.id}>
              <div className="tdg-interacao-topo">
                <span className="tdg-tag">{rotuloDoTipo(it.tipo)}</span>
                <time>{dataHora(it.ocorridaEm)}</time>
              </div>
              {it.assunto && <strong className="tdg-interacao-assunto">{it.assunto}</strong>}
              {it.ata && <p className="tdg-interacao-ata">{it.ata}</p>}
              <div className="tdg-interacao-pe">
                {it.autorEmail && <span title="Autor do registro">👤 {it.autorEmail}</span>}
                {it.resultado && <span className="tdg-tag tdg-tag-suave">{RESULTADO_ROTULO.get(it.resultado) || it.resultado}</span>}
                {it.proximoPasso && <span title="Próximo passo">→ {it.proximoPasso}{it.proximoPassoEm ? ` (${dataHora(it.proximoPassoEm)})` : ""}</span>}
              </div>
            </article>
          ))}
        </div>
        {onAbrirOportunidades && (
          <footer className="tdg-drawer-pe">
            <button type="button" className="tdg-mini" onClick={() => onAbrirOportunidades(oportunidade)}>
              <ExternalLink size={14} /> Abrir na tela Oportunidades (registrar/editar)
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

const deltaClass = (d) => (d === null || d === undefined ? "" : d >= 0 ? "tdg-ok" : "tdg-alerta");
const deltaTxt = (d) => (d === null || d === undefined ? "—" : `${d >= 0 ? "▲ +" : "▼ "}${(d * 100).toFixed(1)}%`);

// Faixa de comparativos MoM / MTD / DoD / YoY para uma métrica aditiva.
function Comparativos({ dados, formato = num }) {
  const tiles = [
    ["MoM", dados.mom, "mês vs. mês anterior"],
    ["MTD", dados.mtd, "mês até o dia X vs. mesmo período do mês anterior"],
    ["DoD", dados.dod, "dia vs. dia anterior"],
    ["YoY", dados.yoy, "vs. mesmo mês do ano anterior"],
  ];
  return (
    <div className="tdg-kpi-row tdg-comparativos">
      {tiles.map(([label, c, hint]) => (
        <div className="tdg-kpi tdg-kpi-comp" key={label} title={hint}>
          <span>{label}{label === "MTD" && c?.disponivel ? ` · até dia ${c.corteDia}` : ""}</span>
          {c && c.disponivel ? (
            <>
              <strong>{formato(c.atual)} <em className={deltaClass(c.delta)}>{deltaTxt(c.delta)}</em></strong>
              <small>anterior: {formato(c.anterior)}</small>
            </>
          ) : <strong className="tdg-sem-base">sem base ainda</strong>}
        </div>
      ))}
    </div>
  );
}

const Vazio = ({ children }) => <p className="tdg-panel-vazio">{children}</p>;

// Marca as seções que só têm o total do período (sem quebra mensal ainda) quando
// há um mês em foco — pra deixar claro que aquele quadro NÃO está filtrado.
const TagPeriodo = ({ mesFoco }) => (mesFoco
  ? <div className="tdg-tag-periodo-wrap"><span className="tdg-tag-periodo" title="Esta seção mostra o período completo — a quebra por mês chega com o feed pedido-a-pedido do Track3R.">período completo · não filtra por mês ainda</span></div>
  : null);

const Secao = ({ titulo, kicker, nota, children }) => (
  <section className="tdg-panel">
    <div className="tdg-section-head"><div>{kicker && <span className="tdg-kicker">{kicker}</span>}<h3>{titulo}</h3></div></div>
    {children}
    {nota && <p className="tdg-nota">{nota}</p>}
  </section>
);

// Barras horizontais. Suporta clique (drill/isolar), destaque do selecionado,
// % do total e cor por item. Tooltip nativo com valor e %.
const Barras = ({ itens, valor, rotulo, formato = num, onClick, selKey, keyOf, cor, comPct = false }) => {
  const vals = itens.map((i) => Number(valor(i)) || 0);
  const max = Math.max(1, ...vals);
  const total = vals.reduce((s, v) => s + v, 0) || 1;
  const temSel = selKey !== undefined && selKey !== null;
  return (
    <div className="tdg-barras">
      {itens.map((i, idx) => {
        const v = Number(valor(i)) || 0;
        const pct = (v / total) * 100;
        const k = keyOf ? keyOf(i, idx) : idx;
        const sel = temSel && selKey === k;
        const dim = temSel && !sel;
        return (
          <div className={`tdg-barra-linha${onClick ? " clicavel" : ""}${dim ? " esmaecida" : ""}${sel ? " sel" : ""}`} key={idx}
            onClick={onClick ? () => onClick(i, k) : undefined}
            title={`${rotulo(i)}: ${formato(v)}${comPct ? ` · ${pct.toFixed(1)}%` : ""}`}>
            <span className="tdg-barra-rotulo">{rotulo(i)}</span>
            <span className="tdg-barra-trilho"><span className="tdg-barra-preenchida" style={{ width: `${(v / max) * 100}%`, background: cor ? cor(i, idx) : undefined }} /></span>
            <span className="tdg-barra-valor">{formato(v)}{comPct && <em className="tdg-barra-pct">{pct.toFixed(1)}%</em>}</span>
          </div>
        );
      })}
    </div>
  );
};

// Gráfico de linha/área (inline SVG) com eixo de valores, grade, rótulos diretos
// no pico e no último ponto, % do dia (comPct) e tooltip nativo por ponto.
// A área de plotagem tem altura fixa própria (svg preenche 100% dela) e o eixo
// de datas fica FORA dela — assim a sobreposição (ticks, pontos, rótulos) cai
// exatamente sobre a linha, sem o descolamento de antes.
const LinhaSVG = ({ serie, meta = null, formatoY = num, comPct = false, altura = 170 }) => {
  const largura = 720;
  const pad = { t: 18, r: 16, b: 10, l: 16 };
  const ys = serie.map((p) => Number(p.y) || 0);
  const maxV = Math.max(...ys, meta ?? 0);
  const yMax = maxV * 1.12 || 1;
  const lo = meta !== null ? Math.max(0, Math.min(...ys, meta) * 0.96) : 0;
  const span = yMax - lo || 1;
  const soma = ys.reduce((s, v) => s + v, 0) || 1;
  const x = (i) => pad.l + (i / Math.max(1, serie.length - 1)) * (largura - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / span) * (altura - pad.t - pad.b);
  const linha = serie.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(ys[i]).toFixed(1)}`).join(" ");
  const area = `${linha} L${x(serie.length - 1).toFixed(1)},${(altura - pad.b).toFixed(1)} L${x(0).toFixed(1)},${(altura - pad.b).toFixed(1)} Z`;
  const metaY = meta !== null ? y(meta) : null;
  const seg = serie.length > 1 ? (largura - pad.l - pad.r) / (serie.length - 1) : largura;
  const maxIdx = ys.indexOf(Math.max(...ys));
  const rotulados = [...new Set([maxIdx, serie.length - 1].filter((i) => i >= 0))];
  const ticksFrac = [1, 0.5, 0];
  const pos = (i, v) => ({ left: `${(x(i) / largura) * 100}%`, top: `${(y(v) / altura) * 100}%` });
  const rotuloPonto = (i) => {
    const v = ys[i];
    return `${formatoY(v)}${comPct ? ` · ${((v / soma) * 100).toFixed(1)}%` : ""}`;
  };
  return (
    <div className="tdg-chart-rico">
      <div className="tdg-chart-plot" style={{ height: altura }}>
        <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label="gráfico de linha">
          <defs>
            <linearGradient id="tdg-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--tdg-green)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--tdg-green)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticksFrac.map((f, k) => <line key={k} className="tdg-chart-grade" x1={pad.l} x2={largura - pad.r} y1={pad.t + (1 - f) * (altura - pad.t - pad.b)} y2={pad.t + (1 - f) * (altura - pad.t - pad.b)} />)}
          <path d={area} className="tdg-chart-area" fill="url(#tdg-area-grad)" />
          <path d={linha} className="tdg-chart-linha" />
          {metaY !== null && <line x1={pad.l} x2={largura - pad.r} y1={metaY} y2={metaY} className="tdg-chart-meta" />}
          {serie.map((p, i) => (
            <rect key={i} className="tdg-chart-hit" x={x(i) - seg / 2} y={0} width={seg} height={altura} fill="transparent">
              <title>{`${p.label}: ${rotuloPonto(i)}`}</title>
            </rect>
          ))}
        </svg>
        <div className="tdg-chart-overlay">
          {ticksFrac.map((f, k) => (
            <span key={k} className="tdg-chart-ytick" style={{ top: `${((pad.t + (1 - f) * (altura - pad.t - pad.b)) / altura) * 100}%` }}>{formatoY(lo + f * span)}</span>
          ))}
          {rotulados.map((i) => <span key={`d${i}`} className={`tdg-chart-dot${i === maxIdx ? " pico" : ""}`} style={pos(i, ys[i])} />)}
          {rotulados.map((i) => (
            <span key={`r${i}`} className={`tdg-chart-rotulo${i === maxIdx ? " pico" : ""}`} style={pos(i, ys[i])}>{rotuloPonto(i)}</span>
          ))}
        </div>
      </div>
      <div className="tdg-chart-eixo"><span>{serie[0]?.label}</span>{meta !== null && <span className="tdg-chart-meta-rot">meta {formatoY(meta)}</span>}<span>{serie[serie.length - 1]?.label}</span></div>
    </div>
  );
};

// Donut clicável. segmentos: [{label, valor}]. Clicar isola a fatia (dim nas
// demais); legenda também clica. Agrupa a cauda em "Outros" (neutro, não filtra).
const Donut = ({ segmentos, formato = brl, selecionado = null, onSelecionar }) => {
  const total = segmentos.reduce((s, x) => s + (Number(x.valor) || 0), 0) || 1;
  const top = segmentos.slice(0, 5);
  const resto = segmentos.slice(5).reduce((s, x) => s + (Number(x.valor) || 0), 0);
  const dados = resto > 0 ? [...top, { label: "Outros", valor: resto, outros: true }] : top;
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  const clicar = (d) => { if (onSelecionar && !d.outros) onSelecionar(selecionado === d.label ? null : d.label); };
  return (
    <div className="tdg-donut-wrap">
      <svg viewBox="0 0 160 160" className="tdg-donut" role="img" aria-label="rosca de concentração">
        <g transform="translate(80,80) rotate(-90)">
          <circle r={R} className="tdg-donut-trilho" fill="none" strokeWidth="26" />
          {dados.map((d, i) => {
            const frac = (Number(d.valor) || 0) / total;
            const dash = `${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}`;
            const dim = selecionado !== null && selecionado !== d.label;
            const el = (
              <circle key={i} r={R} fill="none" strokeWidth={selecionado === d.label ? 31 : 26}
                stroke={VIZ[i % VIZ.length]} strokeDasharray={dash} strokeDashoffset={(-offset * C).toFixed(2)}
                opacity={dim ? 0.28 : 1} style={{ cursor: onSelecionar && !d.outros ? "pointer" : "default" }}
                onClick={() => clicar(d)}>
                <title>{`${d.label}: ${formato(d.valor)} · ${(frac * 100).toFixed(1)}%`}</title>
              </circle>
            );
            offset += frac;
            return el;
          })}
        </g>
      </svg>
      <ul className="tdg-donut-legenda">
        {dados.map((d, i) => {
          const dim = selecionado !== null && selecionado !== d.label;
          const clicavel = onSelecionar && !d.outros;
          return (
            <li key={i} className={`${clicavel ? "clicavel" : ""}${dim ? " esmaecida" : ""}${selecionado === d.label ? " sel" : ""}`} onClick={() => clicar(d)}>
              <span className="tdg-donut-cor" style={{ background: VIZ[i % VIZ.length] }} />{d.label}<b>{((Number(d.valor) || 0) / total * 100).toFixed(1)}%</b><small>{formato(d.valor)}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ===== Aba Receita =====
function AbaReceita({ receita, mesFoco = null, setMesFoco }) {
  const { porPeriodo, previsao, concentracao, resumoMensal, ticketMedio } = receita;
  const vazio = "Sem faturamento ainda. Preenche quando o Track3R enviar (artefato, importação ou webhook).";
  const mesesDisp = porPeriodo?.meses?.map((m) => m.mes) || [];
  const [tomadorSel, setTomadorSel] = useState(null);
  const mesAtivo = mesFoco || mesesDisp[mesesDisp.length - 1];
  const serieDiaria = (porPeriodo?.porDia?.[mesAtivo] || []).map((d) => ({ label: d.dia.slice(8), y: d.receita }));
  const clienteSel = tomadorSel ? concentracao?.clientes?.find((c) => c.tomador === tomadorSel) : null;
  // Comparativos ancoram no último ponto da série — truncar até o mês focado faz
  // MoM/MTD/YoY se referirem àquele mês. Sem foco, série inteira (mês corrente).
  const compReceita = useMemo(() => comparativosDeSerie({
    mensal: (porPeriodo?.meses || []).filter((m) => !mesFoco || m.mes <= mesFoco).map((m) => ({ mes: m.mes, valor: m.receita })),
    diaria: Object.values(porPeriodo?.porDia || {}).flat().filter((d) => !mesFoco || String(d.dia).slice(0, 7) <= mesFoco).map((d) => ({ dia: d.dia, valor: d.receita })),
  }), [porPeriodo, mesFoco]);
  // Concentração: no mês focado usa o recorte porMes de cada tomador; sem foco, o
  // total do período. Fica claro no rótulo qual dos dois está na tela.
  const concentracaoSegmentos = (concentracao?.clientes || []).map((c) => ({
    label: c.tomador,
    valor: mesFoco ? (c.porMes?.[mesFoco] || 0) : c.total,
  })).filter((s) => s.valor > 0);

  return (
    <>
      {porPeriodo.disponivel && (
        <Secao titulo="Comparativos de receita" kicker="MoM · MTD · DoD · YoY">
          <Comparativos dados={compReceita} formato={brl} />
        </Secao>
      )}
      <Secao titulo="Receita por período" kicker="FATURAMENTO" nota="Clique num mês (aqui ou no filtro acima) para focar o painel inteiro naquele mês; clique de novo para voltar ao período completo.">
        {porPeriodo.disponivel ? (
          <>
            <Barras itens={porPeriodo.meses} valor={(i) => i.receita} rotulo={(i) => mesLabel(i.mes)} formato={brl}
              comPct onClick={(i) => setMesFoco?.(mesFoco === i.mes ? null : i.mes)} selKey={mesFoco} keyOf={(i) => i.mes} />
            {serieDiaria.length > 1 && (
              <>
                <div className="tdg-chart-controls"><span className="tdg-nota">Dia a dia · <strong>{mesLabel(mesAtivo)}</strong> · total {brl(serieDiaria.reduce((s, d) => s + (Number(d.y) || 0), 0))}</span></div>
                <LinhaSVG serie={serieDiaria} formatoY={brl} comPct />
              </>
            )}
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Previsão de fechamento do mês" kicker="RITMO">
        {previsao.disponivel ? (
          <div className="tdg-kpi-row">
            <div className="tdg-kpi"><span>Acumulado</span><strong>{brl(previsao.acumulado)}</strong></div>
            <div className="tdg-kpi"><span>Projeção do mês</span><strong>{brl(previsao.projecao)}</strong></div>
            <div className="tdg-kpi"><span>Base</span><strong>{previsao.base === "comparado" ? "ritmo vs. mês anterior" : "ritmo linear"}</strong></div>
          </div>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Concentração por cliente (tomador)" kicker="CARTEIRA" nota="Clique numa fatia (ou na legenda) para isolar o cliente e ver o mês a mês dele.">
        {concentracao.disponivel ? (
          <div className="tdg-split">
            <div className="tdg-filtro-detalhe" style={{ flex: "0 0 auto" }}>
              <div className="tdg-chart-controls"><span className="tdg-nota">Participação {mesFoco ? <>em <strong>{mesLabel(mesFoco)}</strong></> : "no período completo"}</span></div>
              <Donut segmentos={concentracaoSegmentos.length ? concentracaoSegmentos : concentracao.clientes.map((c) => ({ label: c.tomador, valor: c.total }))} selecionado={tomadorSel} onSelecionar={setTomadorSel} />
            </div>
            {clienteSel ? (
              <div className="tdg-filtro-detalhe">
                <div className="tdg-chart-controls">
                  <span><strong>{clienteSel.tomador}</strong> · {brl(clienteSel.total)} · {pctFrac(clienteSel.participacao)} da receita</span>
                  <button type="button" className="tdg-mini" onClick={() => setTomadorSel(null)}>× limpar filtro</button>
                </div>
                <table className="tdg-tabela">
                  <thead><tr><th>Mês</th><th>Receita</th></tr></thead>
                  <tbody>{(concentracao.meses || []).map((m) => <tr key={m}><td>{mesLabel(m)}</td><td>{brl(clienteSel.porMes?.[m] || 0)}</td></tr>)}</tbody>
                </table>
              </div>
            ) : (
              <table className="tdg-tabela">
                <thead><tr><th>Tomador</th><th>Total</th><th>%</th></tr></thead>
                <tbody>{concentracao.clientes.slice(0, 12).map((c) => (
                  <tr key={c.tomador} className="clicavel" onClick={() => setTomadorSel(c.tomador)}><td>{c.tomador}</td><td>{brl(c.total)}</td><td>{pctFrac(c.participacao)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Resumo mensal" kicker="MÊS A MÊS">
        {resumoMensal.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Mês</th><th>Receita</th><th>Var. MoM</th><th>{resumoMensal.clientePrincipal || "Principal"}</th><th>Outros</th></tr></thead>
            <tbody>{resumoMensal.meses.map((m) => <tr key={m.mes} className={mesFoco === m.mes ? "tdg-row-foco" : ""}><td>{mesLabel(m.mes)}</td><td>{brl(m.receita)}</td><td>{varLabel(m.varMoM)}</td><td>{brl(m.principal)}</td><td>{brl(m.outros)}</td></tr>)}</tbody>
          </table>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Ticket médio por cliente" kicker="RECEITA ÷ PEDIDOS">
        {ticketMedio.disponivel ? (
          <><TagPeriodo mesFoco={mesFoco} />
          <table className="tdg-tabela">
            <thead><tr><th>Cliente</th><th>Receita</th><th>Pedidos</th><th>Ticket médio</th></tr></thead>
            <tbody>{ticketMedio.clientes.slice(0, 12).map((c) => <tr key={c.cliente}><td>{c.cliente}</td><td>{brl(c.receita)}</td><td>{c.pedidos ? num(c.pedidos) : "—"}</td><td>{c.ticketMedio === null ? "—" : brlFull(c.ticketMedio)}</td></tr>)}</tbody>
          </table></>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>
    </>
  );
}

// ===== Aba Kanban (editável quando vem das oportunidades do ERP) =====
const ETAPAS_PADRAO = ["Prospecção", "Apresentação", "Negociação", "Proposta / BID", "Homologação", "Fechamento"];

function CartaoKanban({ item, etapas, editavel, onMover, onValor, onVerInteracoes, onRenomear, onAbrir }) {
  const [editandoValor, setEditandoValor] = useState(false);
  const [valor, setValor] = useState(item.valor);
  const [nome, setNome] = useState(item.cliente);
  useEffect(() => { setValor(item.valor); }, [item.valor]);
  useEffect(() => { setNome(item.cliente); }, [item.cliente]);
  return (
    <div className="tdg-kanban-cartao">
      {editavel && item.id ? (
        <input className="tdg-inline-cell tdg-kanban-nome" value={nome} title="Editar o nome da oportunidade"
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => { const v = nome.trim(); if (v && v !== item.cliente) onRenomear?.(item.id, v); else if (!v) setNome(item.cliente); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      ) : <strong>{item.cliente}</strong>}
      {editavel && item.id ? (
        <>
          {editandoValor ? (
            <input className="tdg-inline-input" type="number" value={valor} autoFocus
              onChange={(e) => setValor(e.target.value)}
              onBlur={() => { setEditandoValor(false); if (Number(valor) !== item.valor) onValor(item.id, Number(valor) || 0); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          ) : (
            <button type="button" className="tdg-inline-valor" onClick={() => setEditandoValor(true)} title="Editar valor">{brl(item.valor)}</button>
          )}
          <select className="tdg-inline-select" value={item.etapa || ""} onChange={(e) => onMover(item.id, e.target.value)} title="Mover de etapa">
            {etapas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      ) : <small>{brl(item.valor)}</small>}
      {item.interacoes > 0 && (item.id && onVerInteracoes
        ? <button type="button" className="tdg-card-interacoes tdg-card-interacoes-btn" title="Ver as interações desta oportunidade" onClick={() => onVerInteracoes(item)}>💬 {item.interacoes} interação(ões)</button>
        : <small className="tdg-card-interacoes">💬 {item.interacoes} interação(ões)</small>)}
      {editavel && item.id && onAbrir && (
        <button type="button" className="tdg-card-abrir" onClick={() => onAbrir(item)} title="Abrir na tela Oportunidades para preencher todas as informações">↗ abrir / editar tudo</button>
      )}
    </div>
  );
}

function NotaFup({ item, onNota }) {
  const [texto, setTexto] = useState(item.texto || "");
  useEffect(() => { setTexto(item.texto || ""); }, [item.texto]);
  const salvar = () => { if ((texto || "") !== (item.texto || "")) onNota(item.id, texto); };
  return (
    <textarea className="tdg-nota-input" rows={2} value={texto} placeholder="Observação do follow-up…"
      onChange={(e) => setTexto(e.target.value)} onBlur={salvar}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur(); }} />
  );
}

function FupRow({ c, etapas, onRenomear, onValor, onMover, onFup, onNota, onExcluir, onVerInteracoes }) {
  const [nome, setNome] = useState(c.cliente);
  const [valor, setValor] = useState(c.valor);
  useEffect(() => { setNome(c.cliente); }, [c.cliente]);
  useEffect(() => { setValor(c.valor); }, [c.valor]);
  return (
    <tr>
      <td>
        <input className="tdg-inline-cell" value={nome} onChange={(e) => setNome(e.target.value)}
          onBlur={() => { const v = nome.trim(); if (v && v !== c.cliente) onRenomear(c.id, v); else if (!v) setNome(c.cliente); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </td>
      <td>
        <select className="tdg-inline-select" value={c.etapa} onChange={(e) => onMover(c.id, e.target.value)}>
          {etapas.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td>
        <input className="tdg-inline-cell tdg-num" type="number" value={valor} onChange={(e) => setValor(e.target.value)}
          onBlur={() => { const nv = Number(valor) || 0; if (nv !== c.valor) onValor(c.id, nv); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </td>
      <td>{c.atualizadoEm ? new Date(c.atualizadoEm).toLocaleDateString("pt-BR") : "—"}</td>
      <td className={c.semFupDias >= 20 ? "tdg-alerta" : ""}>{c.semFupDias === null ? "—" : `${c.semFupDias} dia(s)`}</td>
      <td className="tdg-td-texto"><NotaFup item={c} onNota={onNota} /></td>
      <td className="tdg-num">{c.interacoes > 0
        ? <button type="button" className="tdg-link-interacoes" title="Ver as interações desta oportunidade" onClick={() => onVerInteracoes?.(c)}>💬 {c.interacoes}</button>
        : "—"}</td>
      <td className="tdg-fup-acoes">
        <button type="button" className="tdg-mini" onClick={() => onFup(c.id)} title="Registrar follow-up hoje (zera o contador)">✓ FUP</button>
        <button type="button" className="tdg-mini tdg-mini-danger" title="Excluir (vai para arquivados)"
          onClick={() => { if (window.confirm(`Excluir "${c.cliente}"? A oportunidade vai para arquivados.`)) onExcluir(c.id); }}>🗑</button>
      </td>
    </tr>
  );
}

function AbaKanban({ kanban, onMover, onValor, onFup, onNota, onNova, onRenomear, onExcluir, onVerInteracoes, onAbrir }) {
  const { pipeline, fup, updatesSemana, atualizado, editavel } = kanban;
  const etapas = useMemo(() => {
    const doPipe = pipeline.etapas.map((e) => e.etapa);
    return [...new Set([...ETAPAS_PADRAO, ...doPipe])];
  }, [pipeline]);
  const [novo, setNovo] = useState({ cliente: "", valor: "", etapa: ETAPAS_PADRAO[0] });
  // A etapa fica no card (o domínio não devolve etapa por item do pipeline);
  // injeta a etapa da coluna em cada item para o seletor abrir no lugar certo.
  const etapasComEtapa = pipeline.etapas.map((e) => ({ ...e, itens: e.itens.map((i) => ({ ...i, etapa: e.etapa })) }));

  return (
    <>
      <Secao titulo="Kanban — todos os clientes por etapa" kicker="PIPELINE" nota={atualizado ? `Atualizado em ${atualizado}.` : (editavel ? "Editável: mova o card de etapa, ajuste o valor ou registre follow-up." : "")}>
        {editavel && (
          <div className="tdg-nova-form">
            <input placeholder="Novo cliente/oportunidade" value={novo.cliente} onChange={(e) => setNovo({ ...novo, cliente: e.target.value })} />
            <input type="number" placeholder="Valor mensal" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
            <select value={novo.etapa} onChange={(e) => setNovo({ ...novo, etapa: e.target.value })}>{etapas.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button type="button" className="tdg-action" onClick={() => { if (novo.cliente.trim()) { onNova({ cliente: novo.cliente.trim(), valor: Number(novo.valor) || 0, etapa: novo.etapa }); setNovo({ cliente: "", valor: "", etapa: ETAPAS_PADRAO[0] }); } }}>Adicionar</button>
          </div>
        )}
        {pipeline.disponivel ? (
          <>
            <div className="tdg-kpi-row">
              <div className="tdg-kpi"><span>Oportunidades</span><strong>{num(pipeline.total)}</strong></div>
              <div className="tdg-kpi"><span>Valor no pipeline</span><strong>{brl(pipeline.valorTotal)}</strong></div>
            </div>
            <div className="tdg-kanban">
              {etapasComEtapa.map((e) => (
                <div className="tdg-kanban-coluna" key={e.etapa}>
                  <div className="tdg-kanban-cabeca"><strong>{e.etapa}</strong><small>{e.quantidade} · {brl(e.valor)}</small></div>
                  {e.itens.map((i, idx) => <CartaoKanban key={i.id || idx} item={i} etapas={etapas} editavel={editavel} onMover={onMover} onValor={onValor} onVerInteracoes={onVerInteracoes} onRenomear={onRenomear} onAbrir={onAbrir} />)}
                </div>
              ))}
            </div>
          </>
        ) : <Vazio>Sem oportunidades. Adicione acima ou importe seu pipeline.</Vazio>}
      </Secao>

      {updatesSemana.disponivel && (
        <Secao titulo="Atualização semanal" kicker="MOVIMENTAÇÕES">
          <div className="tdg-updates">
            {updatesSemana.itens.map((u, idx) => (
              <div className="tdg-update" key={idx}>
                <div className="tdg-update-topo"><strong>{u.cliente}</strong><span className="tdg-tag">{u.etapa}</span>{u.valor > 0 && <span className="tdg-update-valor">{brl(u.valor)}</span>}{u.data && <small>{u.data}</small>}</div>
                {u.texto && <p>{u.texto}</p>}
              </div>
            ))}
          </div>
        </Secao>
      )}

      <Secao titulo="Clientes para FUP" kicker="SEM ACOMPANHAMENTO" nota={editavel ? "Edite nome, etapa, valor e contexto na linha. 💬 = interações registradas na oportunidade (o histórico completo abre na tela Oportunidades). Use 🗑 para excluir o que não for cliente (ex.: “Implementação do TMS”)." : ""}>
        {fup.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Cliente</th><th>Etapa</th><th>Valor</th><th>Última atualização</th><th>Sem FUP há</th><th>Contexto</th><th>Interações</th>{editavel && <th>Ações</th>}</tr></thead>
            <tbody>{fup.clientes.map((c, idx) => (
              editavel && c.id
                ? <FupRow key={c.id} c={c} etapas={etapas} onRenomear={onRenomear} onValor={onValor} onMover={onMover} onFup={onFup} onNota={onNota} onExcluir={onExcluir} onVerInteracoes={onVerInteracoes} />
                : (
                  <tr key={c.id || idx}><td>{c.cliente}</td><td>{c.etapa}</td><td>{brl(c.valor)}</td><td>{c.atualizadoEm ? new Date(c.atualizadoEm).toLocaleDateString("pt-BR") : "—"}</td>
                    <td className={c.semFupDias >= 20 ? "tdg-alerta" : ""}>{c.semFupDias === null ? "—" : `${c.semFupDias} dia(s)`}</td>
                    <td className="tdg-td-texto">{c.texto || "—"}</td>
                    <td className="tdg-num">{c.interacoes > 0
                      ? (c.id && onVerInteracoes ? <button type="button" className="tdg-link-interacoes" title="Ver as interações desta oportunidade" onClick={() => onVerInteracoes(c)}>💬 {c.interacoes}</button> : `💬 ${c.interacoes}`)
                      : "—"}</td></tr>
                )
            ))}</tbody>
          </table>
        ) : <Vazio>Sem oportunidades para acompanhar.</Vazio>}
      </Secao>
    </>
  );
}

// ===== Aba Operacional =====
function AbaOperacional({ operacional, mesFoco = null, setMesFoco }) {
  const { volume, otd, efetividade, ocorrencias, leadtime, slaRota, reentrega, atualizado, periodo, servicoNota } = operacional;
  const otdFoco = mesFoco ? (otd.meses || []).find((m) => m.mes === mesFoco) : null;
  const efeFoco = mesFoco ? (efetividade.meses || []).find((m) => m.mes === mesFoco) : null;
  const vazio = "Sem dados operacionais ainda. Preenche quando o Track3R enviar ocorrências/encomendas.";
  const [ocKey, setOcKey] = useState(null);
  const [motivoSel, setMotivoSel] = useState(null);
  const [pracaClienteSel, setPracaClienteSel] = useState(null);
  const [slaModo, setSlaModo] = useState("base");
  const [baseAberta, setBaseAberta] = useState(null);
  const slaBases = useMemo(() => agruparSlaPorBase(slaRota.rows || []), [slaRota]);
  const praca = operacional.praca || { disponivel: false, pracas: [], matriz: [] };
  const clientesDaMatriz = [...new Set((praca.matriz || []).map((m) => m.cliente))];
  const matrizFiltrada = pracaClienteSel ? (praca.matriz || []).filter((m) => m.cliente === pracaClienteSel) : (praca.matriz || []);
  const ocFocoKey = mesFoco ? (ocorrencias.meses.find((m) => m.key === mesFoco || mesLabel(m.mes) === mesLabel(mesFoco))?.key || null) : null;
  const ocMes = ocorrencias.meses.find((m) => m.key === (ocKey || ocFocoKey || ocorrencias.defaultKey)) || ocorrencias.meses[ocorrencias.meses.length - 1] || null;
  const serieOtd = (otd.daily || []).map((d) => ({ label: d.data?.slice(5), y: d.pct }));

  return (
    <>
      {(periodo || servicoNota || atualizado) && (
        <div className="tdg-aviso"><CircleDashed size={16} /><span>{[periodo && `Período: ${periodo}`, atualizado && `atualizado ${atualizado}`].filter(Boolean).join(" · ")}{servicoNota ? ` — ${servicoNota}` : ""}</span></div>
      )}

      {volume.disponivel && (
        <Secao titulo="Comparativos de volume" kicker="MoM · YoY">
          <Comparativos dados={comparativosDeSerie({ mensal: (volume.meses || []).filter((m) => !mesFoco || m.mes <= mesFoco).map((m) => ({ mes: m.mes, valor: m.pedidos })), diaria: [] })} formato={num} />
        </Secao>
      )}

      <Secao titulo="Volume de pedidos" kicker="POR MÊS" nota="Clique num mês para focar o painel inteiro nele.">
        {volume.disponivel ? <Barras itens={volume.meses} valor={(i) => i.pedidos} rotulo={(i) => mesLabel(i.mes)} comPct onClick={(i) => setMesFoco?.(mesFoco === i.mes ? null : i.mes)} selKey={mesFoco} keyOf={(i) => i.mes} /> : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Por praça de embarque (cliente × origem)" kicker="PRAÇA DE EMBARQUE"
        nota="Praça = unidade de origem por encomenda (Track3R). Filtre por cliente para ver de quais praças ele embarca. A comparação mês-a-mês por praça — pra flagrar se um cliente (ex.: MAERSK) tirou volume de alguma praça — chega com o feed pedido-a-pedido do Track3R.">
        <TagPeriodo mesFoco={mesFoco} />
        {praca.disponivel ? (
          <div className="tdg-split">
            <div className="tdg-filtro-detalhe">
              <Barras itens={praca.pracas} valor={(i) => i.pedidos} rotulo={(i) => i.praca} comPct />
              <table className="tdg-tabela">
                <thead><tr><th>Praça</th><th>Pedidos</th><th>OTD</th><th>Efetividade</th></tr></thead>
                <tbody>{praca.pracas.map((p) => <tr key={p.praca}><td>{p.praca}</td><td>{num(p.pedidos)}</td><td>{pctFrac(p.otd)}</td><td>{pctFrac(p.efetividade)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="tdg-filtro-detalhe">
              <div className="tdg-chart-controls">
                <label>Cliente:&nbsp;
                  <select value={pracaClienteSel || ""} onChange={(e) => setPracaClienteSel(e.target.value || null)}>
                    <option value="">Todos os clientes</option>
                    {clientesDaMatriz.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {pracaClienteSel && <span className="tdg-nota">{pracaClienteSel}: {num(matrizFiltrada.reduce((s, m) => s + (Number(m.pedidos) || 0), 0))} pedidos em {matrizFiltrada.length} praça(s)</span>}
              </div>
              <table className="tdg-tabela">
                <thead><tr><th>Cliente</th><th>Praça de embarque</th><th>Pedidos</th></tr></thead>
                <tbody>{matrizFiltrada.slice(0, 40).map((m, idx) => <tr key={idx}><td>{m.cliente}</td><td>{m.praca}</td><td>{num(m.pedidos)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : <Vazio>Sem origem por encomenda ainda. Esta visão (cliente × praça de embarque, e a tendência mês-a-mês pra detectar perda de volume por praça) preenche automaticamente quando os webhooks do Track3R entrarem.</Vazio>}
      </Secao>

      <Secao titulo={`OTD — On Time Delivery (meta ${otd.meta}%)`} kicker="PONTUALIDADE">
        {otd.disponivel ? (
          <>
            <div className="tdg-kpi-row">
              <div className="tdg-kpi"><span>OTD acumulado</span><strong className={otd.acumuladoPct >= otd.meta ? "tdg-ok" : "tdg-alerta"}>{pctN(otd.acumuladoPct)}</strong></div>
              {otdFoco && <div className="tdg-kpi"><span>OTD em {mesLabel(mesFoco)}</span><strong className={otdFoco.pct >= otd.meta ? "tdg-ok" : "tdg-alerta"}>{pctN(otdFoco.pct)}</strong></div>}
            </div>
            {serieOtd.length > 1 && <LinhaSVG serie={serieOtd} meta={otd.meta} formatoY={(v) => `${v}%`} />}
            <table className="tdg-tabela"><thead><tr><th>Mês</th><th>Total</th><th>No prazo</th><th>Fora</th><th>OTD</th></tr></thead>
              <tbody>{otd.meses.map((m) => <tr key={m.mes} className={mesFoco === m.mes ? "tdg-row-foco" : ""}><td>{mesLabel(m.mes)}</td><td>{num(m.total)}</td><td>{num(m.noPrazo)}</td><td>{num(m.foraPrazo)}</td><td className={m.pct >= otd.meta ? "tdg-ok" : "tdg-alerta"}>{pctN(m.pct)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Efetividade de entregas" kicker="FINALIZADAS ÷ TOTAL">
        {efetividade.disponivel ? (
          <>
            <div className="tdg-kpi-row">
              <div className="tdg-kpi"><span>Efetividade acumulada</span><strong>{pctN(efetividade.acumuladoPct)}</strong></div>
              {efeFoco && <div className="tdg-kpi"><span>Efetividade em {mesLabel(mesFoco)}</span><strong>{pctN(efeFoco.pctEfetividade)}</strong></div>}
            </div>
            <table className="tdg-tabela"><thead><tr><th>Mês</th><th>Total</th><th>Finalizadas</th><th>Insucessos</th><th>Efetividade</th></tr></thead>
              <tbody>{efetividade.meses.map((m) => <tr key={m.mes} className={mesFoco === m.mes ? "tdg-row-foco" : ""}><td>{mesLabel(m.mes)}</td><td>{num(m.total)}</td><td>{num(m.finalizadas)}</td><td>{num(m.insucessos)}</td><td>{pctN(m.pctEfetividade)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Decomposição das ocorrências" kicker="INSUCESSOS POR MOTIVO">
        {ocorrencias.disponivel && ocMes ? (
          <>
            <div className="tdg-chart-controls">
              <label>Mês:&nbsp;
                <select value={ocMes.key} onChange={(e) => setOcKey(e.target.value)}>
                  {ocorrencias.meses.map((m) => <option key={m.key} value={m.key}>{m.mes}</option>)}
                </select>
              </label>
              <span className="tdg-nota">{num(ocMes.totalInsucessos)} insucessos de {num(ocMes.totalProcessadas)} ({pctN(ocMes.pctInsucesso)})</span>
              {motivoSel && <button type="button" className="tdg-mini" onClick={() => setMotivoSel(null)}>× limpar</button>}
            </div>
            <Barras itens={ocMes.motivos} valor={(i) => i.count} rotulo={(i) => i.motivo} formato={(v) => num(v)}
              comPct onClick={(i) => setMotivoSel(motivoSel === i.motivo ? null : i.motivo)} selKey={motivoSel} keyOf={(i) => i.motivo} />
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Lead time — do pedido à entrega" kicker="PRAZO" nota={leadtime.nota}>
        {leadtime.disponivel ? (
          <table className="tdg-tabela"><thead><tr><th>Mês</th><th>Mediana</th><th>Média</th><th>Entregas</th></tr></thead>
            <tbody>{leadtime.meses.map((m) => <tr key={m.mes} className={mesFoco === m.mes ? "tdg-row-foco" : ""}><td>{mesLabel(m.mes)}</td><td>{m.medianaH === null ? "—" : `${m.medianaH.toFixed(1)} h`}</td><td>{`${(Number(m.mediaH) || 0).toFixed(1)} h`}</td><td>{num(m.count)}</td></tr>)}</tbody>
          </table>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="SLA — pontualidade por base" kicker={slaModo === "base" ? "NO PRAZO POR BASE" : (slaRota.topN ? `TOP ${slaRota.topN} ROTAS` : "POR ROTA")} nota={slaRota.nota}>
        {slaRota.disponivel ? (
          <>
            <TagPeriodo mesFoco={mesFoco} />
            <div className="tdg-chart-controls">
              <div className="tdg-toggle" role="group" aria-label="Agrupar SLA">
                <button type="button" className={`tdg-toggle-btn${slaModo === "base" ? " ativo" : ""}`} onClick={() => setSlaModo("base")}>Por base</button>
                <button type="button" className={`tdg-toggle-btn${slaModo === "rota" ? " ativo" : ""}`} onClick={() => setSlaModo("rota")}>Por rota</button>
              </div>
              <span className="tdg-nota">SLA = % de pedidos entregues <strong>no prazo</strong>{slaModo === "base" ? " — clique numa base para ver as rotas dela." : "."}</span>
            </div>
            {slaModo === "base" ? (
              <table className="tdg-tabela">
                <thead><tr><th>Base</th><th>Pedidos</th><th>No prazo</th><th>Fora</th><th>SLA (no prazo)</th></tr></thead>
                <tbody>
                  {slaBases.bases.map((b) => (
                    <Fragment key={b.base}>
                      <tr className="clicavel" onClick={() => setBaseAberta(baseAberta === b.base ? null : b.base)}>
                        <td><span className="tdg-drill-seta">{baseAberta === b.base ? "▾" : "▸"}</span> {b.base}</td>
                        <td>{num(b.total)}</td>
                        <td>{num(b.noPrazo)}</td>
                        <td>{num(b.foraPrazo)}</td>
                        <td className={b.pctNoPrazo !== null && b.pctNoPrazo < 95 ? "tdg-alerta" : "tdg-ok"}>{pctN(b.pctNoPrazo)}</td>
                      </tr>
                      {baseAberta === b.base && b.rotas.map((r) => (
                        <tr key={r.rota} className="tdg-subrow">
                          <td>↳ {r.rota}</td><td>{num(r.total)}</td><td>{num(r.total - r.foraPrazo)}</td><td>{num(r.foraPrazo)}</td>
                          <td className={r.pctNoPrazo !== null && r.pctNoPrazo < 95 ? "tdg-alerta" : ""}>{pctN(r.pctNoPrazo)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="tdg-tabela">
                <thead><tr><th>Rota</th><th>Pedidos</th><th>No prazo</th><th>Fora</th><th>SLA (no prazo)</th></tr></thead>
                <tbody>{slaRota.rows.map((r) => {
                  const pctNo = 100 - (Number(r.pctForaPrazo) || 0);
                  return <tr key={r.rota}><td>{r.rota}</td><td>{num(r.total)}</td><td>{num(r.total - r.foraPrazo)}</td><td>{num(r.foraPrazo)}</td><td className={pctNo < 95 ? "tdg-alerta" : ""}>{pctN(pctNo)}</td></tr>;
                })}</tbody>
              </table>
            )}
            <p className="tdg-nota">Abrir cada pedido e ver o status individual chega com o feed pedido-a-pedido do Track3R (webhooks). Hoje o SLA vem agregado do artefato.</p>
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>

      <Secao titulo="Reentrega — pedidos com mais de uma tentativa" kicker="REENTREGA" nota={reentrega.nota}>
        {reentrega.disponivel ? (
          <>
            <TagPeriodo mesFoco={mesFoco} />
            <div className="tdg-kpi-row"><div className="tdg-kpi"><span>Reentrega geral</span><strong>{pctN(reentrega.pctGeral)}</strong></div></div>
            {reentrega.distribuicao.length > 0 && (
              <table className="tdg-tabela"><thead><tr><th>Tentativas</th><th>Pedidos</th></tr></thead>
                <tbody>{reentrega.distribuicao.map((d) => <tr key={d.tentativas}><td>{d.tentativas}</td><td>{num(d.count)}</td></tr>)}</tbody>
              </table>
            )}
            <table className="tdg-tabela"><thead><tr><th>Rota</th><th>Pedidos</th><th>Com +1 tentativa</th><th>% reentrega</th></tr></thead>
              <tbody>{reentrega.rows.map((r) => <tr key={r.rota}><td>{r.rota}</td><td>{num(r.total)}</td><td>{num(r.multiTentativa)}</td><td>{pctN(r.pctMultiTentativa)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <Vazio>{vazio}</Vazio>}
      </Secao>
    </>
  );
}

const ABAS = [
  { id: "receita", label: "Receita Novos Negócios", Icon: TrendingUp },
  { id: "kanban", label: "Kanban Novos Clientes", Icon: KanbanSquare },
  { id: "operacional", label: "Modelo Operacional", Icon: Truck },
];

export default function CommercialPanelPage({ authHeaders, setToast, onNavigate }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState("receita");
  const [opInteracoes, setOpInteracoes] = useState(null);
  // Filtro global de mês: clicar num mês (aqui ou numa barra) foca TODAS as
  // seções com granularidade mensal naquele mês. null = período completo.
  const [mesFoco, setMesFoco] = useState(null);
  const mesesGlobais = useMemo(() => {
    const set = new Set();
    (dados?.receita?.porPeriodo?.meses || []).forEach((m) => m?.mes && set.add(m.mes));
    (dados?.operacional?.volume?.meses || []).forEach((m) => m?.mes && set.add(m.mes));
    (dados?.operacional?.otd?.meses || []).forEach((m) => m?.mes && set.add(m.mes));
    return [...set].sort();
  }, [dados]);

  const carregar = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/todogreen/comercial/painel", { headers: authHeaders?.() || {} });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Não foi possível carregar o painel comercial.");
      setDados(data);
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const patchOportunidade = async (id, patch) => {
    try {
      const resp = await fetch(`/api/todogreen/records/opportunities/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || "Não foi possível salvar."); }
      await carregar();
    } catch (e) { setToast?.(e.message); }
  };
  const moverOportunidade = (id, etapa) => patchOportunidade(id, { estagio: etapa });
  const valorOportunidade = (id, valor) => patchOportunidade(id, { valorMensal: valor });
  const registrarFup = (id) => patchOportunidade(id, { ultimaInteracaoEm: new Date().toISOString() });
  const salvarNotaFup = (id, texto) => patchOportunidade(id, { fupTexto: String(texto || "").slice(0, 2000) });
  const renomearOportunidade = (id, nome) => patchOportunidade(id, { cliente: nome, titulo: nome });
  const excluirOportunidade = async (id) => {
    try {
      const resp = await fetch(`/api/todogreen/records/opportunities/${id}`, { method: "DELETE", headers: authHeaders?.() || {} });
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || "Não foi possível excluir."); }
      await carregar();
    } catch (e) { setToast?.(e.message); }
  };
  const novaOportunidade = async ({ cliente, valor, etapa }) => {
    try {
      const resp = await fetch(`/api/todogreen/records/opportunities`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ cliente, estagio: etapa, valorMensal: valor }),
      });
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || "Não foi possível criar."); }
      await carregar();
    } catch (e) { setToast?.(e.message); }
  };

  const avisoFonte = useMemo(() => {
    if (!dados?.fontes) return "";
    if (!dados.fontes.receita?.visivel) return "Você vê o pipeline da sua carteira. Receita e operacional consolidados exigem visão de carteira.";
    if (dados.modo === "artefato_temporario" && dados.fontes.receita?.retrato) {
      const r = dados.fontes.receita.retrato;
      const quando = r.importadoEm ? new Date(r.importadoEm).toLocaleString("pt-BR") : "";
      return `Fonte TEMPORÁRIA: espelho do artefato do Track3R${r.de ? ` (${r.de} a ${r.ate})` : ""}${quando ? ` · atualizado ${quando}` : ""}. Migra para os webhooks oficiais automaticamente quando entrarem.`;
    }
    return "";
  }, [dados]);

  if (loading && !dados) return <section className="tdg-panel" aria-busy="true">Carregando painel comercial...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div><span>COMERCIAL</span><h2>Painel comercial</h2><p>Receita, pipeline e operação em uma tela. Números reais das fontes conectadas — sem dado fictício.</p></div>
        <button className="tdg-action" type="button" onClick={carregar}><RefreshCw size={16} />Atualizar</button>
      </header>

      {avisoFonte && <div className="tdg-aviso"><CircleDashed size={16} /><span>{avisoFonte}</span></div>}

      <div className="tdg-abas" role="tablist">
        {ABAS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={`tdg-aba${aba === id ? " ativa" : ""}`} onClick={() => setAba(id)}><Icon size={16} />{label}</button>
        ))}
      </div>

      {aba !== "kanban" && mesesGlobais.length > 1 && (
        <div className="tdg-mes-filtro" role="group" aria-label="Filtrar por mês">
          <span className="tdg-mes-filtro-rot">Mês:</span>
          <button type="button" className={`tdg-mes-chip${mesFoco === null ? " ativo" : ""}`} onClick={() => setMesFoco(null)}>Período completo</button>
          {mesesGlobais.map((m) => (
            <button type="button" key={m} className={`tdg-mes-chip${mesFoco === m ? " ativo" : ""}`} onClick={() => setMesFoco(m)}>{mesLabel(m)}</button>
          ))}
        </div>
      )}

      {dados && aba === "receita" && <AbaReceita receita={dados.receita} mesFoco={mesFoco} setMesFoco={setMesFoco} />}
      {dados && aba === "kanban" && <AbaKanban kanban={dados.kanban} onMover={moverOportunidade} onValor={valorOportunidade} onFup={registrarFup} onNota={salvarNotaFup} onNova={novaOportunidade} onRenomear={renomearOportunidade} onExcluir={excluirOportunidade} onVerInteracoes={setOpInteracoes} onAbrir={onNavigate ? (op) => onNavigate(`/todogreen/oportunidades?opportunity=${encodeURIComponent(op.id)}`) : undefined} />}
      {dados && aba === "operacional" && <AbaOperacional operacional={dados.operacional} mesFoco={mesFoco} setMesFoco={setMesFoco} />}

      {opInteracoes && (
        <InteracoesDrawer
          oportunidade={opInteracoes}
          authHeaders={authHeaders}
          onFechar={() => setOpInteracoes(null)}
          onAbrirOportunidades={onNavigate ? (op) => { onNavigate(`/todogreen/oportunidades?opportunity=${encodeURIComponent(op.id)}`); setOpInteracoes(null); } : null}
        />
      )}
    </div>
  );
}
