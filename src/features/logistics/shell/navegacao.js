// Navegação da vertical — JS puro, sem React: as áreas do menu, a área dona
// de cada cadastro, as ferramentas de Configurações, a permissão de cada tela
// e a trilha. Menu, trilha e rota leem a MESMA configuração.
import { hasTodoGreenPermission } from "../logisticsVerticalDomain.js";
import { MODULE_IMPLEMENTATION } from "./catalogoDeModulos.js";

// A taxonomia de áreas é a da titular (mensagem de 30/08): cada área da
// empresa na frente e, dentro dela, as funcionalidades. Nenhuma página saiu —
// só mudou de estante. Áreas pedidas sem tela própria moram na mais próxima:
// Cultura Organizacional → Recursos Humanos; Melhoria Contínua → Qualidade;
// Notícias → Workspace (hub de notícias e inteligência).
export const PRIMARY_NAVIGATION = Object.freeze([
  // Principal primeiro (pedido da titular): o painel abre a vertical. Depois o
  // Espaço de trabalho (a mesa: planner, projetos, implantações) e o Comercial
  // (CRM, pipeline, propostas) — o dia a dia comercial. "Espaço de trabalho",
  // nunca "Workspace" (rotulosNaoBanidos). `jornadasInternas`: o menu não
  // repete o que o Espaço já mostra dentro.
  { id: "principal", label: "Principal", route: "/todogreen/dashboard", pages: ["dashboard"] },
  // Área dedicada às 11 telas do roadmap All Green (rodadas de 14/09). A
  // titular pediu para agrupar tudo o que foi construído aqui embaixo do
  // "Green Tech Core" — assim as telas ficam num único menu visível no topo,
  // sem depender de expandir os grupos antigos (Administração, Operação…).
  { id: "green-tech-core", label: "Green Tech Core", route: "/todogreen/core-grupo", pages: ["core-grupo", "tenant-acessos", "green-on-empresa", "roaming-ocpi", "energia-peak", "fila-alertas", "greenmob-locacao", "saas-billing", "ocpp-console", "green-on-app", "seguranca-fisica"] },
  { id: "espaco-trabalho", label: "Espaço de trabalho", route: "/todogreen/espaco", pages: ["espaco", "central-trabalho", "visualizacoes", "agentes-funcoes", "avancos", "planner", "implantacao", "solicitacoes"], jornadasInternas: ["central-trabalho", "visualizacoes", "agentes-funcoes"] },
  // Notícias e inteligência (RFQs/RFIs, notícias, LinkedIn e decisores) é
  // inteligência comercial — mora em Comercial (decisão da titular, 05/09),
  // como atalho para a ferramenta do Espaço.
  { id: "commercial", label: "Comercial", route: "/todogreen/painel-comercial", pages: ["painel-comercial", "clientes", "oportunidades", "funil", "precificacao", "aceite-viagens", "regua", "propostas", "central-rfq", "deal-desk", "marketing", "metas", "performance-comercial", "playbook-comercial"], extras: [["Cadastro · Tabelas de preço", "/todogreen/cadastros?secao=priceTables"]] },
  // Planejamento decide o que entra; Operação executa o que foi aceito. Antes
  // as duas coisas moravam na mesma área e "Planejamento" aparecia dentro de
  // Operação enquanto uma OUTRA aba chamada Planejamento (que era, na verdade,
  // indicadores) existia no menu. Um nome, um lugar.
  { id: "operations", label: "Operação", route: "/todogreen/operacoes", pages: ["operacoes", "ordens-servico", "ocorrencias", "roteirizacao", "pontos-recarga", "sessoes-recarga", "reservas-recarga"], extras: [["Cadastro · Bases e unidades", "/todogreen/cadastros?secao=operationalUnits"], ["Cadastro · Rotas padrão", "/todogreen/cadastros?secao=routes"]] },
  { id: "planejamento", label: "Planejamento", route: "/todogreen/planejamento", pages: ["planejamento"] },
  { id: "esg", label: "ESG", route: "/todogreen/central-esg", pages: ["central-esg", "esg", "energia", "metodologia"] },
  { id: "estudio", label: "Estúdio", route: "/todogreen/estudio-criativo", pages: ["estudio-criativo", "midia", "editor-codigo", "analise-texto", "mapa-ideias"] },
  { id: "compliance", label: "Compliance", route: "/todogreen/auditoria", pages: ["auditoria", "fiscal", "manual", "fluxos"] },
  // Cada seção da Central Jurídica vira um sub-item da sidebar; o LegalHub
  // lê `?aba=xxx` para abrir na seção certa. Sem estes `extras`, o Jurídico
  // aparecia como um item só e todo o conteúdo ficava numa tela — a titular
  // pediu "a listinha da central" como o resto do ERP tem.
  {
    id: "juridico",
    label: "Jurídico",
    route: "/todogreen/juridico?aba=dashboard",
    pages: ["juridico"],
    extras: [
      ["Solicitar", "/todogreen/juridico?aba=solicitar"],
      ["Minhas solicitações", "/todogreen/juridico?aba=minhas"],
      ["Fila", "/todogreen/juridico?aba=demandas"],
      ["Contratos", "/todogreen/juridico?aba=contratos"],
      ["Processos", "/todogreen/juridico?aba=processos"],
      ["Procurações", "/todogreen/juridico?aba=procuracoes"],
      ["Prazos", "/todogreen/juridico?aba=prazos"],
      ["Escritórios", "/todogreen/juridico?aba=escritorios"],
      ["Honorários", "/todogreen/juridico?aba=honorarios"],
      ["Compliance", "/todogreen/juridico?aba=compliance"],
      ["Modelos", "/todogreen/juridico?aba=modelos"],
      ["IA jurídica", "/todogreen/juridico?aba=ia"],
      ["Busca", "/todogreen/juridico?aba=busca"],
      ["Relatórios", "/todogreen/juridico?aba=relatorios"],
    ],
  },
  { id: "indicadores", label: "Indicadores", route: "/todogreen/indicadores", pages: ["indicadores", "dashboards", "relatorios"] },
  // Cada cadastro mora na área dona do dado (atalhos "Cadastro · ..." no
  // segundo nível): materiais/depósitos/fornecedores em Compras, contas no
  // Financeiro, veículos/motoristas na Frota, colaboradores no DP, tabelas
  // de preço no Comercial, bases/rotas na Operação. A página completa
  // continua em Administração como o "ver tudo".
  { id: "suprimentos", label: "Compras", route: "/todogreen/compras", pages: ["compras", "estoque"], extras: [["Cadastro · Materiais", "/todogreen/cadastros?secao=items"], ["Cadastro · Depósitos", "/todogreen/cadastros?secao=warehouses"], ["Cadastro · Fornecedores e parceiros", "/todogreen/cadastros?secao=parties"]] },
  { id: "frota", label: "Frota", route: "/todogreen/motorista-frota", pages: ["motorista-frota", "ciot"], extras: [["Cadastro · Veículos", "/todogreen/cadastros?secao=vehicles"], ["Cadastro · Motoristas", "/todogreen/cadastros?secao=drivers"]] },
  { id: "qualidade", label: "Qualidade", route: "/todogreen/qualidade", pages: ["qualidade"] },
  { id: "finance", label: "Financeiro", route: "/todogreen/faturamento", pages: ["faturamento", "titulos", "rateios", "receita", "custos", "comissoes", "tesouraria", "greenpay", "cobranca-recarga"], extras: [["Cadastro · Centros de custo", "/todogreen/cadastros?secao=costCenters"], ["Cadastro · Plano de contas", "/todogreen/cadastros?secao=accounts"], ["Cadastro · Contas bancárias", "/todogreen/cadastros?secao=bankAccounts"]] },
  { id: "dp", label: "Departamento Pessoal", route: "/todogreen/dp-rh", pages: ["dp-rh"], extras: [["Cadastro · Colaboradores", "/todogreen/cadastros?secao=employees"]] },
  { id: "rh", label: "Recursos Humanos", route: "/todogreen/rh", pages: ["rh"] },
  { id: "products", label: "Produtos", route: "/todogreen/produtos", pages: ["produtos", "motor-operacao"] },
  { id: "documentos", label: "Documentos", route: "/todogreen/documentos", pages: ["documentos"] },
  // A matriz RASCI é artefato de governança: mora só aqui, não repetida em cada
  // área nem no menu de Compliance (pedido da titular).
  // Integrações e "Usuários e acessos" vivem no menu Configurações (topo), o
  // lar convencional das configurações — não repetimos aqui na lateral.
  { id: "administracao", label: "Administração", route: "/todogreen/administracao", pages: ["administracao", "rasci", "sobre-o-negocio", "saude-sistema"], extras: [["Cadastro · Dados da empresa", "/todogreen/cadastros?secao=companyProfiles"]] },
]);

