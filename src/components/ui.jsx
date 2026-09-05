import { ChevronDown, Plus, Sparkles } from "lucide-react";

// O mascote É a marca. Ele aparece aqui em cima, pequeno, e volta como avatar
// enquanto a IA pensa — é a mesma figura nos dois lugares de propósito: é assim
// que uma identidade visual se fixa.
export function Logo({ compact = false }) {
  return (
    <div className="logo">
      <img
        className="logo-mark-img"
        src="/mascote-96.png"
        alt="Seu Funcionário"
        width="36"
        height="36"
      />
      {!compact && (
        <span>
          Seu <strong>Funcionário</strong>
        </span>
      )}
    </div>
  );
}

export function Button({
  children,
  icon: Icon,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button type={type} className={`button ${variant} ${className}`} {...props}>
      {Icon && <Icon size={17} />}
      <span>{children}</span>
    </button>
  );
}

export function DynamicIcon({ icon: Icon, ...props }) {
  return Icon ? <Icon {...props} /> : null;
}

export function Empty({ icon: Icon = Sparkles, title, text, action, onAction }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <Button icon={Plus} onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function FilterSelect({
  "aria-label": ariaLabel,
  label,
  value,
  onChange,
  children,
}) {
  // `label` visível deixa claro o que cada filtro faz — sem ele os selects
  // viram uma fileira de "Todos/Todas" que não diz o que filtra (feedback da
  // titular no board de tarefas).
  return (
    <div className={`filter-select${label ? " filter-select--labeled" : ""}`}>
      {label && <span className="filter-select-label">{label}</span>}
      <div className="filter-select-control">
        <select aria-label={ariaLabel || label} value={value} onChange={onChange}>
          {children}
        </select>
        <ChevronDown />
      </div>
    </div>
  );
}

export const LIST_PAGE_SIZE = 30;

export function LoadMoreButton({ shown, total, onClick }) {
  if (shown >= total) return null;
  return (
    <div className="load-more">
      <Button variant="ghost" onClick={onClick}>
        Carregar mais ({total - shown} restantes)
      </Button>
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  text,
  action,
  children,
  className = "",
  headingLevel = "h1",
}) {
  const Heading = headingLevel;
  return (
    <>
      <div className={`page-title ${className}`.trim()}>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <Heading>{title}</Heading>
          <p>{text}</p>
        </div>
        {action}
      </div>
      {children}
    </>
  );
}
