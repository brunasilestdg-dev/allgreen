// ===== Compras: requisição, pedido, recebimento =====
//
// Camada pura. A regra que organiza o arquivo é a mesma do estoque: o que foi
// RECEBIDO é a soma dos recebimentos, nunca uma coluna. Guardar
// `received_quantity` na linha do pedido reproduziria o defeito do estoque
// mutável — um número que precisa ser mantido em sincronia e que divergiria no
// primeiro recebimento concorrente.
//
// Por isso `status` do pedido guarda só decisão de gente (rascunho, aprovado,
// enviado, encerrado, cancelado) e o estado de recebimento é derivado por
// `recepcaoDoPedido`.
//
// A comparação de propostas NÃO é reescrita aqui: `supplierBidTotals`,
// `compareSupplierBids` e `bestOffersByItem` já existem em `src/domain.js`,
// testados, e a regra que importa — proposta incompleta nunca ganha de uma
// completa — está resolvida lá.

import { procurementNumber } from "../../domain.js";

const texto = (valor) => String(valor ?? "").trim();

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

// Quantidade e dinheiro chegam de planilha e de proposta em formatos
// brasileiros. Reusar `procurementNumber` em vez de um `Number()` cru é o que
// faz "1.234,56" valer mil duzentos e trinta e quatro.
const valor = (bruto) => procurementNumber(bruto);

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = Object.freeze([
  { id: "rascunho", name: "Rascunho" },
  { id: "pendente", name: "Com Suprimentos" },
  // A requisição chega a Suprimentos, que decide: aprova, devolve para o
  // requisitante ajustar, recusa, ou direciona à gestão quando a decisão é
  // acima da alçada de Suprimentos.
  { id: "devolvida", name: "Devolvida para ajuste" },
  { id: "em_gestao", name: "Na gestão" },
  { id: "aprovada", name: "Aprovada" },
  { id: "recusada", name: "Recusada" },
  { id: "atendida", name: "Atendida" },
  { id: "cancelada", name: "Cancelada" },
]);

export const ORDER_STATUSES = Object.freeze([
  { id: "rascunho", name: "Rascunho" },
  { id: "aprovado", name: "Aprovado" },
  { id: "enviado", name: "Enviado ao fornecedor" },
  { id: "encerrado", name: "Encerrado" },
  { id: "cancelado", name: "Cancelado" },
]);

// A transição é declarada, não deduzida. Uma máquina de estados implícita
// ("qualquer status pode ir para qualquer status") deixa o pedido voltar de
// encerrado para rascunho e reabrir uma compra já paga.
const TRANSICOES_DO_PEDIDO = Object.freeze({
  rascunho: ["aprovado", "cancelado"],
  aprovado: ["enviado", "rascunho", "cancelado"],
  enviado: ["encerrado", "cancelado"],
  // Terminais. Encerrado não volta: o recebimento e o título já existem.
  encerrado: [],
  cancelado: [],
});

const TRANSICOES_DA_REQUISICAO = Object.freeze({
  rascunho: ["pendente", "cancelada"],
  // Suprimentos triam o que chega: aprova, devolve, recusa ou direciona à
  // gestão. Não é Suprimentos que escolhe o fornecedor — isso é o pedido/RFQ
  // depois de aprovada.
  pendente: ["aprovada", "recusada", "devolvida", "em_gestao", "cancelada"],
  // A gestão decide o que Suprimentos direcionou.
  em_gestao: ["aprovada", "recusada", "devolvida", "cancelada"],
  // Devolvida volta ao requisitante: ele ajusta e reenvia (pendente) ou desiste.
  devolvida: ["pendente", "cancelada"],
  aprovada: ["atendida", "cancelada"],
  recusada: ["rascunho"],
  atendida: [],
  cancelada: [],
});

export const podeMudarStatusDoPedido = (de, para) =>
  (TRANSICOES_DO_PEDIDO[texto(de)] || []).includes(texto(para));

export const podeMudarStatusDaRequisicao = (de, para) =>
  (TRANSICOES_DA_REQUISICAO[texto(de)] || []).includes(texto(para));

// ---------------------------------------------------------------------------
// Totais do pedido
// ---------------------------------------------------------------------------

export const totalDaLinha = (linha) =>
  Math.max(0, valor(linha?.quantity ?? linha?.quantidade)) *
  Math.max(0, valor(linha?.unitPrice ?? linha?.precoUnitario));

