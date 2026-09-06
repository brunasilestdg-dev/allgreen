// ===== A porta de entrada: pedir em vez de procurar =====
// Camada pura.
//
// O problema que isto resolve: o app tem 68 telas. Quem chega para resolver uma
// coisa simples — "quanto entrou este mês", "manda o orçamento pro cliente" —
// não deveria precisar descobrir em qual das 68 aquilo mora. Ela pede, com as
// palavras dela, e o app leva.
//
// O texto digitado na entrada é entregue à conversa por aqui. É um rascunho,
// não um dado do negócio: fica no aparelho e some quando é usado.

export const DRAFT_KEY = "sf-draft";

export const MAX_PEDIDO = 3000;

export const cleanRequest = (texto) =>
  String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
    .slice(0, MAX_PEDIDO);

export const isSendable = (texto) => cleanRequest(texto).length >= 2;

// Guarda o pedido e devolve se deu para guardar. Falhar aqui (aba anônima com
// armazenamento bloqueado) não pode impedir a pessoa de abrir a conversa —
// ela só vai precisar digitar de novo.
export const stageRequest = (storage, texto) => {
  const limpo = cleanRequest(texto);
  if (!limpo) return false;
  // Sem armazenamento, `storage?.setItem` não faz nada e não reclama — dizer
  // que guardou seria mentira, e quem chama decidiria errado com base nisso.
  if (typeof storage?.setItem !== "function") return false;
  try {
    storage.setItem(DRAFT_KEY, limpo);
    return true;
  } catch {
    return false;
  }
};

export const readStagedRequest = (storage) => {
  try {
    return cleanRequest(storage?.getItem(DRAFT_KEY) || "");
  } catch {
    return "";
  }
};

// Sugestões da entrada. São pedidos inteiros, do jeito que a pessoa falaria —
// não nomes de tela. "Financeiro" não ensina nada a quem nunca abriu o app;
// "quanto entrou e quanto saiu este mês" ensina.
export const SUGESTOES = [
  "Quanto entrou e quanto saiu este mês?",
  "Escreve uma mensagem de cobrança educada para um cliente atrasado",
  "Monta uma cotação de frete Last Mile para 500 pacotes por dia",
  "Quais tarefas estão atrasadas?",
  "Quanto CO₂ evitamos com a frota elétrica este mês?",
  "Me ajuda a precificar uma operação dedicada de transferência entre CDs",
];

// Rotação estável por dia: a entrada não muda a cada abertura (o que faria a
// pessoa perder a sugestão que ia clicar), mas também não congela para sempre.
export const suggestionsForToday = (todas = SUGESTOES, quantas = 3, hoje = new Date()) => {
  const lista = Array.isArray(todas) ? todas.filter(Boolean) : [];
  if (!lista.length) return [];
  const dia = Math.floor(
    (hoje instanceof Date ? hoje.getTime() : Date.now()) / 86_400_000,
  );
  const inicio = ((dia % lista.length) + lista.length) % lista.length;
  return Array.from({ length: Math.min(quantas, lista.length) }, (_, i) =>
    lista[(inicio + i) % lista.length],
  );
};

// Saudação pelo horário. Detalhe pequeno, mas é o que faz a entrada parecer
// alguém falando com você, e não um painel.
export const greeting = (nome, agora = new Date()) => {
  const h = agora instanceof Date ? agora.getHours() : 12;
  const parte = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const primeiro = String(nome || "").trim().split(/\s+/)[0];
  return primeiro ? `${parte}, ${primeiro}` : parte;
};
