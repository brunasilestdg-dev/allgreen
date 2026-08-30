// ===== Ponte entre o livro da vertical e o motor de contas do app =====
//
// O app geral tem, testados há mais tempo, o aging por faixa de atraso, a
// previsão de caixa semanal e a recorrência mensal (billsDomain). A vertical
// tem o livro (todogreen_financial_entries) com competência, encargos e
// fechamento. Regra 5 do AGENTS.md: não recriar — esta ponte só traduz o
// formato do lançamento da vertical para o formato que o motor do app espera
// e reexporta as leituras. Nenhuma regra financeira é duplicada.

import {
  agingBuckets,
  cashFlowForecast,
  nextRecurrence,
} from "../finance/billsDomain.js";

const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

const cancelado = (entry) =>
  entry?.statusFinanceiro === "cancelled" || entry?.situacao === "cancelled";

// Receita entra; custo e comissão saem. O motor do app só conhece dois lados.
export const lancamentoParaConta = (entry = {}) => ({
  id: entry.id,
  direction: entry.tipo === "revenue" ? "receber" : "pagar",
  value: numero(entry.valor),
  dueDate: entry.vencimentoEm || "",
  payments: numero(entry.valorPago) > 0 ? [{ amount: numero(entry.valorPago) }] : [],
  description: entry.descricao || entry.categoria || "",
  category: entry.categoria || "",
  contactName: entry.contraparte || "",
  recurring: false,
});

const contasValidas = (entries = []) =>
  entries.filter((entry) => !cancelado(entry)).map(lancamentoParaConta);

// Inadimplência por faixa de atraso — a leitura clássica, direto do motor.
export const faixasDeAtraso = (entries = [], hoje = new Date().toISOString().slice(0, 10)) =>
  agingBuckets(contasValidas(entries), hoje);

// Previsão de caixa semanal: recebimentos menos pagamentos em aberto, semana a
// semana. Atrasados caem na primeira semana — o dinheiro ainda é esperado.
export const previsaoSemanalDeCaixa = (entries = [], opcoes = {}) =>
  cashFlowForecast(contasValidas(entries), opcoes);

// Próximo vencimento de um lançamento tratado como mensal (aluguel, seguro,
// parcela do caminhão): mesmo dia no mês seguinte, ajustado a mês curto.
// Devolve só a data — quem cria o lançamento novo é a tela, pelo fluxo normal.
export const proximoVencimentoMensal = (vencimentoEm) => {
  const proxima = nextRecurrence(
    { recurring: true, dueDate: vencimentoEm || "", payments: [] },
    "proxima",
  );
  return proxima ? proxima.dueDate : "";
};
