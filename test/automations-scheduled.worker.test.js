import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

async function createUser(id) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, `Pessoa ${id}`, `${id}@example.com`, "hash", "salt", now)
    .run();
}

async function seedWorkspace(userId, data) {
  await env.DB.prepare(
    `INSERT INTO workspaces (user_id, data, updated_at, revision)
    VALUES (?, ?, ?, 0)`,
  )
    .bind(userId, JSON.stringify(data), new Date().toISOString())
    .run();
}

async function runHourly(iso) {
  const promises = [];
  const ctx = { waitUntil: (promise) => promises.push(promise) };
  await worker.scheduled(
    { scheduledTime: Date.parse(iso), cron: "0 * * * *" },
    env,
    ctx,
  );
  await Promise.all(promises);
}

async function workspace(userId) {
  const row = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(userId)
    .first();
  return { data: JSON.parse(row.data), revision: row.revision };
}

// Estes dois testes aguardam o fanout COMPLETO do cron (waitUntil de todos os
// serviços agendados). Em runner de CI estrangulado o setup já passou de 3
// minutos e os 15s padrão estouram sem bug nenhum — localmente rodam em ~1s.
// Timeout próprio de cron; as asserções continuam integrais.
const TEMPO_DE_CRON = 60_000;

describe("automações executadas pelo servidor", () => {
  it("cria tarefas e lembretes com o app fechado e não duplica o período", async () => {
    const userId = "scheduled-automation-owner";
    await createUser(userId);
    await seedWorkspace(userId, {
      tasks: [],
      notifications: [],
      automations: [
        {
          id: "weekly-rule",
          name: "Planejamento semanal",
          enabled: true,
          frequency: "weekly",
          day: 1,
          actionType: "task",
          actionText: "Planejar prioridades da semana",
          businessId: "business-1",
          history: {},
        },
        {
          id: "monthly-rule",
          name: "Cobranças",
          enabled: true,
          frequency: "monthly",
          day: 20,
          actionType: "reminder",
          actionText: "Revisar cobranças pendentes",
          history: {},
        },
      ],
    });

    await runHourly("2026-07-20T15:00:00.000Z");
    await runHourly("2026-07-20T16:00:00.000Z");

    const current = await workspace(userId);
    expect(current.revision).toBe(1);
    expect(current.data.tasks).toHaveLength(1);
    expect(current.data.tasks[0]).toMatchObject({
      id: "automation-task-weekly-rule-2026-07-20",
      title: "Planejar prioridades da semana",
      due: "2026-07-20",
      businessId: "business-1",
      sourceAutomationId: "weekly-rule",
    });
    expect(current.data.notifications).toHaveLength(1);
    expect(current.data.notifications[0]).toMatchObject({
      id: "automation-reminder-monthly-rule-2026-07",
      message: "Revisar cobranças pendentes",
      sourceAutomationId: "monthly-rule",
    });
    expect(current.data.automations[0].history["2026-07-20"]).toEqual(
      expect.any(String),
    );
    expect(current.data.automations[1].history["2026-07"]).toEqual(
      expect.any(String),
    );

    const runs = await env.DB.prepare(
      `SELECT rule_id AS ruleId, period_key AS periodKey, action_type AS actionType
      FROM automation_runs WHERE owner_id = ? ORDER BY rule_id`,
    )
      .bind(userId)
      .all();
    expect(runs.results).toEqual([
      {
        ruleId: "monthly-rule",
        periodKey: "2026-07",
        actionType: "reminder",
      },
      {
        ruleId: "weekly-rule",
        periodKey: "2026-07-20",
        actionType: "task",
      },
    ]);
  }, TEMPO_DE_CRON);

  it("ignora regras desligadas e regras que ainda não venceram", async () => {
    const userId = "scheduled-automation-not-due";
    await createUser(userId);
    await seedWorkspace(userId, {
      tasks: [],
      notifications: [],
      automations: [
        {
          id: "disabled",
          enabled: false,
          frequency: "weekly",
          day: 1,
          actionText: "Não executar",
        },
        {
          id: "future",
          enabled: true,
          frequency: "monthly",
          day: 25,
          actionText: "Ainda não",
        },
      ],
    });

    await runHourly("2026-07-20T15:00:00.000Z");

    const current = await workspace(userId);
    expect(current.revision).toBe(0);
    expect(current.data.tasks).toEqual([]);
    expect(current.data.notifications).toEqual([]);
  }, TEMPO_DE_CRON);
});
