import { buildPushPayload } from "@block65/webcrypto-web-push";
import {
  createSession,
  encoder,
  hex,
  passwordHash,
  randomHex,
  sameHash,
  sessionUser,
  sha256,
  unhex,
} from "./worker/auth/credenciais.js";
import { cleanText, moneyBRL } from "./worker/lib/format.js";
import { allowed, json } from "./worker/lib/http.js";
import { statusDoGateway } from "./worker/services/ai-gateway.js";
import { handleBuscaVetores } from "./worker/services/busca-semantica.js";
import {
  caixaDoTurnstile,
  cspComTurnstile,
  exigirTurnstile,
  scriptDoTurnstile,
  turnstileSiteKey,
} from "./worker/lib/turnstile.js";
import { handleRouteEstimate } from "./worker/services/route-estimate.js";
import { logAudit } from "./worker/lib/audit.js";
import { membershipRole } from "./worker/lib/membership.js";
import { ensureWorkspaceSnapshotsSchema } from "./worker/lib/workspaceSchema.js";
import {
  canEditRecord,
  canSeeTask,
  filterRecordsForViewer,
  resolveViewerContext,
} from "./worker/lib/visibility.js";
import {
  emailEnabled,
  notifyNewNotifications,
  pushEnabled,
  sendEmail,
  sendEmailText,
  sendWebPush,
  sendWhatsAppText,
  escMail,
  whatsappEnabled,
} from "./worker/mensageria/envio.js";
import { planSnapshot } from "./worker/services/plan-usage.js";
import {
  applyPersonalInboxState,
  buildPersonalInboxItems,
  personalInboxSummary,
} from "./src/features/inbox/personalInboxDomain.js";
import {
  normalizePublicForm,
  publicFormAnswerSummary,
  publicFormFieldIsVisible,
  validatePublicFormSubmission,
} from "./src/features/forms/publicFormDomain.js";
import {
  buildClientPortalSnapshot,
  clientPortalSummary,
  normalizeClientPortal,
  validateClientPortalAction,
} from "./src/features/portal/clientPortalDomain.js";
import {
  buildProcessConnections,
  createProcessCase,
} from "./src/features/processes/processDomain.js";
import {
  askOpenAICompatible,
  configuredAiProviders,
  handleAi,
  handleAiStream,
  publicAiResult,
} from "./worker/services/ai.js";
import { webSearchConfiguration } from "./worker/services/web-search.js";
// Reexportado para quem já importava daqui (src/ai-providers.test.js).
export { askOpenAICompatible, configuredAiProviders, publicAiResult };
import { handleAuth } from "./worker/services/auth.js";
import { handleTestSupport } from "./worker/services/test-support.js";
import { handleCollab } from "./worker/services/collab.js";
import { handleWorkspace } from "./worker/services/workspace.js";
import { freeSuiteOwner, handleFreeSuite } from "./worker/services/free-suite.js";
import { handlePublicSite } from "./worker/services/public-site.js";
import { handleTodoGreenCore } from "./worker/services/todogreen-core.js";
import {
  handlePlatformSuite,
  handlePublicPlatformSuite,
} from "./worker/services/platform-suite.js";
import {
  ensureInteractionsMigrated,
  insertInteraction,
} from "./worker/services/omnichannel.js";
import { createQuoteHandlers } from "./worker/services/quotes.js";
import { createWebhookHandlers } from "./worker/services/webhooks.js";
import { normalizeInboundEmails } from "./worker/mensageria/inbound-email.js";
import { runTodoGreenScheduledWorkAutomations } from "./worker/services/todogreen-work-center.js";
import { runTodoGreenIntelligenceWatches } from "./worker/services/todogreen-client-intelligence.js";
import { runTodoGreenMarketIntelligenceScheduled } from "./worker/services/todogreen-market-intelligence.js";
import { runTodoGreenEnergyReferenceScheduled } from "./worker/services/todogreen-energy-reference.js";
import { runTodoGreenMarketSignalsScheduled } from "./worker/services/todogreen-market-signals.js";
import { runTodoGreenRoadRiskScheduled } from "./worker/services/todogreen-road-risk.js";
import { runTodoGreenTrackerScheduled, expurgarPosicoesAntigasDoTracker } from "./worker/services/todogreen-tracker.js";
import { runTodoGreenPendenciaAvisos } from "./worker/services/todogreen-semente.js";
import { lerManifestoDeVersao, systemVersionPayload } from "./worker/services/todogreen-system-health.js";



// Uma fonte só para "qual SHA está publicado": o manifesto version.json do
// build. /api/status, /api/system/version e a tela Saúde do sistema leem daqui.
const publishedVersion = (env, origin) => lerManifestoDeVersao(env, origin);

// Movido para ./worker/auth/credenciais.js; reexportado para os testes.
export { createSession, hex, passwordHash, randomHex, sameHash, sha256, unhex };

// Movido para ./worker/mensageria/envio.js.

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

