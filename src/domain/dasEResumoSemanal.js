// ===== DAS do MEI e resumo semanal =====
//
// Dois lembretes que o produto manda sozinho, e a razão de estarem juntos: os
// dois são função pura que roda em dois lugares. Aqui, para a tela; e em
// worker/services/weekly-summary.js, para o Cron disparar o push mesmo com o
// app fechado.
//
// É esse "existe em dois lugares" que torna a extração necessária. Enquanto
// moravam no meio de App.jsx, manter as duas cópias em sincronia dependia de
// alguém lembrar; num módulo próprio, dá para o worker importar a mesma
// função em vez de manter a segunda cópia.

// ── DAS do MEI ──────────────────────────────────────────────────────────
// O imposto mensal do MEI (guia DAS) vence todo dia 20. Atraso gera juros e,
// acumulado, pode até desenquadrar o MEI — por isso um lembrete automático é
// a dor mais universal de quem usa o app. Tudo aqui é função pura para ser
// fácil de testar; a notificação real reaproveita db.notifications, que já
// dispara o Web Push quando aparece um item novo na sincronização.
import { today } from "../domain.js";

export const DAS_DEFAULT_DUE_DAY = 20;

export const monthLabelPt = (ym) => {
  const label = new Date(`${ym}-01T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const dasStatus = (taxProfile, ymd = today()) => {
  const dueDay = Number(taxProfile?.dueDay) || DAS_DEFAULT_DUE_DAY;
  const ym = ymd.slice(0, 7);
  const day = Number(ymd.slice(8, 10));
  if (!taxProfile?.isMEI) return { status: "off", ym, dueDay, paid: false };
  const paid = !!taxProfile?.dasHistory?.[ym]?.paid;
  if (paid) return { status: "pago", ym, dueDay, paid: true };
  if (day > dueDay) return { status: "atrasado", ym, dueDay, paid: false };
  return { status: "a_pagar", ym, dueDay, paid: false };
};

// Retorna um novo array de notificações (com o lembrete adicionado) ou null
// quando não há nada a notificar. Idempotente: o id determinístico por mês+tipo
// impede lembretes duplicados a cada sincronização.
export const buildDasReminder = (
  taxProfile,
  notifications,
  userId,
  ymd = today(),
) => {
  if (!userId) return null;
  const { status, ym, dueDay } = dasStatus(taxProfile, ymd);
  const day = Number(ymd.slice(8, 10));
  let type = null;
  if (status === "atrasado") type = "atrasado";
  else if (status === "a_pagar" && day >= dueDay - 5) type = "lembrete";
  if (!type) return null;
  const notifId = `das-${ym}-${type}`;
  if ((notifications || []).some((n) => n && n.id === notifId)) return null;
  const label = monthLabelPt(ym);
  const message =
    type === "atrasado"
      ? `O DAS do MEI de ${label} venceu no dia ${dueDay} e ainda não está marcado como pago. Regularize para não acumular juros.`
      : `O DAS do MEI de ${label} vence no dia ${dueDay}. Não esqueça de emitir e pagar a guia.`;
  return [
    {
      id: notifId,
      assigneeId: userId,
      ownerId: userId,
      message,
      link: "financeiro",
      read: false,
      createdAt: new Date().toISOString(),
    },
    ...(notifications || []),
  ].slice(0, 50);
};

// ── Resumo semanal ──────────────────────────────────────────────────────
// Prova de valor recorrente: números tangíveis da semana (vendas, caixa,
// tarefas) entregues por push — não uma tela que a pessoa precisa lembrar de
// abrir. computeWeeklySummary é puro e existe também em worker/services/weekly-summary.js (que envia
// o push via Cron mesmo com o app fechado); manter as duas cópias em sincronia.
export const weekRange = (ymd = today()) => {
  const d = new Date(`${ymd}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // segunda = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
};

export const previousWeekRange = (ymd = today()) => {
  const { start } = weekRange(ymd);
  const prev = new Date(`${start}T12:00:00`);
  prev.setDate(prev.getDate() - 1);
  return weekRange(prev.toISOString().slice(0, 10));
};

const withinRange = (ymd, start, end) => !!ymd && ymd >= start && ymd <= end;

export const computeWeeklySummary = (data, start, end) => {
  const ymd = (v) => String(v || "").slice(0, 10);
  const orders = (Array.isArray(data?.orders) ? data.orders : []).filter(
    (o) =>
      o.status !== "Cancelado" && withinRange(ymd(o.createdAt), start, end),
  );
  const weekTx = (
    Array.isArray(data?.transactions) ? data.transactions : []
  ).filter((t) => withinRange(ymd(t.date), start, end));
  const cashIn = weekTx
    .filter((t) => t.type === "Receita")
    .reduce((a, t) => a + Number(t.value || 0), 0);
  const cashOut = weekTx
    .filter((t) => t.type === "Despesa")
    .reduce((a, t) => a + Number(t.value || 0), 0);
  const doneTasks = (Array.isArray(data?.tasks) ? data.tasks : []).filter(
    (t) =>
      t.status === "Concluído" && withinRange(ymd(t.updatedAt), start, end),
  );
  const tasksDone = doneTasks.length;
  const tasksReward = doneTasks.reduce((a, t) => a + Number(t.reward || 0), 0);
  const newLeads = (Array.isArray(data?.leads) ? data.leads : []).filter((l) =>
    withinRange(ymd(l.createdAt), start, end),
  ).length;
  const salesRevenue = orders.reduce((a, o) => a + Number(o.total || 0), 0);
  return {
    start,
    end,
    sales: orders.length,
    salesRevenue,
    cashIn,
    cashOut,
    cashNet: cashIn - cashOut,
    tasksDone,
    tasksReward,
    newLeads,
    hasActivity:
      orders.length > 0 || weekTx.length > 0 || tasksDone > 0 || newLeads > 0,
  };
};

export const dayRangeLabel = (start, end) => {
  const fmt = (ymd) =>
    new Date(`${ymd}T12:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  return `${fmt(start)} a ${fmt(end)}`;
};
