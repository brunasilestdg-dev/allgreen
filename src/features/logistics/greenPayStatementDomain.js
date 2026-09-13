// ===== GreenPay — extrato, conciliação e contratos (fase 2) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A fase 1 (greenPayDomain) montou a carteira: ganho derivado da entrega, ciclo
// pendente → aprovado → pago, saldo como SOMA. Esta fase 2 fecha três lacunas
// que o deck pede em "infraestrutura financeira":
//
//  1) EXTRATO exportável — a carteira em linhas, para o motorista e a operação
//     terem o comprovante do período (CSV, sem serviço pago);
//  2) CONCILIAÇÃO do repasse — casar o que foi PAGO no razão interno com o que
//     de fato SAIU pela SysPag (ou por um retorno bancário informado), apontando
//     o que confere, o que diverge e o que saiu sem lançamento;
//  3) CONTRATOS de ganho recorrente — um valor fixo mensal (ajuda de custo,
//     retainer) que vira lançamento uma vez por mês, idempotente por referência.
//
// Honestidade: a conciliação nunca "conserta" divergência sozinha — ela APONTA.
// O contrato não lança o mês sozinho às escondidas: gera um lançamento explícito
// (kind "contrato"), com referência única que impede duplicar ao reprocessar.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
export const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// ===== Extrato =====================================================

const ROTULO_TIPO = {
  entrega: "Entrega",
  km: "Distância (km)",
  bonus: "Bônus",
  ajuste: "Ajuste",
  desconto: "Desconto",
  contrato: "Contrato recorrente",
};
const ROTULO_STATUS = { pendente: "Pendente", aprovado: "Aprovado", pago: "Pago" };

// Lançamentos → linhas do extrato numa janela de datas (por data de serviço).
// Sem janela, tudo. Ordena da mais recente para a mais antiga (leitura de
// extrato). Cada linha traz rótulos legíveis + o valor com sinal.
export const linhasDoExtrato = (lancamentos = [], { de = "", ate = "" } = {}) => {
  const lista = Array.isArray(lancamentos) ? lancamentos : [];
  const dentro = (iso) => {
    const d = texto(iso).slice(0, 10);
    if (!d) return false;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  };
  return lista
    .filter((l) => !(de || ate) || dentro(l.dataServico))
    .map((l) => ({
      data: texto(l.dataServico).slice(0, 10),
      tipo: l.tipo || "",
      tipoRotulo: ROTULO_TIPO[l.tipo] || l.tipo || "",
      status: l.status || "pendente",
      statusRotulo: ROTULO_STATUS[l.status] || l.status || "Pendente",
      referencia: texto(l.referencia || l.observacao, 200),
      valor: arredondarReais(l.valor),
    }))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
};