async function runScheduledAutomations(env, now = new Date()) {
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

async function handleErrorLog(request, env) {
  if (request.method === "GET") {
    if (!env.DB) return json({ logs: [] });
    let user = null;
    try {
      user = await sessionUser(request, env);
    } catch {}
    if (!user)
      return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    const logs = await env.DB.prepare(
      `SELECT id, message, stack, component_stack AS componentStack, url, created_at AS createdAt
      FROM error_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all();
    return json({ logs: logs.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!env.DB) return json({ ok: true });
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`err:${ip}`, 20)) return json({ ok: true });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const message = String(body?.message || "").slice(0, 500);
  if (!message) return json({ error: "Mensagem obrigatória." }, 400);
  let userId = null;
  try {
    const user = await sessionUser(request, env);
    userId = user?.id || null;
  } catch {}
  await env.DB.prepare(
    `INSERT INTO error_logs (id, message, stack, component_stack, url, user_agent, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      message,
      String(body?.stack || "").slice(0, 4000),
      String(body?.componentStack || "").slice(0, 4000),
      String(body?.url || "").slice(0, 500),
      request.headers.get("user-agent")?.slice(0, 300) || "",
      userId,
      new Date().toISOString(),
    )
    .run();
  return json({ ok: true });
}

// public_sites/public_site_leads live entirely outside RESTRICTED_FIELDS —
// canAccessWorkspace only proves the actor belongs to the space, not that
// they're allowed to touch this specific site. Look the site up in the
// owner's own workspace JSON and run it through the same canSeeTask a
// non-owner would need to pass for any other record, so a colaborador can't
// publish/unpublish/delete or read leads for a site someone else made.
async function canManageWorkspaceRecord(
  env,
  actorId,
  ownerId,
  collection,
  recordId,
) {
  if (actorId === ownerId) return true;
  const role = await membershipRole(env, actorId, ownerId);
  if (!role) return false;
  if (role === "admin") return true;
  const row = await env.DB.prepare(
    "SELECT data FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  if (!row) return false;
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return false;
  }
  const record = (Array.isArray(data[collection]) ? data[collection] : []).find(
    (item) => item && item.id === recordId,
  );
  if (!record) return false;
  const ctx = resolveViewerContext(data, actorId);
  return canEditRecord(record, actorId, ctx);
}

const canManageSite = (env, actorId, ownerId, siteId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "sites", siteId);

const canManagePublicForm = (env, actorId, ownerId, formId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "publicForms", formId);

const canManageClientPortal = (env, actorId, ownerId, portalId) =>
  canManageWorkspaceRecord(env, actorId, ownerId, "clientPortals", portalId);


async function handleWorkspaceBackups(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (role !== "owner" && role !== "admin")
    return json(
      { error: "Somente proprietários e administradores podem restaurar dados." },
      403,
    );
  await ensureWorkspaceSnapshotsSchema(env);

  if (request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT id, revision, created_at, created_by, length(data) AS size
      FROM workspace_snapshots
      WHERE owner_id = ?
      ORDER BY revision DESC
      LIMIT 20`,
    )
      .bind(ownerId)
      .all();
    return json({
      backups: (result.results || []).map((item) => ({
        id: item.id,
        revision: item.revision,
        createdAt: item.created_at,
        createdBy: item.created_by,
        size: item.size,
      })),
    });
  }

  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const snapshotId =
    typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
  const baseRevision = body?.revision;
  if (!snapshotId || !Number.isInteger(baseRevision) || baseRevision < 0)
    return json({ error: "Backup ou revisão inválida." }, 400);

  const snapshot = await env.DB.prepare(
    `SELECT data FROM workspace_snapshots
    WHERE id = ? AND owner_id = ?`,
  )
    .bind(snapshotId, ownerId)
    .first();
  if (!snapshot) return json({ error: "Backup não encontrado." }, 404);
  const current = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  if (!current) return json({ error: "Espaço não encontrado." }, 404);
  if (current.revision !== baseRevision)
    return json(
      {
        error:
          "Este espaço foi alterado em outra aba ou dispositivo. Atualize antes de restaurar.",
        serverRevision: current.revision,
      },
      409,
    );

  const restoredAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_snapshots
      (id, owner_id, revision, data, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      ownerId,
      current.revision,
      current.data,
      restoredAt,
      user.id,
    )
    .run();
  const restored = await env.DB.prepare(
    `UPDATE workspaces
    SET data = ?, updated_at = ?, revision = revision + 1
    WHERE user_id = ? AND revision = ?
    RETURNING revision, updated_at`,
  )
    .bind(snapshot.data, restoredAt, ownerId, baseRevision)
    .first();
  if (!restored)
    return json(
      { error: "O espaço mudou durante a restauração. Tente novamente." },
      409,
    );
  return json({
    ok: true,
    revision: restored.revision,
    updatedAt: restored.updated_at,
  });
}

async function handleTaskAction(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!taskId || !["assume", "interest", "withdraw-interest"].includes(action))
    return json({ error: "Ação de tarefa inválida." }, 400);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    if (!row) return json({ error: "Tarefa não encontrada." }, 404);
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return json({ error: "Não foi possível ler esta tarefa." }, 500);
    }
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const index = tasks.findIndex((item) => item?.id === taskId);
    if (index < 0) return json({ error: "Tarefa não encontrada." }, 404);
    const task = tasks[index];
    const elevated = role === "owner" || role === "admin";
    const ctx = resolveViewerContext(data, user.id);
    if (!elevated && !canSeeTask(task, user.id, ctx))
      return json({ error: "Tarefa não encontrada." }, 404);
    if (!task.isMission || task.distribution !== "disponivel")
      return json({ error: "Esta tarefa não está aberta para participação." }, 409);

    const slots = Math.max(1, Number(task.slots) || 1);
    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    const interested = Array.isArray(task.interested) ? task.interested : [];
    let nextTask = task;
    let message = "";
    if (action === "assume") {
      if (task.approvalMode === "aprovacao")
        return json(
          { error: "Esta missão exige aprovação. Demonstre interesse primeiro." },
          409,
        );
      if (assignees.some((item) => item?.userId === user.id))
        return json({ ok: true, task, revision: row.revision, unchanged: true });
      if (assignees.length >= slots)
        return json({ error: "A última vaga já foi assumida." }, 409);
      const blocked = (Array.isArray(task.dependsOn) ? task.dependsOn : [])
        .map((id) => tasks.find((item) => item?.id === id))
        .some((dependency) => dependency && dependency.status !== "Concluído");
      if (blocked)
        return json({ error: "Conclua as tarefas anteriores antes de assumir esta missão." }, 409);
      const nextAssignees = [
        ...assignees,
        { userId: user.id, name: user.name, at: new Date().toISOString() },
      ];
      const full = nextAssignees.length >= slots;
      nextTask = {
        ...task,
        assignees: nextAssignees,
        missionStatus: full ? "em_andamento" : "disponivel",
        status: full ? "Em andamento" : task.status,
        updatedAt: new Date().toISOString(),
      };
      message = `Vaga assumida em "${task.title}"`;
    } else if (action === "interest") {
      if (interested.some((item) => item?.userId === user.id))
        return json({ ok: true, task, revision: row.revision, unchanged: true });
      if (assignees.length >= slots)
        return json({ error: "Esta missão não possui mais vagas." }, 409);
      nextTask = {
        ...task,
        interested: [
          ...interested,
          { userId: user.id, name: user.name, at: new Date().toISOString() },
        ],
        updatedAt: new Date().toISOString(),
      };
      message = `Novo interesse em "${task.title}"`;
    } else {
      nextTask = {
        ...task,
        interested: interested.filter((item) => item?.userId !== user.id),
        updatedAt: new Date().toISOString(),
      };
    }

    const nextTasks = tasks.map((item, taskIndex) =>
      taskIndex === index ? nextTask : item,
    );
    const beforeNotifications = Array.isArray(data.notifications)
      ? data.notifications
      : [];
    const nextNotifications = message && task.ownerId && task.ownerId !== user.id
      ? [
          {
            id: crypto.randomUUID(),
            ownerId: user.id,
            assigneeId: task.ownerId,
            visibility: "atribuido",
            message,
            link: "operacao",
            read: false,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          },
          ...beforeNotifications,
        ]
      : beforeNotifications;
    const nextData = {
      ...data,
      tasks: nextTasks,
      notifications: nextNotifications,
    };
    const updatedAt = new Date().toISOString();
    const updated = await env.DB.prepare(
      `UPDATE workspaces
       SET data = ?, updated_at = ?, revision = revision + 1
       WHERE user_id = ? AND revision = ?
       RETURNING revision, updated_at`,
    )
      .bind(JSON.stringify(nextData), updatedAt, ownerId, row.revision)
      .first();
    if (!updated) continue;
    try {
      await notifyNewNotifications(env, beforeNotifications, nextNotifications);
    } catch (error) {
      console.error("task action push", error);
    }
    return json({
      ok: true,
      task: nextTask,
      revision: updated.revision,
      updatedAt: updated.updated_at,
    });
  }
  return json(
    { error: "A tarefa mudou enquanto você agia. Atualize e tente novamente." },
    409,
  );
}

const PRODUCT_EVENT_NAMES = new Set([
  "session_started",
  "onboarding_completed",
  "navigation",
  "ai_completed",
  "record_created",
  "action_completed",
  "import_completed",
  "export_completed",
  "weekly_goal_saved",
  "task_claimed",
]);
const PRODUCT_METADATA_KEYS = new Set([
  "module",
  "source",
  "kind",
  "mode",
  "success",
  "count",
  "elapsedBucket",
]);

async function handleProductEvents(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (request.method === "POST") {
    if (!allowed(`events:${user.id}`, 120))
      return json({ error: "Muitos eventos em pouco tempo." }, 429);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Evento inválido." }, 400);
    }
    if (!PRODUCT_EVENT_NAMES.has(body.event))
      return json({ error: "Evento inválido." }, 400);
    const metadata = {};
    if (body.metadata && typeof body.metadata === "object") {
      for (const [key, value] of Object.entries(body.metadata)) {
        if (!PRODUCT_METADATA_KEYS.has(key)) continue;
        if (["string", "number", "boolean"].includes(typeof value))
          metadata[key] = typeof value === "string" ? value.slice(0, 80) : value;
      }
    }
    await env.DB.prepare(
      `INSERT INTO product_events
        (id, user_id, workspace_owner_id, event_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        ownerId,
        body.event,
        JSON.stringify(metadata),
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }
  if (request.method !== "GET")
    return json({ error: "Método não permitido." }, 405);
  if (role !== "owner" && role !== "admin")
    return json({ error: "Acesso restrito à administração do espaço." }, 403);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const grouped = await env.DB.prepare(
    `SELECT event_name AS event, COUNT(*) AS total,
            COUNT(DISTINCT user_id) AS users
       FROM product_events
      WHERE workspace_owner_id = ? AND created_at >= ?
      GROUP BY event_name
      ORDER BY total DESC`,
  )
    .bind(ownerId, since)
    .all();
  const active = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS users
       FROM product_events
      WHERE workspace_owner_id = ? AND created_at >= ?`,
  )
    .bind(ownerId, since)
    .first();
  return json({
    days,
    activeUsers: Number(active?.users || 0),
    events: grouped.results || [],
  });
}

const safeParseJson = (value) => {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

async function handleInbox(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  if (request.method === "GET") {
    await ensureInteractionsMigrated(env, ownerId);
    const rows = await env.DB.prepare(
      `SELECT i.id, i.author_id, i.contact_id, i.contact_name, i.contact_handle,
              i.channel, i.direction, i.subject, i.body, i.meta_json,
              i.created_at, i.read_at, m.conversation_id, m.id AS message_id
         FROM interactions i
         LEFT JOIN conversation_messages m ON m.interaction_id = i.id
        WHERE i.workspace_owner_id = ?
        ORDER BY i.created_at DESC
        LIMIT 500`,
    )
      .bind(ownerId)
      .all();
    const items = (rows.results || []).map((r) => ({
      id: r.id,
      authorId: r.author_id,
      contactId: r.contact_id || "",
      contactName: r.contact_name || "",
      contactHandle: r.contact_handle || "",
      channel: r.channel,
      direction: r.direction,
      subject: r.subject || "",
      body: r.body || "",
      meta: safeParseJson(r.meta_json),
      createdAt: r.created_at,
      readAt: r.read_at || null,
      conversationId: r.conversation_id || "",
      messageId: r.message_id || "",
    }));
    return json({ items });
  }

  if (request.method === "POST") {
    if (!allowed(`inbox:${user.id}`, 120))
      return json({ error: "Muitos registros em pouco tempo." }, 429);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Registro inválido." }, 400);
    }
    try {
      const record = await insertInteraction(env, ownerId, user.id, body);
      return json({ ok: true, ...record });
    } catch (error) {
      return json({ error: error.message || "Registro inválido." }, 400);
    }
  }

  if (request.method === "PATCH") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Requisição inválida." }, 400);
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v) => typeof v === "string").slice(0, 500)
      : [];
    if (!ids.length) return json({ ok: true, updated: 0 });
    const now = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `UPDATE interactions SET read_at = ?
        WHERE workspace_owner_id = ? AND read_at IS NULL
          AND id IN (${placeholders})`,
    )
      .bind(now, ownerId, ...ids)
      .run();
    const messages = await env.DB.prepare(
      `SELECT DISTINCT conversation_id FROM conversation_messages
        WHERE workspace_owner_id = ? AND interaction_id IN (${placeholders})`,
    )
      .bind(ownerId, ...ids)
      .all();
    await env.DB.prepare(
      `UPDATE conversation_messages SET read_at = ?
        WHERE workspace_owner_id = ? AND read_at IS NULL
          AND interaction_id IN (${placeholders})`,
    )
      .bind(now, ownerId, ...ids)
      .run();
    for (const row of messages.results || []) {
      await env.DB.prepare(
        `UPDATE conversations
            SET unread_count = (
                  SELECT COUNT(*) FROM conversation_messages
                   WHERE conversation_id = ? AND direction = 'in' AND read_at IS NULL
                ),
                updated_at = ?
          WHERE id = ? AND workspace_owner_id = ?`,
      )
        .bind(row.conversation_id, now, row.conversation_id, ownerId)
        .run();
    }
    return json({ ok: true, updated: result.meta?.changes || 0 });
  }

  return json({ error: "Método não permitido." }, 405);
}

async function handleInboxConversations(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (request.method !== "GET")
    return json({ error: "Método não permitido." }, 405);
  await ensureInteractionsMigrated(env, ownerId);
  const conversationId = url.searchParams.get("conversation") || "";
  if (conversationId) {
    const row = await env.DB.prepare(
      `SELECT c.id, c.workspace_owner_id, c.contact_id, c.channel, c.subject,
              c.status, c.priority, c.assigned_to, c.last_message_at,
              c.last_message_preview, c.unread_count, c.created_at, c.updated_at,
              ct.display_name, ct.normalized_handle, ct.email, ct.phone
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.workspace_owner_id = ? AND c.id = ?
        LIMIT 1`,
    )
      .bind(ownerId, conversationId)
      .first();
    if (!row) return json({ error: "Conversa não encontrada." }, 404);
    const messages = await env.DB.prepare(
      `SELECT id, interaction_id, author_id, channel, direction, subject, body,
              meta_json, created_at, read_at
         FROM conversation_messages
        WHERE workspace_owner_id = ? AND conversation_id = ?
        ORDER BY created_at ASC
        LIMIT 500`,
    )
      .bind(ownerId, conversationId)
      .all();
    return json({
      conversation: {
        id: row.id,
        contactId: row.contact_id || "",
        contactName: row.display_name || "",
        contactHandle: row.email || row.phone || row.normalized_handle || "",
        channel: row.channel,
        subject: row.subject || "",
        status: row.status,
        priority: row.priority,
        assignedTo: row.assigned_to || "",
        lastMessageAt: row.last_message_at,
        lastMessagePreview: row.last_message_preview || "",
        unreadCount: Number(row.unread_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      messages: (messages.results || []).map((message) => ({
        id: message.id,
        interactionId: message.interaction_id || "",
        authorId: message.author_id,
        channel: message.channel,
        direction: message.direction,
        subject: message.subject || "",
        body: message.body || "",
        meta: safeParseJson(message.meta_json),
        createdAt: message.created_at,
        readAt: message.read_at || null,
      })),
    });
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.contact_id, c.channel, c.subject, c.status, c.priority,
            c.assigned_to, c.last_message_at, c.last_message_preview,
            c.unread_count, c.created_at, c.updated_at,
            ct.display_name, ct.normalized_handle, ct.email, ct.phone
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.workspace_owner_id = ?
      ORDER BY c.last_message_at DESC
      LIMIT 200`,
  )
    .bind(ownerId)
    .all();
  return json({
    conversations: (rows.results || []).map((row) => ({
      id: row.id,
      contactId: row.contact_id || "",
      contactName: row.display_name || "",
      contactHandle: row.email || row.phone || row.normalized_handle || "",
      channel: row.channel,
      subject: row.subject || "",
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to || "",
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview || "",
      unreadCount: Number(row.unread_count) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

async function handleOutboxSend(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  if (!allowed(`outbox:${user.id}`, 40))
    return json({ error: "Muitos envios em pouco tempo." }, 429);
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }

  const channel = String(body.channel || "").trim();
  const to = String(body.to || body.contactHandle || "").trim();
  const subject = String(body.subject || "").trim().slice(0, 200);
  const text = String(body.body || body.text || "").trim().slice(0, 4000);
  if (!text) return json({ error: "Escreva a mensagem antes de enviar." }, 400);

  try {
    let delivery;
    if (channel === "email") {
      const email = to.toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email))
        return json({ error: "Informe um e-mail válido." }, 400);
      delivery = await sendEmailText(env, email, subject, text);
    } else if (channel === "whatsapp") {
      delivery = await sendWhatsAppText(env, to, text);
    } else {
      return json({ error: "Canal de envio automático inválido." }, 400);
    }

    const record = await insertInteraction(env, ownerId, user.id, {
      channel,
      direction: "out",
      contactId: body.contactId,
      contactName: body.contactName,
      contactHandle: to,
      subject,
      body: text,
      meta: {
        automatic: true,
        source: body.source || "outbox",
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId || "",
      },
    });
    return json({ ok: true, channel, ...record, delivery });
  } catch (error) {
    const message = error.message || "Não foi possível enviar automaticamente.";
    const missing = /não está configurado|nao esta configurado/i.test(message);
    return json({ error: message, code: missing ? "PROVIDER_NOT_CONFIGURED" : "SEND_FAILED" }, missing ? 503 : 502);
  }
}

async function resolveInboundOwner(env, provider, accountId) {
  const id = String(accountId || "").trim().toLowerCase();
  if (!env.DB || !provider || !id) return "";
  const row = await env.DB.prepare(
    `SELECT workspace_owner_id FROM inbound_channels
      WHERE provider = ? AND lower(provider_account_id) = ? AND active = 1
      LIMIT 1`,
  )
    .bind(provider, id)
    .first();
  if (row?.workspace_owner_id) return row.workspace_owner_id;
  if (provider === "email" && id.includes("@")) {
    const domain = id.split("@").at(-1);
    const domainRow = await env.DB.prepare(
      `SELECT workspace_owner_id FROM inbound_channels
        WHERE provider = 'email' AND lower(provider_account_id) = ? AND active = 1
        LIMIT 1`,
    )
      .bind(domain)
      .first();
    if (domainRow?.workspace_owner_id) return domainRow.workspace_owner_id;
  }
  if (provider === "whatsapp" && env.WHATSAPP_INBOUND_OWNER_ID)
    return env.WHATSAPP_INBOUND_OWNER_ID;
  if (provider === "email" && env.EMAIL_INBOUND_OWNER_ID)
    return env.EMAIL_INBOUND_OWNER_ID;
  return env.INBOUND_WEBHOOK_OWNER_ID || "";
}

async function hmacSha256Hex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

async function validMetaSignature(request, rawBody, env) {
  if (!env.WHATSAPP_APP_SECRET) return true;
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${await hmacSha256Hex(env.WHATSAPP_APP_SECRET, rawBody)}`;
  return sameHash(signature, expected);
}

async function handleInboundWhatsApp(request, env, url) {
  if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (
      mode === "subscribe" &&
      env.WHATSAPP_VERIFY_TOKEN &&
      token === env.WHATSAPP_VERIFY_TOKEN
    )
      return new Response(challenge, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    return json({ error: "Webhook não autorizado." }, 403);
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`inbound-whatsapp:${ip}`, 240))
    return json({ error: "Muitas mensagens em pouco tempo." }, 429);
  const raw = await request.text();
  if (!(await validMetaSignature(request, raw, env)))
    return json({ error: "Assinatura inválida." }, 403);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Webhook inválido." }, 400);
  }
  let inserted = 0;
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      const accountId = value.metadata?.phone_number_id || env.WHATSAPP_PHONE_ID || "";
      const ownerId = await resolveInboundOwner(env, "whatsapp", accountId);
      if (!ownerId) continue;
      const contactsByWaId = new Map(
        (Array.isArray(value.contacts) ? value.contacts : []).map((contact) => [
          String(contact.wa_id || ""),
          contact.profile?.name || "",
        ]),
      );
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const from = String(message.from || "");
        const type = String(message.type || "text");
        const body =
          message.text?.body ||
          message[type]?.caption ||
          message.button?.text ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          `[${type || "mensagem"} recebida]`;
        await insertInteraction(env, ownerId, ownerId, {
          channel: "whatsapp",
          direction: "in",
          contactName: contactsByWaId.get(from) || from,
          contactHandle: from,
          subject: "WhatsApp recebido",
          body,
          meta: {
            provider: "whatsapp_cloud_api",
            providerMessageId: message.id || "",
            providerAccountId: accountId,
            messageType: type,
          },
        });
        inserted += 1;
      }
    }
  }
  return json({ ok: true, inserted });
}

async function inboundEmailBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

const stripHtml = (value) =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function handleInboundEmail(request, env) {
  if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  // O segredo pode vir por header (provedores que permitem) OU pela URL
  // (?key=/?secret=) — o Brevo Inbound Parsing não deixa configurar header
  // customizado, então o segredo viaja na própria URL do webhook.
  const url = new URL(request.url);
  const secret =
    request.headers.get("x-sf-inbound-secret") ||
    request.headers.get("x-inbound-secret") ||
    url.searchParams.get("key") ||
    url.searchParams.get("secret") ||
    "";
  if (!env.INBOUND_EMAIL_SECRET || !sameHash(secret, env.INBOUND_EMAIL_SECRET))
    return json({ error: "Webhook não autorizado." }, 403);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`inbound-email:${ip}`, 240))
    return json({ error: "Muitos e-mails em pouco tempo." }, 429);
  let body;
  try {
    body = await inboundEmailBody(request);
  } catch {
    return json({ error: "Webhook inválido." }, 400);
  }
  // Entende o formato genérico (um e-mail no topo) e o do Brevo (array items[]).
  const messages = normalizeInboundEmails(body);
  if (!messages.length) return json({ error: "Webhook sem mensagens." }, 400);
  let inserted = 0;
  let anyOwner = false;
  for (const msg of messages) {
    const ownerId = await resolveInboundOwner(env, "email", msg.to);
    if (!ownerId) continue;
    anyOwner = true;
    await insertInteraction(env, ownerId, ownerId, {
      channel: "email",
      direction: "in",
      contactName: msg.fromName || msg.fromAddress,
      contactHandle: msg.fromAddress,
      subject: msg.subject || "(sem assunto)",
      body: (msg.text || stripHtml(msg.html) || "(e-mail sem texto)").slice(0, 4000),
      meta: {
        provider: "inbound_email_webhook",
        providerAccountId: msg.to,
        messageId: msg.messageId,
      },
    });
    inserted += 1;
  }
  if (!anyOwner)
    return json({ error: "Nenhum workspace configurado para este e-mail." }, 404);
  return json({ ok: true, inserted });
}

async function handlePersonalInbox(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  if (request.method === "GET") {
    const workspaceRow = await env.DB.prepare(
      "SELECT data FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    let data = {};
    try {
      data = workspaceRow?.data ? JSON.parse(workspaceRow.data) : {};
    } catch {
      data = {};
    }
    const restricted = role !== "owner" && role !== "admin";
    if (restricted) {
      const ctx = resolveViewerContext(data, user.id);
      data = {
        ...data,
        tasks: filterRecordsForViewer(data.tasks, user.id, ctx),
        notifications: filterRecordsForViewer(
          data.notifications,
          user.id,
          ctx,
        ),
        databases: filterRecordsForViewer(data.databases, user.id, ctx),
        processes: filterRecordsForViewer(data.processes, user.id, ctx),
        processCases: filterRecordsForViewer(
          data.processCases,
          user.id,
          ctx,
        ),
        projects: filterRecordsForViewer(data.projects, user.id, ctx),
      };
    }
    const stateRows = await env.DB.prepare(
      `SELECT item_key AS itemKey, read_at AS readAt,
              snoozed_until AS snoozedUntil
         FROM personal_inbox_state
        WHERE workspace_owner_id = ? AND user_id = ?
        ORDER BY updated_at DESC
        LIMIT 1000`,
    )
      .bind(ownerId, user.id)
      .all();
    const now = new Date().toISOString();
    const derived = buildPersonalInboxItems(
      data,
      {
        ...user,
        isWorkspaceOwner: ownerId === user.id,
      },
      now,
    );
    const items = applyPersonalInboxState(
      derived,
      stateRows.results || [],
      now,
    );
    return json({
      items,
      summary: personalInboxSummary(items, now),
      generatedAt: now,
    });
  }

  if (request.method !== "PATCH")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requisição inválida." }, 400);
  }
  const action = String(body.action || "");
  if (!["read", "unread", "snooze", "unsnooze"].includes(action))
    return json({ error: "Ação inválida." }, 400);
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .filter(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 240,
        )
        .slice(0, 500),
    ),
  ];
  if (!ids.length) return json({ ok: true, updated: 0 });
  const now = new Date().toISOString();
  let until = null;
  if (action === "snooze") {
    const untilMs = Date.parse(body.until);
    const maxMs = Date.now() + 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(untilMs) || untilMs <= Date.now() || untilMs > maxMs)
      return json(
        { error: "Escolha uma data futura de até um ano para adiar." },
        400,
      );
    until = new Date(untilMs).toISOString();
  }

  const statements = ids.map((itemKey) => {
    if (action === "read" || action === "unread")
      return env.DB.prepare(
        `INSERT INTO personal_inbox_state
          (workspace_owner_id, user_id, item_key, read_at, snoozed_until,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(workspace_owner_id, user_id, item_key) DO UPDATE SET
           read_at = excluded.read_at,
           updated_at = excluded.updated_at`,
      ).bind(
        ownerId,
        user.id,
        itemKey,
        action === "read" ? now : null,
        now,
        now,
      );
    return env.DB.prepare(
      `INSERT INTO personal_inbox_state
        (workspace_owner_id, user_id, item_key, read_at, snoozed_until,
         created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(workspace_owner_id, user_id, item_key) DO UPDATE SET
         snoozed_until = excluded.snoozed_until,
         updated_at = excluded.updated_at`,
    ).bind(
      ownerId,
      user.id,
      itemKey,
      action === "snooze" ? until : null,
      now,
      now,
    );
  });
  await env.DB.batch(statements);
  return json({ ok: true, updated: ids.length });
}


const { handlePublicQuote, handleQuotes } = createQuoteHandlers({
  json,
  allowed,
  randomHex,
  escMail,
  moneyBRL,
});

const { handleWebhooks, notifyWorkspaceChange } = createWebhookHandlers({
  json,
  allowed,
  randomHex,
});

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

// Mesmo valor de `triggers.crons` no wrangler.jsonc. O worker-entry.js também
// usa esta constante para não repetir os jobs horários no disparo semanal.
export const WEEKLY_SUMMARY_CRON = "0 12 * * 1";

// Envia o resumo da semana anterior por push para todo dono com atividade e
// pelo menos uma assinatura ativa. Roda uma vez por semana (Cron de segunda).
async function sendWeeklySummaries(env, now) {
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

async function handleTaskNotify(request, env, user) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!emailEnabled(env)) return json({ error: "O envio de e-mail não está configurado." }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`notify:${ip}`, 10)) return json({ error: "Muitos avisos em pouco tempo. Aguarde um instante." }, 429);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Solicitação inválida." }, 400); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Informe um e-mail válido para o aviso." }, 400);
  const title = escMail(String(body.title || "").slice(0, 160));
  if (!title.trim()) return json({ error: "Tarefa sem título." }, 400);
  const description = escMail(String(body.description || "").slice(0, 800));
  const due = escMail(String(body.due || "").slice(0, 40));
  const project = escMail(String(body.project || "").slice(0, 120));
  const who = escMail(user.name || "Um colega");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1e1b35">
    <div style="background:#0f0d1c;border-radius:14px;padding:18px;text-align:center"><span style="color:#fff;font-size:17px;font-weight:bold">Seu Funcionário</span></div>
    <h2 style="margin:22px 0 6px">Nova tarefa para você</h2>
    <p style="color:#555;margin:0 0 16px"><strong>${who}</strong> atribuiu uma tarefa a você:</p>
    <div style="background:#f1eff8;border-radius:12px;padding:16px">
      <p style="margin:0 0 6px;font-size:17px"><strong>${title}</strong></p>
      ${description ? `<p style="margin:0 0 6px;color:#444">${description}</p>` : ""}
      ${project ? `<p style="margin:0;color:#777;font-size:13px">Projeto: ${project}</p>` : ""}
      ${due ? `<p style="margin:0;color:#777;font-size:13px">Prazo: ${due}</p>` : ""}
    </div>
    <p style="color:#888;font-size:12px;margin:18px 0 0">Aviso enviado pelo aplicativo Seu Funcionário a pedido de ${who}.</p>
  </div>`;
  try { await sendEmail(env, email, `Nova tarefa: ${String(body.title || "").slice(0, 80)}`, html); }
  catch (e) { console.error("task notify", e); return json({ error: "Não foi possível enviar o aviso agora." }, 502); }
  return json({ ok: true });
}

async function handlePublicInvite(request, env, url) {
  if (!env.DB) return json({ error: "Serviço indisponível." }, 503);
  const infoMatch = url.pathname === "/api/collab/invite-info";
  if (infoMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const token = url.searchParams.get("token") || "";
    if (!token) return json({ error: "Convite inválido." }, 400);
    const invite = await env.DB.prepare(
      `SELECT invites.name, invites.email, invites.role, invites.status, invites.expires_at AS expiresAt,
        users.name AS ownerName
      FROM invites JOIN users ON users.id = invites.owner_id WHERE invites.token = ?`,
    )
      .bind(await sha256(token))
      .first();
    if (!invite) return json({ error: "Convite inválido ou expirado." }, 404);
    if (invite.status !== "enviado")
      return json({ error: "Este convite já foi utilizado ou cancelado." }, 410);
    if (invite.expiresAt < new Date().toISOString())
      return json({ error: "Este convite expirou." }, 410);
    const hasAccount = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    )
      .bind(invite.email)
      .first();
    return json({
      name: invite.name,
      email: invite.email,
      role: invite.role,
      ownerName: invite.ownerName,
      hasAccount: !!hasAccount,
    });
  }
  if (url.pathname === "/api/collab/invite/accept") {
    if (request.method !== "POST")
      return json({ error: "Método não permitido." }, 405);
    const ip = request.headers.get("cf-connecting-ip") || "public";
    if (!allowed(`invite-accept:${ip}`, 10))
      return json(
        { error: "Muitas tentativas. Aguarde um instante." },
        429,
      );
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Dados inválidos." }, 400);
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return json({ error: "Convite inválido." }, 400);
    const tokenHash = await sha256(token);
    const invite = await env.DB.prepare(
      "SELECT * FROM invites WHERE token = ?",
    )
      .bind(tokenHash)
      .first();
    if (!invite)
      return json({ error: "Convite inválido ou expirado." }, 404);
    if (invite.status !== "enviado")
      return json(
        { error: "Este convite já foi utilizado ou cancelado." },
        410,
      );
    if (invite.expires_at < new Date().toISOString())
      return json({ error: "Este convite expirou. Peça um novo." }, 410);
    let account = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?")
      .bind(invite.email)
      .first();
    let sessionToken = null;
    if (!account) {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 128)
        return json(
          { error: "A senha precisa ter entre 8 e 128 caracteres." },
          400,
        );
      const id = crypto.randomUUID();
      const salt = randomHex(16);
      await env.DB.prepare(
        "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          invite.name,
          invite.email,
          await passwordHash(password, salt),
          salt,
          new Date().toISOString(),
        )
        .run();
      account = { id, name: invite.name };
      sessionToken = await createSession(env, id);
    } else {
      const requester = await sessionUser(request, env);
      if (!requester || requester.email !== invite.email)
        return json(
          {
            error:
              "Entre com a conta que recebeu este convite para aceitá-lo.",
          },
          401,
        );
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO memberships
        (id, owner_id, member_id, role, created_at, status, function_title, bond_type, direct_manager_id)
      VALUES (?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        invite.owner_id,
        account.id,
        invite.role,
        new Date().toISOString(),
        invite.function_title || "",
        invite.bond_type || "",
        invite.direct_manager_id || null,
      )
      .run();
    await env.DB.prepare(
      "UPDATE invites SET status = 'ativo', accepted_at = ? WHERE token = ?",
    )
      .bind(new Date().toISOString(), tokenHash)
      .run();
    const owner = await env.DB.prepare("SELECT name FROM users WHERE id = ?")
      .bind(invite.owner_id)
      .first();
    await logAudit(
      env,
      invite.owner_id,
      { id: account.id, name: account.name },
      "convite_aceito",
      invite.email,
      `papel: ${invite.role}`,
    );
    return json({
      ok: true,
      ownerId: invite.owner_id,
      ownerName: owner?.name || "Espaço compartilhado",
      user: sessionToken ? { id: account.id, name: account.name, email: invite.email } : null,
      token: sessionToken,
    });
  }
  return null;
}

export const siteSlug = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

export function sanitizeSiteHtml(value) {
  let html = String(value || "").slice(0, 300_000);
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(
      /<(?:iframe|object|embed|base)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|base)\s*>/gi,
      "",
    )
    .replace(/<(?:iframe|object|embed|base)\b[^>]*\/?>/gi, "")
    .replace(
      /<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)["']?[^>]*>/gi,
      "",
    )
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");
  return html;
}


// ── Formulários públicos avançados ─────────────────────────────────────
const PUBLIC_FORM_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const PUBLIC_FORM_MAX_FILE_BYTES = 300_000;
const PUBLIC_FORM_MAX_TOTAL_BYTES = 900_000;

const publicFormNotFound = () =>
  new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Formulário indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Este formulário não está disponível</h1><p>O endereço pode estar incorreto ou o formulário foi despublicado.</p></body></html>',
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );

const publicFieldInputHtml = (field) => {
  const esc = escMail;
  const id = `field-${field.id}`;
  const common = `id="${esc(id)}" data-field-input data-field-id="${esc(field.id)}" data-field-type="${esc(field.type)}"${field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : ""}${field.required ? " required" : ""}`;
  let input = "";
  if (field.type === "longtext")
    input = `<textarea ${common} rows="4"></textarea>`;
  else if (field.type === "select")
    input = `<select ${common}><option value="">Selecione...</option>${(field.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>`;
  else if (field.type === "multiselect")
    input = `<select ${common} multiple size="${Math.min(6, Math.max(3, field.options?.length || 3))}">${(field.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>`;
  else if (field.type === "checkbox")
    input = `<label class="check-line"><input ${common} type="checkbox"><span>Sim</span></label>`;
  else if (field.type === "file")
    input = `<input ${common} type="file" ${field.multiple ? "multiple" : ""} accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp"><small class="file-hint">Até 3 arquivos por campo e 300 KB por arquivo.</small>`;
  else {
    const type =
      {
        number: "number",
        currency: "number",
        date: "date",
        datetime: "datetime-local",
        email: "email",
        phone: "tel",
      }[field.type] || "text";
    input = `<input ${common} type="${type}"${field.type === "currency" ? ' step="0.01" min="0"' : ""}>`;
  }
  const condition = field.condition?.fieldId
    ? ` data-condition-field="${esc(field.condition.fieldId)}" data-condition-operator="${esc(field.condition.operator)}" data-condition-value="${esc(field.condition.value)}"`
    : "";
  return `<div class="field" data-field-wrap="${esc(field.id)}"${condition}><label for="${esc(id)}">${esc(field.label)}${field.required ? " <b>*</b>" : ""}</label>${input}${field.help ? `<small>${esc(field.help)}</small>` : ""}<small class="field-error" data-error-for="${esc(field.id)}"></small></div>`;
};

function renderPublicForm(form, env = {}) {
  const esc = escMail;
  const nonce = randomHex(16);
  const endpoint = `/api/public-forms/${encodeURIComponent(form.slug)}/submissions`;
  const logo = form.appearance.logoUrl
    ? `<img class="logo" src="${esc(form.appearance.logoUrl)}" alt="">`
    : "";
  const contact = [
    form.contact.collectName
      ? `<div class="field"><label for="contact-name">Nome${form.contact.requireName ? " <b>*</b>" : ""}</label><input id="contact-name" name="contact-name" maxlength="120"${form.contact.requireName ? " required" : ""}><small class="field-error" data-error-for="name"></small></div>`
      : "",
    form.contact.collectEmail
      ? `<div class="field"><label for="contact-email">E-mail${form.contact.requireEmail ? " <b>*</b>" : ""}</label><input id="contact-email" name="contact-email" type="email" maxlength="160"${form.contact.requireEmail ? " required" : ""}><small class="field-error" data-error-for="email"></small></div>`
      : "",
    form.contact.collectPhone
      ? `<div class="field"><label for="contact-phone">Telefone${form.contact.requirePhone ? " <b>*</b>" : ""}</label><input id="contact-phone" name="contact-phone" type="tel" maxlength="40"${form.contact.requirePhone ? " required" : ""}><small class="field-error" data-error-for="phone"></small></div>`
      : "",
  ].join("");
  const signature = form.signature.enabled
    ? `<section class="special signature"><h2>Assinatura eletrônica${form.signature.required ? " *" : ""}</h2><p>${esc(form.signature.consentText)}</p><label for="signature-name">Nome de quem assina</label><input id="signature-name" maxlength="120"${form.signature.required ? " required" : ""}><canvas id="signature-pad" width="720" height="220" aria-label="Área para desenhar a assinatura"></canvas><button class="clear" type="button" id="signature-clear">Limpar desenho</button><label class="check-line"><input id="signature-consent" type="checkbox"${form.signature.required ? " required" : ""}><span>Confirmo esta assinatura eletrônica.</span></label><small class="field-error" data-error-for="signature"></small></section>`
    : "";
  const payment = form.payment.enabled
    ? `<section class="special payment"><h2>Pagamento${form.payment.required ? " *" : ""}</h2>${form.payment.amount > 0 ? `<strong class="amount">${moneyBRL(form.payment.amount)}</strong>` : ""}${form.payment.instructions ? `<p>${esc(form.payment.instructions)}</p>` : ""}${form.payment.method === "link" && form.payment.link ? `<a class="pay-link" href="${esc(form.payment.link)}" target="_blank" rel="noopener noreferrer">Abrir pagamento</a>` : ""}${form.payment.method === "pix" && form.payment.pixCode ? `<label for="pix-code">Pix copia e cola</label><div class="copy-row"><textarea id="pix-code" readonly>${esc(form.payment.pixCode)}</textarea><button type="button" id="copy-pix">Copiar Pix</button></div>` : ""}<label class="check-line"><input id="payment-ack" type="checkbox"${form.payment.required ? " required" : ""}><span>Confirmo que realizei o pagamento conforme as instruções.</span></label><small class="field-error" data-error-for="payment"></small></section>`
    : "";
  const privacy = form.privacy.consentRequired
    ? `<label class="check-line consent"><input id="privacy-consent" type="checkbox" required><span>${esc(form.privacy.consentText)}</span></label><small class="field-error" data-error-for="privacy"></small>`
    : "";
  const script = `<script nonce="${nonce}">(()=>{const f=document.getElementById('sf-public-form'),status=document.getElementById('sf-status'),submit=document.getElementById('sf-submit'),inputs=[...document.querySelectorAll('[data-field-input]')],wraps=[...document.querySelectorAll('[data-field-wrap]')];let drawing=false,drawn=false;const pad=document.getElementById('signature-pad'),ctx=pad?.getContext('2d');if(ctx){ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle=${JSON.stringify(form.appearance.textColor)};const point=e=>{const r=pad.getBoundingClientRect();return{x:(e.clientX-r.left)*(pad.width/r.width),y:(e.clientY-r.top)*(pad.height/r.height)}};pad.addEventListener('pointerdown',e=>{drawing=true;drawn=true;pad.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y)});pad.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke()});['pointerup','pointercancel'].forEach(n=>pad.addEventListener(n,()=>drawing=false));document.getElementById('signature-clear')?.addEventListener('click',()=>{ctx.clearRect(0,0,pad.width,pad.height);drawn=false})}document.getElementById('copy-pix')?.addEventListener('click',()=>{const el=document.getElementById('pix-code');navigator.clipboard?.writeText(el?.value||'');status.textContent='Código Pix copiado.'});const valueOf=id=>{const el=inputs.find(i=>i.dataset.fieldId===id);if(!el)return'';if(el.type==='checkbox')return el.checked;if(el.multiple&&el.tagName==='SELECT')return[...el.selectedOptions].map(o=>o.value);return el.value};const visible=w=>{const source=w.dataset.conditionField;if(!source)return true;const actual=valueOf(source),expected=w.dataset.conditionValue||'',op=w.dataset.conditionOperator||'equals';if(op==='not_equals')return String(actual)!==expected;if(op==='contains')return Array.isArray(actual)?actual.map(String).includes(expected):String(actual).includes(expected);return String(actual)===expected};const refresh=()=>wraps.forEach(w=>{const show=visible(w);w.hidden=!show;w.querySelectorAll('input,textarea,select').forEach(el=>{el.disabled=!show;if(show&&el.dataset.fieldInput&&${JSON.stringify(true)})el.required=el.hasAttribute('required')})});inputs.forEach(i=>i.addEventListener('change',refresh));refresh();const readFile=file=>new Promise((resolve,reject)=>{if(file.size>${PUBLIC_FORM_MAX_FILE_BYTES})return reject(new Error(file.name+' excede 300 KB.'));const reader=new FileReader();reader.onload=()=>resolve({id:crypto.randomUUID?.()||('file-'+Date.now()+'-'+Math.random()),name:file.name,type:file.type||'application/octet-stream',size:file.size,dataUrl:reader.result});reader.onerror=()=>reject(new Error('Não foi possível ler '+file.name));reader.readAsDataURL(file)});f.addEventListener('submit',async e=>{e.preventDefault();if(!f.reportValidity())return;submit.disabled=true;status.textContent='Enviando...';document.querySelectorAll('.field-error').forEach(el=>el.textContent='');try{const values={},attachments=[];for(const input of inputs){const wrap=input.closest('[data-field-wrap]');if(wrap?.hidden)continue;const fieldId=input.dataset.fieldId,type=input.dataset.fieldType;if(type==='file'){const files=[...(input.files||[])];if(files.length>3)throw new Error('Envie no máximo 3 arquivos por campo.');for(const file of files)attachments.push({...await readFile(file),fieldId});continue}values[fieldId]=valueOf(fieldId)}if(attachments.reduce((sum,item)=>sum+item.size,0)>${PUBLIC_FORM_MAX_TOTAL_BYTES})throw new Error('Os anexos excedem 900 KB no total.');const body={submissionId:crypto.randomUUID?.()||('submission-'+Date.now()+'-'+Math.random()),website:document.getElementById('website').value,turnstileToken:(f.querySelector('[name="cf-turnstile-response"]')||{}).value||'',contact:{name:document.getElementById('contact-name')?.value||'',email:document.getElementById('contact-email')?.value||'',phone:document.getElementById('contact-phone')?.value||''},values,attachments,signature:pad?{name:document.getElementById('signature-name')?.value||'',consent:!!document.getElementById('signature-consent')?.checked,dataUrl:drawn?pad.toDataURL('image/png'):''}:{},payment:{acknowledged:!!document.getElementById('payment-ack')?.checked},privacyConsent:document.getElementById('privacy-consent')?document.getElementById('privacy-consent').checked:true};const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok){if(d.errors)Object.entries(d.errors).forEach(([key,msg])=>{const el=document.querySelector('[data-error-for="'+CSS.escape(key)+'"]');if(el)el.textContent=msg});throw new Error(d.error||'Revise os campos informados.')}f.innerHTML='<div class="success"><span>✓</span><h2>Enviado com sucesso</h2><p>'+${JSON.stringify(form.appearance.successMessage)}+'</p><strong>Protocolo '+d.protocol+'</strong></div>';status.textContent=''}catch(error){status.textContent=error.message||'Não foi possível enviar agora.';submit.disabled=false;window.turnstile?.reset()}})})()</script>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(form.title)}</title><style>:root{--primary:${form.appearance.primaryColor};--bg:${form.appearance.backgroundColor};--card:${form.appearance.cardColor};--text:${form.appearance.textColor}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:clamp(14px,4vw,48px)}main{width:min(720px,100%);margin:0 auto}.card{padding:clamp(20px,5vw,42px);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:22px;background:var(--card);box-shadow:0 22px 60px rgba(35,24,80,.09)}.logo{display:block;max-width:180px;max-height:64px;object-fit:contain;margin:0 0 22px}h1{margin:0;font-size:clamp(1.55rem,4vw,2.2rem);line-height:1.1}header>p{margin:10px 0 26px;color:color-mix(in srgb,var(--text) 68%,transparent);line-height:1.55}form{display:grid;gap:18px}.field{display:grid;gap:7px}.field[hidden]{display:none}.field label,.special>label{font-size:.86rem;font-weight:750}.field b{color:var(--primary)}input,textarea,select{width:100%;padding:12px 13px;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);border-radius:11px;background:var(--card);color:var(--text);font:inherit}textarea{resize:vertical}select[multiple]{min-height:110px}.field small,.file-hint{color:color-mix(in srgb,var(--text) 58%,transparent);font-size:.74rem;line-height:1.4}.field-error{min-height:0;color:#c52233!important;font-weight:650}.check-line{display:flex!important;align-items:flex-start;gap:9px;font-weight:500!important;line-height:1.45}.check-line input{width:18px;height:18px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--primary)}.special{display:grid;gap:10px;padding:17px;border:1px solid color-mix(in srgb,var(--primary) 24%,transparent);border-radius:14px;background:color-mix(in srgb,var(--primary) 5%,var(--card))}.special h2{margin:0;font-size:1rem}.special p{margin:0;color:color-mix(in srgb,var(--text) 68%,transparent);font-size:.83rem;line-height:1.5}.amount{font-size:1.5rem}.signature canvas{width:100%;height:150px;border:1px dashed color-mix(in srgb,var(--text) 28%,transparent);border-radius:10px;background:#fff;touch-action:none}.clear{justify-self:start;border:0;background:transparent;color:var(--primary);font-weight:700;cursor:pointer}.copy-row{display:grid;grid-template-columns:1fr auto;gap:8px}.copy-row textarea{min-height:70px}.copy-row button,.pay-link{align-self:stretch;padding:10px 14px;border:0;border-radius:10px;background:color-mix(in srgb,var(--primary) 10%,var(--card));color:var(--primary);font-weight:750;text-decoration:none;cursor:pointer}.consent{padding-top:4px;font-size:.8rem}#sf-submit{min-height:48px;border:0;border-radius:12px;background:var(--primary);color:#fff;font-size:1rem;font-weight:800;cursor:pointer}#sf-submit:disabled{opacity:.55;cursor:wait}#sf-status{min-height:20px;margin:0;color:#c52233;font-size:.82rem;text-align:center}.honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden}.success{display:grid;place-items:center;gap:9px;padding:28px 0;text-align:center}.success span{display:grid;width:54px;height:54px;place-items:center;border-radius:50%;background:#e5f7eb;color:#168447;font-size:1.8rem;font-weight:900}.success h2,.success p{margin:0}.success p{color:color-mix(in srgb,var(--text) 65%,transparent)}.success strong{margin-top:8px;padding:10px 13px;border-radius:9px;background:color-mix(in srgb,var(--primary) 9%,var(--card));color:var(--primary)}footer{margin-top:16px;text-align:center;color:color-mix(in srgb,var(--text) 45%,transparent);font-size:.72rem}@media(max-width:520px){body{padding:0}.card{min-height:100vh;border:0;border-radius:0}.copy-row{grid-template-columns:1fr}}</style></head><body><main><section class="card">${logo}<header><h1>${esc(form.title)}</h1><p>${esc(form.description)}</p></header><form id="sf-public-form"><div class="honeypot" aria-hidden="true"><label>Website<input id="website" autocomplete="off" tabindex="-1"></label></div>${contact}${(form.fields || []).map(publicFieldInputHtml).join("")}${signature}${payment}${privacy}${caixaDoTurnstile(env, "formulario")}<button id="sf-submit" type="submit">${esc(form.appearance.buttonLabel)}</button><p id="sf-status" role="status" aria-live="polite"></p></form></section>${form.appearance.showBranding ? "<footer>Formulário protegido por Seu Funcionário</footer>" : ""}</main>${scriptDoTurnstile(env, nonce)}${script}</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": cspComTurnstile(
        `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'; frame-ancestors *`,
        env,
      ),
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

const sanitizePublicFormValues = (form, rawValues) => {
  const values = {};
  const source =
    rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
      ? rawValues
      : {};
  for (const field of form.fields || []) {
    if (!publicFormFieldIsVisible(field, source) || field.type === "file") continue;
    const raw = source[field.id];
    if (field.type === "checkbox") values[field.id] = raw === true;
    else if (field.type === "multiselect")
      values[field.id] = (Array.isArray(raw) ? raw : [])
        .map((item) => String(item).slice(0, 100))
        .slice(0, 50);
    else if (["number", "currency"].includes(field.type))
      values[field.id] =
        raw === "" || raw == null ? "" : Number.isFinite(Number(raw)) ? Number(raw) : "";
    else values[field.id] = String(raw == null ? "" : raw).slice(0, 4000);
  }
  return values;
};

const sanitizePublicFormAttachments = (form, rawAttachments) => {
  const fileFields = new Set(
    (form.fields || []).filter((field) => field.type === "file").map((field) => field.id),
  );
  const attachments = [];
  const perField = new Map();
  let total = 0;
  for (const raw of Array.isArray(rawAttachments) ? rawAttachments.slice(0, 12) : []) {
    const fieldId = String(raw?.fieldId || "").slice(0, 100);
    const type = String(raw?.type || "").toLowerCase();
    const size = Math.max(0, Number(raw?.size) || 0);
    const dataUrl = String(raw?.dataUrl || "");
    if (
      !fileFields.has(fieldId) ||
      !PUBLIC_FORM_FILE_TYPES.has(type) ||
      size <= 0 ||
      size > PUBLIC_FORM_MAX_FILE_BYTES ||
      !dataUrl.startsWith(`data:${type};base64,`) ||
      dataUrl.length > Math.ceil(PUBLIC_FORM_MAX_FILE_BYTES * 1.5)
    )
      throw new Error("Um dos anexos é inválido ou excede 300 KB.");
    total += size;
    if (total > PUBLIC_FORM_MAX_TOTAL_BYTES)
      throw new Error("Os anexos excedem 900 KB no total.");
    const fieldCount = (perField.get(fieldId) || 0) + 1;
    if (fieldCount > 3)
      throw new Error("Envie no máximo 3 arquivos por campo.");
    perField.set(fieldId, fieldCount);
    attachments.push({
      id: /^[a-zA-Z0-9_-]{3,100}$/.test(String(raw.id || ""))
        ? String(raw.id)
        : crypto.randomUUID(),
      fieldId,
      name: String(raw.name || "arquivo")
        .replace(/[^\p{L}\p{N}._ -]/gu, "")
        .slice(0, 160),
      type,
      size,
      dataUrl,
    });
  }
  return attachments;
};

const sanitizePublicSignature = (form, signature) => {
  if (!form.signature?.enabled) return {};
  const dataUrl = String(signature?.dataUrl || "");
  if (
    dataUrl &&
    (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 350_000)
  )
    throw new Error("O desenho da assinatura é inválido ou muito grande.");
  return {
    name: String(signature?.name || "").trim().slice(0, 120),
    consent: signature?.consent === true,
    dataUrl,
    drawn: !!dataUrl,
    signedAt: new Date().toISOString(),
  };
};

const publicSubmissionTitle = (form, submission) => {
  const first = (form.fields || []).find(
    (field) =>
      field.type !== "file" &&
      publicFormFieldIsVisible(field, submission.values) &&
      submission.values?.[field.id] != null &&
      submission.values[field.id] !== "",
  );
  const answer = Array.isArray(submission.values?.[first?.id])
    ? submission.values[first.id].join(", ")
    : submission.values?.[first?.id];
  return String(
    answer || submission.contact.name || `${form.name} ${submission.protocol}`,
  )
    .trim()
    .slice(0, 150);
};

const publicSubmissionTask = (form, submission, kind, now) => ({
  id: crypto.randomUUID(),
  title: publicSubmissionTitle(form, submission),
  description: `${kind === "ticket" ? "Chamado" : "Tarefa"} criado pelo formulário público ${form.name}.\nProtocolo: ${submission.protocol}\n\n${publicFormAnswerSummary(form, submission.values)}`.trim(),
  priority:
    String(
      Object.entries(submission.values || {}).find(([fieldId]) =>
        /prioridade/i.test(
          form.fields.find((field) => field.id === fieldId)?.label || "",
        ),
      )?.[1] || "Média",
    ).slice(0, 20),
  status: "A fazer",
  startDate: "",
  due: "",
  estimatedDays: "1",
  baselineStart: "",
  baselineDue: "",
  area: kind === "ticket" ? "Atendimento" : form.destination.taskArea || "Operação",
  assigneeType: "real",
  assignee: "",
  assigneeId: "",
  project: "",
  projectId: form.destination.projectId || null,
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
  visibility: "espaco_todo",
  sharedWith: [],
  sharedTeams: [],
  subtasks: [],
  dependsOn: [],
  attachments: (submission.attachments || []).map(({ dataUrl: _dataUrl, ...file }) => file),
  recurrence: { frequency: "none" },
  ownerId: form.workspaceOwnerId,
  businessId: form.businessId || null,
  sourcePublicFormId: form.id,
  sourcePublicFormSubmissionId: submission.id,
  publicProtocol: submission.protocol,
  recordType: kind === "ticket" ? "chamado" : "tarefa",
  createdAt: now,
  updatedAt: now,
});

async function appendPublicFormDestination(env, form, submission, now) {
  const type = form.destination?.type || "response";
  if (type === "response") return { status: "not_required", recordId: null };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(form.workspaceOwnerId)
      .first();
    if (!row) return { status: "failed", error: "Workspace não encontrado." };
    let data;
    try {
      data = JSON.parse(row.data) || {};
    } catch {
      return { status: "failed", error: "Workspace inválido." };
    }
    const beforeNotifications = Array.isArray(data.notifications)
      ? [...data.notifications]
      : [];
    let linkedRecord = null;
    if (type === "task" || type === "ticket") {
      linkedRecord = publicSubmissionTask(form, submission, type, now);
      data.tasks = [linkedRecord, ...(Array.isArray(data.tasks) ? data.tasks : [])];
    } else if (type === "lead") {
      linkedRecord = {
        id: crypto.randomUUID(),
        name: submission.contact.name || publicSubmissionTitle(form, submission),
        company:
          String(
            Object.entries(submission.values || {}).find(([fieldId]) =>
              /empresa|organiza/i.test(
                form.fields.find((field) => field.id === fieldId)?.label || "",
              ),
            )?.[1] || "",
          ).slice(0, 160),
        contact: submission.contact.email || submission.contact.phone || "",
        email: submission.contact.email || "",
        phone: submission.contact.phone || "",
        value: "",
        status: "Novo",
        next: "",
        notes: `Origem: formulário público ${form.name}\nProtocolo: ${submission.protocol}\n\n${publicFormAnswerSummary(form, submission.values)}`.trim(),
        interactions: [
          {
            id: crypto.randomUUID(),
            type: "Formulário público",
            note: `Resposta recebida com protocolo ${submission.protocol}.`,
            at: now.slice(0, 10),
            createdAt: now,
          },
        ],
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        ownerId: form.workspaceOwnerId,
        businessId: form.businessId || null,
        sourcePublicFormId: form.id,
        sourcePublicFormSubmissionId: submission.id,
        publicProtocol: submission.protocol,
        createdAt: now,
        updatedAt: now,
      };
      data.leads = [linkedRecord, ...(Array.isArray(data.leads) ? data.leads : [])];
    } else if (type === "process") {
      const process = (Array.isArray(data.processes) ? data.processes : []).find(
        (item) => item.id === form.destination.processId,
      );
      if (!process)
        return {
          status: "failed",
          error: "O processo de destino não está mais disponível.",
        };
      const processValues = {};
      for (const field of form.fields || []) {
        const processFieldId = field.processFieldId || field.id;
        if (process.fields?.some((item) => item.id === processFieldId))
          processValues[processFieldId] = submission.values?.[field.id];
      }
      const created = createProcessCase(process, processValues, {
        protocol: submission.protocol,
        requesterName: submission.contact.name,
        requesterEmail: submission.contact.email,
        ownerId: form.workspaceOwnerId,
        businessId: form.businessId,
      }, now);
      if (!created.caseRecord)
        return {
          status: "failed",
          error: "A resposta não atende aos campos obrigatórios do processo.",
        };
      const connections = buildProcessConnections(
        process,
        created.caseRecord,
        data.databases || [],
        {
          ownerId: form.workspaceOwnerId,
          businessId: form.businessId,
        },
      );
      linkedRecord = {
        ...created.caseRecord,
        sourcePublicFormId: form.id,
        sourcePublicFormSubmissionId: submission.id,
        linkedRecord: connections.linkedRecord,
        linkedTaskId: connections.task?.id || null,
      };
      data.processCases = [
        linkedRecord,
        ...(Array.isArray(data.processCases) ? data.processCases : []),
      ];
      data.formResponses = [
        {
          id: crypto.randomUUID(),
          processId: process.id,
          caseId: linkedRecord.id,
          values: linkedRecord.values,
          submittedAt: now,
          submittedBy: null,
          businessId: form.businessId || null,
          ownerId: form.workspaceOwnerId,
          visibility: "espaco_todo",
          sourcePublicFormId: form.id,
          sourcePublicFormSubmissionId: submission.id,
        },
        ...(Array.isArray(data.formResponses) ? data.formResponses : []),
      ];
      data.databases = connections.databases;
      if (connections.task)
        data.tasks = [
          connections.task,
          ...(Array.isArray(data.tasks) ? data.tasks : []),
        ];
    }
    if (!linkedRecord)
      return { status: "failed", error: "Destino não reconhecido." };
    data.notifications = [
      {
        id: crypto.randomUUID(),
        assigneeId: form.ownerId || form.workspaceOwnerId,
        ownerId: form.workspaceOwnerId,
        message: `Nova resposta em ${form.name}: ${submission.protocol}`,
        link: "formularios-publicos",
        read: false,
        visibility: "privado",
        createdAt: now,
      },
      ...(Array.isArray(data.notifications) ? data.notifications : []),
    ].slice(0, 50);
    const serialized = JSON.stringify(data);
    if (serialized.length > 900_000)
      return {
        status: "failed",
        error:
          "O workspace está no limite. A resposta foi preservada, mas a conversão precisa ser feita manualmente.",
      };
    const updated = await env.DB.prepare(
      `UPDATE workspaces
       SET data = ?, updated_at = ?, revision = revision + 1
       WHERE user_id = ? AND revision = ?
       RETURNING revision`,
    )
      .bind(
        serialized,
        now,
        form.workspaceOwnerId,
        Number(row.revision) || 0,
      )
      .first();
    if (updated) {
      try {
        await notifyNewNotifications(
          env,
          beforeNotifications,
          data.notifications,
        );
      } catch (error) {
        console.error("public form push", error);
      }
      return { status: "completed", recordId: linkedRecord.id };
    }
  }
  return {
    status: "failed",
    error: "O workspace mudou durante a conversão. A resposta foi preservada.",
  };
}

const publicSubmissionListItem = (row) => {
  const attachments = safeParseJson(row.attachments_json);
  const signature = safeParseJson(row.signature_json);
  const payment = safeParseJson(row.payment_json);
  return {
    id: row.id,
    formId: row.form_id,
    protocol: row.protocol,
    contact: {
      name: row.respondent_name || "",
      email: row.respondent_email || "",
      phone: row.respondent_phone || "",
    },
    values: safeParseJson(row.values_json),
    attachments: (Array.isArray(attachments) ? attachments : []).map(
      ({ dataUrl: _dataUrl, ...attachment }) => attachment,
    ),
    signature: {
      name: signature.name || "",
      consent: signature.consent === true,
      drawn: signature.drawn === true,
      signedAt: signature.signedAt || null,
    },
    payment: {
      acknowledged: payment.acknowledged === true,
      method: payment.method || "",
      amount: Number(payment.amount) || 0,
    },
    destination: row.destination,
    linkedRecordId: row.linked_record_id || null,
    conversionStatus: row.conversion_status,
    conversionError: row.conversion_error || "",
    submittedAt: row.submitted_at,
  };
};

async function handlePublicForm(request, env, url) {
  if (!env.DB) return json({ error: "Formulários indisponíveis." }, 503);
  const pageMatch = url.pathname.match(/^\/f\/([a-z0-9-]+)\/?$/i);
  if (pageMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const row = await env.DB.prepare(
      "SELECT snapshot_json FROM public_forms WHERE slug = ? AND published = 1",
    )
      .bind(pageMatch[1])
      .first();
    if (!row) return publicFormNotFound();
    const form = normalizePublicForm(safeParseJson(row.snapshot_json));
    return renderPublicForm(form, env);
  }

  const submissionMatch = url.pathname.match(
    /^\/api\/public-forms\/([a-z0-9-]+)\/submissions\/?$/i,
  );
  if (!submissionMatch) return null;
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`public-form:${ip}`, 8))
    return json(
      { error: "Muitos envios em pouco tempo. Aguarde e tente novamente." },
      429,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, created_by, snapshot_json
       FROM public_forms WHERE slug = ? AND published = 1`,
  )
    .bind(submissionMatch[1])
    .first();
  if (!row) return json({ error: "Este formulário não está disponível." }, 404);
  const form = normalizePublicForm(safeParseJson(row.snapshot_json), {
    workspaceOwnerId: row.workspace_owner_id,
    ownerId: row.created_by,
  });
  if (String(body.website || "").trim())
    return json({ ok: true, protocol: "FORM-RECEBIDO" });
  const barradoNoFormulario = await exigirTurnstile(request, env, body, {
    acao: "formulario",
    responder: json,
  });
  if (barradoNoFormulario) return barradoNoFormulario;
  const contact = {
    name: String(body.contact?.name || "").trim().slice(0, 120),
    email: String(body.contact?.email || "").trim().toLowerCase().slice(0, 160),
    phone: String(body.contact?.phone || "").trim().slice(0, 40),
  };
  let attachments;
  let signature;
  try {
    attachments = sanitizePublicFormAttachments(form, body.attachments);
    signature = sanitizePublicSignature(form, body.signature);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  const values = sanitizePublicFormValues(form, body.values);
  const payment = form.payment.enabled
    ? {
        acknowledged: body.payment?.acknowledged === true,
        method: form.payment.method,
        amount: form.payment.amount,
      }
    : {};
  const cleanSubmission = {
    contact,
    values,
    attachments,
    signature,
    payment,
    privacyConsent: body.privacyConsent === true,
  };
  const validation = validatePublicFormSubmission(form, cleanSubmission);
  if (!validation.valid)
    return json(
      {
        error: "Revise os campos obrigatórios.",
        errors: validation.errors,
      },
      400,
    );
  const submissionKey = String(body.submissionId || "").slice(0, 120);
  if (!submissionKey)
    return json({ error: "Identificador do envio ausente." }, 400);
  const dedupe = await sha256(`${row.id}|${submissionKey}`);
  const previous = await env.DB.prepare(
    "SELECT protocol FROM public_form_submissions WHERE form_id = ? AND dedupe_key = ?",
  )
    .bind(row.id, dedupe)
    .first();
  if (previous) return json({ ok: true, protocol: previous.protocol, duplicate: true });
  const now = new Date().toISOString();
  const protocol = `${form.serviceCode || "FORM"}-${now.slice(0, 10).replaceAll("-", "")}-${randomHex(3).toUpperCase()}`;
  const submission = {
    id: crypto.randomUUID(),
    protocol,
    ...cleanSubmission,
  };
  await env.DB.prepare(
    `INSERT INTO public_form_submissions
      (id, form_id, workspace_owner_id, protocol, respondent_name,
       respondent_email, respondent_phone, values_json, attachments_json,
       signature_json, payment_json, destination, linked_record_id,
       conversion_status, conversion_error, dedupe_key, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '', ?, ?)`,
  )
    .bind(
      submission.id,
      row.id,
      row.workspace_owner_id,
      protocol,
      contact.name,
      contact.email,
      contact.phone,
      JSON.stringify(values),
      JSON.stringify(attachments),
      JSON.stringify(signature),
      JSON.stringify(payment),
      form.destination.type,
      form.destination.type === "response" ? "not_required" : "pending",
      dedupe,
      now,
    )
    .run();
  const conversion = await appendPublicFormDestination(
    env,
    form,
    submission,
    now,
  );
  await env.DB.prepare(
    `UPDATE public_form_submissions
       SET linked_record_id = ?, conversion_status = ?, conversion_error = ?
     WHERE id = ?`,
  )
    .bind(
      conversion.recordId || null,
      conversion.status,
      String(conversion.error || "").slice(0, 500),
      submission.id,
    )
    .run();
  try {
    await insertInteraction(env, row.workspace_owner_id, row.workspace_owner_id, {
      channel: "form",
      direction: "in",
      contactName: contact.name,
      contactHandle: contact.email || contact.phone,
      subject: `Formulário: ${form.name}`,
      body: publicFormAnswerSummary(form, values) || "(resposta sem texto)",
      meta: {
        publicFormId: form.id,
        submissionId: submission.id,
        protocol,
      },
    });
  } catch (error) {
    console.error("inbox from public form", error);
  }
  return json(
    {
      ok: true,
      protocol,
      conversionStatus: conversion.status,
    },
    201,
  );
}

async function handleForms(request, env, user, url) {
  const action = url.pathname.replace("/api/forms/", "");
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  if (action === "status" && request.method === "GET") {
    let visibleIds = null;
    if (role === "colaborador" || role === "gestor") {
      const workspace = await env.DB.prepare(
        "SELECT data FROM workspaces WHERE user_id = ?",
      )
        .bind(ownerId)
        .first();
      const data = safeParseJson(workspace?.data);
      const ctx = resolveViewerContext(data, user.id);
      visibleIds = new Set(
        filterRecordsForViewer(data.publicForms, user.id, ctx).map(
          (form) => form.id,
        ),
      );
    }
    const rows = await env.DB.prepare(
      `SELECT id, slug, published, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM public_form_submissions s WHERE s.form_id = f.id) AS submissions
         FROM public_forms f
        WHERE workspace_owner_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(ownerId)
      .all();
    return json({
      items: (rows.results || [])
        .filter((item) => !visibleIds || visibleIds.has(item.id))
        .map((item) => ({
          ...item,
          published: item.published === 1,
          submissions: Number(item.submissions) || 0,
          url: `${url.origin}/f/${item.slug}`,
        })),
    });
  }

  if (action === "submissions" && request.method === "GET") {
    const formId = String(url.searchParams.get("form_id") || "").slice(0, 100);
    const formRow = await env.DB.prepare(
      "SELECT workspace_owner_id FROM public_forms WHERE id = ?",
    )
      .bind(formId)
      .first();
    if (!formRow) return json({ items: [] });
    if (
      formRow.workspace_owner_id !== ownerId ||
      !(await canManagePublicForm(env, user.id, ownerId, formId))
    )
      return json({ error: "Você não pode acessar estas respostas." }, 403);
    const rows = await env.DB.prepare(
      `SELECT id, form_id, protocol, respondent_name, respondent_email,
              respondent_phone, values_json, attachments_json, signature_json,
              payment_json, destination, linked_record_id, conversion_status,
              conversion_error, submitted_at
         FROM public_form_submissions
        WHERE form_id = ?
        ORDER BY submitted_at DESC
        LIMIT 300`,
    )
      .bind(formId)
      .all();
    return json({ items: (rows.results || []).map(publicSubmissionListItem) });
  }

  if (action === "file" && request.method === "GET") {
    const submissionId = String(
      url.searchParams.get("submission_id") || "",
    ).slice(0, 100);
    const attachmentId = String(
      url.searchParams.get("attachment_id") || "",
    ).slice(0, 100);
    const row = await env.DB.prepare(
      `SELECT s.form_id, s.workspace_owner_id, s.attachments_json
         FROM public_form_submissions s WHERE s.id = ?`,
    )
      .bind(submissionId)
      .first();
    if (
      !row ||
      row.workspace_owner_id !== ownerId ||
      !(await canManagePublicForm(env, user.id, ownerId, row.form_id))
    )
      return json({ error: "Arquivo não encontrado." }, 404);
    const attachments = safeParseJson(row.attachments_json);
    const attachment = (Array.isArray(attachments) ? attachments : []).find(
      (item) => item.id === attachmentId,
    );
    if (!attachment?.dataUrl) return json({ error: "Arquivo não encontrado." }, 404);
    const match = String(attachment.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match || !PUBLIC_FORM_FILE_TYPES.has(match[1]))
      return json({ error: "Arquivo inválido." }, 400);
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return new Response(bytes, {
      headers: {
        "content-type": match[1],
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name || "arquivo")}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const formId = String(body.form?.id || body.id || "").slice(0, 100);
  if (!formId || !/^[a-zA-Z0-9_-]{3,100}$/.test(formId))
    return json({ error: "Identificador do formulário inválido." }, 400);
  const canManage =
    user.id === ownerId ||
    role === "admin" ||
    (await canManagePublicForm(env, user.id, ownerId, formId));
  if (!canManage)
    return json({ error: "Você não pode publicar este formulário." }, 403);

  if (action === "publish") {
    const form = normalizePublicForm(body.form, {
      workspaceOwnerId: ownerId,
      ownerId: body.form?.ownerId || user.id,
      businessId: body.form?.businessId || null,
    });
    const snapshot = JSON.stringify(form);
    if (snapshot.length > 350_000)
      return json({ error: "A configuração do formulário é muito grande." }, 413);
    if (form.slug.length < 3 || !form.title || form.fields.length < 1)
      return json(
        { error: "Informe título, endereço e pelo menos um campo." },
        400,
      );
    if (
      form.destination.type === "process" &&
      !form.destination.processId
    )
      return json({ error: "Escolha o processo de destino." }, 400);
    if (
      form.payment.enabled &&
      ((form.payment.method === "pix" && !form.payment.pixCode) ||
        (form.payment.method === "link" && !form.payment.link))
    )
      return json(
        { error: "Configure o Pix ou link de pagamento antes de publicar." },
        400,
      );
    const existing = await env.DB.prepare(
      "SELECT workspace_owner_id FROM public_forms WHERE id = ?",
    )
      .bind(formId)
      .first();
    if (existing && existing.workspace_owner_id !== ownerId)
      return json({ error: "Este formulário pertence a outro espaço." }, 403);
    const collision = await env.DB.prepare(
      "SELECT id FROM public_forms WHERE slug = ?",
    )
      .bind(form.slug)
      .first();
    if (collision && collision.id !== formId)
      return json(
        { error: "Este endereço já está em uso. Escolha outro." },
        409,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO public_forms
        (id, workspace_owner_id, created_by, slug, snapshot_json,
         published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug, snapshot_json = excluded.snapshot_json,
         published = 1, updated_at = excluded.updated_at`,
    )
      .bind(
        formId,
        ownerId,
        form.ownerId || user.id,
        form.slug,
        snapshot,
        now,
        now,
      )
      .run();
    return json({
      ok: true,
      slug: form.slug,
      url: `${url.origin}/f/${form.slug}`,
      embedUrl: `${url.origin}/f/${form.slug}`,
      publishedAt: now,
    });
  }
  if (action === "unpublish") {
    await env.DB.prepare(
      `UPDATE public_forms
          SET published = 0, updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    )
      .bind(new Date().toISOString(), formId, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}

// ── Portal do cliente ───────────────────────────────────────────────────
const CLIENT_PORTAL_TOKEN_PATTERN = /^[a-f0-9]{48,128}$/i;
const CLIENT_PORTAL_MAX_FILE_BYTES = 350_000;
const CLIENT_PORTAL_MAX_WORKSPACE_BYTES = 900_000;

const clientPortalUnavailable = () =>
  new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Portal indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Este portal não está disponível</h1><p>O link pode ter expirado, sido revogado ou estar incorreto.</p></body></html>',
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );

const clientPortalDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const clientPortalProtocol = () => {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PORTAL-${stamp}-${randomHex(3).toUpperCase()}`;
};

async function loadClientPortal(env, token, { touch = false } = {}) {
  if (!env.DB || !CLIENT_PORTAL_TOKEN_PATTERN.test(token || "")) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, created_by, config_json, status,
            expires_at, created_at, updated_at
       FROM client_portals
      WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first();
  if (!row || row.status !== "active") return null;
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return null;
  const config = normalizeClientPortal(safeParseJson(row.config_json), {
    workspaceOwnerId: row.workspace_owner_id,
    ownerId: row.created_by,
  });
  const workspace = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(row.workspace_owner_id)
    .first();
  if (!workspace) return null;
  const data = safeParseJson(workspace.data);
  const snapshot = buildClientPortalSnapshot(data, config);
  if (touch)
    await env.DB.prepare(
      "UPDATE client_portals SET last_accessed_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), row.id)
      .run()
      .catch(() => {});
  return {
    row,
    config,
    data,
    revision: Number(workspace.revision) || 0,
    snapshot,
  };
}

const clientPortalStatusLabel = (status) => {
  const labels = {
    "A fazer": "A fazer",
    "Em andamento": "Em andamento",
    Aguardando: "Aguardando",
    Concluído: "Concluído",
    Novo: "Novo",
    Entregue: "Entregue",
    aprovado: "Aprovado",
    recusado: "Recusado",
  };
  return labels[status] || status || "Sem status";
};

function renderClientPortal(token, snapshot) {
  const esc = escMail;
  const portal = snapshot.portal || {};
  const permissions = portal.permissions || {};
  const summary = clientPortalSummary(snapshot);
  const primary = /^#[0-9a-f]{6}$/i.test(portal.appearance?.primaryColor || "")
    ? portal.appearance.primaryColor
    : "#0b9f8f";
  const accent = /^#[0-9a-f]{6}$/i.test(portal.appearance?.accentColor || "")
    ? portal.appearance.accentColor
    : "#16b8a6";
  const logo = portal.appearance?.logoUrl
    ? `<img class="logo" src="${esc(portal.appearance.logoUrl)}" alt="">`
    : `<span class="logo-fallback">${esc(
        (snapshot.business?.name || portal.clientName || "SF")
          .slice(0, 2)
          .toUpperCase(),
      )}</span>`;
  const cards = [
    ["Projetos", summary.projects],
    ["Tarefas abertas", summary.openTasks],
    ["Entregas para aprovar", summary.pendingDeliveries],
    ["Documentos", summary.documents],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join("");
  const projects = (snapshot.projects || [])
    .map(
      (project) => `<article class="card project-card">
        <div class="row between"><div><span class="eyebrow">Projeto</span><h3>${esc(
          project.name,
        )}</h3></div><strong class="progress-number">${project.progress}%</strong></div>
        ${project.objective ? `<p>${esc(project.objective)}</p>` : ""}
        <div class="progress"><span style="width:${Math.max(
          0,
          Math.min(100, Number(project.progress) || 0),
        )}%"></span></div>
        <small>${project.completedTasks} de ${project.taskCount} tarefas concluídas${
          project.endDate ? ` · previsão ${esc(clientPortalDate(project.endDate))}` : ""
        }</small>
        ${
          project.milestones?.length
            ? `<div class="milestones">${project.milestones
                .map(
                  (milestone) =>
                    `<span><b>${esc(milestone.title)}</b>${milestone.plannedDate ? ` · ${esc(clientPortalDate(milestone.plannedDate))}` : ""}</span>`,
                )
                .join("")}</div>`
            : ""
        }
      </article>`,
    )
    .join("");
  const tasks = (snapshot.tasks || [])
    .map((task) => {
      const latest = task.deliveries?.[task.deliveries.length - 1];
      const canDecide =
        permissions.approveDeliveries &&
        latest &&
        !latest.clientDecision;
      const delivery = latest
        ? `<div class="delivery">
            <div class="row between"><strong>Última entrega</strong><span class="badge">${esc(
              latest.clientDecision
                ? latest.clientDecision === "approved"
                  ? "Aprovada por você"
                  : "Ajustes solicitados"
                : "Aguardando sua análise",
            )}</span></div>
            ${latest.comment ? `<p>${esc(latest.comment)}</p>` : ""}
            ${
              canDecide
                ? `<form class="delivery-form" data-task="${esc(
                    task.id,
                  )}" data-delivery="${esc(latest.id)}">
                    <label>Comentário opcional<textarea name="feedback" maxlength="1600" placeholder="Registre sua observação"></textarea></label>
                    <div class="actions">
                      <button type="submit" name="decision" value="changes_requested" class="ghost">Solicitar ajustes</button>
                      <button type="submit" name="decision" value="approved">Aprovar entrega</button>
                    </div>
                  </form>`
                : ""
            }
          </div>`
        : "";
      return `<article class="card task-card">
        <div class="row between"><div><span class="eyebrow">${esc(
          task.project || "Tarefa",
        )}</span><h3>${esc(task.title)}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(task.status),
        )}</span></div>
        ${task.description ? `<p>${esc(task.description)}</p>` : ""}
        ${task.due ? `<small>Prazo: ${esc(clientPortalDate(task.due))}</small>` : ""}
        ${delivery}
      </article>`;
    })
    .join("");
  const documents = (snapshot.documents || [])
    .map(
      (document) => `<article class="card document-card">
        <div class="row between"><div><span class="eyebrow">${esc(
          document.type || "Documento",
        )}</span><h3>${esc(document.title)}</h3></div>${
          document.downloadable
            ? `<a class="button-link ghost" href="/api/portal/${esc(
                token,
              )}/download/${esc(document.id)}">Baixar relatório</a>`
            : ""
        }</div>
        ${
          document.content
            ? `<details><summary>Visualizar conteúdo</summary><pre>${esc(
                document.content,
              )}</pre></details>`
            : "<p>Documento compartilhado sem visualização de texto.</p>"
        }
      </article>`,
    )
    .join("");
  const quotes = (snapshot.quotes || [])
    .map(
      (quote) => `<article class="card">
        <div class="row between"><div><span class="eyebrow">Orçamento</span><h3>${esc(
          quote.clientName || "Proposta comercial",
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(quote.status),
        )}</span></div>
        <div class="value">${moneyBRL(Number(quote.total) || 0)}</div>
        <ul class="items">${quote.items
          .map(
            (item) =>
              `<li><span>${esc(item.quantity)} × ${esc(item.name)}</span><strong>${moneyBRL(
                (Number(item.quantity) || 0) * (Number(item.price) || 0),
              )}</strong></li>`,
          )
          .join("")}</ul>
        ${quote.validUntil ? `<small>Válido até ${esc(clientPortalDate(quote.validUntil))}</small>` : ""}
      </article>`,
    )
    .join("");
  const orders = (snapshot.orders || [])
    .map(
      (order) => `<article class="card">
        <div class="row between"><div><span class="eyebrow">Pedido</span><h3>${esc(
          order.clientName || order.id,
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(order.status),
        )}</span></div>
        <div class="value">${moneyBRL(Number(order.total) || 0)}</div>
        <ul class="items">${order.items
          .map(
            (item) =>
              `<li><span>${esc(item.quantity)} × ${esc(item.name)}</span></li>`,
          )
          .join("")}</ul>
      </article>`,
    )
    .join("");
  const trips = (snapshot.trips || [])
    .map(
      (trip) => `<article class="card trip-card">
        <div class="row between"><div><span class="eyebrow">Entrega</span><h3>${esc(
          trip.code || "Acompanhamento",
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(trip.status),
        )}</span></div>
        <div class="route"><span>${esc(trip.origin || "Origem")}</span><b>→</b><span>${esc(
          trip.destination || "Destino",
        )}</span></div>
        ${trip.eta ? `<small>Previsão: ${esc(clientPortalDate(trip.eta))}</small>` : ""}
        ${trip.occurrence ? `<p class="notice">${esc(trip.occurrence)}</p>` : ""}
      </article>`,
    )
    .join("");
  const section = (id, title, content) =>
    content
      ? `<section id="${id}"><div class="section-title"><span></span><h2>${title}</h2></div><div class="grid">${content}</div></section>`
      : "";
  const nonce = randomHex(16);
  const endpoint = `/api/portal/${token}/actions`;
  const interactionForms = `${
    permissions.openTickets
      ? `<article class="card action-card"><span class="eyebrow">Atendimento</span><h3>Abrir chamado</h3><form id="ticket-form"><label>Assunto<input name="title" maxlength="200" required></label><label>Descrição<textarea name="description" maxlength="4000" required></textarea></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label><button type="submit">Enviar chamado</button></form></article>`
      : ""
  }${
    permissions.uploadDocuments
      ? `<article class="card action-card"><span class="eyebrow">Documentos</span><h3>Enviar documento</h3><form id="upload-form"><label>Arquivo<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx" required></label><label>Observação<textarea name="note" maxlength="1200"></textarea></label><button type="submit">Enviar documento</button></form></article>`
      : ""
  }`;
  const script = `<script nonce="${nonce}">(()=>{const endpoint=${JSON.stringify(
    endpoint,
  )},status=document.getElementById('portal-status');const requestId=()=>crypto.randomUUID?.()||('request-'+Date.now()+'-'+Math.random());const send=async body=>{status.textContent='Enviando...';const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,requestId:requestId()})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível concluir.');status.textContent='Concluído. Protocolo '+data.protocol;return data};document.querySelectorAll('.delivery-form').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const submitter=event.submitter;try{await send({type:'delivery',taskId:form.dataset.task,deliveryId:form.dataset.delivery,decision:submitter?.value||'',feedback:new FormData(form).get('feedback')||''});location.reload()}catch(error){status.textContent=error.message}}));document.getElementById('ticket-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);try{await send({type:'ticket',title:data.get('title'),description:data.get('description'),priority:data.get('priority')});form.reset()}catch(error){status.textContent=error.message}});const readFile=file=>new Promise((resolve,reject)=>{if(!file||!file.size)return reject(new Error('Selecione um arquivo.'));if(file.size>${CLIENT_PORTAL_MAX_FILE_BYTES})return reject(new Error('O arquivo excede 350 KB.'));const reader=new FileReader();reader.onload=()=>resolve({id:crypto.randomUUID?.()||('file-'+Date.now()),name:file.name,type:file.type||'application/octet-stream',size:file.size,dataUrl:reader.result});reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file)});document.getElementById('upload-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);try{await send({type:'upload',file:await readFile(data.get('file')),note:data.get('note')||''});form.reset()}catch(error){status.textContent=error.message}})})()</script>`;
  return { nonce, html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(
    portal.title,
  )}</title><style>*{box-sizing:border-box}body{--primary:${primary};--accent:${accent};margin:0;background:#f6f4fb;color:#211846;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}.top{padding:34px max(20px,calc((100vw - 1120px)/2));background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff}.brand,.row,.actions,.route{display:flex;align-items:center;gap:12px}.brand{margin-bottom:28px}.logo{width:44px;height:44px;object-fit:contain;border-radius:12px;background:#fff}.logo-fallback{display:grid;width:44px;height:44px;place-items:center;border-radius:12px;background:#fff;color:var(--primary);font-weight:900}.brand strong,.brand small{display:block}.brand small{opacity:.78}.top h1{max-width:760px;margin:0 0 8px;font-size:clamp(1.8rem,5vw,3rem)}.top p{max-width:760px;margin:0;line-height:1.6;opacity:.88}.wrap{max-width:1120px;margin:0 auto;padding:22px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:-48px}.metric,.card{background:#fff;border:1px solid #e6e2f2;border-radius:18px;box-shadow:0 12px 34px rgba(55,35,115,.07)}.metric{padding:18px}.metric strong,.metric span{display:block}.metric strong{font-size:1.8rem}.metric span{margin-top:3px;color:#746d88;font-size:.78rem}.section-title{display:flex;align-items:center;gap:9px;margin:32px 0 12px}.section-title span{width:5px;height:24px;border-radius:9px;background:linear-gradient(var(--primary),var(--accent))}.section-title h2{margin:0;font-size:1.18rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:18px}.card h3{margin:3px 0 8px;font-size:1rem}.card p{color:#655e76;line-height:1.55}.between{justify-content:space-between}.eyebrow{color:var(--primary);font-size:.65rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.status,.badge{padding:5px 8px;border-radius:999px;background:#f0edf9;color:var(--primary);font-size:.68rem;font-weight:800}.progress{height:8px;margin:14px 0 8px;overflow:hidden;border-radius:9px;background:#ece8f5}.progress span{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent))}.progress-number,.value{color:var(--primary);font-size:1.3rem}.milestones{display:grid;gap:5px;margin-top:12px}.milestones span{padding:8px;border-radius:9px;background:#f8f7fc;font-size:.75rem}.delivery{margin-top:14px;padding:13px;border-radius:13px;background:#faf8ff;border:1px solid #ece7f8}.delivery textarea{min-height:68px}.actions{justify-content:flex-end;margin-top:8px}.actions button{width:auto}.document-card pre{max-height:320px;overflow:auto;white-space:pre-wrap;font:inherit;font-size:.8rem;line-height:1.55}.document-card summary{cursor:pointer;color:var(--primary);font-weight:800}.button-link,button{display:inline-flex;justify-content:center;padding:10px 13px;border:0;border-radius:10px;background:var(--primary);color:#fff;font:inherit;font-size:.78rem;font-weight:800;text-decoration:none;cursor:pointer}.ghost{background:#f0edf9;color:var(--primary)}label{display:grid;gap:5px;margin:10px 0;color:#655e76;font-size:.72rem;font-weight:800}input,textarea,select{width:100%;padding:10px;border:1px solid #ddd7ec;border-radius:9px;background:#fff;color:#211846;font:inherit}textarea{min-height:92px;resize:vertical}.items{padding:0;list-style:none}.items li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #eee}.route{justify-content:space-between;margin:14px 0;padding:12px;border-radius:12px;background:#f8f7fc}.notice{padding:9px;border-radius:9px;background:#fff4e5;color:#8a5300!important}.portal-status{position:sticky;bottom:12px;z-index:3;min-height:20px;margin:18px auto;padding:10px 14px;border-radius:11px;background:#211846;color:#fff;text-align:center;font-size:.78rem}.footer{padding:30px 20px;text-align:center;color:#88809a;font-size:.75rem}@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr);margin-top:-32px}.grid{grid-template-columns:1fr}.wrap{padding:14px}.top{padding:26px 18px 54px}.between{align-items:flex-start}.actions{align-items:stretch;flex-direction:column}.actions button{width:100%}}</style></head><body><header class="top"><div class="brand">${logo}<div><strong>${esc(
    snapshot.business?.name || "Seu Funcionário",
  )}</strong><small>Portal seguro do cliente</small></div></div><h1>${esc(
    portal.title,
  )}</h1><p>${esc(
    portal.clientName ? `${portal.clientName}, ${portal.welcome}` : portal.welcome,
  )}</p></header><main class="wrap"><div class="metrics">${cards}</div>${section(
    "projetos",
    "Projetos",
    projects,
  )}${section("tarefas", "Tarefas e entregas", tasks)}${section(
    "documentos",
    "Documentos e relatórios",
    documents,
  )}${section("orcamentos", "Orçamentos", quotes)}${section(
    "pedidos",
    "Pedidos",
    orders,
  )}${section("entregas", "Acompanhamento de entregas", trips)}${section(
    "interagir",
    "Fale com a equipe",
    interactionForms,
  )}<p id="portal-status" class="portal-status" role="status">${
    portal.supportText
      ? esc(portal.supportText)
      : "Suas ações recebem protocolo e ficam registradas."
  }</p></main><footer class="footer">Acesso individual e restrito · Seu Funcionário</footer>${script}</body></html>` };
}

function sanitizeClientPortalFile(file) {
  if (!file || typeof file !== "object")
    throw new Error("Selecione um arquivo.");
  const name = String(file.name || "")
    .trim()
    .slice(0, 240);
  const type = String(file.type || "").toLowerCase();
  const size = Math.max(0, Number(file.size) || 0);
  const dataUrl = String(file.dataUrl || "");
  if (
    !name ||
    !PUBLIC_FORM_FILE_TYPES.has(type) ||
    !size ||
    size > CLIENT_PORTAL_MAX_FILE_BYTES
  )
    throw new Error("O arquivo não é permitido ou excede 350 KB.");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match || match[1].toLowerCase() !== type)
    throw new Error("O conteúdo do arquivo é inválido.");
  const estimatedBytes = Math.floor((match[2].replace(/=+$/, "").length * 3) / 4);
  if (estimatedBytes < 1 || estimatedBytes > CLIENT_PORTAL_MAX_FILE_BYTES)
    throw new Error("O conteúdo do arquivo excede 350 KB.");
  return {
    id: String(file.id || crypto.randomUUID()).slice(0, 100),
    name,
    type,
    size: estimatedBytes,
    dataUrl,
  };
}

const publicClientPortalEvent = (row) => {
  const payload = safeParseJson(row.payload_json);
  if (payload.file) {
    const { dataUrl: _dataUrl, ...metadata } = payload.file;
    payload.file = metadata;
  }
  return {
    id: row.id,
    portalId: row.portal_id,
    type: row.type,
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    linkedRecordId: row.linked_record_id || "",
    protocol: row.protocol,
    payload,
    status: row.status,
    error: row.error || "",
    createdAt: row.created_at,
  };
};

async function applyClientPortalEvent(env, loaded, event, action) {
  const ownerId = loaded.row.workspace_owner_id;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const workspace = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    if (!workspace)
      return { status: "failed", error: "Workspace não encontrado." };
    const data = safeParseJson(workspace.data);
    const snapshot = buildClientPortalSnapshot(data, loaded.config);
    const validation = validateClientPortalAction(action, snapshot);
    if (!validation.valid)
      return { status: "failed", error: validation.error };
    const beforeNotifications = Array.isArray(data.notifications)
      ? [...data.notifications]
      : [];
    const now = new Date().toISOString();
    let linkedRecordId = "";
    if (action.type === "ticket") {
      const task = {
        id: crypto.randomUUID(),
        title: `[Portal] ${String(action.title || "").trim().slice(0, 200)}`,
        description: `${String(action.description || "").trim().slice(0, 4000)}\n\nCliente: ${loaded.config.clientName || "não informado"}\nProtocolo: ${event.protocol}`,
        status: "A fazer",
        priority:
          action.priority === "Urgente"
            ? "Alta"
            : action.priority === "Alta"
              ? "Alta"
              : "Média",
        area: "Atendimento",
        assignee: "Atendimento",
        assigneeId: "",
        project: "",
        projectId: null,
        approvalMode: "imediata",
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        assignees: [],
        interested: [],
        deliveries: [],
        subtasks: [],
        dependsOn: [],
        attachments: [],
        recurrence: { frequency: "none" },
        ownerId,
        businessId: loaded.config.businessId || null,
        sourceClientPortalId: loaded.config.id,
        sourceClientPortalEventId: event.id,
        publicProtocol: event.protocol,
        createdAt: now,
        updatedAt: now,
      };
      data.tasks = [task, ...(Array.isArray(data.tasks) ? data.tasks : [])];
      linkedRecordId = task.id;
    } else if (action.type === "upload") {
      const document = {
        id: crypto.randomUUID(),
        title: action.file.name,
        type: "Documento enviado pelo cliente",
        category: "Portal do cliente",
        content: `Documento recebido pelo portal de ${loaded.config.clientName || "cliente"}.\nProtocolo: ${event.protocol}${action.note ? `\nObservação: ${String(action.note).slice(0, 1200)}` : ""}`,
        status: "Recebido",
        ownerId,
        businessId: loaded.config.businessId || null,
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        sourceClientPortalId: loaded.config.id,
        sourceClientPortalEventId: event.id,
        portalAttachment: {
          id: action.file.id,
          name: action.file.name,
          type: action.file.type,
          size: action.file.size,
        },
        createdAt: now,
        updatedAt: now,
      };
      data.documents = [
        document,
        ...(Array.isArray(data.documents) ? data.documents : []),
      ];
      linkedRecordId = document.id;
    } else if (action.type === "delivery") {
      data.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task) => {
        if (task.id !== action.taskId) return task;
        return {
          ...task,
          clientApprovalStatus:
            action.decision === "approved" ? "approved" : "changes_requested",
          clientApprovalFeedback: String(action.feedback || "").slice(0, 1600),
          clientApprovalAt: now,
          deliveries: (Array.isArray(task.deliveries) ? task.deliveries : []).map(
            (delivery) =>
              delivery.id === action.deliveryId
                ? {
                    ...delivery,
                    clientDecision: action.decision,
                    clientFeedback: String(action.feedback || "").slice(0, 1600),
                    clientDecidedAt: now,
                    clientProtocol: event.protocol,
                  }
                : delivery,
          ),
          updatedAt: now,
        };
      });
      linkedRecordId = action.taskId;
    }
    data.notifications = [
      {
        id: crypto.randomUUID(),
        assigneeId: loaded.config.ownerId || ownerId,
        ownerId,
        message:
          action.type === "ticket"
            ? `Novo chamado de ${loaded.config.clientName || "cliente"}: ${event.protocol}`
            : action.type === "upload"
              ? `Novo documento no portal: ${event.protocol}`
              : `Cliente respondeu sobre uma entrega: ${event.protocol}`,
        link: "portal-cliente",
        read: false,
        visibility: "privado",
        createdAt: now,
      },
      ...(Array.isArray(data.notifications) ? data.notifications : []),
    ].slice(0, 50);
    const serialized = JSON.stringify(data);
    if (serialized.length > CLIENT_PORTAL_MAX_WORKSPACE_BYTES)
      return {
        status: "failed",
        error:
          "O workspace está no limite. A solicitação foi preservada para tratamento manual.",
      };
    const updated = await env.DB.prepare(
      `UPDATE workspaces
          SET data = ?, updated_at = ?, revision = revision + 1
        WHERE user_id = ? AND revision = ?
        RETURNING revision`,
    )
      .bind(serialized, now, ownerId, Number(workspace.revision) || 0)
      .first();
    if (!updated) continue;
    await notifyNewNotifications(
      env,
      beforeNotifications,
      data.notifications,
    ).catch((error) => console.error("client portal push", error));
    return { status: "applied", linkedRecordId };
  }
  return {
    status: "failed",
    error: "O workspace mudou durante a ação. O registro foi preservado.",
  };
}

async function handlePublicClientPortal(request, env, url) {
  if (!env.DB) return json({ error: "Portal indisponível." }, 503);
  const pageMatch = url.pathname.match(/^\/portal\/([a-f0-9]{48,128})\/?$/i);
  const dataMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/?$/i,
  );
  const actionMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/actions\/?$/i,
  );
  const downloadMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/download\/([a-zA-Z0-9_-]{3,100})\/?$/,
  );
  const token =
    pageMatch?.[1] || dataMatch?.[1] || actionMatch?.[1] || downloadMatch?.[1];
  if (!token) return null;
  const loaded = await loadClientPortal(env, token, {
    touch: !!pageMatch || !!dataMatch,
  });
  if (!loaded)
    return pageMatch ? clientPortalUnavailable() : json({ error: "Portal não encontrado." }, 404);
  if (pageMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const rendered = renderClientPortal(token, loaded.snapshot);
    return new Response(rendered.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; script-src 'nonce-${rendered.nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (dataMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    return json({
      ...loaded.snapshot,
      summary: clientPortalSummary(loaded.snapshot),
    });
  }
  if (downloadMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const document = (loaded.snapshot.documents || []).find(
      (item) => item.id === downloadMatch[2] && item.downloadable,
    );
    if (!document) return json({ error: "Relatório não encontrado." }, 404);
    return new Response(document.content || "Relatório sem conteúdo textual.", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          `${document.title || "relatorio"}.txt`,
        )}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`client-portal:${ip}:${loaded.row.id}`, 20))
    return json({ error: "Muitas tentativas. Aguarde um minuto." }, 429);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const action = {
    type: String(body.type || "").slice(0, 80),
    title: String(body.title || "").trim().slice(0, 200),
    description: String(body.description || "").trim().slice(0, 4000),
    priority: String(body.priority || "").slice(0, 40),
    note: String(body.note || "").trim().slice(0, 1200),
    taskId: String(body.taskId || "").slice(0, 100),
    deliveryId: String(body.deliveryId || "").slice(0, 100),
    decision: String(body.decision || "").slice(0, 40),
    feedback: String(body.feedback || "").trim().slice(0, 1600),
    file: body.file,
  };
  if (action.type === "upload") {
    try {
      action.file = sanitizeClientPortalFile(body.file);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }
  const validation = validateClientPortalAction(action, loaded.snapshot);
  if (!validation.valid) return json({ error: validation.error }, 400);
  const requestId = String(body.requestId || "").slice(0, 160);
  if (!requestId) return json({ error: "Identificador do envio obrigatório." }, 400);
  const dedupeKey = await sha256(`${loaded.row.id}:${requestId}`);
  const previous = await env.DB.prepare(
    `SELECT protocol, status, error
       FROM client_portal_events
      WHERE portal_id = ? AND dedupe_key = ?`,
  )
    .bind(loaded.row.id, dedupeKey)
    .first();
  if (previous)
    return json({
      ok: previous.status === "applied",
      protocol: previous.protocol,
      status: previous.status,
      error: previous.error || "",
      duplicate: true,
    });
  const now = new Date().toISOString();
  const event = {
    id: crypto.randomUUID(),
    protocol: clientPortalProtocol(),
  };
  const payload = {
    title: action.title,
    description: action.description,
    priority: action.priority,
    note: action.note,
    feedback: action.feedback,
    decision: action.decision,
    clientName: loaded.config.clientName,
    clientEmail: loaded.config.clientEmail,
    file: action.file || null,
  };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO client_portal_events
      (id, portal_id, workspace_owner_id, type, entity_type, entity_id,
       protocol, payload_json, status, error, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', '', ?, ?)`,
  )
    .bind(
      event.id,
      loaded.row.id,
      loaded.row.workspace_owner_id,
      action.type,
      action.type === "delivery"
        ? "task"
        : action.type === "upload"
          ? "document"
          : "ticket",
      action.taskId || null,
      event.protocol,
      JSON.stringify(payload),
      dedupeKey,
      now,
    )
    .run();
  const applied = await applyClientPortalEvent(env, loaded, event, action);
  await env.DB.prepare(
    `UPDATE client_portal_events
        SET linked_record_id = ?, status = ?, error = ?
      WHERE id = ?`,
  )
    .bind(
      applied.linkedRecordId || null,
      applied.status,
      applied.error || "",
      event.id,
    )
    .run();
  return json(
    {
      ok: applied.status === "applied",
      protocol: event.protocol,
      status: applied.status,
      error: applied.error || "",
    },
    applied.status === "applied" ? 201 : 202,
  );
}

