// ===== Ordem de serviço: custo realizado e avanço derivado =====
//
// Camada pura. A regra que organiza o arquivo, igual à do estoque e das compras:
// o número que a tela mostra é derivado. O avanço da OS sai dos apontamentos, o
// custo realizado sai do material consumido e da hora apontada — nenhum dos dois
// é coluna.
//
// Isso não é preciosismo. Um percentual gravado diria 100% enquanto as horas
// dizem 40%, e ninguém saberia qual dos dois está certo. É a mesma razão pela
// qual a jornada de eletrificação "não marca etapa como concluída só por
// clique".

const texto = (valor) => String(valor ?? "").trim();

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const dinheiro = (valor) => Math.round((numero(valor) + Number.EPSILON) * 100) / 100;

// Estimativa AUSENTE não é zero. "Não estimamos" e "estimamos zero" são coisas
// diferentes, e confundi-las faria toda OS sem estimativa aparecer como 100%
// estourada no relatório.
const estimativa = (valor) =>
  valor === null || valor === undefined || valor === "" ? null : numero(valor);

export const SERVICE_ORDER_STATUSES = Object.freeze([
  { id: "aberta", name: "Aberta" },
  { id: "em_execucao", name: "Em execução" },
  { id: "pausada", name: "Pausada" },
  { id: "concluida", name: "Concluída" },
  { id: "cancelada", name: "Cancelada" },
]);

// Transição declarada. Concluída e cancelada não são terminais aqui de
// propósito: reabrir uma OS para apontar hora esquecida é rotina em operação, e
// travar isso empurraria o apontamento para uma OS nova, quebrando o histórico
// de custo do serviço. O que trava o passado é o fechamento de período, no
// financeiro — não a OS.
const TRANSICOES = Object.freeze({
  aberta: ["em_execucao", "cancelada"],
  em_execucao: ["pausada", "concluida", "cancelada"],
  pausada: ["em_execucao", "cancelada"],
  concluida: ["em_execucao"],
  cancelada: ["aberta"],
});

export const podeMudarStatus = (de, para) =>
  (TRANSICOES[texto(de)] || []).includes(texto(para));

// ---------------------------------------------------------------------------
// Custo realizado
// ---------------------------------------------------------------------------

export const custoDoMaterial = (materiais = []) =>
  dinheiro(materiais.reduce(
    (soma, linha) => soma + Math.abs(numero(linha?.quantity)) * Math.max(0, numero(linha?.unitCost)),
    0,
  ));

export const custoDaMaoDeObra = (apontamentos = []) =>
  dinheiro(apontamentos.reduce(
    (soma, linha) => soma + Math.abs(numero(linha?.hours)) * Math.max(0, numero(linha?.hourlyCost)),
    0,
  ));

export const horasApontadas = (apontamentos = []) =>
  Math.round(apontamentos.reduce((soma, linha) => soma + Math.abs(numero(linha?.hours)), 0) * 100) / 100;

// Custo realizado vs. previsto. `desvio` e `desvioPercent` são `null` quando não
// houve estimativa — comparar contra nada e devolver 100% mentiria.
export const custoDaOrdem = (ordem = {}, materiais = [], apontamentos = []) => {
  const material = custoDoMaterial(materiais);
  const maoDeObra = custoDaMaoDeObra(apontamentos);
  const realizado = dinheiro(material + maoDeObra);
  const previsto = estimativa(ordem.estimatedCost);

  return {
    material,
    maoDeObra,
    realizado,
    previsto,
    desvio: previsto === null ? null : dinheiro(realizado - previsto),
    desvioPercent: previsto !== null && previsto > 0
      ? Math.round(((realizado - previsto) / previsto) * 1000) / 10
      : null,
    // Só é estouro quando há previsão para estourar.
    estourou: previsto !== null && previsto > 0 && realizado > previsto,
  };
};

// ---------------------------------------------------------------------------
// Avanço
// ---------------------------------------------------------------------------

// O avanço sai das HORAS apontadas contra as estimadas. Sem estimativa de horas,
// devolve `null` — e a tela mostra "sem estimativa" em vez de uma barra que
// finge saber. `limitado` avisa quando passou de 100%: o trabalho continua, mas
// a barra para, e esconder isso faria a OS parecer no prazo.
export const avancoDaOrdem = (ordem = {}, apontamentos = []) => {
  const horas = horasApontadas(apontamentos);
  const previstas = estimativa(ordem.estimatedHours);

  // Concluída sem estimativa é 100%: a decisão de gente resolve o que a
  // aritmética não consegue.
  if (previstas === null || previstas <= 0) {
    return {
      percentual: texto(ordem.status) === "concluida" ? 100 : null,
      horas,
      horasPrevistas: previstas,
      limitado: false,
    };
  }

  const bruto = (horas / previstas) * 100;
  return {
    percentual: Math.min(100, Math.round(bruto)),
    horas,
    horasPrevistas: previstas,
    limitado: bruto > 100,
  };
};

