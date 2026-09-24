// ===== Resumo semanal por push (cron de segunda) =====
//
// Contrato
// - Recebe: `env` e `now`, o horário do disparo semanal.
// - Devolve: `{ sent }` — quantos pushes foram entregues.
// - Quem chama: o `scheduled` de worker.js, só no disparo semanal.
// - Autorização: não há pessoa no pedido. Percorre os espaços e manda o
//   resumo só para as assinaturas de push do próprio dono; a semana fica
//   reservada em `weekly_summary_log` para não enviar em dobro.

import { moneyBRL } from "../lib/format.js";
import { pushEnabled, sendWebPush } from "../mensageria/envio.js";

// ── Resumo semanal ──────────────────────────────────────────────────────
// Cópia sincronizada de computeWeeklySummary em src/App.jsx. Aqui roda no
// handler `scheduled` (Cron) para enviar o resumo por push mesmo com o app
// fechado — a razão de ser da funcionalidade.
function weekRangeFrom(date) {
  const d = new Date(date);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow),
  );
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

function previousWeekBounds(date) {
  const { start } = weekRangeFrom(date);
  const prev = new Date(`${start}T12:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return weekRangeFrom(prev);
}

function computeWeeklySummary(data, start, end) {
  const within = (v) => {
    const ymd = String(v || "").slice(0, 10);
    return ymd && ymd >= start && ymd <= end;
  };
  const orders = (Array.isArray(data?.orders) ? data.orders : []).filter(
    (o) => o.status !== "Cancelado" && within(o.createdAt),
  );
  const weekTx = (Array.isArray(data?.transactions) ? data.transactions : []).filter(
    (t) => within(t.date),
  );
  const cashIn = weekTx
    .filter((t) => t.type === "Receita")
    .reduce((a, t) => a + Number(t.value || 0), 0);
  const cashOut = weekTx
    .filter((t) => t.type === "Despesa")
    .reduce((a, t) => a + Number(t.value || 0), 0);
  const doneTasks = (Array.isArray(data?.tasks) ? data.tasks : []).filter(
    (t) => t.status === "Concluído" && within(t.updatedAt),
  );
  const tasksDone = doneTasks.length;
  const tasksReward = doneTasks.reduce((a, t) => a + Number(t.reward || 0), 0);
  const newLeads = (Array.isArray(data?.leads) ? data.leads : []).filter((l) =>
    within(l.createdAt),
  ).length;
  const sales = orders.length;
  return {
    sales,
    salesRevenue: orders.reduce((a, o) => a + Number(o.total || 0), 0),
    cashIn,
    cashNet: cashIn - cashOut,
    tasksDone,
    tasksReward,
    newLeads,
    hasActivity: sales > 0 || weekTx.length > 0 || tasksDone > 0 || newLeads > 0,
  };
}

function weeklySummaryBody(summary) {
  const parts = [];
  if (summary.sales > 0)
    parts.push(`${summary.sales} venda(s) somando ${moneyBRL(summary.salesRevenue)}`);
  if (summary.cashIn > 0) parts.push(`${moneyBRL(summary.cashIn)} em entradas`);
  if (summary.tasksDone > 0)
    parts.push(`${summary.tasksDone} tarefa(s) concluída(s)`);
  if (summary.newLeads > 0)
    parts.push(`${summary.newLeads} novo(s) contato(s)`);
  const list = parts.join(", ").replace(/,([^,]*)$/, " e$1");
  return `Semana passada você teve ${list}. Bom trabalho — bora fazer esta semana render também!`;
}

// Envia o resumo da semana anterior por push para todo dono com atividade e
// pelo menos uma assinatura ativa. Roda uma vez por semana (Cron de segunda).
export async function sendWeeklySummaries(env, now) {
  if (!env.DB || !pushEnabled(env)) return { sent: 0 };
  const { start, end } = previousWeekBounds(now);
  let workspaces;
  try {
    workspaces = await env.DB.prepare(
      "SELECT user_id, data FROM workspaces",
    ).all();
  } catch (error) {
    console.error("weekly summary query", error);
    return { sent: 0 };
  }
  let sent = 0;
  for (const row of workspaces.results || []) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    const summary = computeWeeklySummary(data, start, end);
    if (!summary.hasActivity) continue;
    let subs;
    try {
      subs = await env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
      )
        .bind(row.user_id)
        .all();
    } catch (error) {
      console.error("weekly summary subs", error);
      continue;
    }
    const rows = subs.results || [];
    if (!rows.length) continue;
    // O Cron do Cloudflare é "pelo menos uma vez": em raros casos dispara em
    // dobro. Reservar a semana com INSERT OR IGNORE garante um único envio por
    // dono por semana — se a linha já existe, outro disparo chegou primeiro.
    try {
      const claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO weekly_summary_log (user_id, week_start, sent_at)
        VALUES (?, ?, ?)`,
      )
        .bind(row.user_id, start, new Date().toISOString())
        .run();
      if (!claim.meta.changes) continue;
    } catch (error) {
      console.error("weekly summary claim", error);
      continue;
    }
    const message = {
      data: {
        title: "Seu resumo da semana",
        body: weeklySummaryBody(summary),
        link: "inicio",
      },
      options: { ttl: 86400, urgency: "normal" },
    };
    let delivered = 0;
    for (const s of rows) {
      const subscription = {
        endpoint: s.endpoint,
        expirationTime: null,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        const result = await sendWebPush(env, subscription, message);
        if (result.ok) {
          sent += 1;
          delivered += 1;
        }
        else if (result.gone)
          await env.DB.prepare(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
          )
            .bind(s.endpoint)
            .run();
      } catch (error) {
        console.error("weekly summary push", error);
      }
    }
    // Uma reserva só representa envio concluído quando ao menos um
    // dispositivo confirmou a entrega. Se todos falharem, libere a semana
    // para a próxima execução tentar novamente.
    if (!delivered) {
      try {
        await env.DB.prepare(
          "DELETE FROM weekly_summary_log WHERE user_id = ? AND week_start = ?",
        )
          .bind(row.user_id, start)
          .run();
      } catch (error) {
        console.error("weekly summary release", error);
      }
    }
  }
  return { sent };
}