export const totalDoPedido = (pedido = {}, linhas = []) => {
  const subtotal = linhas.reduce((soma, linha) => soma + totalDaLinha(linha), 0);
  const frete = Math.max(0, valor(pedido.freight ?? pedido.frete));
  const impostos = Math.max(0, valor(pedido.taxes ?? pedido.impostos));
  const desconto = Math.max(0, valor(pedido.discount ?? pedido.desconto));
  return {
    subtotal,
    frete,
    impostos,
    desconto,
    // Nunca negativo: um desconto maior que o pedido é erro de digitação, e um
    // total negativo viraria receita no financeiro.
    total: Math.max(0, subtotal + frete + impostos - desconto),
  };
};

// ---------------------------------------------------------------------------
// Aprovação
// ---------------------------------------------------------------------------

// A alçada é por valor. `limite` nulo ou ausente significa "toda compra precisa
// de aprovação" — o padrão seguro. Zero significa "nenhuma precisa", e é uma
// escolha explícita de quem configurou, não um acidente de campo vazio.
export const exigeAprovacao = (total, limite) => {
  if (limite === null || limite === undefined || limite === "") return true;
  const teto = numero(limite);
  if (!Number.isFinite(teto) || teto < 0) return true;
  return numero(total) > teto;
};

// Um pedido aprovado que MUDOU depois da aprovação perdeu a aprovação. Sem esta
// conferência, aprovar R$ 1.000 e depois editar para R$ 50.000 passaria pela
// alçada sem ninguém ver.
export const aprovacaoAindaVale = (pedido = {}, linhas = []) => {
  if (pedido.approvalStatus !== "aprovada") return false;
  const aprovado = numero(pedido.approvedTotal);
  const atual = totalDoPedido(pedido, linhas).total;
  // Tolerância de um centavo para não invalidar por arredondamento de ponto
  // flutuante; qualquer diferença real derruba a aprovação.
  return Math.abs(atual - aprovado) <= 0.01;
};

// ---------------------------------------------------------------------------
// Recebimento
// ---------------------------------------------------------------------------

// Soma o que já foi recebido de cada linha, com devolução entrando como
// negativo. Devolução é um recebimento de `kind: "devolucao"` — separá-la
// permite o relatório distinguir o que entrou do que voltou, e ainda assim
// chegar ao saldo certo.
export const recebidoPorLinha = (recebimentos = []) => {
  const porLinha = new Map();
  for (const recebimento of recebimentos) {
    if (recebimento?.archivedAt) continue;
    const sinal = texto(recebimento?.kind) === "devolucao" ? -1 : 1;
    for (const linha of recebimento?.linhas || []) {
      const chave = texto(linha?.orderItemId);
      if (!chave) continue;
      const quantidade = Math.abs(valor(linha?.quantidade ?? linha?.quantity));
      porLinha.set(chave, (porLinha.get(chave) || 0) + sinal * quantidade);
    }
  }
  return porLinha;
};

// O estado de recebimento do pedido, derivado. `pendente` quando nada chegou,
// `parcial` quando falta, `completo` quando fechou, `excedente` quando veio mais
// do que foi pedido — que é informação, não erro a esconder.
export const recepcaoDoPedido = (linhas = [], recebimentos = []) => {
  const recebido = recebidoPorLinha(recebimentos);
  const detalhe = linhas.map((linha) => {
    const pedida = Math.max(0, valor(linha?.quantity ?? linha?.quantidade));
    const chegou = recebido.get(texto(linha?.id)) || 0;
    return {
      orderItemId: texto(linha?.id),
      itemId: texto(linha?.itemId),
      pedida,
      recebida: chegou,
      // Nunca negativo: já recebi mais do que pedi não gera "falta negativa".
      pendente: Math.max(0, pedida - chegou),
      excedente: Math.max(0, chegou - pedida),
    };
  });

  const totalPedido = detalhe.reduce((soma, linha) => soma + linha.pedida, 0);
  const totalRecebido = detalhe.reduce((soma, linha) => soma + linha.recebida, 0);
  const algumExcedente = detalhe.some((linha) => linha.excedente > 0);
  const tudoAtendido = detalhe.length > 0 && detalhe.every((linha) => linha.pendente === 0);

  let situacao = "pendente";
  if (algumExcedente) situacao = "excedente";
  else if (tudoAtendido) situacao = "completo";
  else if (totalRecebido > 0) situacao = "parcial";

  return {
    situacao,
    linhas: detalhe,
    totalPedido,
    totalRecebido,
    // Percentual só quando há o que receber. Dividir por zero devolveria NaN, e
    // devolver 0 diria "nada chegou" para um pedido vazio.
    percentual: totalPedido > 0 ? Math.round((totalRecebido / totalPedido) * 100) : null,
  };
};

