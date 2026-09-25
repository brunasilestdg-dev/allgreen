// ===== Automações agendadas do espaço (cron horário) =====
//
// Contrato
// - Recebe: `env` (com `env.DB`) e `now`, o horário do disparo.
// - Devolve: `{ workspaces, executions }` — quantos espaços mudaram e quantas
//   regras rodaram. Sem `env.DB`, não faz nada.
// - Quem chama: o `scheduled` de worker.js, no disparo horário.
// - Autorização: não há pessoa no pedido. Roda como sistema sobre todos os
//   espaços e só escreve no próprio espaço dono das regras
//   (`workspaces.user_id`), protegido por `revision` e com snapshot antes.
//
// Cada regra de `data.automations` que venceu no dia de São Paulo vira
// tarefa ou lembrete com id determinístico por regra+período: um disparo
// repetido não duplica nada.

import { ensureWorkspaceSnapshotsSchema } from "../lib/workspaceSchema.js";
import { notifyNewNotifications } from "../mensageria/envio.js";

function automationDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function scheduledAutomationPeriod(rule, ymd) {
  if (!rule || rule.enabled === false) return null;
  const [year, month, day] = String(ymd).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (rule.frequency === "monthly") {
    if (day < Math.min(31, Math.max(1, Number(rule.day) || 1))) return null;
    return ymd.slice(0, 7);
  }
  if (date.getUTCDay() !== (Number(rule.day) || 1)) return null;
  return ymd;
}

function serverAutomationTask(rule, ownerId, ymd, periodKey) {
  return {
    id: `automation-task-${rule.id}-${periodKey}`,
    title: rule.actionText || rule.name || "Tarefa automática",
    description: `Criada automaticamente por “${rule.name || "Automação"}”.`,
    priority: "Média",
    status: "A fazer",
    due: ymd,
    area: "Operação",
    assigneeType: "real",
    assignee: "",
    assigneeId: ownerId,
    project: "",
    isMission: false,
    distribution: "atribuida",
    difficulty: "Simples",
    slots: "1",
    points: "",
    reward: "",
    approvalMode: "imediata",
    allowWithdrawal: true,
    assignees: [],
    interested: [],
    missionStatus: "",
    deliveries: [],
    visibility: "privado",
    sharedWith: [],
    sharedTeams: [],
    subtasks: [],
    dependsOn: [],
    attachments: [],
    recurrence: { frequency: "none" },
    businessId: rule.businessId || null,
    ownerId,
    sourceAutomationId: rule.id,
    createdAt: new Date().toISOString(),
  };
}

async function ensureAutomationRunsSchema(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      action_type TEXT NOT NULL,
      output_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(owner_id, rule_id, period_key)
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_automation_runs_owner_created
    ON automation_runs(owner_id, created_at DESC)`,
  ).run();
}

export async function runScheduledAutomations(env, now = new Date()) {
  if (!env.DB) return { workspaces: 0, executions: 0 };
  await ensureAutomationRunsSchema(env);
  const ymd = automationDateKey(now);
  const result = await env.DB.prepare(
    "SELECT user_id, data, revision FROM workspaces ORDER BY updated_at DESC",
  ).all();
  let changedWorkspaces = 0;
  let executions = 0;
  for (const row of result.results || []) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    const rules = Array.isArray(data.automations) ? data.automations : [];
    const due = rules
      .map((rule) => ({
        rule,
        periodKey: scheduledAutomationPeriod(rule, ymd),
      }))
      .filter(
        ({ rule, periodKey }) =>
          periodKey && !(rule.history && rule.history[periodKey]),
      );
    if (!due.length) continue;

    const createdAt = now.toISOString();
    const beforeNotifications = data.notifications;
    const newTasks = [];
    const newNotifications = [];
    const updatedRules = rules.map((rule) => {
      const match = due.find((item) => item.rule.id === rule.id);
      if (!match) return rule;
      const outputId =
        (rule.actionType || "task") === "reminder"
          ? `automation-reminder-${rule.id}-${match.periodKey}`
          : `automation-task-${rule.id}-${match.periodKey}`;
      if ((rule.actionType || "task") === "reminder")
        newNotifications.push({
          id: outputId,
          assigneeId: row.user_id,
          ownerId: row.user_id,
          message: rule.actionText || rule.name || "Lembrete automático",
          link: "automacoes",
          read: false,
          sourceAutomationId: rule.id,
          createdAt,
        });
      else
        newTasks.push(
          serverAutomationTask(rule, row.user_id, ymd, match.periodKey),
        );
      return {
        ...rule,
        lastRun: createdAt,
        history: { ...(rule.history || {}), [match.periodKey]: createdAt },
      };
    });
    const nextData = {
      ...data,
      automations: updatedRules,
      tasks: [...newTasks, ...(Array.isArray(data.tasks) ? data.tasks : [])],
      notifications: [
        ...newNotifications,
        ...(Array.isArray(data.notifications) ? data.notifications : []),
      ],
    };
    await ensureWorkspaceSnapshotsSchema(env);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_snapshots
        (id, owner_id, revision, data, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        row.user_id,
        row.revision || 0,
        row.data,
        createdAt,
        row.user_id,
      )
      .run();
    const updated = await env.DB.prepare(
      `UPDATE workspaces
      SET data = ?, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND revision = ?
      RETURNING revision`,
    )
      .bind(
        JSON.stringify(nextData),
        createdAt,
        row.user_id,
        row.revision || 0,
      )
      .first();
    if (!updated) continue;
    changedWorkspaces += 1;
    for (const { rule, periodKey } of due) {
      const actionType = rule.actionType || "task";
      const outputId =
        actionType === "reminder"
          ? `automation-reminder-${rule.id}-${periodKey}`
          : `automation-task-${rule.id}-${periodKey}`;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO automation_runs
          (id, owner_id, rule_id, period_key, action_type, output_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          row.user_id,
          rule.id,
          periodKey,
          actionType,
          outputId,
          createdAt,
        )
        .run();
      executions += 1;
    }
    await notifyNewNotifications(
      env,
      beforeNotifications,
      nextData.notifications,
    ).catch((error) => console.error("automation push", error));
  }
  return { workspaces: changedWorkspaces, executions };
}
