import { useEffect } from "react";
import { destinoDoConviteLegado } from "../../routing/conviteLegado.js";

// Link antigo `?convite=CÓDIGO` → /convite/:token. A regra (e o porquê: a rota
// /api/collab/join não existe mais) mora em `routing/conviteLegado.js`.
export function useEntradaPorConvite() {
  useEffect(() => {
    const destino = destinoDoConviteLegado(location.search);
    if (destino) location.replace(destino);
  }, []);
}
