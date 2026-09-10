const ENCERRADOS = new Set(["completed", "concluida", "delivered", "entregue"]);
const CANCELADOS = new Set(["cancelled", "canceled", "cancelado"]);

const texto = (value) => String(value ?? "").trim();
const statusNormalizado = (value) => texto(value).toLowerCase();
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const dataMs = (value) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const valorPesquisavel = (value) => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valorPesquisavel).join(" ");
  if (typeof value === "object") return Object.values(value).map(valorPesquisavel).join(" ");
  return texto(value);
};

export const isClosedTmsStatus = (status) => {
  const value = statusNormalizado(status);
  return ENCERRADOS.has(value) || CANCELADOS.has(value);
};

export function slaState(record, now = Date.now()) {
  const status = statusNormalizado(record?.status);
  const cancelled = CANCELADOS.has(status);
  const completed = ENCERRADOS.has(status);
  const deadlineValue = record?.scheduledEndAt || record?.promisedAt || record?.deadline || "";
  const deadline = dataMs(deadlineValue);
  const finishedAt = dataMs(record?.completedAt || record?.deliveredAt || record?.occurredAt);

  if (cancelled) return { level: "cancelled", label: "Cancelada", deadline: deadlineValue, minutes: null };
  if (completed) {
    if (deadline && finishedAt && finishedAt > deadline) {
      return { level: "late", label: "Concluída com atraso", deadline: deadlineValue, minutes: Math.ceil((finishedAt - deadline) / 60000) };
    }
    return { level: "completed", label: "Concluída", deadline: deadlineValue, minutes: null };
  }
  if (!deadline) return { level: "no_deadline", label: "Sem prazo", deadline: "", minutes: null };

  const minutes = Math.ceil((deadline - now) / 60000);
  if (minutes < 0) return { level: "late", label: "Atrasada", deadline: deadlineValue, minutes: Math.abs(minutes) };
  if (minutes <= 120) return { level: "risk", label: "Risco de SLA", deadline: deadlineValue, minutes };
  if (minutes <= 24 * 60) return { level: "attention", label: "Vence hoje", deadline: deadlineValue, minutes };
  return { level: "on_time", label: "No prazo", deadline: deadlineValue, minutes };
}

export function filterTmsRecords(records, filters = {}, now = Date.now()) {
  const query = texto(filters.query).toLocaleLowerCase("pt-BR");
  const status = statusNormalizado(filters.status);
  const risk = texto(filters.risk);
  const sorted = (Array.isArray(records) ? records : []).filter((record) => {
    if (status && statusNormalizado(record?.status) !== status) return false;
    const sla = slaState(record, now);
    if (risk && sla.level !== risk) return false;
    if (!query) return true;
    return valorPesquisavel(record).toLocaleLowerCase("pt-BR").includes(query);
  });

  return sorted.sort((a, b) => {
    const priority = { late: 0, risk: 1, attention: 2, no_deadline: 3, on_time: 4, completed: 5, cancelled: 6 };
    const aSla = slaState(a, now);
    const bSla = slaState(b, now);
    const byPriority = (priority[aSla.level] ?? 9) - (priority[bSla.level] ?? 9);
    if (byPriority) return byPriority;
    const aDate = dataMs(aSla.deadline || a?.updatedAt || a?.createdAt) || 0;
    const bDate = dataMs(bSla.deadline || b?.updatedAt || b?.createdAt) || 0;
    return aDate - bDate;
  });
}

export function paginateTmsRecords(records, page = 1, pageSize = 20) {
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const total = Array.isArray(records) ? records.length : 0;
  const pages = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  const start = (current - 1) * safeSize;
  return { rows: records.slice(start, start + safeSize), page: current, pages, total, pageSize: safeSize };
}

