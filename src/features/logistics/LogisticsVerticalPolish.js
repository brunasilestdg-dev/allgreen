import "./LogisticsVerticalAccess.css";
import "./LogisticsVerticalEnterprise.css";

const LABELS = new Map([
  ["VERTICAL PRIVADA · To Do Green", "TO DO GREEN"],
  ["VERTICAL PRIVADA · TO DO GREEN", "TO DO GREEN"],
  ["PORTAL TO DO GREEN", "TO DO GREEN"],
  ["Portal To Do Green", "To Do Green"],
  ["Vertical To Do Green protegida", "Acesso restrito"],
  ["Acesso restrito à To Do Green", "Acesso restrito"],
  ["Esta área só abre para usuários vinculados ao workspace da To Do Green ou com permissão individual ativa. Entrar pela URL não concede acesso.", "Entre com uma conta autorizada para acessar as rotinas da To Do Green."],
  ["Este ambiente é exclusivo para usuários autorizados da To Do Green. O acesso é liberado por convite, e-mail corporativo ou permissão individual ativa.", "Entre com uma conta autorizada para acessar as rotinas da To Do Green."],
  ["Usuário atual", "Conta"],
  ["Tenant", "Empresa"],
  ["Ambiente", "Empresa"],
  ["todogreen", "To Do Green"],
  ["Central To Do Green", "Painel de Gerenciamento"],
  ["Painel operacional", "Painel de Gerenciamento"],
  ["Logística sustentável com preço, operação e ESG no mesmo painel.", "Painel de Gerenciamento"],
  ["Operação, pricing, ESG, pipeline e governança em uma experiência privada e objetiva.", "Visibilidade comercial e estratégica sobre clientes, oportunidades, preços, resultados, operação e indicadores ambientais."],
  ["A vertical agora separa módulos funcionais de backlog. Card sem fluxo real não aparece como pronto.", "Visibilidade comercial e estratégica sobre clientes, oportunidades, preços, resultados, operação e indicadores ambientais."],
  ["funções privadas com acesso controlado", "rotinas ativas"],
  ["módulos por tenant, com rota e permissão", "rotinas ativas"],
  ["módulos por tenant", "rotinas"],
  ["módulos", "rotinas"],
  ["Módulos", "Rotinas"],
  ["funcionais", "ativas"],
  ["funcional", "ativo"],
  ["backlog", "planejado"],
  ["Backlog", "Planejado"],
  ["Card sem fluxo real", "Item sem rotina liberada"],
  ["Visão real da vertical, sem card falso.", "Painel de Gerenciamento"],
  ["Indicadores da operação", "Painel de Gerenciamento"],
  ["Os indicadores abaixo são calculados a partir de clientes, oportunidades, simulações, receitas, custos e operações cadastradas.", "Uma visão consolidada para acompanhamento comercial e estratégico, sem substituir a gestão das áreas responsáveis."],
  ["Nenhum indicador real carregado ainda.", "Nenhum registro cadastrado ainda."],
  ["O painel não usa receita, cliente ou operação inventada como produção. Cadastre a primeira simulação ou ative o modo demonstração explicitamente.", "Cadastre clientes, simulações ou operações para alimentar os indicadores."],
  ["SEM DADOS FICTÍCIOS", "SEM REGISTROS"],
  ["Criar primeira simulação", "Criar simulação"],
  ["Produtos logísticos", "Produtos"],
  ["PRODUTOS LOGÍSTICOS", "PORTFÓLIO"],
  ["Calculadoras reais disponíveis", "Produtos e modelos de preço"],
  ["Produtos disponíveis", "Produtos e modelos de preço"],
  ["Abrir precificação", "Calcular preço"],
  ["Produto logístico customizado", "Projeto customizado"],
  ["Projeto logístico personalizado", "Projeto customizado"],
  ["Transferência entre CDs, hubs ou lojas", "Transferência entre CDs"],
  ["Receita, forecast e faturamento", "Receita e forecast"],
  ["Custos, OPEX e margem", "Custos e margem"],
  ["ESG, Green Score e Escopo 3", "ESG e Green Score"],
  ["Operação a granel", "Granel"],
  ["Distribuição fracionada", "Fracionado"],
  ["Abastecimento de lojas", "Abastecimento"],
  ["Coleta em fornecedores", "Coletas"],
  ["Operação dedicada", "Dedicada"],
  ["Calculadora Ambiental", "Cálculo ambiental"],
  ["Dashboard ESG", "Painel ESG"],
  ["Relatórios ESG", "Relatórios"],
  ["Certificados e declarações", "Declarações"],
  ["Remuneração Variável", "Comissões"],
  ["Oportunidades e pipeline", "Oportunidades"],
  ["Propostas e contratos", "Propostas"],
  ["Precificação e aprovação comercial", "Precificação"],
  ["Receita e forecast", "Receita"],
  ["Custos e margem", "Custos"],
  ["Auditoria e governança", "Auditoria"],
  ["Metodologia e premissas", "Metodologia"],
  ["Cockpit executivo", "Painel"],
  ["COCKPIT EXECUTIVO", "PAINEL"],
  ["CRM enxuto para grandes contas sustentáveis", "Cadastro de clientes"],
  ["Oportunidades com produto, valor, estágio e probabilidade", "Oportunidades comerciais"],
  ["Proposta comercial com preço, operação e ROI ambiental", "Propostas"],
  ["PRECIFICAÇÃO LOGÍSTICA", "PRECIFICAÇÃO"],
  ["Logística sustentável", "Operação"],
  ["sustentável", ""],
  ["Sustentável", ""],
  ["Ver itens planejados desta área", "Ver próximos itens"],
  ["Planejado. Ainda não liberado como função.", "Em implantação."],
  ["Planejado. Ainda não liberado.", "Em implantação."],
  ["Backlog mapeado; ainda não exibido como funcional.", "Em implantação."],
  ["Abrir módulo", "Abrir rotina"],
]);

