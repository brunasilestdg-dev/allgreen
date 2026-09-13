import { useId } from "react";

// ===== Tooltip — dica curta no hover/foco (item 42/50) =====
//
// Puramente CSS para aparecer (sem timer, sem JS de posição), mas acessível: a
// dica é ligada ao gatilho por aria-describedby, então o leitor de tela também a
// anuncia — e aparece no foco do teclado, não só no mouse.
//
// Envolve um único filho (o gatilho). side: top | bottom | left | right.
export function Tooltip({ label, children, side = "top", className = "" }) {
  const id = useId();
  return (
    <span className={`ds-tooltip ds-tooltip--${side} ${className}`.trim()}>
      <span className="ds-tooltip__trigger" aria-describedby={id}>
        {children}
      </span>
      <span className="ds-tooltip__bubble" role="tooltip" id={id}>
        {label}
      </span>
    </span>
  );
}
