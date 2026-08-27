import { ArrowRight, GitBranch } from "lucide-react";
import { cards } from "./EnterpriseAreaPage.jsx";

// Ordem em que o trabalho normalmente atravessa a empresa — do produto ao caixa.
const ORDEM = ["products", "planning", "commercial", "operations", "finance", "dp", "quality", "marketing", "legal", "admin", "indicators"];

const areasOrdenadas = () => {
  const chaves = Object.keys(cards);
  return [...chaves].sort((a, b) => {
    const ia = ORDEM.indexOf(a); const ib = ORDEM.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
};

export default function FluxosPage({ onNavigate }) {
  const areas = areasOrdenadas();
  return (
    <section className="tdg-panel tdg-fluxos-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">FLUXOS</span>
          <h2>Fluxos entre áreas</h2>
          <p>Como o trabalho passa de uma área para a outra — do produto ao caixa. Cada passagem mostra quem recebe e o que faz em seguida.</p>
        </div>
        <GitBranch size={28} />
      </div>

      <div className="tdg-fluxos-grid">
        {areas.map((chave) => {
          const area = cards[chave];
          if (!area?.handoff?.length) return null;
          return (
            <article className="tdg-fluxo-card" key={chave}>
              <header>
                <span className="tdg-kicker">{area.kicker}</span>
                <strong>{area.title}</strong>
              </header>
              <ol className="tdg-fluxo-passos">
                {area.handoff.map(([label, owner]) => (
                  <li key={`${owner}-${label}`}>
                    <b>{owner}</b>
                    <ArrowRight size={13} aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ol>
              {area.actions?.length > 0 && (
                <button type="button" className="tdg-fluxo-link" onClick={() => onNavigate?.(area.actions[0][1])}>
                  Abrir {area.kicker.toLowerCase()}<ArrowRight size={13} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
