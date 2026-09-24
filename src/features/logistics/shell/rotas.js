// Rotas da vertical — JS puro, sem React: de qual página, produto e
// ferramenta o caminho fala, e como trocar de tela sem recarregar o app.
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import { todoGreenCanonicalPage } from "../todoGreenRouteOwnership.js";

export const todoGreenPath = () =>
  typeof window === "undefined"
    ? "/todogreen"
    : `${window.location.pathname}${window.location.search}`;

const sectionFromPath = (path) => {
  const slug = String(path || "")
    .replace(/^\/todogreen\/?/, "")
    .split("?")[0]
    .split("/")[0];
  return slug || "dashboard";
};

// O produto da precificação vem da ROTA (/todogreen/precificacao/<produto>),
// não de estado só do React. Assim voltar, avançar, atualizar a página e
// compartilhar o link levam ao mesmo produto — era isto que o módulo
// imperativo (removido) fingia fazer com clique sintético no card.
export const produtoDaRota = (path) => {
  const partes = String(path || "").replace(/^\/todogreen\/?/, "").split("?")[0].split("/");
  if (partes[0] !== "precificacao") return "";
  const id = partes[1] || "";
  return LOGISTICS_PRODUCTS.some((item) => item.id === id) ? id : "";
};



export const todoGreenRouteToPage = (path) => todoGreenCanonicalPage(path);

export const workspaceToolFromPath = (path = "") =>
  new URLSearchParams(String(path).split("?")[1] || "").get("ferramenta") || "visao-geral";

export const navigate = (route) => {
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const openFunctionPage = (route) => {
  if (typeof window === "undefined") return;
  window.open(route, "_blank", "noopener,noreferrer");
};