const csvCampo = (v) => {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Extrato em CSV com separador ";" (padrão Excel pt-BR). O BOM UTF-8 fica com a
// tela (mesmo padrão do gerador de planilhas) — aqui é o texto puro, testável.
export const extratoCsv = (linhas = []) => {
  const cab = ["Data", "Tipo", "Situação", "Referência", "Valor (R$)"];
  const corpo = (Array.isArray(linhas) ? linhas : []).map((l) =>
    [l.data, l.tipoRotulo, l.statusRotulo, l.referencia, arredondarReais(l.valor).toFixed(2)]
      .map(csvCampo)
      .join(";"),
  );
  return [cab.join(";"), ...corpo].join("\n");
};

// ===== Conciliação do repasse =====================================

// Agrupa os lançamentos PAGOS por lote de repasse (settlement). É a soma que
// deveria ter saído em cada repasse — o lado interno da conciliação.
export const lotesDeRepasse = (lancamentosPagos = []) => {
  const lista = (Array.isArray(lancamentosPagos) ? lancamentosPagos : []).filter(
    (l) => texto(l.status) === "pago" && texto(l.settlementId || l.settlement_id),
  );
  const mapa = new Map();
  for (const l of lista) {
    const id = texto(l.settlementId || l.settlement_id);
    const atual = mapa.get(id) || { settlementId: id, driverId: texto(l.driverId || l.driver_id), total: 0, itens: 0 };
    atual.total = arredondarReais(atual.total + num(l.valor));
    atual.itens += 1;
    mapa.set(id, atual);
  }
  return [...mapa.values()];
};

// Casa os lotes internos com os retornos externos (SysPag/banco). Cada retorno:
// { referenciaExterna (= settlementId), valor, status?, idExterno? }.
// Classifica em: conferido (bate valor), divergente (valor diferente),
// sem_retorno (pago no razão, sem retorno externo) e sem_lancamento (retorno
// externo sem lote correspondente — dinheiro que saiu sem razão, o pior caso).
export const conciliarRepasses = (lancamentosPagos = [], retornos = []) => {
  const lotes = lotesDeRepasse(lancamentosPagos);
  const listaRet = Array.isArray(retornos) ? retornos : [];
  const porRef = new Map();
  for (const r of listaRet) {
    const ref = texto(r.referenciaExterna || r.settlementId || r.referencia);
    if (ref) porRef.set(ref, r);
  }
  const usados = new Set();

  const conferido = [];
  const divergente = [];
  const semRetorno = [];
  for (const lote of lotes) {
    const ret = porRef.get(lote.settlementId);
    if (!ret) {
      semRetorno.push(lote);
      continue;
    }
    usados.add(lote.settlementId);
    const valorRet = arredondarReais(ret.valor);
    if (Math.abs(valorRet - lote.total) < 0.01) {
      conferido.push({ ...lote, valorExterno: valorRet, idExterno: texto(ret.idExterno) });
    } else {
      divergente.push({ ...lote, valorExterno: valorRet, diferenca: arredondarReais(valorRet - lote.total), idExterno: texto(ret.idExterno) });
    }
  }

  const semLancamento = listaRet
    .filter((r) => {
      const ref = texto(r.referenciaExterna || r.settlementId || r.referencia);
      return ref && !usados.has(ref);
    })
    .map((r) => ({
      settlementId: texto(r.referenciaExterna || r.settlementId || r.referencia),
      valorExterno: arredondarReais(r.valor),
      idExterno: texto(r.idExterno),
    }));

  return {
    conferido,
    divergente,
    semRetorno,
    semLancamento,
    resumo: {
      lotes: lotes.length,
      conferidos: conferido.length,
      divergentes: divergente.length,
      semRetorno: semRetorno.length,
      semLancamento: semLancamento.length,
      // Concilia de verdade só quando não há divergência nem saída órfã.
      ok: divergente.length === 0 && semLancamento.length === 0,
    },
  };
};

// ===== Contratos de ganho recorrente ==============================

export const normalizarContrato = (corpo = {}) => ({
  driverId: texto(corpo.driverId, 120),
  descricao: texto(corpo.descricao, 200),
  valor: Math.max(0, arredondarReais(corpo.valor)),
  diaDoMes: Math.min(28, Math.max(1, Math.trunc(num(corpo.diaDoMes)) || 1)),
  ativo: corpo.ativo === undefined ? true : Boolean(corpo.ativo),
});

export const validarContrato = (corpo = {}) => {
  if (!texto(corpo.driverId)) return "Escolha o motorista do contrato.";
  if (!texto(corpo.descricao)) return "Descreva o contrato (ex.: ajuda de custo mensal).";
  if (!(num(corpo.valor) > 0)) return "Informe um valor mensal maior que zero.";
  return "";
};

// Referência única do lançamento de um contrato num mês — é ela que impede
// duplicar quando o mês é gerado de novo (reprocesso, dois cliques).
export const referenciaDoContrato = (contratoId, mesYm) =>
  `contrato-${texto(contratoId, 80)}-${texto(mesYm, 7)}`;

// O dia do mês, sem estourar meses curtos (dia 28 é o teto do contrato, então
// nunca cai fora — mas mantém a defesa para fevereiro se o teto mudar).
const diaValidoNoMes = (ano, mes0, dia) => {
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
  return Math.min(dia, ultimo);
};

// O lançamento que um contrato gera para um mês (YYYY-MM). kind "contrato",
// referência única (idempotência), data de serviço no dia do contrato. Contrato
// inativo ou sem valor não gera nada (null).
export const lancamentoDoContrato = (contrato = {}, mesYm = "") => {
  const c = normalizarContrato(contrato);
  const ym = texto(mesYm, 7);
  if (!c.ativo || !(c.valor > 0) || !/^\d{4}-\d{2}$/.test(ym) || !c.driverId) return null;
  const ano = Number(ym.slice(0, 4));
  const mes0 = Number(ym.slice(5, 7)) - 1;
  const dia = diaValidoNoMes(ano, mes0, c.diaDoMes);
  return {
    driverId: c.driverId,
    tipo: "contrato",
    valor: c.valor,
    referencia: c.descricao,
    dataServico: `${ym}-${String(dia).padStart(2, "0")}`,
    idempotencia: referenciaDoContrato(contrato.id || c.driverId, ym),
  };
};
