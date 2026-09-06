// ===== O toast que não mente mais =====
//
// O `Toast` mostrava SEMPRE um check verde — mas o mesmo canal é o único por
// onde as telas jogam erro (`setToast(error.message)` no catch). Ou seja: toda
// gravação que FALHA aparecia como sucesso verde. Aqui a mensagem ganha um tom.
//
// Duas fontes de tom, nesta ordem: se quem chamou passou um objeto
// `{ mensagem/message, tom/tone }`, o tom explícito manda; senão, inferimos do
// texto pelos sinais de erro mais comuns em português. Sucesso não costuma
// conter "não foi possível", "falhou", "inválido", "obrigatório" — então o
// falso-positivo é raro, e errar para o lado de "isto parece um erro" é o lado
// seguro (um aviso vermelho de leve num sucesso incomoda menos que um erro
// disfarçado de check verde).

const SINAIS_DE_ERRO =
  /(não foi poss|não encontr|não pode|não consegu|falh|err[oa]|inválid|permiss|recarregue|obrigat|selecione|informe|excede|indispon|expir|bloque|recus|inconsist)/i;

export function textoDoToast(toast) {
  if (toast == null) return "";
  if (typeof toast === "string") return toast;
  if (typeof toast === "object") return String(toast.mensagem ?? toast.message ?? "");
  return String(toast);
}

export function tomDoToast(toast) {
  if (toast && typeof toast === "object") {
    const tom = String(toast.tom ?? toast.tone ?? "").toLowerCase();
    if (tom === "erro" || tom === "error" || tom === "danger") return "erro";
    if (tom === "ok" || tom === "success" || tom === "sucesso" || tom === "info") return "ok";
  }
  return SINAIS_DE_ERRO.test(textoDoToast(toast)) ? "erro" : "ok";
}
