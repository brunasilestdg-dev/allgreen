import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pilha de modais abertos. Com modais aninhados (um modal aberto de dentro de
// outro), só o do TOPO responde a Escape e ao trap de Tab — senão um único
// Escape fecha os dois de uma vez (perdendo edições não salvas do de baixo) e o
// trap do externo rouba o foco dos campos do interno. Para um modal só, ele é
// sempre o topo, então o comportamento não muda.
const modalStack = [];

export default function Modal({ title, children, onClose, wide = false }) {
  const modalRef = useRef(null);
  const triggerRef = useRef(
    typeof document !== "undefined" ? document.activeElement : null,
  );
  const idRef = useRef({});

  useEffect(() => {
    const token = idRef.current;
    modalStack.push(token);
    return () => {
      const i = modalStack.indexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const noTopo = () => modalStack[modalStack.length - 1] === idRef.current;
    const handleKeyDown = (event) => {
      if (!noTopo()) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", handleKeyDown);
    return () => removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const node = modalRef.current;
    const trigger = triggerRef.current;
    if (node && !node.contains(document.activeElement)) {
      const focusable = node.querySelector(FOCUSABLE_SELECTOR);
      (focusable || node).focus();
    }
    return () => {
      if (trigger?.focus) trigger.focus();
    };
  }, []);

  // Trava a rolagem do fundo enquanto o modal está aberto. Sem isso o conteúdo
  // atrás rola sob o modal (mouse/touch), dando sensação de descontrole em
  // telas longas. Restaura o valor anterior ao fechar.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <section
        ref={modalRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
