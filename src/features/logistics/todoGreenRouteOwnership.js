// Uma rota pertence a uma única tela. Apelidos existem só para links antigos e
// são resolvidos antes da renderização, nunca por dois componentes concorrentes.
export const TODO_GREEN_ROUTE_ALIASES = Object.freeze({
  comercial: "clientes",
  "central-trabalho": "espaco",
  "dashboard-esg": "esg",
  // Os quatro cards de ESG colapsaram na Central ESG (uma fonte de verdade).
  // Links antigos continuam resolvendo para lá em vez de 404.
  "green-score": "central-esg",
  "calculadora-ambiental": "central-esg",
  "tradutor-esg": "central-esg",
  "escopo-3": "central-esg",
  "relatorios-esg": "relatorios",
  "cofre-evidencias": "auditoria",
  certificados: "relatorios",
  contatos: "clientes",
  pipeline: "oportunidades",
  contratos: "propostas",
  simulacoes: "precificacao",
  "parametros-simulador": "regua",
  aprovacoes: "deal-desk",
  alcada: "deal-desk",
  remuneracao: "comissoes",
  forecast: "receita",
  recebimento: "titulos",
  opex: "custos",
  "centros-custo": "rateios",
  margem: "custos",
  rentabilidade: "custos",
  "produtos-logisticos": "produtos",
  "catalogo-produtos": "produtos",
  fretes: "operacoes",
  rotas: "operacoes",
  viagens: "operacoes",
  veiculos: "motorista-frota",
  // A rota antiga de rastreamento não expõe mais a tela do fornecedor.
  // Telemetria continua no backend e a operação consulta frota/posição na experiência própria.
  rastreamento: "motorista-frota",
  motoristas: "motorista-frota",
  dp: "dp-rh",
  escalas: "rh",
  campanhas: "marketing",
  entregas: "operacoes",
  pacotes: "operacoes",
  ocupacao: "dashboard",
  produtividade: "dashboard",
  tarefas: "dashboard",
  notificacoes: "dashboard",
  inbox: "dashboard",
  exportacoes: "relatorios",
  usuarios: "acessos",
  permissoes: "acessos",
  configuracoes: "acessos",
  agentes: "agentes-funcoes",
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
