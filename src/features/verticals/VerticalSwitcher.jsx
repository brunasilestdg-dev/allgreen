import { ChevronRight } from "lucide-react";
import { Badge } from "../../design-system/index.js";
import { VERTICAIS, rotuloStatus } from "./verticalsCatalog.js";
import "./verticalSwitcher.css";

// Trocador compacto entre as três verticais. Cabe no rodapé de qualquer
// shell ou como grid num painel de home. NÃO substitui a navegação interna
// de cada vertical — só ajuda quem precisa saltar entre To Do Green, Green
// On e Greenmob quando esse mesmo cliente/veículo aparece nas três.
export default function VerticalSwitcher({ current = "", compact = false }) {
  return (
    <nav
      className={`verticais-switcher ${compact ? "is-compact" : ""}`}
      aria-label="Trocar de vertical"
    >
      {VERTICAIS.map((vertical) => {
        const isCurrent = vertical.id === current;
        return (
          <a
            key={vertical.id}
            href={vertical.route}
            className={`verticais-item ${isCurrent ? "is-current" : ""}`}
            aria-current={isCurrent ? "page" : undefined}
          >
            <div className="verticais-item-head">
              <strong>{vertical.name}</strong>
              <Badge>{rotuloStatus(vertical.status)}</Badge>
            </div>
            {!compact && (
              <>
                <p className="verticais-item-subtitle">{vertical.subtitle}</p>
                <ul className="verticais-item-modules">
                  {vertical.modules.slice(0, 4).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
            <span className="verticais-item-cta">
              {isCurrent ? "Você está aqui" : "Abrir"}
              {!isCurrent && <ChevronRight size={14} aria-hidden="true" />}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