// Recebimento não pode passar do que falta. Devolução não pode passar do que
// foi recebido — devolver mais do que chegou criaria estoque negativo a partir
// de uma correção.
export const validarLinhasDoRecebimento = (linhas = [], pedidoLinhas = [], recebimentos = [], kind = "recebimento") => {
  const recepcao = recepcaoDoPedido(pedidoLinhas, recebimentos);
  const porId = new Map(recepcao.linhas.map((linha) => [linha.orderItemId, linha]));
  const informadas = linhas.filter((linha) => Math.abs(valor(linha?.quantidade ?? linha?.quantity)) > 0);
  if (!informadas.length) return "Informe a quantidade recebida de ao menos um item.";

  for (const linha of informadas) {
    const alvo = porId.get(texto(linha?.orderItemId));
    if (!alvo) return "Há uma linha que não pertence a este pedido.";
    const quantidade = Math.abs(valor(linha?.quantidade ?? linha?.quantity));
    if (kind === "devolucao") {
      if (quantidade > alvo.recebida)
        return `Não é possível devolver ${quantidade} de um item com ${alvo.recebida} recebido.`;
      continue;
    }
    if (quantidade > alvo.pendente)
      return `Não é possível receber ${quantidade} de um item com ${alvo.pendente} pendente.`;
  }
  return "";
};

// ---------------------------------------------------------------------------
// As pontes: recebimento → estoque e recebimento → conta a pagar
// ---------------------------------------------------------------------------
//
// Puras de propósito. Elas MONTAM o lançamento e devolvem; quem grava é o
// handler. É o mesmo princípio de `buildOrderReceita` no monólito: "uma função
// que grava sozinha esconde a decisão de quem a chamou."

// Cada linha recebida vira um movimento de estoque. Devolução vira saída — o
// material volta para o fornecedor.
export const recebimentoParaMovimentos = (recebimento = {}, pedidoLinhas = []) => {
  const porId = new Map(pedidoLinhas.map((linha) => [texto(linha?.id), linha]));
  const devolucao = texto(recebimento.kind) === "devolucao";
  return (recebimento.linhas || [])
    .map((linha) => {
      const pedida = porId.get(texto(linha?.orderItemId));
      const quantidade = Math.abs(valor(linha?.quantidade ?? linha?.quantity));
      // Linha de serviço não tem material e não movimenta estoque. Forçar um
      // movimento criaria saldo de algo que não existe fisicamente.
      const itemId = texto(pedida?.itemId);
      if (!itemId || !quantidade) return null;
      return {
        itemId,
        warehouseId: texto(recebimento.warehouseId),
        kind: devolucao ? "saida" : "entrada",
        quantity: quantidade,
        // O custo da entrada é o preço do pedido, não um valor digitado no
        // recebimento: é o preço que foi negociado e aprovado.
        unitCost: devolucao ? 0 : Math.max(0, valor(linha?.custoUnitario ?? pedida?.unitPrice)),
        originType: "recebimento",
        originId: texto(recebimento.id),
        originNumber: texto(recebimento.documentNumber || recebimento.invoiceNumber),
        occurredAt: texto(recebimento.receivedAt),
      };
    })
    .filter(Boolean);
};

// O título a pagar. Sai como `kind: "cost"` em `todogreen_financial_entries`,
// que é a fonte única do financeiro da vertical — não uma tabela nova de contas
// a pagar. A migração 0052 já deu a essa tabela vencimento, baixa e status.
export const recebimentoParaConta = (recebimento = {}, pedido = {}, pedidoLinhas = [], opcoes = {}) => {
  const porId = new Map(pedidoLinhas.map((linha) => [texto(linha?.id), linha]));
  const bruto = (recebimento.linhas || []).reduce((soma, linha) => {
    const pedida = porId.get(texto(linha?.orderItemId));
    const quantidade = Math.abs(valor(linha?.quantidade ?? linha?.quantity));
    return soma + quantidade * Math.max(0, valor(linha?.custoUnitario ?? pedida?.unitPrice));
  }, 0);

  // Devolução não gera título; ela abate o que já foi lançado, e esse abatimento
  // é decisão de quem confere a fatura — não um crédito automático.
  if (texto(recebimento.kind) === "devolucao") return null;
  if (bruto <= 0) return null;

  const prazo = Math.max(0, Math.trunc(numero(pedido.paymentTermDays)));
  return {
    kind: "cost",
    categoria: texto(opcoes.categoria) || "Compras",
    descricao: `Compra — ${texto(pedido.supplierName) || "fornecedor"}${
      recebimento.invoiceNumber ? ` — NF ${texto(recebimento.invoiceNumber)}` : ""
    }`,
    valor: bruto,
    contraparte: texto(pedido.supplierName),
    numeroDocumento: texto(recebimento.invoiceNumber),
    centroCusto: texto(pedido.costCenterId),
    // Vence conforme o prazo do pedido, contado do recebimento. Sem prazo, vence
    // no dia — é o que acontece numa compra à vista.
    vencimentoEm: somarDias(texto(recebimento.receivedAt), prazo),
    competenciaEm: primeiroDia(texto(recebimento.receivedAt)),
    mesReferencia: texto(recebimento.receivedAt).slice(0, 7),
    statusFinanceiro: "pending",
    campos: {
      sourceReceiptId: texto(recebimento.id),
      sourcePurchaseOrderId: texto(pedido.id),
    },
  };
};

