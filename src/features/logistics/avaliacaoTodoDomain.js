// Leitura humana da avaliação do Todô (#128, fase 2). O servidor entrega os
// números crus (total, 👍, 👎, corrigidas, taxa); aqui vira uma frase honesta e
// um tom para a tela pintar — sem inventar qualidade quando ninguém votou.

// Devolve { tom, frase } a partir do agregado. tom ∈ 'neutro'|'bom'|'atencao'.
export function leituraDaAvaliacao(dados = {}) {
  const total = Number(dados.total || 0);
  const avaliadas = Number(dados.avaliadas || 0);
  const taxa = dados.taxaUtil;

  if (total === 0) {
    return { tom: "neutro", frase: "O Todô ainda não respondeu nada por aqui. Quando responder, a qualidade aparece nesta tela." };
  }
  if (avaliadas === 0) {
    return { tom: "neutro", frase: `${total} resposta(s), nenhuma avaliada ainda. Peça ao time para usar o 👍/👎 — é assim que ele melhora.` };
  }
  if (typeof taxa !== "number") {
    return { tom: "neutro", frase: `${total} resposta(s) até agora.` };
  }
  if (taxa >= 80) {
    return { tom: "bom", frase: `${taxa}% das respostas avaliadas foram úteis. O Todô está ajudando.` };
  }
  if (taxa >= 50) {
    return { tom: "atencao", frase: `${taxa}% das avaliadas foram úteis. Dá para melhorar — veja as correções recentes.` };
  }
  return { tom: "atencao", frase: `Só ${taxa}% das avaliadas foram úteis. Vale corrigir as respostas erradas e ensinar o que faltou.` };
}
