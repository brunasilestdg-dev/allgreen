import { useEffect } from "react";
import { codigoDeConviteDaUrl } from "./authDomain.js";

// Link antigo no formato `?convite=CÓDIGO`. Ele chamava /api/collab/join,
// rota que não existe mais (o Worker respondia 404 "Ação não encontrada").
// O convite hoje vive em /convite/:token (AcceptInvite), que valida o token
// e serve quem tem ou não tem conta — então o link antigo só é redirecionado.
export function useEntradaPorConvite() {
  useEffect(() => {
    const codigo = codigoDeConviteDaUrl(location.search);
    if (codigo) location.replace(`/convite/${encodeURIComponent(codigo)}`);
  }, []);
}
