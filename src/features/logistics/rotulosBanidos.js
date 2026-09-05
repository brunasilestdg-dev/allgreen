// Polimento de rótulos da To Do Green como função PURA (#117).
//
// Antes esta lógica vivia dentro de LogisticsVerticalPolish.js — um módulo que
// varria o DOM com um MutationObserver para trocar palavras internas ("vertical",
// "tenant", "workspace", "card"...) por linguagem de produto. Esse apagador de
// DOM deixou de ser carregado em produção (não está no main.jsx) e foi
// removido; o que sobrou de útil — e testado — é só a troca de texto, que fica
// aqui, sem tocar no DOM.
//
// O teste `rotulosNaoBanidos.test.js` usa isto para garantir que nenhum rótulo
// de menu contém palavra banida — foi assim que o primeiro botão do menu ficou
// com fundo e sem nome (o grupo se chamava "Workspace", palavra banida, e o
// apagador a removia de todo texto).

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

// As trocas de UMA palavra respeitam fronteira de palavra. Sem isso a troca
// "funcional" → "ativo" comia o MIOLO de "funcionalidade" e a tela de acessos
// pedia para "selecionar cada ativoidade". E "todogreen" → "To Do Green"
// quebrava e-mail ou domínio (@To Do Green.com.br), por isso não troca quando
// vem seguido de ponto, @ ou hífen.
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
