import { useMemo } from "react";
import { Plus, TrendingUp } from "lucide-react";
import {
  ESTAGIOS_FUNIL,
  PROBABILIDADE_POR_ESTAGIO,
  analisarOportunidade,
  estagioValido,
} from "../opportunityIntelligenceDomain.js";
import "./TodoGreenPages.css";

// Funil de vendas da To Do Green: a mesma leitura ponderada do funil do app
// geral, agora sobre as oportunidades da vertical (estágio, probabilidade por
// etapa e valor de contrato do próprio motor comercial). Previsão ponderada =
// valor × probabilidade da etapa — o número realista, não a soma otimista.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const isData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").slice(0, 10));
const mesLabel = (chave) => {
  const [ano, mes] = chave.split("-");
  return `${NOMES_MES[Number(mes) - 1]}/${ano.slice(2)}`;
};

export default function SalesFunnelPage({ opportunities = [], onNavigate, setToast }) {
  const dados = useMemo(() => {
    const analisadas = (opportunities || []).map((o) => ({
      o,
      financeiro: analisarOportunidade(o).financeiro,
      estagio: estagioValido(o.estagio),
    }));
    const abertas = analisadas.filter((x) => ESTAGIOS_FUNIL.includes(x.estagio));
    const ganhas = analisadas.filter((x) => x.estagio === "Fechada ganha");
    const perdidas = analisadas.filter((x) => x.estagio === "Fechada perdida");
    const soma = (lista, campo) => lista.reduce((s, x) => s + (x.financeiro[campo] || 0), 0);

    const decididas = ganhas.length + perdidas.length;
    const ciclos = ganhas
      .map((x) => {
        const inicio = String(x.o.criadoEm || "").slice(0, 10);
        const fim = String(x.o.closedAt || x.o.expectedCloseAt || "").slice(0, 10);
        if (!isData(inicio) || !isData(fim)) return null;
        return Math.max(0, Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000));
      })
      .filter((d) => d !== null);

    const porEtapa = ESTAGIOS_FUNIL.map((estagio) => {
      const itens = abertas.filter((x) => x.estagio === estagio);
      return {
        estagio,
        count: itens.length,
        total: soma(itens, "valorContrato"),
        weighted: soma(itens, "valorPonderado"),
        probabilidade: PROBABILIDADE_POR_ESTAGIO[estagio] || 0,
      };
    });
    const maxTotal = Math.max(1, ...porEtapa.map((e) => e.total));

    const hoje = new Date();
    const meses = [];
    for (let i = 0; i < 3; i += 1) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const doMes = abertas.filter((x) => String(x.o.expectedCloseAt || "").slice(0, 7) === chave);
      meses.push({ chave, count: doMes.length, total: soma(doMes, "valorContrato"), weighted: soma(doMes, "valorPonderado") });
    }

    return {
      abertas: abertas.length,
      emNegociacao: soma(abertas, "valorContrato"),
      ponderado: soma(abertas, "valorPonderado"),
      taxaFechamento: decididas > 0 ? Math.round((ganhas.length / decididas) * 100) : 0,
      ticketMedio: ganhas.length > 0 ? soma(ganhas, "valorContrato") / ganhas.length : 0,
      cicloMedio: ciclos.length ? Math.round(ciclos.reduce((s, d) => s + d, 0) / ciclos.length) : 0,
      porEtapa,
      maxTotal,
      meses,
    };
  }, [opportunities]);

  const irParaOportunidades = () => onNavigate?.("/todogreen/oportunidades");

  return (
    <section className="tdg-panel tdg-page tdg-funil">
      <header className="tdg-page-title">
        <div>
          <span>COMERCIAL · FORECAST</span>
          <h2><TrendingUp size={20} /> Funil de vendas</h2>
          <p>Cada etapa tem uma probabilidade. Disso sai a previsão do que você deve faturar de verdade — não só a soma otimista de tudo.</p>
        </div>
        <button type="button" className="tdg-action" onClick={irParaOportunidades}><Plus size={16} /> Nova oportunidade</button>
      </header>

      <div className="tdg-funil-metrics">
        <article className="tdg-metric"><span>Em negociação</span><strong>{BRL.format(dados.emNegociacao)}</strong></article>
        <article className="tdg-metric ativa"><span>Previsão ponderada</span><strong>{BRL.format(dados.ponderado)}</strong></article>
        <article className="tdg-metric"><span>Taxa de fechamento</span><strong>{dados.taxaFechamento}%</strong></article>
        <article className="tdg-metric"><span>Ticket médio</span><strong>{BRL.format(dados.ticketMedio)}</strong></article>
        <article className="tdg-metric"><span>Ciclo médio de venda</span><strong>{dados.cicloMedio} dias</strong></article>
      </div>

      <div className="tdg-funil-grid">
        <section className="tdg-panel">
          <div className="tdg-section-head"><div><span className="tdg-kicker">FUNIL</span><h3>Funil por etapa</h3></div></div>
          <ul className="tdg-funil-etapas">
            {dados.porEtapa.map((e) => (
              <li key={e.estagio}>
                <span className="tdg-funil-etapa-nome" title={`${e.probabilidade}% de probabilidade`}>{e.estagio}</span>
                <span className="tdg-funil-barra"><span style={{ width: `${Math.round((e.total / dados.maxTotal) * 100)}%` }} /></span>
                <span className="tdg-funil-etapa-valor">{e.count} · {BRL.format(e.total)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="tdg-panel">
          <div className="tdg-section-head"><div><span className="tdg-kicker">PREVISÃO</span><h3>Previsão dos próximos meses</h3></div></div>
          <div className="tdg-table-wrap"><table className="tdg-table tdg-funil-tabela">
            <thead><tr><th>Mês</th><th>Negócios</th><th>Valor total</th><th>Ponderado</th></tr></thead>
            <tbody>{dados.meses.map((m) => (
              <tr key={m.chave}><td>{mesLabel(m.chave)}</td><td>{m.count}</td><td>{BRL.format(m.total)}</td><td>{BRL.format(m.weighted)}</td></tr>
            ))}</tbody>
          </table></div>
          <small className="tdg-funil-nota">Ponderado = valor × probabilidade da etapa. É a leitura realista. Oportunidades sem data prevista não aparecem aqui.</small>
        </section>
      </div>

      {dados.abertas === 0 && (
        <div className="tdg-funil-vazio">
          <TrendingUp size={26} />
          <strong>Nenhuma oportunidade no funil</strong>
          <p>Cadastre um negócio em andamento com valor e data prevista. Com dois ou três, o funil já começa a te dizer quanto esperar no mês.</p>
          <button type="button" className="tdg-action tdg-action-ghost" onClick={irParaOportunidades}><Plus size={16} /> Criar a primeira</button>
        </div>
      )}
    </section>
  );
}
