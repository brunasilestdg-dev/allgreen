// ===== SegmentedControl — alternância compacta (item 7) =====
//
// Para conjuntos pequenos e mutuamente exclusivos: temperatura (Frio/Morno/
// Quente), modo de visualização (Cartões/Kanban/Tabela), período. Uma faixa
// só, o selecionado em destaque. Melhor que um <select> quando as opções cabem
// na tela e a troca é frequente.
//
// options: [{ value, label, icon? }]
export function SegmentedControl({ options = [], value, onChange, size = "md", ariaLabel, disabled = false, className = "" }) {
  return (
    <div className={`ds-seg ds-seg--${size}${disabled ? " is-disabled" : ""} ${className}`.trim()} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        const marcado = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={marcado}
            disabled={disabled}
            className={`ds-seg__opt${marcado ? " is-active" : ""}`}
            onClick={() => onChange?.(o.value)}
          >
            {Icon && <Icon size={size === "sm" ? 14 : 15} aria-hidden="true" />}
            {o.label != null && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