export const BLOCKED_PATTERNS = [
  /\bvertical\b/gi,
  /\btenant\b/gi,
  /\bworkspace\b/gi,
  /\btudo em um só lugar\b/gi,
  /\bexperiência privada\b/gi,
  /\bproduto pronto\b/gi,
  /\bsem card falso\b/gi,
  /\bcard falso\b/gi,
  /\bcard\b/gi,
  /\bmódulo funcional\b/gi,
];

const ROUTINES = [
  {
    title: "Painel",
    route: "/todogreen/dashboard",
    score: "8.4",
    text: "Indicadores, pendências, risco comercial e leitura diária da operação.",
    subs: ["KPIs", "Pendências", "Alertas", "Prioridades"],
  },
  {
    title: "CRM",
    route: "/todogreen/clientes",
    score: "8.6",
    text: "Contas enterprise com decisores, dores, histórico, oportunidades e próximos passos.",
    subs: ["Contas", "Contatos", "Histórico", "Próximas ações"],
  },
  {
    title: "Oportunidades",
    route: "/todogreen/oportunidades",
    score: "8.2",
    text: "Pipeline por produto, etapa, valor, probabilidade, urgência e risco.",
    subs: ["Pipeline", "Forecast", "Prioridade", "Follow-up"],
  },
  {
    title: "Precificação",
    route: "/todogreen/precificacao",
    score: "8.5",
    text: "Custo, margem, preço mínimo, preço recomendado e aprovação comercial.",
    subs: ["Produtos", "Margem", "Aprovações", "Simulações"],
  },
  {
    title: "Propostas",
    route: "/todogreen/propostas",
    score: "8.1",
    text: "Serviços incluídos, condições, informações do cálculo, impacto ambiental e status da negociação.",
    subs: ["Versões", "Condições", "Aprovação", "Status"],
  },
  {
    title: "Operações",
    route: "/todogreen/operacoes",
    score: "8.1",
    text: "Rotas, viagens, frota, entregas, ocupação, energia e ocorrências.",
    subs: ["Rotas", "Viagens", "Frota", "Ocorrências"],
  },
  {
    title: "Financeiro",
    route: "/todogreen/receita",
    score: "8.0",
    text: "Receita, custos, margem, forecast, faturamento e rentabilidade.",
    subs: ["Receita", "Custos", "Margem", "Forecast"],
  },
  {
    title: "ESG",
    route: "/todogreen/esg",
    score: "8.3",
    text: "CO₂ evitado, Green Score, emissões da cadeia logística, método de cálculo e documentos.",
    subs: ["Green Score", "Emissões", "Documentos", "Relatórios"],
  },
];

const CRM_FIELDS = [
  ["Conta", "perfil, segmento, potencial e prioridade"],
  ["Decisores", "compras, operação, ESG e financeiro"],
  ["Histórico", "reuniões, follow-ups, objeções e documentos"],
  ["Inteligência", "dor logística, risco, fit e próxima ação"],
];

// O polimento como função PURA, exportada para o teste que impede o apagador
// de comer rótulo de menu: foi exatamente assim que o primeiro botão do menu
// ficou com fundo e sem nome — o grupo se chamava "Workspace", palavra banida
// aqui dentro, e o apagador a removia de todo texto da vertical.
// As trocas de UMA palavra respeitam fronteira de palavra. Sem isso a troca
// "funcional" → "ativo" comia o MIOLO de "funcionalidade" e a tela de acessos
// pedia para "selecionar cada ativoidade" (defeito apontado pela titular,
// 31/08). E "todogreen" → "To Do Green" quebrava qualquer e-mail ou domínio
// (@To Do Green.com.br), por isso não troca quando vem seguido de ponto.
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TROCAS = [...LABELS.entries()].map(([from, to]) => ({
  regex: /\s/.test(from)
    ? new RegExp(escapar(from), "g")
    : new RegExp(`\\b${escapar(from)}\\b(?![.@-])`, "g"),
  to,
}));

