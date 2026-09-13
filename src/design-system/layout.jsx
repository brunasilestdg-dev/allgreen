// ===== PageHeader / Toolbar — o topo de tela e a barra de ações (item 47) =====
//
// Toda página tem um topo (kicker + título + subtítulo + ações à direita) e
// quase toda tem uma barra de filtros/ações. Padronizar os dois alinha o ritmo
// vertical entre módulos e acaba com cada tela inventando o próprio espaçamento.

// breadcrumb: [{ label, onClick?, href? }] — o último é a página atual.
export function PageHeader({
  title,
  subtitle,
  kicker,
  breadcrumb,
  actions,
  className = "",
  ...props
}) {
  return (
    <header className={`ds-pagehead ${className}`.trim()} {...props}>
      {breadcrumb?.length > 0 && (
        <nav className="ds-pagehead__crumbs" aria-label="Trilha de navegação">
          {breadcrumb.map((passo, i) => {
            const ultimo = i === breadcrumb.length - 1;
            return (
              <span className="ds-pagehead__crumb" key={`${passo.label}-${i}`}>
                {ultimo ? (
                  <span aria-current="page">{passo.label}</span>
                ) : passo.onClick || passo.href ? (
                  <a
                    href={passo.href || undefined}
                    onClick={passo.onClick ? (e) => { e.preventDefault(); passo.onClick(); } : undefined}
                  >
                    {passo.label}
                  </a>
                ) : (
                  <span>{passo.label}</span>
                )}
                {!ultimo && <span className="ds-pagehead__sep" aria-hidden="true">›</span>}
              </span>
            );
          })}
        </nav>
      )}
      <div className="ds-pagehead__row">
        <div className="ds-pagehead__headings">
          {kicker && <span className="ds-pagehead__kicker">{kicker}</span>}
          {title && <h1 className="ds-pagehead__title">{title}</h1>}
          {subtitle && <p className="ds-pagehead__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="ds-pagehead__actions">{actions}</div>}
      </div>
    </header>
  );
}

// Barra de ações/filtros. `justify` controla a distribuição; envolve em linha e
// quebra no mobile em vez de estourar (item 47: nada sai da tela).
export function Toolbar({ children, justify = "between", className = "", ...props }) {
  return (
    <div className={`ds-toolbar ds-toolbar--${justify} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
