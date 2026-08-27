import { fatiasDaRosca, maiorValor, pontosDaLinha, serieDoIndicador } from "../dashboardChartsDomain.js";
import "./DashboardCharts.css";

// Os desenhos dos indicadores do painel. Puro SVG/CSS — sem biblioteca externa
// (a CSP do produto não deixaria carregar uma, e a régua visual da vertical é
// própria). A série vem pronta de `dashboardChartsDomain`; aqui só se desenha.

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

function Barras({ serie, unidade }) {
  if (!serie.length) return <SemDados />;
  const max = maiorValor(serie);
  return (
    <div className="tdgc-bars" role="img" aria-label="Gráfico de barras">
      {serie.map((item, i) => (
        <div className="tdgc-bar-col" key={item.chave || item.rotulo || i}>
          <span className="tdgc-bar-val">{formatarValor(item.valor, unidade)}</span>
          <span className="tdgc-bar" style={{ height: `${Math.max(4, (Math.abs(item.valor) / max) * 100)}%` }} />
          <span className="tdgc-bar-lbl">{item.rotulo}</span>
        </div>
      ))}
    </div>
  );
}

function Evolucao({ serie, unidade }) {
  if (serie.length < 2) return serie.length ? <Barras serie={serie} unidade={unidade} /> : <SemDados />;
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
        <circle cx={ultimo.x} cy={ultimo.y + 6} r="4" className="tdgc-endpoint" />
      </svg>
      <div className="tdgc-line-labels">
        <span>{serie[0].rotulo}</span>
        <strong>{formatarValor(ultimo.valor, unidade)}</strong>
        <span>{serie[serie.length - 1].rotulo}</span>
      </div>
    </div>
  );
}

function Distribuicao({ distribuicao }) {
  const fatias = fatiasDaRosca(distribuicao);
  if (!fatias.length) return <SemDados />;
  const gradiente = fatias
    .map((f, i) => `${CORES[i % CORES.length]} ${f.inicio}% ${f.fim}%`)
    .join(", ");
  return (
    <div className="tdgc-donut-wrap">
      <div className="tdgc-donut" style={{ background: `conic-gradient(${gradiente})` }} role="img" aria-label="Gráfico de distribuição" />
      <ul className="tdgc-legend">
        {fatias.map((f, i) => (
          <li key={f.rotulo}>
            <i style={{ background: CORES[i % CORES.length] }} />
            <span>{f.rotulo}</span>
            <b>{f.percentual}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tabela({ serie, unidade }) {
  if (!serie.length) return <SemDados />;
  return (
    <div className="tdgc-table-wrap">
      <table className="tdgc-table">
        <tbody>
          {serie.map((item, i) => (
            <tr key={item.chave || item.rotulo || i}>
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
// desconhecido cai em número — nunca tela em branco.
export default function WidgetChart({ widget, data, valorEscalar }) {
  const { valor, unidade, serie, distribuicao } = serieDoIndicador(widget.metric, data, valorEscalar);
  switch (widget.type) {
    case "bar": return <Barras serie={serie} unidade={unidade} />;
    case "line": return <Evolucao serie={serie} unidade={unidade} />;
    case "donut": return <Distribuicao distribuicao={distribuicao} />;
    case "table": return <Tabela serie={serie} unidade={unidade} />;
    default: return <Numero valor={valor} unidade={unidade} />;
  }
}