async function handleClientPortals(request, env, user, url) {
  const action = url.pathname.replace("/api/client-portals/", "");
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (action === "status" && request.method === "GET") {
    let visibleIds = null;
    if (role === "colaborador" || role === "gestor") {
      const workspace = await env.DB.prepare(
        "SELECT data FROM workspaces WHERE user_id = ?",
      )
        .bind(ownerId)
        .first();
      const data = safeParseJson(workspace?.data);
      const ctx = resolveViewerContext(data, user.id);
      visibleIds = new Set(
        filterRecordsForViewer(data.clientPortals, user.id, ctx).map(
          (portal) => portal.id,
        ),
      );
    }
    const rows = await env.DB.prepare(
      `SELECT id, status, expires_at AS expiresAt,
              last_accessed_at AS lastAccessedAt, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM client_portal_events e WHERE e.portal_id = p.id) AS events
         FROM client_portals p
        WHERE workspace_owner_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(ownerId)
      .all();
    return json({
      items: (rows.results || [])
        .filter((item) => !visibleIds || visibleIds.has(item.id))
        .map((item) => ({
          ...item,
          active: item.status === "active",
          events: Number(item.events) || 0,
        })),
    });
  }
  if (action === "events" && request.method === "GET") {
    const portalId = String(url.searchParams.get("portal_id") || "").slice(
      0,
      100,
    );
    const portalRow = await env.DB.prepare(
      "SELECT workspace_owner_id FROM client_portals WHERE id = ?",
    )
      .bind(portalId)
      .first();
    if (
      !portalRow ||
      portalRow.workspace_owner_id !== ownerId ||
      !(await canManageClientPortal(env, user.id, ownerId, portalId))
    )
      return json({ error: "Você não pode acessar este portal." }, 403);
    const rows = await env.DB.prepare(
      `SELECT id, portal_id, type, entity_type, entity_id, linked_record_id,
              protocol, payload_json, status, error, created_at
         FROM client_portal_events
        WHERE portal_id = ?
        ORDER BY created_at DESC
        LIMIT 300`,
    )
      .bind(portalId)
      .all();
    return json({ items: (rows.results || []).map(publicClientPortalEvent) });
  }
  if (action === "file" && request.method === "GET") {
    const eventId = String(url.searchParams.get("event_id") || "").slice(0, 100);
    const row = await env.DB.prepare(
      `SELECT portal_id, workspace_owner_id, payload_json
         FROM client_portal_events
        WHERE id = ? AND type = 'upload'`,
    )
      .bind(eventId)
      .first();
    if (
      !row ||
      row.workspace_owner_id !== ownerId ||
      !(await canManageClientPortal(env, user.id, ownerId, row.portal_id))
    )
      return json({ error: "Arquivo não encontrado." }, 404);
    const file = safeParseJson(row.payload_json)?.file;
    if (!file?.dataUrl) return json({ error: "Arquivo não encontrado." }, 404);
    const match = String(file.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match || !PUBLIC_FORM_FILE_TYPES.has(match[1]))
      return json({ error: "Arquivo inválido." }, 400);
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return new Response(bytes, {
      headers: {
        "content-type": match[1],
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          file.name || "arquivo",
        )}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const portalId = String(body.portal?.id || body.id || "").slice(0, 100);
  if (!portalId || !/^[a-zA-Z0-9_-]{3,100}$/.test(portalId))
    return json({ error: "Identificador do portal inválido." }, 400);
  const canManage =
    user.id === ownerId ||
    role === "admin" ||
    (await canManageClientPortal(env, user.id, ownerId, portalId));
  if (!canManage)
    return json({ error: "Você não pode publicar este portal." }, 403);
  if (action === "publish") {
    const portal = normalizeClientPortal(body.portal, {
      workspaceOwnerId: ownerId,
      ownerId: user.id,
      businessId: body.portal?.businessId || null,
    });
    portal.ownerId = user.id;
    portal.workspaceOwnerId = ownerId;
    if (!portal.clientName || !portal.title)
      return json({ error: "Informe o cliente e o título do portal." }, 400);
    if (
      portal.expiresAt &&
      new Date(portal.expiresAt).getTime() <= Date.now()
    )
      return json({ error: "A validade precisa estar no futuro." }, 400);
    const config = JSON.stringify(portal);
    if (config.length > 180_000)
      return json({ error: "A configuração do portal é muito grande." }, 413);
    const existing = await env.DB.prepare(
      "SELECT workspace_owner_id FROM client_portals WHERE id = ?",
    )
      .bind(portalId)
      .first();
    if (existing && existing.workspace_owner_id !== ownerId)
      return json({ error: "Este portal pertence a outro espaço." }, 403);
    const token = randomHex(32);
    const tokenHash = await sha256(token);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO client_portals
        (id, workspace_owner_id, created_by, token_hash, config_json, status,
         expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         token_hash = excluded.token_hash, config_json = excluded.config_json,
         status = 'active', expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        portal.id,
        ownerId,
        portal.ownerId || user.id,
        tokenHash,
        config,
        portal.expiresAt || null,
        now,
        now,
      )
      .run();
    return json({
      ok: true,
      url: `${url.origin}/portal/${token}`,
      publishedAt: now,
    });
  }
  if (action === "revoke") {
    await env.DB.prepare(
      `UPDATE client_portals
          SET status = 'revoked', updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    )
      .bind(new Date().toISOString(), portalId, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}

async function handleSites(request, env, user, url) {
  const action = url.pathname.replace("/api/sites/", "");
  if (action === "leads" && request.method === "GET") {
    const siteId = url.searchParams.get("site_id") || "";
    const site = await env.DB.prepare(
      "SELECT owner_id FROM public_sites WHERE id = ?",
    )
      .bind(siteId)
      .first();
    if (!site) return json({ leads: [] });
    if (!(await canManageSite(env, user.id, site.owner_id, siteId)))
      return json({ error: "Você não tem acesso a este site." }, 403);
    const leads = await env.DB.prepare(
      `SELECT id, name, email, phone, message, created_at AS createdAt FROM public_site_leads
      WHERE site_id = ? ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(siteId)
      .all();
    return json({ leads: leads.results || [] });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 80) : "";
  const ownerId =
    typeof body.ownerId === "string" && body.ownerId ? body.ownerId : user.id;
  if (!id || !/^[a-zA-Z0-9_-]{3,80}$/.test(id))
    return json({ error: "Identificador do site inválido." }, 400);
  if (!(await canManageSite(env, user.id, ownerId, id)))
    return json({ error: "Você não tem acesso a este site." }, 403);

  if (action === "publish") {
    const slug = siteSlug(body.slug);
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 200)
        : "";
    const html = sanitizeSiteHtml(body.html);
    const pages = Array.isArray(body.pages)
      ? body.pages.slice(0, 8).map((page) => ({
          slug: siteSlug(page?.slug || "").slice(0, 50),
          name:
            typeof page?.name === "string"
              ? page.name.trim().slice(0, 80)
              : "Página",
          html: sanitizeSiteHtml(page?.html || ""),
        }))
      : [];
    const pagesJson = JSON.stringify(pages);
    if (pagesJson.length > 900_000)
      return json(
        { error: "As páginas excederam o limite de publicação." },
        413,
      );
    if (slug.length < 3 || !name || html.length < 120)
      return json(
        { error: "Revise nome, endereço e conteúdo antes de publicar." },
        400,
      );
    const existing = await env.DB.prepare(
      "SELECT owner_id FROM public_sites WHERE id = ?",
    )
      .bind(id)
      .first();
    if (existing && existing.owner_id !== ownerId)
      return json({ error: "Este site pertence a outro espaço." }, 403);
    const collision = await env.DB.prepare(
      "SELECT id FROM public_sites WHERE slug = ?",
    )
      .bind(slug)
      .first();
    if (collision && collision.id !== id)
      return json(
        { error: "Este endereço já está em uso. Escolha outro slug." },
        409,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO public_sites (id, owner_id, slug, name, description, html, pages_json, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name, description = excluded.description,
      html = excluded.html, pages_json = excluded.pages_json, published = 1, updated_at = excluded.updated_at`,
    )
      .bind(id, ownerId, slug, name, description, html, pagesJson, now, now)
      .run();
    return json({
      ok: true,
      slug,
      url: `${url.origin}/s/${slug}`,
      publishedAt: now,
    });
  }
  if (action === "unpublish") {
    await env.DB.prepare(
      "UPDATE public_sites SET published = 0, updated_at = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(new Date().toISOString(), id, ownerId)
      .run();
    return json({ ok: true });
  }
  if (action === "delete") {
    await env.DB.prepare(
      "DELETE FROM public_sites WHERE id = ? AND owner_id = ?",
    )
      .bind(id, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}

async function handlePush(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const action = url.pathname.replace("/api/push/", "");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  if (action === "subscribe") {
    if (!pushEnabled(env))
      return json(
        { error: "Notificações do navegador não estão configuradas." },
        503,
      );
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (
      !endpoint ||
      typeof p256dh !== "string" ||
      !p256dh ||
      typeof auth !== "string" ||
      !auth
    )
      return json({ error: "Assinatura inválida." }, 400);
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, created_at = excluded.created_at`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        endpoint,
        p256dh,
        auth,
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }
  if (action === "unsubscribe") {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return json({ ok: true });
    await env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
    )
      .bind(endpoint, user.id)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}


async function handleMedia(request, env, url) {
  if (request.method === "GET") {
    const requestId = url.searchParams.get("request_id") || "";
    if (!/^wan_[a-f0-9]{32}$/.test(requestId))
      return json({ error: "Identificador de vídeo inválido." }, 400);
    if (!env.VIDEO_AI_URL || !env.VIDEO_AI_TOKEN)
      return json(
        { error: "O servidor próprio de vídeo ainda não está conectado." },
        503,
      );
    const response = await fetch(
      `${env.VIDEO_AI_URL.replace(/\/$/, "")}/v1/videos/${requestId}`,
      { headers: { authorization: `Bearer ${env.VIDEO_AI_TOKEN}` } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return json(
        {
          error:
            data.detail ||
            data.error?.message ||
            "Não foi possível consultar o vídeo.",
        },
        response.status,
      );
    return json({
      status: data.status,
      progress: data.progress || 0,
      url: data.url || null,
      duration: data.duration || null,
      error: data.error || null,
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 5 || prompt.length > 3000)
    return json({ error: "Descreva o material em 5 a 3.000 caracteres." }, 400);
  if (body.type === "video") {
    if (!env.VIDEO_AI_URL || !env.VIDEO_AI_TOKEN)
      return json(
        {
          error:
            "O servidor próprio de vídeo ainda não está conectado. A aplicação não recorrerá a créditos de terceiros.",
        },
        503,
      );
    const response = await fetch(
      `${env.VIDEO_AI_URL.replace(/\/$/, "")}/v1/videos`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.VIDEO_AI_TOKEN}`,
        },
        body: JSON.stringify({
          prompt,
          quality: body.quality === "standard" ? "standard" : "advanced",
          aspectRatio: "16:9",
        }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return json(
        {
          error:
            data.detail ||
            data.error?.message ||
            `Vídeo indisponível (${response.status}).`,
        },
        response.status,
      );
    return json({
      status: data.status || "pending",
      requestId: data.requestId,
      freeTier: false,
    });
  }
  const finalPrompt =
    body.type === "logo"
      ? `Crie um conceito de logo profissional e memorável para uso comercial. ${prompt}. Símbolo original, composição limpa, fundo simples, sem mockup, sem marca d'água, texto somente se solicitado e com grafia exata.`
      : prompt;
  if (env.AI) {
    try {
      const freeResult = await env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell",
        {
          prompt: finalPrompt.slice(0, 2048),
          steps: 4,
          seed: Math.floor(Math.random() * 1_000_000),
        },
      );
      if (freeResult?.image)
        return json({
          status: "done",
          url: `data:image/jpeg;base64,${freeResult.image}`,
          mimeType: "image/jpeg",
          freeTier: true,
        });
    } catch {
      if (body.confirmPaid !== true)
        return json(
          {
            error:
              "A geração integrada está temporariamente indisponível. Tente novamente em alguns minutos.",
          },
          503,
        );
    }
  }
  if (body.confirmPaid !== true)
    return json(
      {
        error:
          "A geração integrada não respondeu. Tente novamente em alguns minutos.",
      },
      503,
    );
  if (!env.XAI_API_KEY)
    return json({ error: "A opção complementar não está disponível." }, 503);
  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt: finalPrompt,
      response_format: "url",
      n: 1,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    return json(
      {
        error:
          data.error?.message || `Imagem indisponível (${response.status}).`,
      },
      response.status,
    );
  return json({
    status: "done",
    url: data.data?.[0]?.url || null,
    mimeType: data.data?.[0]?.mime_type || "image/jpeg",
    revisedPrompt: data.data?.[0]?.revised_prompt || "",
    freeTier: false,
  });
}

// Transcrição no Workers AI (já no plano, sem serviço externo). O turbo custa
// ~13% mais neurons por minuto que o antigo e acerta mais português.
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const WHISPER_FALLBACK_MODEL = "@cf/openai/whisper";
const BASE64_AUDIO = /^[A-Za-z0-9+/]+={0,2}$/;

// Transcreve áudio com Whisper no Workers AI. O áudio é gravado ou escolhido no
// navegador e chega aqui em base64; nada é armazenado no servidor.
export async function handleTranscribe(request, env) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  if (!env.AI)
    return json(
      { error: "Transcrição indisponível: Workers AI não está configurado." },
      503,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }
  const base64 = String(body?.audio || "");
  if (!base64) return json({ error: "Nenhum áudio recebido." }, 400);
  // ~8 MB de base64 (aprox. 6 MB de áudio) é o teto por envio.
  if (base64.length > 8_000_000)
    return json(
      { error: "Áudio muito longo. Divida em partes de até 5 minutos." },
      413,
    );
  // Confere o formato sem decodificar: a regex é nativa e linear, enquanto o
  // `atob` + laço byte a byte + `[...bytes]` de antes montava um array JS de
  // milhões de itens — o bastante para estourar os 10 ms de CPU do plano Free.
  if (!BASE64_AUDIO.test(base64))
    return json({ error: "Áudio em formato inválido." }, 400);
  // Nomes próprios que a pessoa informou (participantes, cliente): o Whisper
  // erra nome com frequência, e o `initial_prompt` é a dica de contexto dele.
  const dica = String(body?.hint || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
  try {
    let result;
    try {
      // large-v3-turbo aceita o base64 direto e o idioma — o `whisper` antigo
      // não tinha parâmetro de idioma e adivinhava a língua a cada áudio.
      result = await env.AI.run(WHISPER_MODEL, {
        audio: base64,
        language: "pt",
        vad_filter: true,
        ...(dica ? { initial_prompt: dica } : {}),
      });
    } catch (error) {
      // Contingência: o modelo antigo, que exige os bytes. Só entra quando o
      // turbo falha, então o custo de CPU da conversão fica fora do caminho
      // normal.
      console.error("Transcribe turbo error", error);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      result = await env.AI.run(WHISPER_FALLBACK_MODEL, { audio: [...bytes] });
    }
    const text = String(result?.text || "").trim();
    if (!text)
      return json({ error: "Não foi possível entender o áudio." }, 422);
    return json({
      text,
      words: result?.word_count ?? null,
    });
  } catch (error) {
    console.error("Transcribe error", error);
    return json({ error: "Não foi possível transcrever este áudio." }, 502);
  }
}

const apiCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, content-type, idempotency-key",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

function publicApiJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...apiCorsHeaders,
      ...extraHeaders,
    },
  });
}

