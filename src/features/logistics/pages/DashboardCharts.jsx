import { fatiasDaRosca, maiorValor, pontosDaLinha, serieDoIndicador } from "../dashboardChartsDomain.js";
import "./DashboardCharts.css";

// Os desenhos dos indicadores do painel. Puro SVG/CSS — sem biblioteca externa
// (a CSP do produto não deixaria carregar uma, e a régua visual da vertical é
// própria). A série vem pronta de `dashboardChartsDomain`; aqui só se desenha.
//
// Dinâmicos (pedido da titular: "clicar nos gráficos, torná-los dinâmicos"):
// cada barra/fatia/ponto mostra o valor exato ao passar o mouse (tooltip nativo)
// e, quando a tela passa `onSelecionar`, vira botão clicável que devolve o item
// tocado — a pessoa clica a fatia e a tela decide para onde levar. A entrada é
// animada por CSS (barra cresce, linha se desenha, rosca aparece).

// Paleta categórica da rosca: verde da marca primeiro, depois tons que se
// distinguem em claro e escuro. Índices além do tamanho dão a volta.
const CORES = ["var(--tdg-green)", "#c4700b", "#2f8f83", "#5b6b78", "#8a5cb4", "#b8483a"];

const formatarValor = (valor, unidade) => {
  const num = Number(valor) || 0;
  if (unidade === "R$") {
    return num >= 1000
      ? `R$ ${(num / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
      : `R$ ${num.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  }
  if (unidade === "%") return `${num.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return num.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

function SemDados() {
  return <p className="tdgc-empty">Sem dados ainda para este indicador.</p>;
}

function Numero({ valor, unidade }) {
  return (
    <div className="tdgc-metric">
      <strong>{formatarValor(valor, unidade)}</strong>
    </div>
  );
}

function Barras({ serie, unidade, onSelecionar }) {
  if (!serie.length) return <SemDados />;
  const max = maiorValor(serie);
  return (
    <div className="tdgc-bars" role="img" aria-label="Gráfico de barras">
      {serie.map((item, i) => {
        const dica = `${item.rotulo}: ${formatarValor(item.valor, unidade)}`;
        const altura = `${Math.max(4, (Math.abs(item.valor) / max) * 100)}%`;
        const conteudo = (
          <>
            <span className="tdgc-bar-val">{formatarValor(item.valor, unidade)}</span>
            <span className="tdgc-bar" style={{ height: altura }} />
            <span className="tdgc-bar-lbl">{item.rotulo}</span>
          </>
        );
        return onSelecionar ? (
          <button type="button" className="tdgc-bar-col tdgc-clic" key={item.chave || item.rotulo || i} title={dica} aria-label={`Abrir ${dica}`} onClick={() => onSelecionar(item)}>
            {conteudo}
          </button>
        ) : (
          <div className="tdgc-bar-col" key={item.chave || item.rotulo || i} title={dica}>
            {conteudo}
          </div>
        );
      })}
    </div>
  );
}

function Evolucao({ serie, unidade, onSelecionar }) {
  if (serie.length < 2) return serie.length ? <Barras serie={serie} unidade={unidade} onSelecionar={onSelecionar} /> : <SemDados />;
  const W = 300;
  const H = 120;
  const pts = pontosDaLinha(serie, { largura: W, altura: H - 24 });
  const desenho = pts.map((p) => `${p.x},${p.y + 6}`).join(" ");
  const area = `${pts[0].x},${H - 12} ${desenho} ${pts[pts.length - 1].x},${H - 12}`;
  const ultimo = pts[pts.length - 1];
  return (
    <div className="tdgc-line-wrap">
      <svg className="tdgc-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gráfico de evolução">
        <line x1="0" y1={H - 12} x2={W} y2={H - 12} className="tdgc-axis" />
        <polygon points={area} className="tdgc-area" />
        <polyline points={desenho} className="tdgc-stroke" />
        {/* Um ponto por mês com o valor no tooltip; clicável quando a tela pede. */}
        {pts.map((p, i) => (
          <circle
            key={serie[i]?.chave || serie[i]?.rotulo || i}
            cx={p.x}
            cy={p.y + 6}
            r={i === pts.length - 1 ? 4 : 3}
            className={`tdgc-point${i === pts.length - 1 ? " tdgc-endpoint" : ""}${onSelecionar ? " tdgc-clic" : ""}`}
            onClick={onSelecionar ? () => onSelecionar(serie[i]) : undefined}
          >
            <title>{`${serie[i].rotulo}: ${formatarValor(serie[i].valor, unidade)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="tdgc-line-labels">
        <span>{serie[0].rotulo}</span>
        <strong>{formatarValor(ultimo.valor, unidade)}</strong>
        <span>{serie[serie.length - 1].rotulo}</span>
      </div>
    </div>
  );
}

// Rosca em SVG (não mais conic-gradient chapado): um anel segmentado com vão
// fino entre as fatias, o TOTAL no centro (o buraco deixa de ser vazio) e a
// legenda com nome + contagem + %. Cada fatia é clicável e mostra o valor no
// tooltip. Circunferência ≈ 100 (r = 15.915), então cada 1% = 1 unidade de
// traço — o começo de cada fatia é a sua % acumulada.
function Distribuicao({ distribuicao, onSelecionar }) {
  const fatias = fatiasDaRosca(distribuicao);
  if (!fatias.length) return <SemDados />;
  const total = fatias.reduce((soma, f) => soma + f.valor, 0);
  const R = 15.915;
  const VAO = fatias.length > 1 ? 1.5 : 0; // vão entre fatias, em % do anel
  return (
    <div className="tdgc-donut-wrap">
      <div className="tdgc-donut2">
        <svg viewBox="0 0 42 42" className="tdgc-donut2-svg" role="img" aria-label="Gráfico de distribuição">
          <circle cx="21" cy="21" r={R} className="tdgc-donut2-trilho" />
          {fatias.map((f, i) => {
            const traco = Math.max(0.5, f.percentual - VAO);
            return (
              <circle
                key={f.rotulo}
                cx="21"
                cy="21"
                r={R}
                className={`tdgc-donut2-arco${onSelecionar ? " tdgc-clic" : ""}`}
                stroke={CORES[i % CORES.length]}
                strokeDasharray={`${traco} ${100 - traco}`}
                strokeDashoffset={-f.inicio}
                onClick={onSelecionar ? () => onSelecionar(f) : undefined}
              >
                <title>{`${f.rotulo}: ${f.valor} (${f.percentual}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="tdgc-donut2-centro">
          <strong>{total.toLocaleString("pt-BR")}</strong>
          <small>total</small>
        </div>
      </div>
      <ul className="tdgc-legend">
        {fatias.map((f, i) => {
          const dica = `${f.rotulo}: ${f.valor} (${f.percentual}%)`;
          const conteudo = (
            <>
              <i style={{ background: CORES[i % CORES.length] }} />
              <span>{f.rotulo}</span>
              <b>{f.valor} · {f.percentual}%</b>
            </>
          );
          return onSelecionar ? (
            <li key={f.rotulo}>
              <button type="button" className="tdgc-legend-btn tdgc-clic" title={dica} aria-label={`Abrir ${dica}`} onClick={() => onSelecionar(f)}>
                {conteudo}
              </button>
            </li>
          ) : (
            <li key={f.rotulo} title={dica}>{conteudo}</li>
          );
        })}
      </ul>
    </div>
  );
}

function Tabela({ serie, unidade, onSelecionar }) {
  if (!serie.length) return <SemDados />;
  return (
    <div className="tdgc-table-wrap">
      <table className="tdgc-table">
        <tbody>
          {serie.map((item, i) => (
            <tr
              key={item.chave || item.rotulo || i}
              className={onSelecionar ? "tdgc-clic" : ""}
              onClick={onSelecionar ? () => onSelecionar(item) : undefined}
            >
              <td>{item.rotulo}</td>
              <td className="tdgc-num">{formatarValor(item.valor, unidade)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// O ponto de entrada: dado o widget e os dados, escolhe o desenho. Um `type`
// desconhecido cai em número — nunca tela em branco. `onSelecionar(item)` é
// opcional: quando a tela passa, o gráfico fica clicável (barra/fatia/ponto).
export default function WidgetChart({ widget, data, valorEscalar, onSelecionar }) {
  const { valor, unidade, serie, distribuicao } = serieDoIndicador(widget.metric, data, valorEscalar);
  switch (widget.type) {
    case "bar": return <Barras serie={serie} unidade={unidade} onSelecionar={onSelecionar} />;
    case "line": return <Evolucao serie={serie} unidade={unidade} onSelecionar={onSelecionar} />;
    case "donut": return <Distribuicao distribuicao={distribuicao} onSelecionar={onSelecionar} />;
    case "table": return <Tabela serie={serie} unidade={unidade} onSelecionar={onSelecionar} />;
    default: return <Numero valor={valor} unidade={unidade} />;
  }
}
