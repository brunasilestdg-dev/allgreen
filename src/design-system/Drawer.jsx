import { useEffect } from "react";
import { X } from "lucide-react";

// ===== Drawer — painel lateral (item 50) =====
//
// Para edição/contexto sem sair da tela: desliza de um lado, escurece o fundo,
// fecha no Esc e no clique fora. Complementa o Modal (centro) — o Drawer é para
// formulário lateral e detalhe, onde o contexto atrás precisa continuar visível.
//
// Controlado: `open` + `onClose`. side: right | left.
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = "right",
  width = 420,
  className = "",
}) {
  useEffect(() => {
    if (!open) return undefined;
    const aoTeclar = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ds-drawer" role="presentation">
      <div className="ds-drawer__backdrop" onClick={() => onClose?.()} aria-hidden="true" />
      <aside
        className={`ds-drawer__panel ds-drawer__panel--${side} ${className}`.trim()}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <header className="ds-drawer__head">
          {title && <h2 className="ds-drawer__title">{title}</h2>}
          <button type="button" className="ds-drawer__close" aria-label="Fechar" onClick={() => onClose?.()}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="ds-drawer__body">{children}</div>
        {footer && <footer className="ds-drawer__foot">{footer}</footer>}
      </aside>
    </div>
  );
}
