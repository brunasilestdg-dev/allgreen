import { Check } from "lucide-react";

// ===== RadioCards — decisão importante em blocos clicáveis (item 10) =====
//
// Em vez de uma bolinha perdida no meio da tela, cada opção é um bloco inteiro
// clicável. O selecionado fica evidente por fundo + borda + indicador. Para
// escolhas do tipo "Privado / Pessoas específicas / Todo o espaço".
//
// options: [{ value, label, description?, icon? }]
export function RadioCards({ options = [], value, onChange, name, columns = 1, className = "" }) {
  return (
    <div
      className={`ds-radiocards ${className}`.trim()}
      role="radiogroup"
      style={{ gridTemplateColumns: columns > 1 ? `repeat(${columns}, minmax(0, 1fr))` : undefined }}
    >
      {options.map((o) => {
        const marcado = value === o.value;
        const Icon = o.icon;
        return (
          <label key={o.value} className={`ds-radiocard${marcado ? " is-selected" : ""}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={marcado}
              onChange={() => onChange?.(o.value)}
            />
            {Icon && <span className="ds-radiocard__icon"><Icon size={18} aria-hidden="true" /></span>}
            <span className="ds-radiocard__body">
              <span className="ds-radiocard__label">{o.label}</span>
              {o.description && <span className="ds-radiocard__desc">{o.description}</span>}
            </span>
            <span className="ds-radiocard__mark" aria-hidden="true">{marcado && <Check size={15} />}</span>
          </label>
        );
      })}
    </div>
  );
}
