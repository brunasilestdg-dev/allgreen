// ===== Plantû — assistente operacional da To Do Green =====
//
// Assistente operacional da vertical To Do Green.
//
// A parte pura: qual especialista atende cada tela, o que o Plantû sabe
// fazer, como ela se apresenta, e o corpo que vai para o servidor. Fica
// separada do componente porque é isso que dá para testar sem montar tela.
//
// O Plantû fala com /api/todogreen/semente — o endpoint da vertical que
// carrega a carteira real, as ferramentas de consulta ao CRM e as ações que
// ela pode propor. O rótulo de especialista continua vindo da tela, porque é
// assim que ela se apresenta; quem monta o contexto de verdade é o servidor.

export const SEMENTE = Object.freeze({
  nome: "Plantû",
  assinatura: "Assistente do ERP",
  lema: "Consultas, análises e ações do ERP.",
  saudacao:
    "Consulte contas, preço, frota, operação, financeiro, ESG, notícias e RFQs. Nada é gravado sem confirmação.",
});

// O que ela faz, na ordem em que a marca apresenta.
export const HABILIDADES = Object.freeze([
  "Contas",
  "Preço",
  "Frota",
  "Operação",
  "Financeiro",
  "Notícias/RFQs",
]);

// Cada tela tem um especialista que responde melhor por ela. O nome à direita
// precisa existir em todoGreenAiSpecialists.js — se não existir, o núcleo cai
// no Consultor genérico, que é exatamente o defeito que acabamos de corrigir.
export const ESPECIALISTA_POR_TELA = Object.freeze({
  clientes: "Especialista em Contas e Vendas",
  oportunidades: "Especialista em Contas e Vendas",
  propostas: "Especialista em Contas e Vendas",
  "performance-comercial": "Especialista em Contas e Vendas",

  precificacao: "Especialista em Precificação Logística",
  regua: "Especialista em Precificação Logística",
  custos: "Especialista em Precificação Logística",
  "deal-desk": "Especialista em Precificação Logística",

  esg: "Especialista ESG",
  "green-score": "Especialista ESG",
  "central-esg": "Especialista ESG",
  "calculadora-ambiental": "Especialista ESG",
  "tradutor-esg": "Especialista ESG",
  "escopo-3": "Especialista ESG",
  metodologia: "Especialista ESG",

  operacoes: "Especialista em Operações Logísticas",
  rastreamento: "Especialista em Operações Logísticas",
  solicitacoes: "Especialista em Operações Logísticas",

  receita: "Especialista Financeiro",
  comissoes: "Especialista Financeiro",

  documentos: "Especialista em Dados",
  auditoria: "Especialista em Dados",
  relatorios: "Especialista em Dados",
  dashboards: "Especialista em Dados",

  metas: "Especialista em Projetos",
});

// Sem tela conhecida, quem atende é o especialista operacional: é a porta de
// entrada do ERP quando o contexto ainda não aponta uma área.
export const especialistaDaTela = (pagina) =>
  ESPECIALISTA_POR_TELA[String(pagina || "").trim()] || "Especialista em Operações Logísticas";

// O que a pessoa provavelmente quer perguntar naquela tela. Existe para a
// Plantû não abrir com uma caixa de texto vazia — campo vazio é a forma mais
// rápida de alguém fechar e não voltar.
const ATALHOS_POR_ESPECIALISTA = Object.freeze({
  "Especialista em Contas e Vendas": [
    "O que está parado na minha carteira?",
    "Quais contas correm risco de perda?",
    "Quem cuida de compras nas minhas contas quentes?",
  ],
  "Especialista em Precificação Logística": [
    "Onde a margem está abaixo do piso?",
    "Este preço se sustenta? Abra a conta.",
    "Que dado falta para fechar esta simulação?",
  ],
  "Especialista ESG": [
    "O que sustenta o Green Score deste período?",
    "Onde falta evidência para o relatório do cliente?",
    "Quais contas têm sinal ESG na pesquisa externa?",
  ],
  "Especialista em Operações Logísticas": [
    "O que exige ação no ERP agora?",
    "Que rota está com ocupação abaixo do previsto?",
    "Onde há atraso ou ocorrência se repetindo?",
  ],
  "Especialista Financeiro": [
    "Qual contrato está abaixo da margem mínima?",
    "A receita está concentrada em poucos clientes?",
    "O que fugiu do padrão neste período?",
  ],
  "Especialista em Dados": [
    "Que registro está incompleto ou inconsistente?",
    "Quais contas estão sem contato com canal?",
    "Que número não se sustenta na evidência?",
  ],
  "Especialista em Projetos": [
    "O que está atrasado ou bloqueado?",
    "Que meta corre risco de não fechar?",
    "Qual o próximo passo com responsável e prazo?",
  ],
});

