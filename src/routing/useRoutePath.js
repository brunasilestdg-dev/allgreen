import { useSyncExternalStore } from "react";

// O app inteiro decide QUAL portal montar lendo `window.location` durante o
// render — mas nada avisava o React quando a URL mudava sem recarregar a
// página. Quem navegava por `pushState` de dentro da vertical (o "Abrir Torre
// TMS" da tela inicial, por exemplo) trocava a URL e continuava vendo a tela
// anterior: só o F5 levava ao destino. Pior, a vertical seguia montada numa
// rota que não é dela.
//
// Aqui a rota vira assinatura de verdade. `popstate` cobre voltar/avançar do
// navegador E a navegação interna, porque quem usa `pushState` neste código
// dispara o evento logo em seguida (ver `navigate` em LogisticsVertical.jsx e
// TmsPortal.jsx). Não é um router novo: é a peça que faltava para o router que
// já existe (`resolvePrimaryRoute`) reagir.
const assinar = (aoMudar) => {
  window.addEventListener("popstate", aoMudar);
  window.addEventListener("hashchange", aoMudar);
  return () => {
    window.removeEventListener("popstate", aoMudar);
    window.removeEventListener("hashchange", aoMudar);
  };
};

// Só o caminho: a busca (?ferramenta=, ?client=) é assunto de cada tela, que já
// ouve `popstate` por conta própria. Assinar a query aqui re-renderizaria o app
// inteiro a cada filtro trocado, sem trocar de portal.
const caminhoAtual = () => (typeof window === "undefined" ? "/" : window.location.pathname || "/");
const caminhoNoServidor = () => "/";

export function useRoutePath() {
  return useSyncExternalStore(assinar, caminhoAtual, caminhoNoServidor);
}

export default useRoutePath;
