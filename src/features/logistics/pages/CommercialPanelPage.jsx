import { useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, KanbanSquare, Truck, CircleDashed } from "lucide-react";
import "./TodoGreenPages.css";

const brl = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v, casas = 1) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(casas)}%`);
const num = (v) => (Number(v) || 0).toLocaleString("pt-BR");
const mesLabel = (mes) => {
  const [ano, m] = String(mes || "").split("-");
  const nomes = ["", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return m ? `${nomes[Number(m)] || m}/${String(ano).slice(2)}` : mes;
};
const varLabel = (v) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

// Estado vazio honesto: diz POR QUE está vazio, sem fingir número.
const Vazio = ({ children }) => <p className="tdg-panel-vazio">{children}</p>;

const Secao = ({ titulo, kicker, children }) => (
  <section className="tdg-panel">
    <div className="tdg-section-head">
      <div>{kicker && <span className="tdg-kicker">{kicker}</span>}<h3>{titulo}</h3></div>
    </div>
    {children}
  </section>
);

// Barras horizontais simples, sem dependência de lib de gráfico.
const Barras = ({ itens, valor, rotulo, formato = num }) => {
  const max = Math.max(1, ...itens.map((i) => Number(valor(i)) || 0));
  return (
    <div className="tdg-barras">
      {itens.map((i, idx) => (
        <div className="tdg-barra-linha" key={idx}>
          <span className="tdg-barra-rotulo">{rotulo(i)}</span>
          <span className="tdg-barra-trilho">
            <span className="tdg-barra-preenchida" style={{ width: `${((Number(valor(i)) || 0) / max) * 100}%` }} />
          </span>
          <span className="tdg-barra-valor">{formato(valor(i))}</span>
        </div>
      ))}
    </div>
  );
};

function AbaReceita({ receita }) {
  const { porPeriodo, previsao, concentracao, resumoMensal, ticketMedio } = receita;
  const semTrack3r = "Sem faturamento ainda. Assim que o Track3R enviar (webhook ou importação), preenche automaticamente.";
  return (
    <>
      <Secao titulo="Receita por período" kicker="FATURAMENTO">
        {porPeriodo.disponivel
          ? <Barras itens={porPeriodo.meses} valor={(i) => i.receita} rotulo={(i) => mesLabel(i.mes)} formato={brl} />
          : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Previsão de fechamento do mês" kicker="RITMO">
        {previsao.disponivel ? (
          <div className="tdg-kpi-row">
            <div className="tdg-kpi"><span>Acumulado</span><strong>{brl(previsao.acumulado)}</strong></div>
            <div className="tdg-kpi"><span>Projeção do mês</span><strong>{brl(previsao.projecao)}</strong></div>
            <div className="tdg-kpi"><span>Base</span><strong>{previsao.base === "comparado" ? "ritmo vs. mês anterior" : "ritmo linear"}</strong></div>
          </div>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Concentração por cliente (tomador)" kicker="CARTEIRA">
        {concentracao.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Tomador</th><th>Total</th><th>% da receita</th></tr></thead>
            <tbody>
              {concentracao.clientes.slice(0, 15).map((c) => (
                <tr key={c.tomador}><td>{c.tomador}</td><td>{brl(c.total)}</td><td>{pct(c.participacao)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Resumo mensal" kicker="MÊS A MÊS">
        {resumoMensal.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Mês</th><th>Receita</th><th>Var. MoM</th><th>{resumoMensal.clientePrincipal || "Principal"}</th><th>Outros</th></tr></thead>
            <tbody>
              {resumoMensal.meses.map((m) => (
                <tr key={m.mes}>
                  <td>{mesLabel(m.mes)}</td><td>{brl(m.receita)}</td><td>{varLabel(m.varMoM)}</td>
                  <td>{brl(m.principal)}</td><td>{brl(m.outros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Ticket médio por cliente" kicker="RECEITA ÷ PEDIDOS">
        {ticketMedio.disponivel ? (
          <>
            {!ticketMedio.temVolume && <Vazio>Receita presente, mas ainda sem volume de pedidos para calcular o ticket. Falta a base de encomendas do Track3R.</Vazio>}
            <table className="tdg-tabela">
              <thead><tr><th>Cliente</th><th>Receita</th><th>Pedidos</th><th>Ticket médio</th></tr></thead>
              <tbody>
                {ticketMedio.clientes.slice(0, 15).map((c) => (
                  <tr key={c.cliente}><td>{c.cliente}</td><td>{brl(c.receita)}</td><td>{c.pedidos ? num(c.pedidos) : "—"}</td><td>{c.ticketMedio === null ? "—" : brl(c.ticketMedio)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>
    </>
  );
}

function AbaKanban({ kanban }) {
  const { pipeline, fup } = kanban;
  return (
    <>
      <Secao titulo="Pipeline comercial" kicker="OPORTUNIDADES POR ETAPA">
        {pipeline.disponivel ? (
          <div className="tdg-kanban">
            {pipeline.etapas.map((e) => (
              <div className="tdg-kanban-coluna" key={e.etapa}>
                <div className="tdg-kanban-cabeca"><strong>{e.etapa}</strong><small>{e.quantidade} · {brl(e.valorMensal)}/mês</small></div>
                {e.itens.slice(0, 8).map((i, idx) => (
                  <div className="tdg-kanban-cartao" key={idx}><strong>{i.cliente}</strong><small>{brl(i.valorMensal)}/mês</small></div>
                ))}
              </div>
            ))}
          </div>
        ) : <Vazio>Sem oportunidades cadastradas. Importe seu pipeline ou conecte os boards do monday.com.</Vazio>}
      </Secao>

      <Secao titulo="Clientes para FUP" kicker="SEM ACOMPANHAMENTO">
        {fup.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Cliente</th><th>Etapa</th><th>Valor mensal</th><th>Última atualização</th><th>Sem FUP há</th></tr></thead>
            <tbody>
              {fup.clientes.slice(0, 20).map((c, idx) => (
                <tr key={idx}>
                  <td>{c.cliente}</td><td>{c.etapa}</td><td>{brl(c.valorMensal)}</td>
                  <td>{c.atualizadoEm ? new Date(c.atualizadoEm).toLocaleDateString("pt-BR") : "—"}</td>
                  <td>{c.semFupDias === null ? "—" : `${c.semFupDias} dia(s)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio>Sem oportunidades para acompanhar ainda.</Vazio>}
      </Secao>
      <p className="tdg-nota">Atualização do pipeline: semanal. Ao mapear os boards do monday.com, esta aba passa a refletir o CRM em tempo real.</p>
    </>
  );
}

