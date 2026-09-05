import { Loader2 } from "lucide-react";

// ===== Button — hierarquia de verdade (item 8) =====
//
// A hierarquia vem de contraste/peso/posição, NUNCA de tamanho absurdo. Alturas
// consistentes (sm/md/lg). Um só componente para o produto inteiro — Salvar
// tem a mesma cara em qualquer módulo (item 50). Estados previstos: hover,
// pressed, focus, disabled, loading (item 8).
//
// variant: primary | secondary | tertiary | danger | ghost
// size:    sm | md | lg
export function Button({
  children,
  icon: Icon,
  iconRight: IconRight,
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  className = "",
  type = "button",
  disabled = false,
  ...props
}) {
  return (
    <button
      type={type}
      className={`ds-btn ds-btn--${variant} ds-btn--${size}${block ? " ds-btn--block" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      {...props}
    >
      {loading ? <Loader2 className="ds-spin" size={size === "sm" ? 15 : 17} aria-hidden="true" />
        : Icon ? <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" /> : null}
      {children != null && <span className="ds-btn__label">{children}</span>}
      {IconRight && !loading && <IconRight size={size === "sm" ? 15 : 17} aria-hidden="true" />}
    </button>
  );
}

// Ação compacta só-ícone (editar, excluir, duplicar) — precisa de aria-label.
export function IconButton({
  icon: Icon,
  label,
  variant = "ghost",
  size = "md",
  loading = false,
  className = "",
  type = "button",
  disabled = false,
  ...props
}) {
  return (
    <button
      type={type}
      className={`ds-iconbtn ds-iconbtn--${variant} ds-iconbtn--${size} ${className}`.trim()}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="ds-spin" size={size === "sm" ? 15 : 18} aria-hidden="true" />
        : Icon ? <Icon size={size === "sm" ? 15 : 18} aria-hidden="true" /> : null}
    </button>
  );
}
