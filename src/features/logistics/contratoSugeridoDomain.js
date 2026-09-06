// ===== O contrato nasce do que a simulação já provou =====
//
// Hoje o formulário de contrato nasce em branco e a pessoa redigita o valor,
// o serviço, o imposto — números que o cenário de precificação aceito JÁ tem.
// Redigitar é onde o valor do contrato diverge do que a simulação aprovou (um
// dígito a mais e o contrato fecha por um preço que ninguém aprovou).
//
// Aqui a proposta aceita puxa o cenário vinculado (`scenarioId`) e devolve uma
// SUGESTÃO de contrato. Três regras que a mantêm confiável:
//
//   1) É sugestão, não trava: o formulário continua editável; quem gera o
//      contrato confirma ou corrige.
//   2) Campo sem origem confiável fica em branco — nunca chuta 0 nem inventa.
//      Preencher com 0 seria pior que vazio, porque parece número aprovado.
//   3) Só o que casa de tipo entra. O SLA do cenário é texto livre ("98,5% no
//      prazo", "D+1"), não horas — então não vira o SLA em horas do contrato.

const positivo = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
};

/**
 * Sugestão de contrato a partir da proposta aceita e do cenário vinculado.
 *
 * Devolve só as chaves que dá para derivar com segurança; o resto o chamador
 * mantém como estava (mescla por cima do formulário vazio). Sem cenário
 * vinculado, devolve `{}` — nada a sugerir, formulário segue em branco.
 */
export function sugestaoDeContrato(proposta, cenarios = []) {
  if (!proposta) return {};
  const cenario = (Array.isArray(cenarios) ? cenarios : []).find(
    (item) => item && item.id === proposta.scenarioId,
  );
  const resultado = cenario?.result;
  if (!resultado) return {};

  // O preço que a simulação aprovou: o selecionado manda; o recomendado é o
  // fallback quando não houve escolha manual. É este número que não pode ser
  // redigitado errado.
  const mensal = positivo(resultado.selectedPrice) ?? positivo(resultado.recommendedPrice);
  const meses = positivo(resultado.inputs?.contractMonths);
  const imposto = positivo(resultado.assumptions?.taxPercent);

  const sugestao = {};
  if (mensal != null) sugestao.valorMensal = String(mensal);
  // Valor total só quando sabemos os meses — mensal × prazo. Sem os meses,
  // deixar em branco é mais honesto que gravar o mensal como se fosse o total.
  if (mensal != null && meses != null) sugestao.valorTotal = String(Math.round(mensal * meses));
  if (resultado.productId) sugestao.servicoId = String(resultado.productId);
  if (imposto != null) sugestao.aliquotaImposto = String(imposto);
  return sugestao;
}
