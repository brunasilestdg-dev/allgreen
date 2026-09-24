import { useEffect } from "react";
import { entrarPorCodigoDeConvite } from "./authApi.js";
import { codigoDeConviteDaUrl } from "./authDomain.js";

// Link de convite com código (`/?convite=...`): assim que há uma pessoa logada,
// o código é trocado pela entrada no espaço compartilhado e some da URL (não
// pode ser reaproveitado ao recarregar nem vazar num print da barra).
export function useEntradaPorConvite(user, setToast) {
  useEffect(() => {
    if (!user) return;
    const code = codigoDeConviteDaUrl(location.search);
    if (!code) return;
    history.replaceState({}, "", location.pathname);
    entrarPorCodigoDeConvite(code)
      .then(({ data: d }) => {
        if (d && d.ownerId) setToast(`Você entrou no espaço de ${d.ownerName}`);
        else if (d && d.error) setToast(d.error);
      })
      .catch(() => {});
  }, [user, setToast]);
}
