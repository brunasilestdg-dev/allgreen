// ===== Central de atendimento automatizada do portal =====
// Camada pura.
//
// O portal já tinha três portas separadas para o cliente falar: o Assistente
// (pergunta e resposta com IA), as Solicitações (chamado com prazo para a
// equipe) e o NPS. A "caixa automatizada" é UMA porta que decide sozinha por
// qual caminho a mensagem segue:
//
//  - dá para responder na hora, com os dados do próprio cliente? responde (IA);
//  - é um pedido que a equipe precisa EXECUTAR (nova rota, coleta, volume), um
//    RELATO de problema (avaria, extravio) ou assunto SENSÍVEL/comercial?
//    escala — vira o mesmo chamado com prazo que a equipe já trata, só que já
//    classificado e com o contexto pronto.
//
// Nada aqui chama rede, banco ou modelo: esta camada só ROTEIA. A resposta da
// IA e a criação do chamado continuam nos mesmos lugares de sempre. Por ser
// pura, a decisão é testável na fronteira — que é onde a confiança do cliente
// se ganha ou se perde: um pedido de preço que virasse "resposta automática"
// da IA, ou uma avaria que ficasse só num chat sem abrir chamado, seria uma
// promessa quebrada. O padrão-ouro é: na dúvida, uma pessoa.

import { TIPOS_SOLICITACAO, tipoValido, urgenciaValida } from "./clientRequestDomain.js";

export const LIMITE_MENSAGEM = 2000;

const normalizar = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const contem = (texto, termos) => termos.some((t) => texto.includes(t));

// Um termo por sinal. Ficam exportados para o teste conferir a régua sem
// depender de exemplos escolhidos a dedo.

// Assunto que uma pessoa precisa tratar: preço, contrato, jurídico, pedido de
// falar com gente. A IA nunca responde sozinha por aqui.
export const TERMOS_SENSIVEIS = [
  "preco", "valor do frete", "tabela", "reajuste", "aumento de preco",
  "contrato", "renovacao", "rescisao", "cancelar contrato", "cancelamento",
  "juridico", "advogado", "processo", "reclamacao", "insatisfeit",
  "cobranca indevida", "negociar", "desconto", "proposta comercial",
  "comercial", "falar com", "atendente", "humano", "gerente", "responsavel",
];

// Relato de problema numa entrega: abre ocorrência (o relógio da operação é
// curto). Diferente de PERGUNTAR onde está a carga — isso a IA responde.
export const TERMOS_RELATO_PROBLEMA = [
  "avaria", "avariad", "extravi", "sumiu", "sumida", "roubo", "roubad",
  "quebrou", "quebrad", "danificad", "faltou", "faltando", "nao chegou",
  "divergencia", "mercadoria trocada", "entrega errada", "produto errado",
  "violad", "molhad",
];

export const TERMOS_URGENCIA = [
  "urgente", "urgencia", "agora", "hoje", "imediat", "emergencia",
  "o quanto antes", "asap", "parou", "parada", "parado", "correndo",
];

// Formato de pergunta: é o que a IA pode responder na hora com os dados do
// cliente. Sem isso (um pedido afirmativo, um "quero X"), a caixa prefere a
// pessoa.
export const TERMOS_PERGUNTA = [
  "?", "qual", "quais", "quando", "onde", "quanto", "quantos", "quantas",
  "como", "cade", "ja saiu", "ja foi", "chegou", "status", "andamento",
  "previsao", "prazo de entrega", "posso saber", "me diz", "gostaria de saber",
  "tem previsao",
];

// Pedidos que só a equipe executa. Mapeados para os tipos que já existem em
// clientRequestDomain — nada de inventar um catálogo paralelo.
const REGRAS_DE_TIPO = [
  { tipo: "nova_rota", termos: ["nova rota", "incluir rota", "novo trecho", "incluir trecho", "passar a atender", "nova entrega fixa", "incluir a rota", "adicionar rota"] },
  { tipo: "coleta_extra", termos: ["coleta extra", "coleta fora", "retirada extra", "buscar a carga", "coletar", "retirar a carga", "agendar coleta"] },
  { tipo: "aumento_volume", termos: ["aumentar volume", "aumento de volume", "mais volume", "mais carga", "mais frequencia", "elevar volume", "dobrar", "escalar volume"] },
  { tipo: "documento", termos: ["nota fiscal", "nf-e", "nfe", "canhoto", "comprovante", "2 via", "segunda via", "laudo", "xml da nota"] },
  { tipo: "relatorio_esg", termos: ["relatorio", "co2", "emiss", "green score", "ambiental", "esg", "pegada de carbono"] },
];

// Ações que SEMPRE precisam da equipe, mesmo em forma de pergunta.
const ACOES_DA_EQUIPE = new Set(["nova_rota", "coleta_extra", "aumento_volume"]);

const classificarTipo = (n, { relato }) => {
  if (relato) return "ocorrencia";
  for (const regra of REGRAS_DE_TIPO) {
    if (contem(n, regra.termos)) return regra.tipo;
  }
  return "outro";
};

const montarAssunto = (textoOriginal, tipo) => {
  const primeiraLinha = String(textoOriginal ?? "").split(/\r?\n/)[0].trim();
  const base = primeiraLinha.replace(/\s+/g, " ").slice(0, 120);
  // O assunto precisa de corpo (a fila da equipe lista por assunto). Curto
  // demais vira o rótulo do tipo, que já diz do que se trata.
  return base.length >= 4 ? base : TIPOS_SOLICITACAO[tipoValido(tipo)].rotulo;
};

const motivoDaDecisao = ({ sensivel, exigeEquipe, informacional }) => {
  if (sensivel) return "Assunto comercial ou sensível: uma pessoa da equipe assume.";
  if (exigeEquipe) return "É um pedido para a equipe executar — abrimos o chamado com prazo.";
  if (informacional) return "Dava para responder na hora com os seus próprios dados.";
  return "Sem uma pergunta clara, preferimos encaminhar para uma pessoa.";
};

// A decisão. Uma mensagem livre entra; sai o caminho (responder com IA ou
// escalar) já com o tipo, a urgência e o assunto que a criação do chamado usa.
export const triagemAtendimento = (mensagemBruta) => {
  const original = String(mensagemBruta ?? "").trim();
  const n = normalizar(original);

  const sensivel = contem(n, TERMOS_SENSIVEIS);
  const relato = contem(n, TERMOS_RELATO_PROBLEMA);
  const urgente = contem(n, TERMOS_URGENCIA);
  const pergunta = contem(n, TERMOS_PERGUNTA);

  const tipo = classificarTipo(n, { relato });
  const exigeEquipe = relato || ACOES_DA_EQUIPE.has(tipo);
  const informacional = pergunta && !exigeEquipe;

  // Só responde sozinha quando é pergunta, não é ação da equipe e não é
  // sensível. Qualquer outra coisa vai para uma pessoa — inclusive o vago.
  const autoRespondivel = informacional && !sensivel;

  // Relato de problema sobe a urgência: avaria "normal" ainda é avaria.
  const urgencia = urgenciaValida(relato || urgente ? "alta" : "normal");

  return {
    acao: autoRespondivel ? "responder_ia" : "escalar",
    autoRespondivel,
    escalar: !autoRespondivel,
    sensivel,
    tipo,
    urgencia,
    assunto: montarAssunto(original, tipo),
    motivo: motivoDaDecisao({ sensivel, exigeEquipe, informacional }),
  };
};