export const polirTexto = (original) => {
  let next = original;
  for (const { regex, to } of TROCAS) {
    regex.lastIndex = 0;
    next = next.replace(regex, to);
  }
  BLOCKED_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "").replace(/\s{2,}/g, " ");
  });
  return next
    .replace(/ · planejado$/i, "")
    .replace(/ · ativo$/i, "")
    .replace(/\s+([,.])/g, "$1");
};

const replaceTextNode = (node) => {
  const original = node.nodeValue;
  if (!original) return;
  let next = polirTexto(original);
  // Só apara o começo quando este é o primeiro nó do elemento. O React quebra
  // `{40} funcionais · {13} backlog` em nós separados — "40", " funcionais · ",
  // "13", " backlog" — e aparar o começo de cada um colava as palavras nos
  // números: "40ativas · 13planejado". O espaço aqui é conteúdo, não sobra.
  if (!node.previousSibling) next = next.trimStart();
  if (next !== original) node.nodeValue = next;
};

const walk = (root) => {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".tdg *").forEach((element) => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) replaceTextNode(node);
    }
  });
};

const openFunctionPage = (route) => {
  window.open(route, "_blank", "noopener,noreferrer");
};

const buildRoutineCard = (routine) => {
  const button = document.createElement("button");
  button.className = "tdg-routine-card";
  button.type = "button";
  button.setAttribute("aria-label", `Abrir ${routine.title}`);
  button.innerHTML = `
    <header><strong>${routine.title}</strong></header>
    <p>${routine.text}</p>
    <div class="tdg-routine-sub">${routine.subs.map((item) => `<span>${item}</span>`).join("")}</div>
  `;
  button.addEventListener("click", () => openFunctionPage(routine.route));
  return button;
};

const ensureRoutineMap = () => {
  const root = document.querySelector(".tdg");
  const hero = document.querySelector(".tdg-hero");
  const existing = document.querySelector(".tdg-routine-map");
  const isHome = /^\/todogreen\/?$/.test(window.location.pathname);
  if (!isHome) {
    existing?.remove();
    return;
  }
  if (!root || !hero || existing) return;

  const section = document.createElement("section");
  section.className = "tdg-routine-map";
  section.innerHTML = `
    <div class="tdg-routine-head">
      <div>
        <span class="tdg-kicker">ESCOLHA O QUE QUER FAZER</span>
        <h2>Áreas de trabalho da To Do Green</h2>
        <p>Abra a área que precisa usar agora.</p>
      </div>
    </div>
    <div class="tdg-routine-grid"></div>
  `;
  const grid = section.querySelector(".tdg-routine-grid");
  ROUTINES.forEach((routine) => grid.appendChild(buildRoutineCard(routine)));
  hero.insertAdjacentElement("afterend", section);
};

const ensureCrmUpgrade = () => {
  const clientPanel = [...document.querySelectorAll(".tdg-panel")].find((panel) =>
    panel.textContent.includes("CLIENTES E CONTATOS") || panel.textContent.includes("Cadastro de clientes"),
  );
  if (!clientPanel || clientPanel.querySelector(".tdg-crm-upgrade")) return;
  const box = document.createElement("div");
  box.className = "tdg-crm-upgrade";
  box.innerHTML = `
    <h3>CRM de contas enterprise</h3>
    <p>O cadastro de cliente passa a ser a base da venda: conta, decisores, dor logística, maturidade ESG, histórico, oportunidades e próxima ação. A referência não é formulário simples; é rotina comercial completa.</p>
    <div class="tdg-crm-grid">
      ${CRM_FIELDS.map(([title, text]) => `<span><small>${title}</small><strong>${text}</strong></span>`).join("")}
    </div>
  `;
  clientPanel.prepend(box);
};

const markSecondaryCatalog = () => {
  document.querySelectorAll(".tdg-section").forEach((section) => {
    if (section.classList.contains("tdg-routine-map")) return;
    section.setAttribute("data-tdg-catalog", "secondary");
  });
};

const markCards = () => {
  document.querySelectorAll(".tdg-module-card:not(.disabled), .tdg-product-card, .tdg-tabs button").forEach((button) => {
    button.setAttribute("data-tdg-clickable", "true");
    if (!button.getAttribute("aria-label")) {
      const label = button.textContent?.replace(/\s+/g, " ").trim();
      if (label) button.setAttribute("aria-label", `Abrir ${label}`);
    }
  });
};

const polishAccessScreen = () => {
  const denied = document.querySelector(".tdg-denied-card");
  if (!denied) return;
  denied.setAttribute("data-tdg-access", "private-portal");
  const terms = denied.querySelectorAll("dt, dd, h1, p, span");
  terms.forEach((element) => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) replaceTextNode(node);
    }
  });
};

const polish = () => {
  walk(document);
  markCards();
  ensureRoutineMap();
  ensureCrmUpgrade();
  markSecondaryCatalog();
  polishAccessScreen();
};

if (typeof window !== "undefined") {
  const start = () => {
    polish();
    const observer = new MutationObserver(() => polish());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