const PUBLIC_API_COLLECTIONS = new Set([
  "tasks",
  "contacts",
  "opportunities",
  "transactions",
]);

function publicApiOpenApi(origin) {
  const paths = {
    "/api/public/v1/me": {
      get: {
        summary: "Identifica o espaço da chave",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Espaço autenticado" } },
      },
    },
  };
  for (const collection of PUBLIC_API_COLLECTIONS) {
    paths[`/api/public/v1/${collection}`] = {
      get: {
        summary: `Lista ${collection}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "query",
            name: "limit",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          { in: "query", name: "businessId", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Lista paginada" } },
      },
      ...(collection === "tasks" || collection === "contacts"
        ? {
            post: {
              summary: `Cria um item em ${collection}`,
              security: [{ bearerAuth: [] }],
              parameters: [
                {
                  in: "header",
                  name: "Idempotency-Key",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: {
                201: { description: "Item criado" },
                409: { description: "Conflito de atualização" },
              },
            },
          }
        : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Seu Funcionário Public API",
      version: "1.0.0",
      description:
        "API gratuita e versionada para integrar dados do espaço. Chaves são criadas dentro do aplicativo.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "sf_live" },
      },
    },
    paths,
  };
}

async function publicApiCredentials(request, env) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token.startsWith("sf_live_")) return null;
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, scope FROM public_api_keys
     WHERE key_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await sha256(token))
    .first();
  if (!row) return null;
  if (!allowed(`public-api:${row.id}`, 120)) return { rateLimited: true };
  await env.DB.prepare(
    "UPDATE public_api_keys SET last_used_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), row.id)
    .run();
  return row;
}

function publicApiRecord(record) {
  if (!record || typeof record !== "object") return null;
  const safe = { ...record };
  for (const field of [
    "ownerId",
    "sharedWith",
    "sharedTeams",
    "editors",
    "sharingPermission",
    "visibility",
  ])
    delete safe[field];
  return safe;
}

const publicWritableFields = {
  tasks: [
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
    "businessId",
    "project",
    "tags",
  ],
  contacts: [
    "name",
    "email",
    "phone",
    "company",
    "role",
    "notes",
    "businessId",
    "tags",
  ],
};

function buildPublicRecord(collection, body, ownerId) {
  const record = {
    id: crypto.randomUUID(),
    ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "public-api",
  };
  for (const field of publicWritableFields[collection] || []) {
    if (body[field] === undefined) continue;
    record[field] = Array.isArray(body[field])
      ? body[field].slice(0, 20).map((value) => cleanText(value, 80))
      : cleanText(
          body[field],
          field === "description" || field === "notes" ? 2_000 : 200,
        );
  }
  if (!record.name && !record.title) return null;
  if (collection === "tasks") {
    record.status = record.status || "pendente";
    record.priority = record.priority || "media";
  }
  return record;
}

async function handlePublicApi(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: apiCorsHeaders });
  if (url.pathname === "/api/public/v1/openapi.json") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson(publicApiOpenApi(url.origin));
  }
  const credentials = await publicApiCredentials(request, env);
  if (credentials?.rateLimited)
    return publicApiJson(
      { error: "Limite de 120 chamadas por minuto excedido." },
      429,
      { "retry-after": "60" },
    );
  if (!credentials)
    return publicApiJson({ error: "Chave ausente, inválida ou revogada." }, 401);
  if (url.pathname === "/api/public/v1/me") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson({
      workspaceId: credentials.workspace_owner_id,
      scope: credentials.scope,
      version: "v1",
    });
  }
  const collection = url.pathname.split("/").filter(Boolean)[3] || "";
  if (!PUBLIC_API_COLLECTIONS.has(collection))
    return publicApiJson({ error: "Recurso não encontrado." }, 404);
  const workspace = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(credentials.workspace_owner_id)
    .first();
  let data;
  try {
    data = workspace ? JSON.parse(workspace.data) : {};
  } catch {
    return publicApiJson({ error: "Dados do espaço indisponíveis." }, 503);
  }
  if (request.method === "GET") {
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      ),
    );
    const businessId = cleanText(url.searchParams.get("businessId"), 80);
    const records = (Array.isArray(data[collection]) ? data[collection] : [])
      .filter((record) => !businessId || record?.businessId === businessId)
      .slice(0, limit)
      .map(publicApiRecord)
      .filter(Boolean);
    return publicApiJson({ data: records, count: records.length, limit });
  }
  if (request.method !== "POST")
    return publicApiJson({ error: "Método não permitido." }, 405);
  if (credentials.scope !== "read-write")
    return publicApiJson({ error: "Esta chave permite somente leitura." }, 403);
  if (!publicWritableFields[collection])
    return publicApiJson({ error: "Este recurso não aceita criação." }, 405);
  const idempotencyKey = cleanText(
    request.headers.get("idempotency-key"),
    100,
  );
  if (!idempotencyKey)
    return publicApiJson(
      { error: "Envie o cabeçalho Idempotency-Key." },
      400,
    );
  const prior = await env.DB.prepare(
    `SELECT response_json FROM public_api_idempotency
     WHERE api_key_id = ? AND request_key = ?`,
  )
    .bind(credentials.id, idempotencyKey)
    .first();
  if (prior) return publicApiJson(JSON.parse(prior.response_json), 200);
  let body;
  try {
    body = await request.json();
  } catch {
    return publicApiJson({ error: "Corpo JSON inválido." }, 400);
  }
  const record = buildPublicRecord(
    collection,
    body && typeof body === "object" ? body : {},
    credentials.workspace_owner_id,
  );
  if (!record)
    return publicApiJson(
      {
        error:
          collection === "tasks" ? "Informe o título." : "Informe o nome.",
      },
      400,
    );
  data[collection] = [
    ...(Array.isArray(data[collection]) ? data[collection] : []),
    record,
  ];
  const updated = JSON.stringify(data);
  if (updated.length > 900_000)
    return publicApiJson({ error: "O espaço de dados está cheio." }, 413);
  const revision = Number.isInteger(workspace?.revision)
    ? workspace.revision
    : 0;
  const result = await env.DB.prepare(
    `UPDATE workspaces SET data = ?, updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND revision = ?`,
  )
    .bind(
      updated,
      new Date().toISOString(),
      credentials.workspace_owner_id,
      revision,
    )
    .run();
  if (!result.meta?.changes)
    return publicApiJson(
      {
        error:
          "Os dados mudaram durante a operação. Repita com a mesma chave de idempotência.",
      },
      409,
    );
  const responseBody = { data: publicApiRecord(record) };
  await env.DB.prepare(
    `INSERT INTO public_api_idempotency
      (id, api_key_id, request_key, response_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      credentials.id,
      idempotencyKey,
      JSON.stringify(responseBody),
      new Date().toISOString(),
    )
    .run();
  return publicApiJson(responseBody, 201);
}

export default {
  async scheduled(controller, env, ctx) {
    const now = new Date(controller?.scheduledTime || Date.now());
    // O cron semanal só entrega o resumo. Na segunda às 12:00 UTC o cron de
    // hora em hora dispara no mesmo minuto e já roda os jobs abaixo; rodá-los
    // aqui também dobrava as chamadas externas (PNCP, ANEEL, rastreador...).
    if (controller?.cron === WEEKLY_SUMMARY_CRON) {
      ctx.waitUntil(
        sendWeeklySummaries(env, now).catch((error) =>
          console.error("scheduled weekly summary", error),
        ),
      );
      return;
    }
    ctx.waitUntil(
      runScheduledAutomations(env, now).catch((error) =>
        console.error("scheduled automations", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenScheduledWorkAutomations(env, now).catch((error) =>
        console.error("scheduled To Do Green work automations", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenIntelligenceWatches(env, now).catch((error) =>
        console.error("scheduled To Do Green intelligence watches", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenMarketIntelligenceScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green market intelligence", error),
      ),
    );
    // Referências de energia (ANEEL tarifas, ANP diesel, ONS curva de carga):
    // mantém o cache fresco com data da fonte, auto-limitado (ONS 1×/dia, ANP
    // 1×/semana, ANEEL 1×/semana por par configurado, 3 pares por disparo).
    ctx.waitUntil(
      runTodoGreenEnergyReferenceScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green energy references", error),
      ),
    );
    // Sinais de mercado (PNCP 6/6 h, Compras.gov 1×/dia, GDELT um termo por hora)
    // e Risk Map (ANTT: um recurso por hora, refresh de 30 dias).
    ctx.waitUntil(
      runTodoGreenMarketSignalsScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green market signals", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenRoadRiskScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green road risk", error),
      ),
    );
    // Rastreador → operação no cron: a posição do veículo (last_position) fica
    // fresca para o cockpit e o portal do cliente sem ninguém clicar "sincronizar".
    // Auto-limitado: só integrações em polling, respeitando o intervalo ≥60min de
    // cada uma, no máximo 10 por disparo — não é uma enxurrada de chamadas externas.
    ctx.waitUntil(
      runTodoGreenTrackerScheduled(env).catch((error) =>
        console.error("scheduled To Do Green tracker", error),
      ),
    );
    // Retenção: expurga posições do rastreador além da janela (padrão 90 dias,
    // configurável por TODOGREEN_TRACKER_RETENTION_DAYS). É a coleção de maior
    // volume da vertical; sem esta limpeza no cron ela cresce sem teto no D1.
    ctx.waitUntil(
      expurgarPosicoesAntigasDoTracker(env, now).catch((error) =>
        console.error("scheduled To Do Green tracker retention", error),
      ),
    );
    // Aviso de pendências novas (push + e-mail), só o que surgiu desde o último
    // disparo. Primeiro disparo de cada espaço só registra o baseline, não envia.
    ctx.waitUntil(
      runTodoGreenPendenciaAvisos(env).catch((error) =>
        console.error("scheduled To Do Green pendências", error),
      ),
    );
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/agenda/") ||
      url.pathname.startsWith("/atendimento/") ||
      url.pathname.startsWith("/api/public-scheduling/") ||
      url.pathname.startsWith("/api/public-support/") ||
      url.pathname.startsWith("/api/public-analytics/")
    ) {
      if (!env.DB)
        return url.pathname.startsWith("/api/")
          ? json({ error: "Banco de dados indisponível." }, 503)
          : new Response("Este serviço ainda não está disponível.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
      try {
        const response = await handlePublicPlatformSuite(request, env, url, {
          json,
          allowed,
        });
        if (response) return response;
      } catch (error) {
        console.error("Public platform suite error", error);
        return url.pathname.startsWith("/api/")
          ? json({ error: "Não foi possível concluir a solicitação." }, 500)
          : new Response("Este serviço não está disponível agora.", {
              status: 500,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
      }
    }
    if (url.pathname.startsWith("/api/public/v1/")) {
      if (!env.DB)
        return publicApiJson({ error: "Banco de dados indisponível." }, 503);
      try {
        return await handlePublicApi(request, env, url);
      } catch (error) {
        console.error("Public API error", error);
        return publicApiJson(
          { error: "Não foi possível concluir a chamada." },
          500,
        );
      }
    }
    // Público e sem segredo: SHA publicado, hora do build e ambiente. É o que
    // a auditoria compara com `git rev-parse HEAD` para dizer "produção = main".
    if (url.pathname === "/api/system/version") {
      if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
      const manifesto = await publishedVersion(env, url.origin);
      return json(systemVersionPayload(env, manifesto));
    }
    if (url.pathname === "/api/status") {
      let database = "indisponível";
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT 1 AS ok").first();
          database = "operacional";
        }
      } catch {}
      const appVersion = await publishedVersion(env, url.origin);
      const clientVersion = url.searchParams.get("client") || "";
      const search = webSearchConfiguration(env);
      return json({
        status: database === "operacional" ? "operacional" : "degradado",
        database,
        version: appVersion?.version || "local",
        buildTime: appVersion?.buildTime || null,
        clientVersion,
        current: clientVersion
          ? clientVersion === (appVersion?.version || "local")
          : true,
        capabilities: {
          webSearch: {
            configured: search.configured,
            braveConfigured: search.providers.brave,
          },
          // Só se está ligado; nunca o token nem o ID da conta.
          aiGateway: statusDoGateway(env),
          antiRobo: { configured: Boolean(turnstileSiteKey(env)) },
        },
        roadmap: {
          complete: true,
          completedThrough: 27,
          nextItem: null,
        },
        checkedAt: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/inbound/whatsapp") {
      try {
        return await handleInboundWhatsApp(request, env, url);
      } catch (error) {
        console.error("Inbound WhatsApp error", error);
        return json({ error: "Não foi possível receber o WhatsApp." }, 500);
      }
    }
    if (url.pathname === "/api/inbound/email") {
      try {
        return await handleInboundEmail(request, env);
      } catch (error) {
        console.error("Inbound email error", error);
        return json({ error: "Não foi possível receber o e-mail." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/orcamento/") ||
      url.pathname.startsWith("/api/public-quotes/")
    ) {
      try {
        const response = await handlePublicQuote(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public quote error", error);
        return url.pathname.startsWith("/orcamento/")
          ? new Response("Este orçamento não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível registrar a resposta." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/f/") ||
      url.pathname.startsWith("/api/public-forms/")
    ) {
      try {
        const response = await handlePublicForm(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public form error", error);
        return url.pathname.startsWith("/f/")
          ? new Response("Este formulário não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir o envio." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/portal/") ||
      url.pathname.startsWith("/api/portal/")
    ) {
      try {
        const response = await handlePublicClientPortal(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public client portal error", error);
        return url.pathname.startsWith("/portal/")
          ? new Response("Este portal não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir a ação no portal." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/s/") ||
      url.pathname.startsWith("/loja/") ||
      url.pathname.startsWith("/api/public-sites/")
    ) {
      try {
        const response = await handlePublicSite(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public site error", error);
        return url.pathname.startsWith("/s/") || url.pathname.startsWith("/loja/")
          ? new Response("Esta página não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir o envio." }, 500);
      }
    }
    if (url.pathname === "/api/config")
      return json({
        googleClientId: env.GOOGLE_CLIENT_ID || "",
        videoEnabled: !!(env.VIDEO_AI_URL && env.VIDEO_AI_TOKEN),
        vapidPublicKey: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : null,
        supportEmail: env.SUPPORT_EMAIL || env.MAIL_SENDER || "",
        // Chave PÚBLICA do widget anti-robô; vazia quando o Turnstile está
        // desligado (falta a chave secreta ou a pública).
        turnstileSiteKey: turnstileSiteKey(env),
      });
    if (url.pathname === "/api/errors") {
      try {
        return await handleErrorLog(request, env);
      } catch (error) {
        console.error("Error log failure", error);
        return json({ ok: true });
      }
    }
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        return await handleAuth(request, env, url);
      } catch (error) {
        console.error("Auth error", error);
        return json({ error: "Não foi possível concluir o acesso." }, 500);
      }
    }
    if (url.pathname.startsWith("/api/test-support/")) {
      try {
        return await handleTestSupport(request, env, url);
      } catch (error) {
        console.error("Test support error", error);
        return json({ error: "Não foi possível concluir a ação de teste." }, 500);
      }
    }
    if (
      url.pathname === "/api/collab/invite-info" ||
      url.pathname === "/api/collab/invite/accept"
    ) {
      try {
        const response = await handlePublicInvite(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public invite error", error);
        return json({ error: "Não foi possível concluir a ação." }, 500);
      }
    }
    // Convite individual: o token opaco do e-mail é a credencial desta única
    // etapa. Ele não usa nem aceita a sessão de quem fez o convite.
    if (url.pathname === "/api/todogreen/access-invite") {
      try {
        return await handleTodoGreenCore(request, env, null, url, { audit: logAudit });
      } catch (error) {
        console.error("To Do Green public invite error", error);
        return json({ error: "Não foi possível abrir este convite." }, 500);
      }
    }
    const needsAuth =
      url.pathname === "/api/ai" ||
      url.pathname === "/api/plan" ||
      url.pathname === "/api/ai/stream" ||
      url.pathname === "/api/transcribe" ||
      url.pathname === "/api/rotas/estimativa" ||
      url.pathname === "/api/busca/vetores" ||
      url.pathname === "/api/media" ||
      url.pathname === "/api/workspace" ||
      url.pathname === "/api/workspace/backups" ||
      url.pathname === "/api/webhooks" ||
      url.pathname === "/api/tasks/action" ||
      url.pathname === "/api/events" ||
      url.pathname === "/api/outbox/send" ||
      url.pathname.startsWith("/api/inbox") ||
      url.pathname.startsWith("/api/quotes/") ||
      url.pathname.startsWith("/api/forms/") ||
      url.pathname.startsWith("/api/client-portals/") ||
      url.pathname.startsWith("/api/collab") ||
      url.pathname === "/api/tasks/notify" ||
      url.pathname.startsWith("/api/sites/") ||
      url.pathname.startsWith("/api/free-suite/") ||
      url.pathname.startsWith("/api/platform/") ||
      url.pathname.startsWith("/api/todogreen/") ||
      url.pathname.startsWith("/api/ai-keys") ||
      url.pathname.startsWith("/api/search-keys") ||
      url.pathname.startsWith("/api/push/");
    if (needsAuth) {
      if (url.pathname === "/api/ai" && request.method !== "POST")
        return json({ error: "Método não permitido." }, 405);
      if (
        (url.pathname === "/api/workspace" ||
          url.pathname === "/api/workspace/backups" ||
          url.pathname === "/api/tasks/action" ||
          url.pathname === "/api/events" ||
          url.pathname === "/api/outbox/send" ||
          url.pathname.startsWith("/api/inbox") ||
          url.pathname.startsWith("/api/forms/") ||
          url.pathname.startsWith("/api/client-portals/") ||
          url.pathname.startsWith("/api/collab") ||
          url.pathname.startsWith("/api/sites/") ||
          url.pathname.startsWith("/api/free-suite/") ||
          url.pathname.startsWith("/api/platform/") ||
          url.pathname.startsWith("/api/todogreen/") ||
          url.pathname.startsWith("/api/ai-keys") ||
          url.pathname.startsWith("/api/search-keys") ||
          url.pathname === "/api/plan" ||
          url.pathname === "/api/webhooks" ||
          url.pathname.startsWith("/api/push/")) &&
        !env.DB
      )
        return json(
          { error: "O serviço de contas ainda não está configurado." },
          503,
        );
      let user;
      try {
        user = await sessionUser(request, env);
        if (!user)
          return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
      } catch (error) {
        console.error("Session check error", error);
        return json({ error: "Não foi possível validar sua sessão." }, 500);
      }
      // Chaves de IA do espaço de trabalho ("traga sua própria chave").
      // Exige owner/admin: uma chave de API é credencial que gera cobrança na
      // conta de quem a trouxe, e não é coisa que qualquer membro cadastre ou
      // apague pelos outros.
      if (url.pathname.startsWith("/api/ai-keys")) {
        try {
          const ownerId = url.searchParams.get("owner") || user.id;
          const role = await membershipRole(env, user.id, ownerId);
          if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
          if (role !== "owner" && role !== "admin")
            return json(
              { error: "Somente o dono ou um administrador do espaço cadastra chaves de IA." },
              403,
            );
          const { handleAiKeys } = await import("./worker/services/ai-keys.js");
          return await handleAiKeys(request, env, { ownerId, userId: user.id });
        } catch (error) {
          console.error("AI keys error", error);
          return json({ error: "Não foi possível salvar a chave de IA." }, 500);
        }
      }
      // Configuração de busca do espaço ("traga sua própria busca"): a URL do
      // SearXNG e as chaves de provedores de pesquisa. Mesma exigência de
      // owner/admin das chaves de IA — é a credencial que decide de onde a
      // pesquisa da empresa inteira sai.
      if (url.pathname.startsWith("/api/search-keys")) {
        try {
          const ownerId = url.searchParams.get("owner") || user.id;
          const role = await membershipRole(env, user.id, ownerId);
          if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
          if (role !== "owner" && role !== "admin")
            return json(
              { error: "Somente o dono ou um administrador do espaço configura a busca." },
              403,
            );
          const { handleSearchKeys } = await import("./worker/services/search-keys.js");
          return await handleSearchKeys(request, env, { ownerId, userId: user.id });
        } catch (error) {
          console.error("Search keys error", error);
          return json({ error: "Não foi possível salvar a configuração de busca." }, 500);
        }
      }
      if (url.pathname === "/api/workspace") {
        try {
          return await handleWorkspace(request, env, user, url, ctx, notifyWorkspaceChange);
        } catch (error) {
          console.error("Workspace error", error);
          return json(
            { error: "Não foi possível sincronizar seus dados." },
            500,
          );
        }
      }
      if (url.pathname === "/api/webhooks") {
        try {
          return await handleWebhooks(request, env, user, url);
        } catch (error) {
          console.error("Webhook error", error);
          return json(
            { error: "Não foi possível configurar o envio automático." },
            500,
          );
        }
      }
      if (url.pathname === "/api/workspace/backups") {
        try {
          return await handleWorkspaceBackups(request, env, user, url);
        } catch (error) {
          console.error("Workspace backup error", error);
          return json(
            { error: "Não foi possível acessar os backups deste espaço." },
            500,
          );
        }
      }
      if (url.pathname === "/api/tasks/action") {
        try {
          return await handleTaskAction(request, env, user, url);
        } catch (error) {
          console.error("Task action error", error);
          return json({ error: "Não foi possível atualizar esta tarefa." }, 500);
        }
      }
      if (url.pathname === "/api/transcribe") {
        return await handleTranscribe(request, env);
      }
      if (url.pathname === "/api/rotas/estimativa") {
        if (!allowed(`rota-estimativa:${user.id}`, 10))
          return json({ error: "Muitas consultas em pouco tempo. Aguarde um minuto." }, 429);
        return await handleRouteEstimate(request, env);
      }
      if (url.pathname === "/api/busca/vetores") {
        // Indexar um espaço grande pede vários lotes seguidos; 30 por minuto
        // cobre ~1.900 textos e ainda barra laço descontrolado.
        if (!allowed(`busca-vetores:${user.id}`, 30))
          return json({ error: "Muitas consultas em pouco tempo. Aguarde um minuto." }, 429);
        try {
          return await handleBuscaVetores(request, env, user);
        } catch (error) {
          console.error("Semantic search error", error);
          return json({ error: "A busca por significado não respondeu agora.", indisponivel: true }, 500);
        }
      }
      if (url.pathname === "/api/events") {
        try {
          return await handleProductEvents(request, env, user, url);
        } catch (error) {
          console.error("Product event error", error);
          return json({ error: "Não foi possível registrar este evento." }, 500);
        }
      }
      if (url.pathname === "/api/outbox/send") {
        try {
          return await handleOutboxSend(request, env, user, url);
        } catch (error) {
          console.error("Outbox send error", error);
          return json({ error: "Não foi possível enviar a mensagem." }, 500);
        }
      }
      if (url.pathname === "/api/inbox/personal") {
        try {
          return await handlePersonalInbox(request, env, user, url);
        } catch (error) {
          console.error("Personal inbox error", error);
          return json(
            { error: "Não foi possível acessar sua caixa de entrada pessoal." },
            500,
          );
        }
      }
      if (url.pathname === "/api/inbox/conversations") {
        try {
          return await handleInboxConversations(request, env, user, url);
        } catch (error) {
          console.error("Inbox conversations error", error);
          return json(
            { error: "Não foi possível acessar as conversas da caixa." },
            500,
          );
        }
      }
      if (url.pathname === "/api/inbox") {
        try {
          return await handleInbox(request, env, user, url);
        } catch (error) {
          console.error("Inbox error", error);
          return json(
            { error: "Não foi possível acessar a caixa de entrada." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/quotes/")) {
        try {
          return await handleQuotes(request, env, user, url);
        } catch (error) {
          console.error("Quotes error", error);
          return json(
            { error: "Não foi possível compartilhar o orçamento." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/forms/")) {
        try {
          return await handleForms(request, env, user, url);
        } catch (error) {
          console.error("Forms error", error);
          return json(
            { error: "Não foi possível gerenciar este formulário." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/client-portals/")) {
        try {
          return await handleClientPortals(request, env, user, url);
        } catch (error) {
          console.error("Client portals error", error);
          return json(
            { error: "Não foi possível gerenciar este portal." },
            500,
          );
        }
      }
      if (url.pathname === "/api/tasks/notify") {
        try {
          return await handleTaskNotify(request, env, user);
        } catch (error) {
          console.error("Notify error", error);
          return json({ error: "Não foi possível enviar o aviso." }, 500);
        }
      }
      if (url.pathname.startsWith("/api/collab")) {
        try {
          return await handleCollab(request, env, user, url);
        } catch (error) {
          console.error("Collab error", error);
          return json(
            { error: "Não foi possível concluir a ação de colaboração." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/sites/")) {
        try {
          return await handleSites(request, env, user, url);
        } catch (error) {
          console.error("Sites error", error);
          return json(
            { error: "Não foi possível concluir a publicação." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/free-suite/")) {
        try {
          return await handleFreeSuite(request, env, user, url);
        } catch (error) {
          console.error("Free suite error", error);
          return json(
            { error: "Não foi possível concluir a ação no laboratório." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/platform/")) {
        try {
          return await handlePlatformSuite(request, env, user, url, {
            json,
            ownerAccess: freeSuiteOwner,
          });
        } catch (error) {
          console.error("Platform suite error", error);
          return json(
            { error: "Não foi possível concluir a ação nesta central." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/todogreen/")) {
        try {
          return await handleTodoGreenCore(request, env, user, url, {
            audit: logAudit,
          });
        } catch (error) {
          console.error("To Do Green error", error);
          return json(
            { error: "Não foi possível concluir a ação da To Do Green." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/push/")) {
        try {
          return await handlePush(request, env, user, url);
        } catch (error) {
          console.error("Push error", error);
          return json(
            { error: "Não foi possível concluir a ação de notificação." },
            500,
          );
        }
      }
      if (url.pathname === "/api/plan") {
        try {
          return json(await planSnapshot(env, user.id));
        } catch (error) {
          console.error("Plan error", error);
          return json(
            { error: "Não foi possível ler o seu plano agora." },
            500,
          );
        }
      }
      if (url.pathname === "/api/ai/stream") {
        try {
          return await handleAiStream(request, env, user);
        } catch (error) {
          console.error("Stream error", error);
          return json({ error: "Streaming indisponível.", fallback: true }, 500);
        }
      }
      return url.pathname === "/api/ai"
        ? handleAi(request, env, user)
        : handleMedia(request, env, url);
    }
    // Fallback: serve o SPA. Envelopa o HTML com cabeçalhos de segurança —
    // os portais externos (cliente/motorista/colaborador) e a entrada da
    // vertical são rotas React DENTRO deste shell, então precisam de
    // anti-clickjacking (sempre) e noindex nas superfícies privadas. Sites e
    // formulários públicos têm handlers próprios e não passam por aqui.
    const assetResp = await env.ASSETS.fetch(request);
    const contentType = assetResp.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return assetResp;
    const headers = new Headers(assetResp.headers);
    headers.set("x-frame-options", "DENY");
    if (/^\/(portal-cliente|portal-motorista|portal-colaborador|todogreen)(\/|$)/.test(url.pathname)) {
      headers.set("x-robots-tag", "noindex, nofollow");
    }
    return new Response(assetResp.body, {
      status: assetResp.status,
      statusText: assetResp.statusText,
      headers,
    });
  },
};