// Aritmética de data em UTC, sobre a parte AAAA-MM-DD. Usar o fuso local faria
// o vencimento mudar de dia conforme onde o Worker rodou.
export const somarDias = (ymd, dias) => {
  const base = texto(ymd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "";
  const data = new Date(`${base}T00:00:00.000Z`);
  if (Number.isNaN(data.getTime())) return "";
  data.setUTCDate(data.getUTCDate() + Math.trunc(numero(dias)));
  return data.toISOString().slice(0, 10);
};

const primeiroDia = (ymd) => {
  const base = texto(ymd).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : "";
};

// ---------------------------------------------------------------------------
// Requisição → pedido
// ---------------------------------------------------------------------------

// A requisição vira as linhas do pedido. Não vira o pedido inteiro: fornecedor,
// preço e prazo são decisão da cotação, e preenchê-los aqui inventaria número.
export const linhasDoPedidoDaRequisicao = (requisicao = {}) =>
  (requisicao.items || []).map((item, indice) => ({
    itemId: texto(item?.itemId),
    description: texto(item?.descricao ?? item?.description),
    unit: texto(item?.unidade ?? item?.unit) || "UN",
    quantity: Math.max(0, valor(item?.quantidade ?? item?.quantity)),
    unitPrice: 0,
    lineNumber: indice + 1,
  })).filter((linha) => linha.quantity > 0 && (linha.itemId || linha.description));

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export const validateRequest = (requisicao = {}) => {
  if (!texto(requisicao.title)) return "Informe o que está sendo pedido.";
  const itens = Array.isArray(requisicao.items) ? requisicao.items : [];
  if (!itens.length) return "Adicione ao menos um item à requisição.";
  const validos = itens.filter(
    (item) => valor(item?.quantidade ?? item?.quantity) > 0 &&
      (texto(item?.itemId) || texto(item?.descricao ?? item?.description)),
  );
  if (!validos.length) return "Cada item precisa de material ou descrição e quantidade maior que zero.";
  return "";
};

export const validateOrder = (pedido = {}, linhas = []) => {
  if (!texto(pedido.supplierPartyId)) return "Informe o fornecedor.";
  if (!linhas.length) return "Adicione ao menos um item ao pedido.";
  for (const linha of linhas) {
    if (!(valor(linha?.quantity ?? linha?.quantidade) > 0))
      return "Cada item precisa de quantidade maior que zero.";
    if (!texto(linha?.itemId) && !texto(linha?.description ?? linha?.descricao))
      return "Cada item precisa de material cadastrado ou descrição.";
    if (valor(linha?.unitPrice ?? linha?.precoUnitario) < 0)
      return "O preço unitário não pode ser negativo.";
  }
  if (numero(pedido.paymentTermDays) < 0) return "O prazo de pagamento não pode ser negativo.";
  return "";
};

export const validateReceipt = (recebimento = {}) => {
  if (!texto(recebimento.orderId)) return "Informe o pedido de compra.";
  if (!texto(recebimento.warehouseId)) return "Informe o depósito que recebeu.";
  if (!texto(recebimento.receivedAt)) return "Informe a data do recebimento.";
  const chave = texto(recebimento.invoiceKey).replace(/\D+/g, "");
  // Chave de NF-e tem 44 dígitos. Aceitar 43 deixaria passar erro de digitação
  // que só apareceria quando o XML não casasse, meses depois.
  if (chave && chave.length !== 44) return "A chave da nota fiscal tem 44 dígitos.";
  return "";
};
