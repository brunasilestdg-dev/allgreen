// Uma rota pertence a uma única tela. Apelidos existem só para links antigos e
// são resolvidos antes da renderização, nunca por dois componentes concorrentes.
export const TODO_GREEN_ROUTE_ALIASES = Object.freeze({
  "central-trabalho": "espaco",
  "dashboard-esg": "esg",
  "relatorios-esg": "relatorios",
  "cofre-evidencias": "auditoria",
  contatos: "clientes",
  pipeline: "oportunidades",
  contratos: "propostas",
  simulacoes: "precificacao",
  aprovacoes: "deal-desk",
  alcada: "deal-desk",
  forecast: "receita",
  recebimento: "titulos",
  opex: "custos",
  margem: "custos",
  rentabilidade: "custos",
  fretes: "operacoes",
  rotas: "operacoes",
  viagens: "operacoes",
  veiculos: "motorista-frota",
  motoristas: "motorista-frota",
  dp: "dp-rh",
  escalas: "rh",
  campanhas: "marketing",
  entregas: "operacoes",
  pacotes: "operacoes",
  usuarios: "acessos",
  permissoes: "acessos",
  configuracoes: "acessos",
});

export const todoGreenRouteSegment = (path = "") =>
  String(path).replace(/^\/todogreen\/?/, "").split("?")[0].split("/")[0] || "dashboard";

export const todoGreenCanonicalPage = (path = "") => {
  const segment = todoGreenRouteSegment(path);
  return TODO_GREEN_ROUTE_ALIASES[segment] || segment;
};

export const assertUniqueRouteOwnership = (screens = []) => {
  const seen = new Map();
  for (const screen of screens) {
    const route = String(screen?.route || "");
    if (!route) throw new Error(`Tela ${screen?.id || "sem id"} sem rota canônica.`);
    if (seen.has(route))
      throw new Error(`A rota ${route} pertence a ${seen.get(route)} e ${screen?.id || "outra tela"}.`);
    seen.set(route, screen?.id || route);
  }
  return true;
};
