import "./TodoGreenPages.css";
import { useMemo } from "react";
import { avancosDaSemana } from "../avancosDaSemanaDomain.js";

// ===== Avanços da semana =====
//
// O mockup da titular, campo a campo: cartão com o selo de valor, o nome do
// cliente e o avanço concreto — que é o comentário mais recente da
// oportunidade (ou o próximo passo registrado). Quem esfriou aparece no
// rodapé de atenção, nunca escondida no meio de uma lista.

const BRL_COMPACTO = (valor) => {
  const n = Number(valor) || 0;
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MM`;
  if (Math.abs(n) >= 1_000) return `R$ ${Math.round(n / 1_000).toLocaleString("pt-BR")} mil`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
};

export default function AvancosDaSemanaPage({ opportunities = [], comments = [], interactions = [], onNavigate }) {
  const { avancos, totalMensal, frios } = useMemo(
    () => avancosDaSemana({ oportunidades: opportunities, comentarios: comments, interacoes: interactions }),
    [opportunities, comments, interactions],
  );

  return (
    <section className="tdg-panel tdg-page tdg-avancos-page">
      <header className="tdg-page-title">
        <div>
          <span>NOVOS NEGÓCIOS · PIPELINE</span>
          <h2>Avanços da semana</h2>
          <p>
            {avancos.length} oportunidade(s) com movimento concreto esta semana
            {totalMensal > 0 ? `, somando ${BRL_COMPACTO(totalMensal)}/mês` : ""} — ordenadas por
            potencial de receita. O avanço de cada cartão é o último comentário registrado na
            oportunidade.
          </p>
        </div>
      </header>

      {avancos.length === 0 && (
        <div className="tdg-empty-access">
          Nenhum movimento registrado nos últimos sete dias. Comente nas oportunidades (ou
          registre a interação) e os avanços aparecem aqui sozinhos.
        </div>
      )}

      <div className="tdg-avancos-grid">
        {avancos.map((item) => (
          <button
            type="button"
            className="tdg-avanco-cartao"
            key={item.id}
            title={`${item.cliente} · ${item.estagio}`}
            onClick={() => onNavigate?.(item.clientId ? `/todogreen/clientes?client=${encodeURIComponent(item.clientId)}` : "/todogreen/oportunidades")}
          >
            <span className="tdg-avanco-valor">{BRL_COMPACTO(item.valor)}</span>
            <strong>{item.cliente}</strong>
            <p>{item.nota || "Sem nota — registre um comentário na oportunidade."}</p>
          </button>
        ))}
      </div>

      {frios.length > 0 && (
        <p className="tdg-avancos-atencao">
          <strong>Atenção:</strong>{" "}
          {frios
            .map((item) => `${item.cliente} esfriou (${item.diasParado === null ? "sem registro de contato" : `${item.diasParado} dias sem movimento`})`)
            .join(" · ")}{" "}
          — candidata(s) a reforço de follow-up.
        </p>
      )}
    </section>
  );
}