export const atalhosDaTela = (pagina) =>
  ATALHOS_POR_ESPECIALISTA[especialistaDaTela(pagina)] ||
  ATALHOS_POR_ESPECIALISTA["Especialista em Operações Logísticas"];

// ===== O corpo que vai para /api/todogreen/semente =====
//
// O servidor monta o contexto sozinho — carteira, ferramentas, permissões.
// Daqui vão só a pergunta, a tela (para o Plantû saber onde a pessoa está),
// o cliente em foco quando há um, e a conversa até aqui.

export const HISTORICO_MAXIMO = 8;

const PAPEL = { voce: "user", semente: "assistant" };

export const corpoDaPergunta = ({ pergunta, tela, clienteId, historico = [] } = {}) => {
  const texto = String(pergunta || "").trim();
  if (texto.length < 3) return { valido: false, corpo: null };
  const corpo = {
    pergunta: texto,
    tela: String(tela || "").trim() || undefined,
    clienteId: String(clienteId || "").trim() || undefined,
    historico: (Array.isArray(historico) ? historico : [])
      // Mensagem que falhou é aviso de erro na tela, não fala da assistente.
      // Reenviá-la ensinaria o modelo a imitar mensagem de erro.
      .filter((item) => item && !item.falhou && PAPEL[item.de] && typeof item.texto === "string")
      .map((item) => ({ role: PAPEL[item.de], content: item.texto }))
      .slice(-HISTORICO_MAXIMO),
  };
  return { valido: true, corpo };
};

// ===== A proposta de ação, dita em português =====
//
// A proposta chega do servidor como objeto ({tipo, campos...}). Quem vai
// clicar em "Confirmar" precisa ler exatamente o que vai acontecer — um botão
// que diz só "Confirmar" embaixo de um JSON é assinatura em branco.

export const textoDaProposta = (proposta = {}) => {
  const tipo = String(proposta.tipo || "");
  if (tipo === "criar_tarefa") {
    const partes = [`Criar tarefa: "${proposta.titulo || "sem título"}"`];
    if (proposta.cliente) partes.push(`para ${proposta.cliente}`);
    if (proposta.prazo) partes.push(`até ${proposta.prazo}`);
    return partes.join(" ");
  }
  if (tipo === "definir_proxima_acao") {
    const partes = [`Definir próxima ação de ${proposta.cliente || "?"}: "${proposta.acao || ""}"`];
    if (proposta.prazo) partes.push(`até ${proposta.prazo}`);
    return partes.join(" ");
  }
  if (tipo === "pesquisar_empresa")
    return `Pesquisar ${proposta.cliente || "a empresa"} na web agora`;
  if (tipo === "aprender") {
    // Aqui o texto INTEIRO importa. Nas outras ações a pessoa confere um
    // título e um prazo; nesta ela está autorizando o assistente a afirmar
    // aquilo para todo mundo do espaço, inclusive dentro de uma proposta.
    // Resumir o conteúdo seria pedir assinatura no que ela não leu.
    const partes = [`Guardar no dossiê da To Do Green: "${proposta.titulo || "sem título"}"`];
    if (proposta.conteudo) partes.push(`\n${proposta.conteudo}`);
    const carimbo = [
      proposta.fonte && `fonte: ${proposta.fonte}`,
      proposta.sigilo && `sigilo: ${proposta.sigilo}`,
    ].filter(Boolean).join(" · ");
    if (carimbo) partes.push(`\n(${carimbo})`);
    return partes.join(" ");
  }
  return "Ação desconhecida — não confirme.";
};