export function summarizeTms(data, now = Date.now()) {
  const orders = data?.all?.orders || data?.recent?.orders || [];
  const operations = data?.all?.operations || data?.recent?.operations || [];
  const fiscal = data?.all?.fiscal || data?.recent?.fiscal || [];
  const ciots = data?.all?.ciots || data?.recent?.ciots || [];
  const billing = data?.all?.billing || [];
  const openOrders = orders.filter((item) => !isClosedTmsStatus(item.status));
  const openOperations = operations.filter((item) => !isClosedTmsStatus(item.status));
  const orderSla = openOrders.map((item) => ({ item, sla: slaState(item, now) }));
  const delayedOrders = orderSla.filter(({ sla }) => sla.level === "late");
  const riskOrders = orderSla.filter(({ sla }) => ["risk", "attention"].includes(sla.level));
  const noDeadlineOrders = orderSla.filter(({ sla }) => sla.level === "no_deadline");
  const unlinked = operations.filter((item) => !item.clientId || !item.operationId);
  const billingValue = billing.reduce((sum, item) => sum + numero(item.amount), 0);
  const revenueAtRisk = [...delayedOrders, ...riskOrders].reduce((sum, entry) => sum + numero(entry.item.netAmount), 0);

  return {
    orders: orders.length,
    ordersOpen: openOrders.length,
    operationsOpen: openOperations.length,
    delayedOrders: delayedOrders.length,
    riskOrders: riskOrders.length,
    noDeadlineOrders: noDeadlineOrders.length,
    unlinkedOperations: unlinked.length,
    fiscalPending: fiscal.filter((item) => !["autorizado", "cancelado"].includes(statusNormalizado(item.status))).length,
    ciotPending: ciots.filter((item) => !["issued", "closed", "cancelled", "canceled"].includes(statusNormalizado(item.status))).length,
    billingPending: billing.length,
    billingValue,
    revenueAtRisk,
  };
}

export function buildTmsActionQueue(data, now = Date.now()) {
  const calculated = summarizeTms(data, now);
  const indicators = data?.indicators || {};
  // Quando o servidor devolve agregados, eles vencem a página carregada. Isso
  // mantém a fila correta mesmo com centenas de milhares de registros.
  const summary = {
    ...calculated,
    delayedOrders: Number(indicators.ordersDelayed ?? calculated.delayedOrders),
    riskOrders: Number(indicators.ordersAtRisk ?? calculated.riskOrders),
    noDeadlineOrders: Number(indicators.ordersWithoutDeadline ?? calculated.noDeadlineOrders),
    unlinkedOperations: Number(indicators.unlinkedExternalDocs ?? calculated.unlinkedOperations),
    fiscalPending: indicators.ctePending != null || indicators.mdfePending != null
      ? Number(indicators.ctePending || 0) + Number(indicators.mdfePending || 0)
      : calculated.fiscalPending,
    ciotPending: Number(indicators.ciotPending ?? calculated.ciotPending),
    billingPending: Number(indicators.billingPending ?? calculated.billingPending),
  };
  const actions = [
    summary.delayedOrders && { id: "late", tone: "critical", title: `${summary.delayedOrders} carga(s) atrasada(s)`, detail: "Prazo de entrega vencido e execução ainda aberta.", section: "cargas" },
    summary.riskOrders && { id: "risk", tone: "warning", title: `${summary.riskOrders} carga(s) próximas do SLA`, detail: "Vencimento em até 24 horas. Priorize despacho e tratativa.", section: "cargas" },
    summary.unlinkedOperations && { id: "unlinked", tone: "warning", title: `${summary.unlinkedOperations} documento(s) sem vínculo`, detail: "Associe cliente e operação para não perder rastreabilidade.", section: "integracoes" },
    summary.fiscalPending && { id: "fiscal", tone: "warning", title: `${summary.fiscalPending} documento(s) fiscal(is) pendente(s)`, detail: "CT-e ou MDF-e ainda sem autorização.", section: "fiscal" },
    summary.ciotPending && { id: "ciot", tone: "warning", title: `${summary.ciotPending} CIOT(s) pendente(s)`, detail: "Regularize antes do início da viagem aplicável.", section: "fiscal" },
    summary.billingPending && { id: "billing", tone: "info", title: `${summary.billingPending} item(ns) pronto(s) para faturar`, detail: "Execução concluída e com comprovante disponível.", section: "faturamento" },
    summary.noDeadlineOrders && { id: "deadline", tone: "info", title: `${summary.noDeadlineOrders} carga(s) sem prazo`, detail: "Sem janela de entrega não existe gestão de SLA.", section: "cargas" },
  ].filter(Boolean);

  return actions.length ? actions : [{ id: "clear", tone: "ok", title: "Operação sem pendências críticas", detail: "Nenhuma fila prioritária foi identificada nos dados carregados.", section: "controle" }];
}

const csvCell = (value) => `"${texto(value).replaceAll('"', '""')}"`;

export function tmsCsv(columns, records) {
  const header = columns.map((column) => csvCell(column.label)).join(";");
  const lines = (records || []).map((record) => columns.map((column) => csvCell(
    typeof column.value === "function" ? column.value(record) : record?.[column.value],
  )).join(";"));
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}
