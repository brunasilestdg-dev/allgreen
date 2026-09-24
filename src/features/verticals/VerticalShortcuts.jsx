import { useEffect, useState } from "react";
import { ArrowUpRight, BatteryCharging, CarFront, IdCard, Route, Truck } from "lucide-react";
import { destinosDoAcesso, todoGreenOwnerId } from "./verticalAccess.js";

const ICONES = {
  todogreen: Truck,
  greenon: BatteryCharging,
  greenmob: CarFront,
  "portal-motorista": Route,
  "portal-colaborador": IdCard,
};

// Trocar de ambiente é trocar de casca: navegação de página inteira, não
// `go()` interno.
const irPara = (rota) => window.location.assign(rota);

// Grupo "Ambientes" no menu lateral do app geral. Só aparece quando o
// servidor confirma um vínculo com a To Do Green; sem vínculo, sem sessão ou
// com a rede fora, não mostra nada — o menu fica exatamente como era.
// Botões (e não links) porque o menu inteiro é feito de botões: assim o
// atalho herda o mesmo estilo, inclusive no modo compacto.
export default function VerticalShortcuts({ authHeaders, collapsed = false, navigate = irPara }) {
  const [destinos, setDestinos] = useState([]);
  useEffect(() => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization) return undefined;
    let ativo = true;
    Promise.resolve()
      .then(() =>
        fetch(
          `/api/todogreen/access?owner=${encodeURIComponent(todoGreenOwnerId(globalThis.localStorage))}`,
          { headers },
        ),
      )
      .then((resposta) => (resposta?.ok ? resposta.json() : null))
      .then((payload) => {
        if (ativo) setDestinos(destinosDoAcesso(payload));
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [authHeaders]);
  if (!destinos.length) return null;
  return (
    <div className="nav-group nav-ambientes" role="group" aria-label="Outros ambientes">
      {!collapsed && <span className="nav-group-label">AMBIENTES</span>}
      {destinos.map((destino) => {
        const Icone = ICONES[destino.id] || ArrowUpRight;
        return (
          <button
            key={destino.id}
            type="button"
            title={collapsed ? destino.name : destino.subtitle}
            onClick={() => navigate(destino.route)}
          >
            <Icone />
            <span>{destino.name}</span>
          </button>
        );
      })}
    </div>
  );
}
