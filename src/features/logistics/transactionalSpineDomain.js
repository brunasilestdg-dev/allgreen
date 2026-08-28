const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const SERVICE_ORDER_TRANSITIONS = Object.freeze({
  draft: ["released", "cancelled"],
  released: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
});

export function canTransitionServiceOrder(from, to) {
  return (SERVICE_ORDER_TRANSITIONS[from] || []).includes(to);
}

// Preço recomendado guardado no resultado da simulação (result_json do
// pricing_scenarios). O motor de preço devolve `precoRecomendado`; aceitamos
// também as chaves equivalentes de versões/idiomas do resultado. Devolve null
// quando nenhuma existe — nunca 0, para não fingir um preço que a simulação
// não deu.
export function precoDaSimulacao(result) {
  if (!result || typeof result !== "object") return null;
  const chaves = ["precoRecomendado", "recommendedPrice", "precoFinal", "precoSugerido", "valorRecomendado", "preco", "price"];
  for (const chave of chaves) {
    const valor = number(result[chave]);
    if (valor > 0) return valor;
  }
  return null;
}

// Preço unitário da OS gerada a partir do aceite. A precedência respeita quem
// tem mais autoridade sobre o número: o que for digitado na hora vence (uma
// renegociação pontual); senão herda o valor NEGOCIADO do contrato; senão o
// preço da SIMULAÇÃO que gerou o contrato. Assim o preço flui
// simulação → contrato → OS sem redigitação, mas nunca sobrescreve um valor
// informado de propósito. `origem` deixa rastro de onde o número veio.
export function precoUnitarioDaOs({ unitPrice, contractMonthlyValue, simulacaoResult } = {}) {
  const digitado = number(unitPrice);
  if (digitado > 0) return { preco: digitado, origem: "digitado" };
  const doContrato = number(contractMonthlyValue);
  if (doContrato > 0) return { preco: doContrato, origem: "contrato" };
  const daSimulacao = precoDaSimulacao(simulacaoResult);
  if (daSimulacao != null) return { preco: daSimulacao, origem: "simulacao" };
  return { preco: null, origem: "ausente" };
}

export function serviceOrderAmounts(input = {}) {
  const quantity = Math.max(0, number(input.quantity));
  const unitPrice = Math.max(0, number(input.unitPrice));
  const grossAmount = quantity * unitPrice;
  const discountAmount = Math.min(grossAmount, Math.max(0, number(input.discountAmount)));
  const taxAmount = Math.max(0, number(input.taxAmount));
  return {
    quantity,
    unitPrice,
    grossAmount,
    discountAmount,
    taxAmount,
    netAmount: grossAmount - discountAmount + taxAmount,
  };
}

export function validateAllocation(total, allocations = [], tolerance = 0.01) {
  const expected = Math.max(0, number(total));
  if (!expected) return { valid: false, error: "O custo precisa ser maior que zero." };
  if (!Array.isArray(allocations) || !allocations.length)
    return { valid: false, error: "Informe ao menos um rateio." };
  const allocated = allocations.reduce((sum, item) => sum + Math.max(0, number(item.amount)), 0);
  if (Math.abs(expected - allocated) > tolerance)
    return { valid: false, error: "A soma dos rateios precisa ser igual ao custo." };
  if (allocations.some((item) => !item.serviceOrderId && !item.operationId && !item.clientId &&
    !item.contractId && !item.vehicleId && !item.supplierId && !item.costCenterId))
    return { valid: false, error: "Cada rateio precisa apontar para ao menos uma dimensão." };
  return { valid: true, allocated };
}

export function settlementState(openAmount, amount) {
  const open = Math.max(0, number(openAmount));
  const paid = Math.max(0, number(amount));
  if (!paid) return { valid: false, error: "O valor da baixa precisa ser maior que zero." };
  if (paid > open + 0.01) return { valid: false, error: "A baixa não pode superar o saldo em aberto." };
  const remaining = Math.max(0, open - paid);
  return { valid: true, remaining, status: remaining <= 0.01 ? "settled" : "partial" };
}