// Cada cadastro no galho da sua área (regra da titular). O atalho já nascia na
// área certa, mas abrir "Cadastro · Veículos" jogava a pessoa em Administração
// › Cadastros com as sete abas de todas as áreas na cara — e um segundo clique
// em outro cadastro não trocava de seção. Este mapa devolve a área dona da
// seção: o menu fica onde estava, a trilha diz de onde é e a tela abre só os
// cadastros daquela área.
export const AREA_DO_CADASTRO = Object.freeze({
  operationalUnits: "operations",
  routes: "operations",
  priceTables: "commercial",
  items: "suprimentos",
  warehouses: "suprimentos",
  parties: "suprimentos",
  vehicles: "frota",
  drivers: "frota",
  costCenters: "finance",
  accounts: "finance",
  bankAccounts: "finance",
  employees: "dp",
  companyProfiles: "administracao",
});

export const secaoDaRota = (rota = "") => {
  try {
    return new URLSearchParams(String(rota).split("?")[1] || "").get("secao") || "";
  } catch {
    return "";
  }
};

export const MANAGEMENT_TOOLS = Object.freeze([
  {
    id: "projects",
    label: "Projetos e tarefas",
    title: "Projetos e tarefas",
    description: "Quadros, responsáveis, prazos, automações e acompanhamento das entregas da To Do Green.",
    route: "/todogreen/central-trabalho",
    permission: "",
  },
  {
    id: "integracoes",
    label: "Integrações",
    title: MODULE_IMPLEMENTATION.integracoes.title,
    description: MODULE_IMPLEMENTATION.integracoes.description,
    route: "/todogreen/integracoes",
    permission: "integration:manage",
  },
  {
    id: "conectores",
    label: "Conectores",
    title: MODULE_IMPLEMENTATION.conectores.title,
    description: MODULE_IMPLEMENTATION.conectores.description,
    route: "/todogreen/conectores",
    permission: "integration:manage",
  },
  {
    id: "acessos",
    label: "Usuários e acessos",
    title: "Usuários e acessos",
    description: MODULE_IMPLEMENTATION.acessos.description,
    route: "/todogreen/acessos",
    permission: "access:manage",
  },
]);

