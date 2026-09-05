import { useId } from "react";

// ===== Campos de formulário padronizados (item 11/12) =====
//
// Altura, padding, raio, foco e mensagens iguais em todo lugar. A cor só entra
// com função (foco, erro) — não é verde em toda borda (item 11). Label sempre
// ligada ao controle; erro e dica com aria correto (item 42).

export function Field({ label, hint, error, required, htmlFor, children, className = "" }) {
  return (
    <div className={`ds-field${error ? " ds-field--error" : ""} ${className}`.trim()}>
      {label && (
        <label className="ds-field__label" htmlFor={htmlFor}>
          {label}{required && <span className="ds-field__req" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {error ? <small className="ds-field__error" role="alert">{error}</small>
        : hint ? <small className="ds-field__hint">{hint}</small> : null}
    </div>
  );
}

// Input com label opcional embutida (uso rápido) — para casos compostos, use
// <Field> em volta de <Input bare>.
export function Input({ label, hint, error, required, size = "md", className = "", id, ...props }) {
  const auto = useId();
  const inputId = id || auto;
  const control = (
    <input
      id={inputId}
      className={`ds-input ds-input--${size} ${label ? "" : className}`.trim()}
      aria-invalid={error ? "true" : undefined}
      {...props}
    />
  );
  if (!label && !hint && !error) return control;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={className}>
      {control}
    </Field>
  );
}

export function Textarea({ label, hint, error, required, rows = 4, className = "", id, ...props }) {
  const auto = useId();
  const inputId = id || auto;
  const control = (
    <textarea
      id={inputId}
      rows={rows}
      className={`ds-input ds-textarea ${label ? "" : className}`.trim()}
      aria-invalid={error ? "true" : undefined}
      {...props}
    />
  );
  if (!label && !hint && !error) return control;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={className}>
      {control}
    </Field>
  );
}