// Situação de prazo, derivada das datas. `null` quando não há prazo declarado —
// uma OS sem data combinada não pode estar atrasada.
export const prazoDaOrdem = (ordem = {}, hojeYmd = "") => {
  const fim = texto(ordem.scheduledEnd).slice(0, 10);
  const hoje = texto(hojeYmd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) return null;

  const concluida = texto(ordem.status) === "concluida";
  const referencia = concluida ? texto(ordem.finishedAt).slice(0, 10) || hoje : hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referencia)) return null;

  const ms = Date.parse(`${referencia}T00:00:00.000Z`) - Date.parse(`${fim}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  const dias = Math.round(ms / 86400000);

  return {
    dias: Math.abs(dias),
    // Concluída depois do prazo continua sendo entrega atrasada — o fato não
    // deixa de ser verdade porque o trabalho acabou.
    situacao: dias > 0 ? (concluida ? "entregue_com_atraso" : "atrasada") : concluida ? "entregue_no_prazo" : "no_prazo",
  };
};

// ---------------------------------------------------------------------------
// A ponte: consumo → movimento de estoque
// ---------------------------------------------------------------------------

// Pura: monta o movimento e devolve. Quem grava é o handler — o mesmo princípio
// de `buildOrderReceita` e `recebimentoParaMovimentos`.
//
// Consumo é SAÍDA de estoque, e por isso passa pela conferência de saldo do
// handler de estoque: consumir o que não tem é o mesmo erro de vender o que não
// tem.
export const consumoParaMovimento = (consumo = {}, ordem = {}) => {
  const itemId = texto(consumo.itemId);
  const quantidade = Math.abs(numero(consumo.quantity));
  if (!itemId || !quantidade) return null;
  return {
    itemId,
    warehouseId: texto(consumo.warehouseId) || texto(ordem.warehouseId),
    kind: "saida",
    quantity: quantidade,
    // A saída não declara custo: ela consome o custo médio do estoque. Este
    // valor viaja só para ser COPIADO na linha da OS, para o custo do serviço
    // não mudar quando o preço do fornecedor mudar depois.
    unitCost: 0,
    originType: "ordem_servico",
    originId: texto(consumo.id),
    originNumber: texto(ordem.documentNumber),
    occurredAt: texto(consumo.consumedAt),
  };
};

// Devolver material que sobrou da OS. Entrada de volta ao depósito, com o mesmo
// custo com que saiu — devolver a custo zero baixaria a média do estoque sem
// razão.
export const devolucaoParaMovimento = (consumo = {}, ordem = {}, quantidade = 0) => {
  const qtd = Math.abs(numero(quantidade));
  const consumido = Math.abs(numero(consumo.quantity));
  if (!qtd || qtd > consumido) return null;
  return {
    itemId: texto(consumo.itemId),
    warehouseId: texto(consumo.warehouseId) || texto(ordem.warehouseId),
    kind: "entrada",
    quantity: qtd,
    unitCost: Math.max(0, numero(consumo.unitCost)),
    originType: "ordem_servico_devolucao",
    originId: texto(consumo.id),
    originNumber: texto(ordem.documentNumber),
    occurredAt: texto(consumo.consumedAt),
  };
};

// ---------------------------------------------------------------------------
// Resumo da carteira de ordens
// ---------------------------------------------------------------------------

export const resumoDasOrdens = (ordens = [], hojeYmd = "") => {
  const base = {
    total: ordens.length,
    abertas: 0,
    emExecucao: 0,
    concluidas: 0,
    atrasadas: 0,
    custoRealizado: 0,
    // Só soma o previsto de quem TEM previsão. Somar zero pelos sem estimativa
    // faria o previsto total parecer menor que o realizado sempre.
    custoPrevisto: 0,
    ordensComPrevisao: 0,
  };

  return ordens.reduce((resumo, ordem) => {
    const status = texto(ordem.status);
    if (status === "aberta") resumo.abertas += 1;
    if (status === "em_execucao") resumo.emExecucao += 1;
    if (status === "concluida") resumo.concluidas += 1;
    if (prazoDaOrdem(ordem, hojeYmd)?.situacao === "atrasada") resumo.atrasadas += 1;

    resumo.custoRealizado = dinheiro(resumo.custoRealizado + numero(ordem.custo?.realizado));
    const previsto = estimativa(ordem.estimatedCost);
    if (previsto !== null) {
      resumo.custoPrevisto = dinheiro(resumo.custoPrevisto + previsto);
      resumo.ordensComPrevisao += 1;
    }
    return resumo;
  }, base);
};

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export const validateServiceOrder = (ordem = {}) => {
  if (!texto(ordem.title)) return "Informe o que precisa ser feito.";
  if (estimativa(ordem.estimatedHours) !== null && numero(ordem.estimatedHours) < 0)
    return "As horas previstas não podem ser negativas.";
  if (estimativa(ordem.estimatedCost) !== null && numero(ordem.estimatedCost) < 0)
    return "O custo previsto não pode ser negativo.";
  const inicio = texto(ordem.scheduledStart).slice(0, 10);
  const fim = texto(ordem.scheduledEnd).slice(0, 10);
  if (inicio && fim && fim < inicio) return "O prazo final não pode ser antes do início.";
  return "";
};

export const validateMaterialConsumption = (consumo = {}) => {
  if (!texto(consumo.itemId)) return "Informe o material consumido.";
  if (!(numero(consumo.quantity) > 0)) return "A quantidade precisa ser maior que zero.";
  if (!texto(consumo.consumedAt)) return "Informe a data do consumo.";
  return "";
};

export const validateTimeEntry = (apontamento = {}) => {
  // Terceirizado e prestador apontam hora e não têm login; exigir usuário
  // impediria de registrar quem de fato trabalhou.
  if (!texto(apontamento.userId) && !texto(apontamento.personName))
    return "Informe quem trabalhou.";
  if (!(numero(apontamento.hours) > 0)) return "As horas precisam ser maiores que zero.";
  // Um dia tem 24 horas. Aceitar 240 por erro de digitação estragaria o custo do
  // serviço sem ninguém notar.
  if (numero(apontamento.hours) > 24) return "Não é possível apontar mais de 24 horas num dia.";
  if (numero(apontamento.hourlyCost) < 0) return "O custo por hora não pode ser negativo.";
  if (!texto(apontamento.workedOn)) return "Informe a data do trabalho.";
  return "";
};
