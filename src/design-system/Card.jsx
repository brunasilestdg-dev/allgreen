import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

// ===== Card / MetricCard — a superfície de conteúdo padrão (item 50) =====
//
// Card é o contêiner branco com borda e raio que quase toda tela usa; hoje cada
// módulo desenha o seu com hex e sombra próprios. Um só, com tokens, encerra a
// divergência. MetricCard é o KPI (rótulo + número + tendência) que se repete em
// painéis — mesma leitura em qualquer lugar.

// as: elemento raiz (section/article/div). pad: none | sm | md | lg.
export function Card({
  children,
  title,
  actions,
  kicker,
  footer,
  pad = "md",
  as: As = "section",
  className = "",
  ...props
}) {
  const temCabeca = title != null || actions != null || kicker != null;
  return (
    <As className={`ds-card ds-card--pad-${pad} ${className}`.trim()} {...props}>
      {temCabeca && (
        <header className="ds-card__head">
          <div className="ds-card__headings">
            {kicker && <span className="ds-card__kicker">{kicker}</span>}
            {title && <h3 className="ds-card__title">{title}</h3>}
          </div>
          {actions && <div className="ds-card__actions">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="ds-card__foot">{footer}</footer>}
    </As>
  );
}

const ICONE_TENDENCIA = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus };

// tone da tendência é semântico (verde sobe é bom; vermelho desce é ruim) — mas
// quem sabe o significado é quem chama, então `trendTone` é explícito e não
// deduzido de "subiu = bom" (nem sempre é: custo subindo é ruim).
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  trendTone = "neutral",
  className = "",
  ...props
}) {
  const IconeTendencia = trend ? ICONE_TENDENCIA[trend] : null;
  return (
    <div className={`ds-metric ${className}`.trim()} {...props}>
      <div className="ds-metric__top">
        <span className="ds-metric__label">{label}</span>
        {Icon && <Icon className="ds-metric__icon" size={16} aria-hidden="true" />}
      </div>
      <strong className="ds-metric__value">{value}</strong>
      {(hint || IconeTendencia) && (
        <div className={`ds-metric__foot ds-metric__foot--${trendTone}`}>
          {IconeTendencia && <IconeTendencia size={14} aria-hidden="true" />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}