export const navigationModules = (ids = []) => {
  const seenRoutes = new Set();
  return ids
    .map((id) => [id, MODULE_IMPLEMENTATION[id]])
    .filter(([, module]) => {
      if (!module?.route || seenRoutes.has(module.route)) return false;
      seenRoutes.add(module.route);
      return true;
    });
};

export const navigationFor = (page, secao = "") => {
  if (page === "cadastros") {
    const area = PRIMARY_NAVIGATION.find((item) => item.id === AREA_DO_CADASTRO[secao]);
    if (area) return area;
  }
  return PRIMARY_NAVIGATION.find((item) => item.pages.includes(page)) || PRIMARY_NAVIGATION[0];
};

// A permissão de uma tela sai do MESMO config que o menu usa para escondê-la.
// Sem isto, esconder o botão não protege a tela: quem digita a URL, volta no
// histórico ou atualiza a página passa direto pela filtragem do menu e o
// conteúdo restrito renderiza assim mesmo. A regra de quem entra é do papel,
// não da presença do botão.
export const permissaoDaPagina = (page) => {
  const ferramenta = MANAGEMENT_TOOLS.find((item) => item.id === page);
  if (ferramenta) return ferramenta.permission || "";
  return MODULE_IMPLEMENTATION[page]?.permission || "";
};

// Uma tela pode servir a mais de uma área. Neste catálogo, lista significa
// alternativas (qualquer uma libera), e não a exigência cumulativa usada em
// operações críticas do domínio.
export const podeAcessarFuncionalidade = (role, permissions, required) => {
  if (!required || (Array.isArray(required) && required.length === 0)) return true;
  const alternatives = Array.isArray(required) ? required : [required];
  return alternatives.some((permission) => hasTodoGreenPermission(role, permission, permissions));
};

// A trilha (breadcrumb) vem do mesmo config do menu: a área da navegação
// primária, a tela do módulo (ou da ferramenta de administração). Menu e trilha
// lendo a mesma fonte nunca discordam sobre onde a pessoa está.
export const trilhaDaPagina = (page, secao = "") => {
  // Área REAL da página (sem o fallback de navigationFor para o primeiro grupo):
  // ferramenta de Configurações (Integrações, Acessos) não pertence a um grupo
  // lateral, então sua trilha é só "Visão geral › <ferramenta>", sem área falsa.
  const area = page === "cadastros"
    ? PRIMARY_NAVIGATION.find((item) => item.id === AREA_DO_CADASTRO[secao])
    : PRIMARY_NAVIGATION.find((item) => item.pages.includes(page));
  const modulo = MODULE_IMPLEMENTATION[page];
  const ferramenta = MANAGEMENT_TOOLS.find((item) => item.id === page);
  const trilha = [{ label: "Visão geral", route: "/todogreen/dashboard" }];
  if (area && area.id !== "principal" && area.route)
    trilha.push({ label: area.label, route: area.route });
  const atual = modulo
    ? { label: modulo.navLabel, route: modulo.route }
    : ferramenta
      ? { label: ferramenta.label, route: ferramenta.route }
      : null;
  if (atual && atual.route !== trilha[trilha.length - 1].route)
    trilha.push(atual);
  return trilha;
};

// O nome que a aba já usa para cada tela. É ele que dá nome ao cartão: se a
// aba se chama "Operações", o cartão não pode se chamar "Rotas".
export const TITULOS_POR_TELA = Object.fromEntries(
  Object.values(MODULE_IMPLEMENTATION).map((item) => [item.route, item.navLabel]),
);

export function sidebarFunctionLabel(grupo) {
  return grupo.nome.replace(/\s+To Do Green$/i, "").trim();
}
