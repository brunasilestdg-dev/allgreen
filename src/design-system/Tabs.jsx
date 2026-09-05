// ===== Tabs — navegação entre seções de um mesmo objeto (item 23/25) =====
//
// As abas da página de cliente (Resumo, Pessoas, Oportunidades, Conversas…):
// mesma aparência e comportamento em qualquer módulo. Controlado — o pai
// guarda a aba ativa (para deep-link, memória, etc.).
//
// tabs: [{ value, label, badge? }]
export function Tabs({ tabs = [], value, onChange, ariaLabel, className = "" }) {
  return (
    <div className={`ds-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const marcado = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={marcado}
            className={`ds-tab${marcado ? " is-active" : ""}`}
            onClick={() => onChange?.(t.value)}
          >
            {t.label}
            {t.badge != null && <span className="ds-tab__badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