function AbaOperacional({ operacional }) {
  const { volume, otd, efetividade, ocorrencias, resumoMensal, ranking, leadTime, slaPorRota, reentrega } = operacional;
  const semTrack3r = "Sem encomendas ainda. Assim que o Track3R enviar ocorrências/encomendas, preenche automaticamente.";
  return (
    <>
      <Secao titulo="Volume de pedidos" kicker="POR MÊS">
        {volume.disponivel ? <Barras itens={volume.meses} valor={(i) => i.pedidos} rotulo={(i) => mesLabel(i.mes)} /> : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo={`OTD — On Time Delivery (meta ${pct(otd.meta, 0)})`} kicker="PONTUALIDADE">
        {otd.disponivel ? (
          <>
            <div className="tdg-kpi-row"><div className="tdg-kpi"><span>OTD geral</span><strong>{pct(otd.otdGeral)}</strong></div><div className="tdg-kpi"><span>Entregas medidas</span><strong>{num(otd.entreguesTotal)}</strong></div></div>
            <table className="tdg-tabela"><thead><tr><th>Mês</th><th>Entregues</th><th>No prazo</th><th>OTD</th></tr></thead>
              <tbody>{otd.meses.map((m) => <tr key={m.mes}><td>{mesLabel(m.mes)}</td><td>{num(m.entregues)}</td><td>{num(m.noPrazo)}</td><td>{pct(m.otd)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Efetividade de entregas" kicker="ENTREGUES ÷ TOTAL">
        {efetividade.disponivel ? (
          <div className="tdg-kpi-row"><div className="tdg-kpi"><span>Efetividade geral</span><strong>{pct(efetividade.efetividadeGeral)}</strong></div><div className="tdg-kpi"><span>Entregues</span><strong>{num(efetividade.entregues)}/{num(efetividade.total)}</strong></div></div>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Decomposição das ocorrências" kicker="INSUCESSOS">
        {ocorrencias.disponivel
          ? <Barras itens={ocorrencias.tipos} valor={(i) => i.quantidade} rotulo={(i) => i.tipo} formato={(v) => num(v)} />
          : <Vazio>Sem ocorrências de insucesso registradas.</Vazio>}
      </Secao>

      <Secao titulo="Resumo mensal operacional" kicker="MÊS A MÊS">
        {resumoMensal.disponivel ? (
          <table className="tdg-tabela">
            <thead><tr><th>Mês</th><th>Volume</th><th>Var. MoM</th><th>OTD</th><th>Efetividade</th><th>Insucessos</th></tr></thead>
            <tbody>{resumoMensal.meses.map((m) => <tr key={m.mes}><td>{mesLabel(m.mes)}</td><td>{num(m.volume)}</td><td>{varLabel(m.varMoM)}</td><td>{pct(m.otd)}</td><td>{pct(m.efetividade)}</td><td>{m.insucessos === null ? "—" : num(m.insucessos)}</td></tr>)}</tbody>
          </table>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Ranking de clientes por volume" kicker="PEDIDOS">
        {ranking.disponivel
          ? <Barras itens={ranking.clientes.slice(0, 15)} valor={(i) => i.total} rotulo={(i) => i.cliente} />
          : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Lead time (registro → entrega)" kicker="PRAZO">
        {leadTime.disponivel ? (
          <div className="tdg-kpi-row"><div className="tdg-kpi"><span>Médio</span><strong>{leadTime.diasMediosGeral?.toFixed(1)} dia(s)</strong></div><div className="tdg-kpi"><span>Pedidos medidos</span><strong>{num(leadTime.pedidos)}</strong></div></div>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="SLA por rota" kicker="FORA DO PRAZO">
        {slaPorRota.disponivel ? (
          <table className="tdg-tabela"><thead><tr><th>Rota</th><th>Pedidos</th><th>Fora do prazo</th><th>% fora</th></tr></thead>
            <tbody>{slaPorRota.rotas.slice(0, 20).map((r) => <tr key={r.rota}><td>{r.rota}</td><td>{num(r.pedidos)}</td><td>{num(r.foraDoPrazo)}</td><td>{pct(r.percentualForaDoPrazo)}</td></tr>)}</tbody>
          </table>
        ) : <Vazio>{semTrack3r}</Vazio>}
      </Secao>

      <Secao titulo="Reentrega" kicker="MAIS DE UMA TENTATIVA">
        {reentrega.disponivel ? (
          <table className="tdg-tabela"><thead><tr><th>Rota</th><th>Pedidos</th><th>Com +1 tentativa</th><th>% reentrega</th></tr></thead>
            <tbody>{reentrega.rotas.slice(0, 20).map((r) => <tr key={r.rota}><td>{r.rota}</td><td>{num(r.pedidos)}</td><td>{num(r.comReentrega)}</td><td>{pct(r.percentualReentrega)}</td></tr>)}</tbody>
          </table>
        ) : <Vazio>Sem reentregas registradas.</Vazio>}
      </Secao>
    </>
  );
}

const ABAS = [
  { id: "receita", label: "Receita Novos Negócios", Icon: TrendingUp },
  { id: "kanban", label: "Kanban Novos Clientes", Icon: KanbanSquare },
  { id: "operacional", label: "Modelo Operacional", Icon: Truck },
];

export default function CommercialPanelPage({ authHeaders, setToast }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState("receita");

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

  const avisoFonte = useMemo(() => {
    if (!dados?.fontes) return "";
    const { receita, operacional } = dados.fontes;
    if (!receita?.visivel) return "Você vê o pipeline da sua carteira. Receita e operacional consolidados exigem visão de carteira.";
    if (receita?.registros === 0 && operacional?.registros === 0)
      return "Track3R ainda não enviou dados. A tela está pronta e preenche sozinha quando o faturamento/encomendas chegarem (webhook ou importação).";
    return "";
  }, [dados]);

  if (loading && !dados)
    return <section className="tdg-panel" aria-busy="true">Carregando painel comercial...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>COMERCIAL</span>
          <h2>Painel comercial</h2>
          <p>Receita, pipeline e operação em uma tela. Números reais das fontes conectadas — sem dado fictício.</p>
        </div>
        <button className="tdg-action" type="button" onClick={carregar}><RefreshCw size={16} />Atualizar</button>
      </header>

      {avisoFonte && (
        <div className="tdg-aviso"><CircleDashed size={16} /><span>{avisoFonte}</span></div>
      )}

      <div className="tdg-abas" role="tablist">
        {ABAS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id}
            className={`tdg-aba${aba === id ? " ativa" : ""}`} onClick={() => setAba(id)}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {dados && aba === "receita" && <AbaReceita receita={dados.receita} />}
      {dados && aba === "kanban" && <AbaKanban kanban={dados.kanban} />}
      {dados && aba === "operacional" && <AbaOperacional operacional={dados.operacional} />}
    </div>
  );
}
