import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, X } from "lucide-react";

// ===== Alert / EmptyState / Spinner / Skeleton — os estados que faltavam =====
//
// Todo módulo precisa dizer "deu certo", "cuidado", "deu erro", "não há nada
// aqui ainda" e "carregando". Sem componente, cada um inventa a própria caixa
// colorida e o próprio vazio. Estes padronizam a cor com FUNÇÃO (item 43) e o
// tom de voz do estado vazio (item 45: o vazio convida à ação, não acusa).

const ICONE_TOM = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

// tone: info | success | warning | danger. danger fala como "alert" ao leitor
// de tela; os demais como "status" (não interrompem).
export function Alert({ children, tone = "info", title, onClose, className = "", ...props }) {
  const Icone = ICONE_TOM[tone] || Info;
  return (
    <div
      className={`ds-alert ds-alert--${tone} ${className}`.trim()}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <Icone className="ds-alert__icon" size={18} aria-hidden="true" />
      <div className="ds-alert__body">
        {title && <strong className="ds-alert__title">{title}</strong>}
        {children && <div className="ds-alert__text">{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="ds-alert__close" aria-label="Fechar aviso" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className = "", ...props }) {
  return (
    <div className={`ds-empty ${className}`.trim()} {...props}>
      {Icon && <span className="ds-empty__icon"><Icon size={26} aria-hidden="true" /></span>}
      {title && <strong className="ds-empty__title">{title}</strong>}
      {description && <p className="ds-empty__text">{description}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  );
}

// Spinner é o "Loading" do catálogo. Com label acessível; se `inline`, não ocupa
// bloco inteiro.
export function Spinner({ size = 20, label = "Carregando…", inline = false, className = "" }) {
  return (
    <span className={`ds-spinner${inline ? " ds-spinner--inline" : ""} ${className}`.trim()} role="status">
      <Loader2 className="ds-spin" size={size} aria-hidden="true" />
      <span className="ds-visuallyhidden">{label}</span>
    </span>
  );
}

// Skeleton: placeholder do conteúdo enquanto carrega — some o "pulo" de layout.
// `lines` desenha várias barras de texto; senão, um bloco de width/height.
export function Skeleton({ width, height = 14, radius, lines = 0, className = "", style, ...props }) {
  if (lines > 0) {
    return (
      <span className={`ds-skeleton-lines ${className}`.trim()} aria-hidden="true" {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="ds-skeleton"
            style={{ height, width: i === lines - 1 ? "60%" : "100%", borderRadius: radius }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={`ds-skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
      {...props}
    />
  );
}
