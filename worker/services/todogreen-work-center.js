import {
  authenticatedUser,
  recorteDeCarteira,
  resolveTodoGreenAccess,
} from "./todogreen-access.js";
import { pesquisarEmpresa } from "./todogreen-client-intelligence.js";
import { emailEnabled, escMail, sendEmail, sendWhatsAppText, whatsappEnabled } from "../mensageria/envio.js";

const TENANT_ID = "todogreen";
const MAX_LIMIT = 200;
const DEFAULT_STATUSES = [
  { id: "novo", label: "Novo", color: "#64748b" },
  { id: "em-andamento", label: "Em andamento", color: "#2563eb" },
  { id: "aguardando", label: "Aguardando", color: "#d97706" },
  { id: "bloqueado", label: "Bloqueado", color: "#dc2626" },
  { id: "concluido", label: "Concluído", color: "#15803d" },
];
const DEFAULT_VIEWS = ["table", "kanban", "calendar", "timeline", "gantt", "dashboard", "workload", "gallery", "form", "map", "pivot"];
const DEFAULT_GROUPS = [{ id: "principal", name: "Principal", color: "#176a4a" }];
const AUTOMATION_TRIGGERS = new Set([
  "item-created",
  "item-updated",
  "status-changed",
  "field-changed",
  "date-overdue",
]);
const AUTOMATION_ACTIONS = new Set([
  "change-status",
  "change-priority",
  "assign-person",
  "move-item",
  "research-client",
  "prepare-whatsapp",
  // Paridade com o Monday. As três primeiras mudam o próprio item na mesma
  // transação de escrita; as quatro últimas são efeitos colaterais (INSERT/
  // UPDATE/e-mail) executados depois, com o contexto do item.
  "update-field",
  "set-date",
  "move-to-group",
  "create-item",
  "duplicate-item",
  "archive-item",
  "notify-email",
]);
// Estas duas agem sobre o próprio item e não têm valor a configurar.
const AUTOMATION_ACTIONS_SEM_VALOR = new Set(["duplicate-item", "archive-item"]);
const AUTOMATION_OPERATORS = new Set([
  "equals",
  "not-equals",
  "contains",
  "is-empty",
  "is-not-empty",
]);

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

const cleanId = (value, fallback = "") => {
  const normalized = clean(value, 80).toLocaleLowerCase("pt-BR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || fallback;
};

const normalizeBoardConfig = (raw = {}) => {
  const statuses = (Array.isArray(raw.statuses) ? raw.statuses : DEFAULT_STATUSES)
    .map((entry, index) => ({
      id: cleanId(entry?.id || entry?.label, `status-${index + 1}`),
      label: clean(entry?.label || entry?.id, 60) || `Status ${index + 1}`,
      color: /^#[0-9a-f]{6}$/i.test(String(entry?.color || "")) ? entry.color : DEFAULT_STATUSES[index % DEFAULT_STATUSES.length].color,
    })).slice(0, 20);
  const groups = (Array.isArray(raw.groups) ? raw.groups : DEFAULT_GROUPS)
    .map((entry, index) => ({
      id: cleanId(entry?.id || entry?.name, `grupo-${index + 1}`),
      name: clean(entry?.name || entry?.id, 80) || `Grupo ${index + 1}`,
      color: /^#[0-9a-f]{6}$/i.test(String(entry?.color || "")) ? entry.color : "#176a4a",
    })).slice(0, 30);
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map((entry, index) => ({
    id: cleanId(entry?.id || entry?.label, `campo-${index + 1}`),
    label: clean(entry?.label || entry?.id, 80) || `Campo ${index + 1}`,
    type: clean(entry?.type, 40) || "text",
    options: (Array.isArray(entry?.options) ? entry.options : []).map((option) => clean(option, 80)).filter(Boolean).slice(0, 50),
    formula: clean(entry?.formula, 500),
    sourceField: clean(entry?.sourceField, 120),
    required: Boolean(entry?.required),
  })).slice(0, 60);
  const views = (Array.isArray(raw.views) ? raw.views : DEFAULT_VIEWS)
    .map((view) => cleanId(view)).filter((view) => DEFAULT_VIEWS.includes(view));
  return {
    statuses: statuses.length ? statuses : DEFAULT_STATUSES,
    groups: groups.length ? groups : DEFAULT_GROUPS,
    fields,
    views: views.length ? [...new Set(views)] : DEFAULT_VIEWS,
    defaultView: DEFAULT_VIEWS.includes(raw.defaultView) ? raw.defaultView : "table",
  };
};
// Autenticação e autorização moram em todogreen-access.js. Reexportadas aqui
// só para não quebrar quem já importava deste módulo — a decisão acontece num
// lugar só.
export { authenticatedUser };

// Assinatura preservada: devolve o acesso ou null. O endurecimento — sem
// acesso por domínio, sem espaço de trabalho vindo da query string — está na
// implementação central.
export async function resolveAccess(env, user, requestedOwnerId) {
  const { access } = await resolveTodoGreenAccess(env, user, requestedOwnerId);
  return access;
}

const canWrite = (access) =>
  access.role === "owner" ||
  access.role === "admin" ||
  access.permissions.includes("*") ||
  access.permissions.includes("work:manage") ||
  access.permissions.includes("work:item:write");

const mapBoard = (row) => {
  const stored = parse(row.permissions_json, {});
  const config = normalizeBoardConfig(stored.config || stored);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    specialist: row.specialist,
    types: parse(row.object_types_json, []),
    permissions: stored.permissions || {},
    config,
    status: row.status,
    order: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapItem = (row) => ({
  id: row.id,
  boardId: row.board_id,
  type: row.type,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  responsibleUserId: row.responsible_user_id || "",
  responsible: row.responsible_label || "",
  client: row.client_label || "",
  dueDate: row.due_date || "",
  fields: parse(row.fields_json, {}),
  relations: parse(row.relations_json, []),
  dependencies: parse(row.dependencies_json, []),
  revision: row.revision,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

const mapComment = (row) => ({
  id: row.id,
  itemId: row.item_id,
  authorId: row.author_user_id,
  author: row.author_name || row.author_email || "Colaborador",
  body: row.body,
  mentions: parse(row.mentions_json, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapEvent = (row) => ({
  id: row.id,
  actorId: row.actor_user_id,
  actor: row.actor_name || row.actor_email || row.actor_user_id,
  action: row.action,
  before: parse(row.before_json, {}),
  after: parse(row.after_json, {}),
  createdAt: row.created_at,
});

const mapAutomationRule = (row) => ({
  id: row.id,
  boardId: row.board_id || "",
  name: row.name,
  trigger: row.trigger_type,
  condition: {
    field: row.condition_field || "",
    operator: row.condition_operator || "equals",
    value: row.condition_value || "",
  },
  action: { type: row.action_type, value: row.action_value || "" },
  enabled: Boolean(row.enabled),
  revision: Number(row.revision || 1),
  lastRunAt: row.last_run_at || "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const automationValue = (item, field) => {
  if (!field) return "";
  if (field.startsWith("fields.")) return item.fields?.[field.slice(7)];
  return item[field];
};

const automationConditionMatches = (rule, item) => {
  const field = rule.condition?.field || "";
  if (!field) return true;
  const current = automationValue(item, field);
  const expected = rule.condition?.value ?? "";
  const operator = rule.condition?.operator || "equals";
  if (operator === "equals") return String(current ?? "") === String(expected);
  if (operator === "not-equals") return String(current ?? "") !== String(expected);
  if (operator === "contains") return String(current ?? "").toLocaleLowerCase("pt-BR").includes(String(expected).toLocaleLowerCase("pt-BR"));
  if (operator === "is-empty") return current == null || String(current).trim() === "";
  if (operator === "is-not-empty") return current != null && String(current).trim() !== "";
  return false;
};

const automationTriggerMatches = (rule, eventType, before, item, now) => {
  if (rule.trigger === "item-updated" && eventType !== "item-created") return true;
  if (rule.trigger === eventType) return true;
  if (rule.trigger === "date-overdue" && eventType === "scheduled")
    return Boolean(item.dueDate && item.dueDate < now.slice(0, 10) && item.status !== "concluido");
  if (rule.trigger === "field-changed" && before)
    return ["status", "priority", "responsible", "client", "dueDate", "type"].some(
      (field) => String(before[field] ?? "") !== String(item[field] ?? ""),
    );
  return false;
};

async function runAutomationRules(env, ownerId, item, { before = null, eventType, now }) {
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_work_automation_rules
     WHERE workspace_owner_id = ? AND enabled = 1 AND (board_id IS NULL OR board_id = ?)
     ORDER BY created_at, id`,
  ).bind(ownerId, item.boardId).all();
  const boardRows = await env.DB.prepare(
    "SELECT * FROM todogreen_work_boards WHERE workspace_owner_id = ? AND status = 'active'",
  ).bind(ownerId).all();
  const boardIds = new Set((boardRows.results || []).map((row) => row.id));
  const boardStatusIds = new Map((boardRows.results || []).map((row) => [row.id, new Set(mapBoard(row).config.statuses.map((status) => status.id))]));
  const executed = [];
  const sideEffects = [];
  const matchedIds = [];
  for (const row of rows.results || []) {
    const rule = mapAutomationRule(row);
    if (!automationTriggerMatches(rule, eventType, before, item, now)) continue;
    if (!automationConditionMatches(rule, item)) continue;
    const value = clean(rule.action.value, rule.action.type === "prepare-whatsapp" ? 1000 : 200);
    let changed = false;
    let executionMessage = `Regra “${rule.name}” executada.`;
    if (rule.action.type === "change-status" && item.status !== value && boardStatusIds.get(item.boardId)?.has(cleanId(value))) {
      item.status = cleanId(value);
      changed = true;
    } else if (rule.action.type === "change-priority" && item.priority !== value && ["baixa", "media", "alta", "critica"].includes(value)) {
      item.priority = value;
      changed = true;
    } else if (rule.action.type === "assign-person" && value && item.responsible !== value) {
      item.responsible = value;
      changed = true;
    } else if (rule.action.type === "move-item" && item.boardId !== value && boardIds.has(value)) {
      item.boardId = value;
      changed = true;
    } else if (rule.action.type === "research-client" && item.fields?.clientId) {
      sideEffects.push({ type: "research-client", clientId: item.fields.clientId, focus: value === "contacts" ? "contacts" : "company", ruleId: rule.id });
      executionMessage = `Regra “${rule.name}”: pesquisa e autopreenchimento iniciados.`;
      changed = true;
    } else if (rule.action.type === "prepare-whatsapp" && item.fields?.clientId && item.fields?.contactId) {
      item.fields.pendingWhatsapp = {
        ruleId: rule.id,
        clientId: item.fields.clientId,
        contactId: item.fields.contactId,
        contactName: clean(item.fields.contactName, 160),
        message: value,
        status: "pending",
        preparedAt: now,
      };
      executionMessage = `Regra “${rule.name}”: WhatsApp preparado e aguardando confirmação.`;
      changed = true;
    } else if (rule.action.type === "update-field" && value.includes("=")) {
      // "chave=valor" grava em fields.<chave>. É o update-field genérico do
      // Monday: qualquer campo customizado, não só status/prioridade.
      const idx = value.indexOf("=");
      const chave = clean(value.slice(0, idx), 60);
      const conteudo = clean(value.slice(idx + 1), 500);
      if (chave && item.fields?.[chave] !== conteudo) {
        item.fields = { ...item.fields, [chave]: conteudo };
        changed = true;
      }
    } else if (rule.action.type === "set-date") {
      // "hoje" | "+N" (N dias a partir de hoje) | data absoluta AAAA-MM-DD.
      const alvo = value === "hoje" || value === "today"
        ? now.slice(0, 10)
        : /^[+-]?\d+$/.test(value)
          ? new Date(Date.now() + Number(value) * 86400000).toISOString().slice(0, 10)
          : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
      if (alvo && item.dueDate !== alvo) { item.dueDate = alvo; changed = true; }
    } else if (rule.action.type === "move-to-group" && value && item.fields?.groupId !== value) {
      item.fields = { ...item.fields, groupId: value };
      changed = true;
    } else if (rule.action.type === "create-item" && value) {
      sideEffects.push({ type: "create-item", boardId: item.boardId, title: value, ruleId: rule.id });
      executionMessage = `Regra “${rule.name}”: item “${value}” criado.`;
      changed = true;
    } else if (rule.action.type === "duplicate-item") {
      sideEffects.push({ type: "duplicate-item", item: { ...item, fields: { ...item.fields } }, ruleId: rule.id });
      executionMessage = `Regra “${rule.name}”: item duplicado.`;
      changed = true;
    } else if (rule.action.type === "archive-item") {
      sideEffects.push({ type: "archive-item", itemId: item.id, ruleId: rule.id });
      executionMessage = `Regra “${rule.name}”: item arquivado.`;
      changed = true;
    } else if (rule.action.type === "notify-email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      sideEffects.push({ type: "notify-email", to: value, title: item.title, boardId: item.boardId, ruleId: rule.id });
      executionMessage = `Regra “${rule.name}”: e-mail enviado a ${value}.`;
      changed = true;
    }
    if (!changed) continue;
    matchedIds.push(rule.id);
    executed.push(executionMessage);
  }
  if (matchedIds.length) {
    await env.DB.batch(matchedIds.map((id) => env.DB.prepare(
      "UPDATE todogreen_work_automation_rules SET last_run_at = ? WHERE id = ? AND workspace_owner_id = ?",
    ).bind(now, id, ownerId)));
  }
  return { executed, sideEffects };
}

async function executeAutomationSideEffects(env, ownerId, userId, effects = []) {
  const agora = new Date().toISOString();
  for (const effect of effects) {
    try {
      if (effect.type === "research-client") {
        const linha = await env.DB.prepare(
          `SELECT id,name,legal_name,document,segment,notes,fields_json,revision
             FROM todogreen_clients
            WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
        ).bind(effect.clientId, TENANT_ID, ownerId).first();
        if (!linha) continue;
        await pesquisarEmpresa(env, { linha, ownerId, userId, forcar: false, focus: effect.focus });
      } else if (effect.type === "create-item") {
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO todogreen_work_items
           (id,tenant_id,workspace_owner_id,board_id,type,title,description,status,priority,
            responsible_user_id,responsible_label,client_label,due_date,fields_json,relations_json,
            dependencies_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
           VALUES (?,?,?,?,'tarefa',?,'','novo','media',NULL,'','','',
            json_object('origem','automacao','ruleId',?),'[]','[]',1,?,?,?,?,NULL)`,
        ).bind(id, TENANT_ID, ownerId, effect.boardId, clean(effect.title, 200), effect.ruleId, userId, userId, agora, agora).run();
        await event(env, ownerId, effect.boardId, id, userId, "created", {}, { id, title: effect.title });
      } else if (effect.type === "duplicate-item") {
        const it = effect.item;
        const id = crypto.randomUUID();
        const campos = { ...it.fields, completedAt: undefined, completedBy: undefined, duplicadoDe: it.id };
        delete campos.recurrenceSuccessorId;
        delete campos.pendingWhatsapp;
        await env.DB.prepare(
          `INSERT INTO todogreen_work_items
           (id,tenant_id,workspace_owner_id,board_id,type,title,description,status,priority,
            responsible_user_id,responsible_label,client_label,due_date,fields_json,relations_json,
            dependencies_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
           VALUES (?,?,?,?,?,?,?,'novo',?,?,?,?,?,?,?,'[]',1,?,?,?,?,NULL)`,
        ).bind(id, TENANT_ID, ownerId, it.boardId, it.type, `${it.title} (cópia)`, it.description || "",
          it.priority || "media", it.responsibleUserId || null, it.responsible || "", it.client || "",
          it.dueDate || null, JSON.stringify(campos), JSON.stringify(it.relations || []), userId, userId, agora, agora).run();
        await event(env, ownerId, it.boardId, id, userId, "duplicated", {}, { id, title: `${it.title} (cópia)` });
      } else if (effect.type === "archive-item") {
        await env.DB.prepare(
          "UPDATE todogreen_work_items SET archived_at=?, updated_by=?, updated_at=? WHERE id=? AND workspace_owner_id=? AND archived_at IS NULL",
        ).bind(agora, userId, agora, effect.itemId, ownerId).run();
      } else if (effect.type === "notify-email" && emailEnabled(env)) {
        const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
          <div style="background:#173d31;border-radius:14px;padding:18px;text-align:center"><span style="color:#fff;font-weight:bold">To Do Green · Central de Trabalho</span></div>
          <h2 style="margin:22px 0 8px">Um item precisa da sua atenção</h2>
          <p style="color:#555">A automação sinalizou: <strong>${escMail(clean(effect.title, 200))}</strong>. Abra a Central de Trabalho para tratar.</p>
        </div>`;
        await sendEmail(env, effect.to, "To Do Green · item da Central de Trabalho", html).catch(() => {});
      }
    } catch (error) {
      console.error("To Do Green automation side effect error", effect.type, error);
    }
  }
}

async function normalizeItemCrmLink(env, access, user, fields = {}) {
  const next = { ...fields };
  const clientId = clean(next.clientId, 80);
  if (!clientId) {
    delete next.clientId;
    delete next.contactId;
    delete next.contactName;
    return { fields: next };
  }
  const scope = recorteDeCarteira(access, user.email, "c", "id");
  const client = await env.DB.prepare(
    `SELECT c.id,c.name,c.fields_json FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${scope.sql}`,
  ).bind(clientId, TENANT_ID, access.ownerId, ...scope.params).first();
  if (!client) return { error: "A conta vinculada não pertence à sua carteira." };
  next.clientId = client.id;
  const contactId = clean(next.contactId, 80);
  if (!contactId) {
    delete next.contactId;
    delete next.contactName;
    return { fields: next, clientName: client.name };
  }
  const contact = (Array.isArray(parse(client.fields_json, {}).contacts) ? parse(client.fields_json, {}).contacts : [])
    .find((candidate) => clean(candidate?.id, 80) === contactId);
  if (!contact) return { error: "O contato selecionado não pertence à conta vinculada." };
  next.contactId = contactId;
  next.contactName = clean(contact.name, 160);
  return { fields: next, clientName: client.name };
}

export async function runTodoGreenScheduledWorkAutomations(env, current = new Date()) {
  if (!env.DB) return { inspected: 0, updated: 0 };
  const now = current instanceof Date ? current.toISOString() : new Date(current).toISOString();
  const dueDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const rows = await env.DB.prepare(
    `SELECT DISTINCT i.* FROM todogreen_work_items i
     JOIN todogreen_work_automation_rules r
       ON r.workspace_owner_id = i.workspace_owner_id
      AND r.enabled = 1
      AND r.trigger_type = 'date-overdue'
      AND (r.board_id IS NULL OR r.board_id = i.board_id)
     WHERE i.archived_at IS NULL AND i.status != 'concluido'
       AND i.due_date IS NOT NULL AND i.due_date < ?
     ORDER BY i.updated_at LIMIT 500`,
  ).bind(dueDate).all();
  let updated = 0;
  for (const row of rows.results || []) {
    const before = mapItem(row);
    const item = { ...before, fields: { ...before.fields } };
    const automationRun = await runAutomationRules(env, before.workspaceOwnerId || row.workspace_owner_id, item, {
      before,
      eventType: "scheduled",
      now,
    });
    if (!automationRun.executed.length) continue;
    item.fields.automation = automationRun.executed.join(" ");
    const result = await env.DB.prepare(
      `UPDATE todogreen_work_items SET board_id = ?, status = ?, priority = ?,
       responsible_label = ?, fields_json = ?, revision = revision + 1,
       updated_by = 'system:automation', updated_at = ?
       WHERE id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(item.boardId, item.status, item.priority, item.responsible,
      JSON.stringify(item.fields), now, item.id, row.workspace_owner_id, row.revision).run();
    if (!result.meta?.changes) continue;
    const latest = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id = ?").bind(item.id).first();
    await event(env, row.workspace_owner_id, item.boardId, item.id, "system:automation", "automated", before, mapItem(latest));
    await executeAutomationSideEffects(env, row.workspace_owner_id, "system:automation", automationRun.sideEffects);
    updated += 1;
  }
  return { inspected: (rows.results || []).length, updated };
}

const normalizeAutomationRule = (body = {}) => {
  const trigger = clean(body.trigger, 40);
  const actionType = clean(body.actionType, 40);
  const operator = clean(body.conditionOperator, 30) || "equals";
  return {
    boardId: clean(body.boardId, 160),
    name: clean(body.name, 160),
    trigger: AUTOMATION_TRIGGERS.has(trigger) ? trigger : "",
    conditionField: clean(body.conditionField, 80),
    conditionOperator: AUTOMATION_OPERATORS.has(operator) ? operator : "",
    conditionValue: clean(body.conditionValue, 240),
    actionType: AUTOMATION_ACTIONS.has(actionType) ? actionType : "",
    actionValue: clean(body.actionValue, actionType === "prepare-whatsapp" ? 1000 : 200),
    enabled: body.enabled !== false,
  };
};

async function handleAutomationRules(request, env, access, user, parts) {
  const ruleId = parts[4] || "";
  const validBoard = async (id) => {
    if (!id) return true;
    return Boolean(await env.DB.prepare(
      "SELECT id FROM todogreen_work_boards WHERE id = ? AND workspace_owner_id = ? AND status = 'active'",
    ).bind(id, access.ownerId).first());
  };
  if (request.method === "GET" && !ruleId) {
    const rows = await env.DB.prepare(
      "SELECT * FROM todogreen_work_automation_rules WHERE workspace_owner_id = ? ORDER BY enabled DESC, updated_at DESC",
    ).bind(access.ownerId).all();
    return response({ automationRules: (rows.results || []).map(mapAutomationRule), access: { canWrite: canWrite(access) } });
  }
  if (!canWrite(access)) return response({ error: "Você não pode gerenciar automações." }, 403);
  if (request.method === "POST" && !ruleId) {
    const body = await request.json().catch(() => ({}));
    const rule = normalizeAutomationRule(body);
    if (!rule.name || !rule.trigger || !rule.actionType || !rule.conditionOperator
      || (!rule.actionValue && !AUTOMATION_ACTIONS_SEM_VALOR.has(rule.actionType)))
      return response({ error: "Informe nome, gatilho e ação válidos." }, 400);
    if (!(await validBoard(rule.boardId))) return response({ error: "Quadro inválido." }, 400);
    if (rule.actionType === "move-item" && !(await validBoard(rule.actionValue)))
      return response({ error: "Quadro de destino inválido." }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_work_automation_rules
       (id, tenant_id, workspace_owner_id, board_id, name, trigger_type,
        condition_field, condition_operator, condition_value, action_type,
        action_value, enabled, revision, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).bind(id, TENANT_ID, access.ownerId, rule.boardId || null, rule.name, rule.trigger,
      rule.conditionField, rule.conditionOperator, rule.conditionValue, rule.actionType,
      rule.actionValue, rule.enabled ? 1 : 0, user.id, user.id, now, now).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_automation_rules WHERE id = ?").bind(id).first();
    return response({ automationRule: mapAutomationRule(row) }, 201);
  }
  const current = await env.DB.prepare(
    "SELECT * FROM todogreen_work_automation_rules WHERE id = ? AND workspace_owner_id = ?",
  ).bind(ruleId, access.ownerId).first();
  if (!current) return response({ error: "Automação não encontrada." }, 404);
  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const expectedRevision = Number(body.revision || 0);
    if (expectedRevision && expectedRevision !== Number(current.revision))
      return response({ error: "Esta automação foi alterada por outra pessoa.", current: mapAutomationRule(current) }, 409);
    const previous = mapAutomationRule(current);
    const merged = normalizeAutomationRule({
      name: body.name ?? previous.name,
      boardId: body.boardId ?? previous.boardId,
      trigger: body.trigger ?? previous.trigger,
      conditionField: body.conditionField ?? previous.condition.field,
      conditionOperator: body.conditionOperator ?? previous.condition.operator,
      conditionValue: body.conditionValue ?? previous.condition.value,
      actionType: body.actionType ?? previous.action.type,
      actionValue: body.actionValue ?? previous.action.value,
      enabled: body.enabled ?? previous.enabled,
    });
    if (!merged.name || !merged.trigger || !merged.actionType || !merged.conditionOperator
      || (!merged.actionValue && !AUTOMATION_ACTIONS_SEM_VALOR.has(merged.actionType)))
      return response({ error: "Automação inválida." }, 400);
    if (!(await validBoard(merged.boardId))) return response({ error: "Quadro inválido." }, 400);
    if (merged.actionType === "move-item" && !(await validBoard(merged.actionValue)))
      return response({ error: "Quadro de destino inválido." }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_work_automation_rules SET board_id = ?, name = ?, trigger_type = ?,
       condition_field = ?, condition_operator = ?, condition_value = ?, action_type = ?,
       action_value = ?, enabled = ?, revision = revision + 1, updated_by = ?, updated_at = ?
       WHERE id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(merged.boardId || null, merged.name, merged.trigger, merged.conditionField,
      merged.conditionOperator, merged.conditionValue, merged.actionType, merged.actionValue,
      merged.enabled ? 1 : 0, user.id, now, ruleId, access.ownerId, current.revision).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_automation_rules WHERE id = ?").bind(ruleId).first();
    return response({ automationRule: mapAutomationRule(row) });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM todogreen_work_automation_rules WHERE id = ? AND workspace_owner_id = ?",
    ).bind(ruleId, access.ownerId).run();
    return response({ ok: true });
  }
  return response({ error: "Método não permitido." }, 405);
}

async function handleBoards(request, env, access, user, parts) {
  const boardId = parts[4] || "";
  if (request.method === "GET" && !boardId) {
    const rows = await env.DB.prepare(
      "SELECT * FROM todogreen_work_boards WHERE workspace_owner_id = ? AND status = 'active' ORDER BY display_order, name",
    ).bind(access.ownerId).all();
    return response({ boards: (rows.results || []).map(mapBoard), access: { canWrite: canWrite(access) } });
  }
  if (!canWrite(access)) return response({ error: "Você não pode configurar quadros." }, 403);
  if (request.method === "POST" && !boardId) {
    const body = await request.json().catch(() => ({}));
    const name = clean(body.name, 120);
    if (!name) return response({ error: "Informe o nome do quadro." }, 400);
    const id = `${access.ownerId}:${cleanId(name, crypto.randomUUID())}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const config = normalizeBoardConfig(body.config || {});
    const types = (Array.isArray(body.types) ? body.types : ["tarefa", "projeto", "processo", "aprovacao"])
      .map((type) => cleanId(type)).filter(Boolean).slice(0, 40);
    const last = await env.DB.prepare(
      "SELECT COALESCE(MAX(display_order), 0) AS last_order FROM todogreen_work_boards WHERE workspace_owner_id = ?",
    ).bind(access.ownerId).first();
    await env.DB.prepare(
      `INSERT INTO todogreen_work_boards
       (id, tenant_id, workspace_owner_id, name, description, specialist, object_types_json,
        permissions_json, status, display_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(id, TENANT_ID, access.ownerId, name, clean(body.description, 800), cleanId(body.specialist, "projects"),
      JSON.stringify(types.length ? types : ["tarefa"]), JSON.stringify({ config }), Number(last?.last_order || 0) + 10,
      user.id, now, now).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_boards WHERE id = ?").bind(id).first();
    return response({ board: mapBoard(row) }, 201);
  }
  const current = await env.DB.prepare(
    "SELECT * FROM todogreen_work_boards WHERE id = ? AND workspace_owner_id = ? AND status = 'active'",
  ).bind(boardId, access.ownerId).first();
  if (!current) return response({ error: "Quadro não encontrado." }, 404);
  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const previous = mapBoard(current);
    const config = normalizeBoardConfig(body.config || previous.config);
    const name = clean(body.name ?? previous.name, 120);
    if (!name) return response({ error: "Informe o nome do quadro." }, 400);
    const types = (Array.isArray(body.types) ? body.types : previous.types).map((type) => cleanId(type)).filter(Boolean).slice(0, 40);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_work_boards SET name=?,description=?,specialist=?,object_types_json=?,
       permissions_json=?,updated_at=? WHERE id=? AND workspace_owner_id=?`,
    ).bind(name, clean(body.description ?? previous.description, 800), cleanId(body.specialist ?? previous.specialist, "projects"),
      JSON.stringify(types.length ? types : ["tarefa"]), JSON.stringify({ config, permissions: previous.permissions }),
      now, boardId, access.ownerId).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_boards WHERE id = ?").bind(boardId).first();
    return response({ board: mapBoard(row) });
  }
  if (request.method === "DELETE") {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_work_items WHERE board_id=? AND workspace_owner_id=? AND archived_at IS NULL",
    ).bind(boardId, access.ownerId).first();
    if (Number(count?.total || 0) > 0)
      return response({ error: "Arquive ou mova os itens antes de arquivar o quadro." }, 409);
    await env.DB.prepare(
      "UPDATE todogreen_work_boards SET status='archived',updated_at=? WHERE id=? AND workspace_owner_id=?",
    ).bind(new Date().toISOString(), boardId, access.ownerId).run();
    return response({ ok: true });
  }
  return response({ error: "Método não permitido." }, 405);
}

async function handleItemCollaboration(request, env, access, user, itemId, action) {
  const current = await env.DB.prepare(
    "SELECT * FROM todogreen_work_items WHERE id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(itemId, access.ownerId).first();
  if (!current) return response({ error: "Item não encontrado." }, 404);
  if (request.method === "GET" && action === "detail") {
    const comments = await env.DB.prepare(
      `SELECT c.*,u.name AS author_name,u.email AS author_email FROM todogreen_work_comments c
       LEFT JOIN users u ON u.id=c.author_user_id
       WHERE c.workspace_owner_id=? AND c.item_id=? AND c.archived_at IS NULL ORDER BY c.created_at`,
    ).bind(access.ownerId, itemId).all();
    const events = await env.DB.prepare(
      `SELECT e.*,u.name AS actor_name,u.email AS actor_email FROM todogreen_work_item_events e
       LEFT JOIN users u ON u.id=e.actor_user_id
       WHERE e.workspace_owner_id=? AND e.item_id=? ORDER BY e.created_at DESC LIMIT 200`,
    ).bind(access.ownerId, itemId).all();
    const children = await env.DB.prepare(
      `SELECT * FROM todogreen_work_items WHERE workspace_owner_id=? AND archived_at IS NULL
       AND json_extract(fields_json, '$.parentId')=? ORDER BY updated_at DESC`,
    ).bind(access.ownerId, itemId).all();
    return response({
      item: mapItem(current),
      comments: (comments.results || []).map(mapComment),
      events: (events.results || []).map(mapEvent),
      subitems: (children.results || []).map(mapItem),
      access: { canWrite: canWrite(access) },
    });
  }
  if (request.method === "POST" && action === "comments") {
    if (!canWrite(access)) return response({ error: "Você não pode comentar neste item." }, 403);
    const body = await request.json().catch(() => ({}));
    const text = clean(body.body, 4000);
    if (!text) return response({ error: "Escreva uma atualização antes de publicar." }, 400);
    const mentions = [...new Set([
      ...(Array.isArray(body.mentions) ? body.mentions : []),
      ...[...text.matchAll(/@([\p{L}\p{N}._-]+)/gu)].map((match) => match[1]),
    ].map((mention) => clean(mention, 120)).filter(Boolean))].slice(0, 30);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_work_comments
       (id,workspace_owner_id,item_id,author_user_id,body,mentions_json,created_at,updated_at,archived_at)
       VALUES (?,?,?,?,?,?,?,?,NULL)`,
    ).bind(id, access.ownerId, itemId, user.id, text, JSON.stringify(mentions), now, now).run();
    await event(env, access.ownerId, current.board_id, itemId, user.id, mentions.length ? "commented-and-mentioned" : "commented", {}, { commentId: id, mentions });
    const row = await env.DB.prepare(
      `SELECT c.*,u.name AS author_name,u.email AS author_email FROM todogreen_work_comments c
       LEFT JOIN users u ON u.id=c.author_user_id WHERE c.id=?`,
    ).bind(id).first();
    return response({ comment: mapComment(row) }, 201);
  }
  return response({ error: "Método não permitido." }, 405);
}

async function seedBoards(env, ownerId, userId) {
  const now = new Date().toISOString();
  const templates = [
    ["implantacoes", "Implantações de clientes", "Da assinatura do contrato ao início estável da operação.", "projects", ["implantacao", "tarefa", "aprovacao", "risco"], 10],
    ["torre-controle", "Torre de Controle", "Viagens, atrasos, SLA, ocorrências e planos de ação.", "operations", ["operacao", "viagem", "entrega", "nao-conformidade", "plano-de-acao"], 20],
    ["frota-sustentavel", "Frota sustentável", "Disponibilidade, manutenção, pneus, bateria, carregadores e energia.", "supplyChain", ["veiculo", "tarefa", "risco", "auditoria"], 30],
    ["comercial-aprovacoes", "Comercial e aprovações", "RFQs, propostas, exceções, aprovações e contratos.", "commercial", ["rfq", "oportunidade", "aprovacao", "contrato", "cotacao"], 40],
    ["esg-evidencias", "ESG e Evidências", "Metas, relatórios, fatores, evidências e planos de melhoria.", "esg", ["indicador", "auditoria", "documento", "plano-de-acao"], 50],
    ["pessoas", "Pessoas e Escalas", "Treinamentos, certificações, férias, escalas e desenvolvimento.", "people", ["motorista", "tarefa", "aprovacao", "documento"], 60],
  ];
  const statements = templates.map(([id, name, description, specialist, types, order]) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_work_boards
       (id, tenant_id, workspace_owner_id, name, description, specialist,
        object_types_json, permissions_json, status, display_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'active', ?, ?, ?, ?)`,
    ).bind(`${ownerId}:${id}`, TENANT_ID, ownerId, name, description, specialist, JSON.stringify(types), order, userId, now, now),
  );
  if (statements.length) await env.DB.batch(statements);
}

async function event(env, ownerId, boardId, itemId, actorId, action, before, after) {
  await env.DB.prepare(
    `INSERT INTO todogreen_work_item_events
     (id, workspace_owner_id, board_id, item_id, actor_user_id, action, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), ownerId, boardId, itemId, actorId, action, JSON.stringify(before || {}), JSON.stringify(after || {}), new Date().toISOString())
    .run();
}

const nextRecurringDate = (dateValue, frequency) => {
  const date = new Date(`${dateValue || new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "biweekly") date.setUTCDate(date.getUTCDate() + 14);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  else return "";
  return date.toISOString().slice(0, 10);
};

async function createRecurringSuccessor(env, access, user, item, now) {
  const recurrence = item.fields?.recurrence;
  if (!recurrence?.frequency || item.fields?.recurrenceSuccessorId) return null;
  const dueDate = nextRecurringDate(item.dueDate, recurrence.frequency);
  if (!dueDate) return null;
  const id = crypto.randomUUID();
  const fields = {
    ...item.fields,
    completedAt: undefined,
    completedBy: undefined,
    recurrenceOriginId: item.fields?.recurrenceOriginId || item.id,
  };
  delete fields.recurrenceSuccessorId;
  await env.DB.prepare(
    `INSERT INTO todogreen_work_items
     (id,tenant_id,workspace_owner_id,board_id,type,title,description,status,priority,
      responsible_user_id,responsible_label,client_label,due_date,fields_json,relations_json,
      dependencies_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)`,
  ).bind(id, TENANT_ID, access.ownerId, item.boardId, item.type, item.title, item.description,
    "novo", item.priority, item.responsibleUserId || null, item.responsible, item.client,
    dueDate, JSON.stringify(fields), JSON.stringify(item.relations || []), JSON.stringify([]),
    user.id, user.id, now, now).run();
  await env.DB.prepare(
    "UPDATE todogreen_work_items SET fields_json=? WHERE id=? AND workspace_owner_id=?",
  ).bind(JSON.stringify({ ...item.fields, recurrenceSuccessorId: id }), item.id, access.ownerId).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id=?").bind(id).first();
  const successor = mapItem(row);
  await event(env, access.ownerId, successor.boardId, successor.id, user.id, "recurrence-created", {}, successor);
  return successor;
}

export async function handleTodoGreenWorkCenter(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/todogreen/work-center")) return null;
  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sua sessão expirou. Entre novamente." }, 401);
  const access = await resolveAccess(env, user, url.searchParams.get("owner"));
  if (!access) return response({ error: "Você não tem acesso à To Do Green." }, 403);
  await seedBoards(env, access.ownerId, user.id);

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[3] === "boards")
    return handleBoards(request, env, access, user, parts);
  if (parts[3] === "automations")
    return handleAutomationRules(request, env, access, user, parts);
  const itemId = parts[3] || "";
  if (itemId && ["detail", "comments"].includes(parts[4] || ""))
    return handleItemCollaboration(request, env, access, user, itemId, parts[4]);
  if (request.method === "POST" && itemId && parts[4] === "whatsapp-confirm") {
    if (!canWrite(access)) return response({ error: "Você não pode confirmar este envio." }, 403);
    const current = await env.DB.prepare(
      "SELECT * FROM todogreen_work_items WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL",
    ).bind(itemId, access.ownerId).first();
    if (!current) return response({ error: "Item não encontrado." }, 404);
    const item = mapItem(current);
    const pending = item.fields?.pendingWhatsapp;
    if (!pending || pending.status !== "pending")
      return response({ error: "Este item não possui um WhatsApp pendente de confirmação." }, 409);
    if (env.OUTBOX_TEST_DELIVERY !== "mock" && !whatsappEnabled(env))
      return response({ error: "O WhatsApp automático ainda não está configurado neste ambiente." }, 503);
    const client = await env.DB.prepare(
      "SELECT fields_json FROM todogreen_clients WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
    ).bind(clean(pending.clientId, 80), TENANT_ID, access.ownerId).first();
    const clientFields = parse(client?.fields_json, {});
    const contact = (Array.isArray(clientFields.contacts) ? clientFields.contacts : [])
      .find((candidate) => clean(candidate?.id, 80) === clean(pending.contactId, 80));
    if (!contact?.phone) return response({ error: "O contato selecionado não possui um WhatsApp válido no CRM." }, 400);
    const delivery = await sendWhatsAppText(env, contact.phone, clean(pending.message, 2000));
    const now = new Date().toISOString();
    item.fields.pendingWhatsapp = {
      ...pending,
      status: "sent",
      sentAt: now,
      sentBy: user.id,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId || "",
    };
    await env.DB.prepare(
      `UPDATE todogreen_work_items SET fields_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND workspace_owner_id=? AND revision=?`,
    ).bind(JSON.stringify(item.fields), user.id, now, itemId, access.ownerId, current.revision).run();
    const latest = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id = ?").bind(itemId).first();
    await event(env, access.ownerId, latest.board_id, itemId, user.id, "whatsapp-sent", { pendingWhatsapp: pending }, { pendingWhatsapp: item.fields.pendingWhatsapp });
    return response({ item: mapItem(latest), delivery: { provider: delivery.provider } });
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const boardId = clean(url.searchParams.get("board"), 160);
  const cursor = clean(url.searchParams.get("cursor"), 60);

  if (request.method === "GET" && !itemId) {
    const boards = await env.DB.prepare(
      `SELECT * FROM todogreen_work_boards
        WHERE workspace_owner_id = ? AND status = 'active'
        ORDER BY display_order, name`,
    ).bind(access.ownerId).all();
    const clauses = ["workspace_owner_id = ?", "archived_at IS NULL"];
    const binds = [access.ownerId];
    if (boardId) { clauses.push("board_id = ?"); binds.push(boardId); }
    if (cursor) { clauses.push("updated_at < ?"); binds.push(cursor); }
    const rows = await env.DB.prepare(
      `SELECT * FROM todogreen_work_items
        WHERE ${clauses.join(" AND ")}
        ORDER BY updated_at DESC LIMIT ?`,
    ).bind(...binds, limit + 1).all();
    const items = (rows.results || []).map(mapItem);
    const automationRows = await env.DB.prepare(
      "SELECT * FROM todogreen_work_automation_rules WHERE workspace_owner_id = ? ORDER BY enabled DESC, updated_at DESC",
    ).bind(access.ownerId).all();
    const clientScope = recorteDeCarteira(access, user.email, "c", "id");
    const clientRows = await env.DB.prepare(
      `SELECT c.id,c.name,c.fields_json FROM todogreen_clients c
        WHERE c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${clientScope.sql}
        ORDER BY c.name LIMIT 500`,
    ).bind(TENANT_ID, access.ownerId, ...clientScope.params).all();
    const clients = (clientRows.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      contacts: (Array.isArray(parse(row.fields_json, {}).contacts) ? parse(row.fields_json, {}).contacts : [])
        .filter((contact) => contact?.id && contact?.name)
        .map((contact) => ({ id: clean(contact.id, 80), name: clean(contact.name, 160), phone: clean(contact.phone, 80) })),
    }));
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return response({
      boards: (boards.results || []).map(mapBoard),
      items,
      automationRules: (automationRows.results || []).map(mapAutomationRule),
      clients,
      nextCursor: hasMore ? items[items.length - 1]?.updatedAt || null : null,
      access: { role: access.role, canWrite: canWrite(access) },
    });
  }

  if (!canWrite(access)) return response({ error: "Você não pode alterar itens da Central de Trabalho." }, 403);

  if (request.method === "POST" && !itemId) {
    const body = await request.json().catch(() => ({}));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedBoardId = clean(body.boardId, 160);
    if (!normalizedBoardId || !clean(body.title, 240))
      return response({ error: "Informe quadro e título." }, 400);
    const board = await env.DB.prepare(
      "SELECT * FROM todogreen_work_boards WHERE id = ? AND workspace_owner_id = ? AND status = 'active'",
    ).bind(normalizedBoardId, access.ownerId).first();
    if (!board) return response({ error: "Quadro inválido." }, 400);
    const boardConfig = mapBoard(board).config;
    const allowedStatuses = new Set(boardConfig.statuses.map((status) => status.id));
    const requestedStatus = cleanId(body.status, "novo");
    const initialStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : boardConfig.statuses[0]?.id || "novo";
    const initialDueDate = clean(body.dueDate, 20) || null;
    const requestedPriority = clean(body.priority, 40) || "media";
    const elevateOverdue = initialDueDate && initialDueDate < new Date().toISOString().slice(0, 10) && initialStatus !== "concluido" && !["alta", "critica"].includes(requestedPriority);
    const initialPriority = elevateOverdue ? "alta" : requestedPriority;
    const initialFields = body.fields && typeof body.fields === "object" ? { ...body.fields } : {};
    if (!initialFields.groupId) initialFields.groupId = boardConfig.groups[0]?.id || "principal";
    if (elevateOverdue) initialFields.automation = "Prazo vencido: prioridade elevada automaticamente.";
    const crmLink = await normalizeItemCrmLink(env, access, user, initialFields);
    if (crmLink.error) return response({ error: crmLink.error }, 400);
    const candidate = {
      id, boardId: normalizedBoardId, type: clean(body.type, 60) || "tarefa",
      title: clean(body.title, 240), description: clean(body.description, 4000),
      status: initialStatus, priority: initialPriority,
      responsibleUserId: clean(body.responsibleUserId, 100), responsible: clean(body.responsible, 160),
      client: clean(crmLink.clientName || body.client, 200), dueDate: initialDueDate || "", fields: crmLink.fields,
    };
    const automationRun = await runAutomationRules(env, access.ownerId, candidate, { eventType: "item-created", now });
    if (automationRun.executed.length) candidate.fields.automation = [candidate.fields.automation, ...automationRun.executed].filter(Boolean).join(" ");
    await env.DB.prepare(
      `INSERT INTO todogreen_work_items
       (id, tenant_id, workspace_owner_id, board_id, type, title, description, status,
        priority, responsible_user_id, responsible_label, client_label, due_date,
        fields_json, relations_json, dependencies_json, revision, created_by, updated_by,
        created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
    ).bind(
      id, TENANT_ID, access.ownerId, candidate.boardId,
      candidate.type, candidate.title, candidate.description,
      candidate.status, candidate.priority,
      candidate.responsibleUserId || null, candidate.responsible, candidate.client,
      candidate.dueDate || null, JSON.stringify(candidate.fields), JSON.stringify(body.relations || []),
      JSON.stringify(body.dependencies || []), user.id, user.id, now, now,
    ).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id = ?").bind(id).first();
    const item = mapItem(row);
    await event(env, access.ownerId, normalizedBoardId, id, user.id, "created", {}, item);
    if (automationRun.sideEffects.length) {
      const work = executeAutomationSideEffects(env, access.ownerId, user.id, automationRun.sideEffects);
      if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    }
    return response({ item, automationsExecuted: automationRun.executed }, 201);
  }

  if (request.method === "PATCH" && itemId) {
    const body = await request.json().catch(() => ({}));
    const current = await env.DB.prepare(
      "SELECT * FROM todogreen_work_items WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL",
    ).bind(itemId, access.ownerId).first();
    if (!current) return response({ error: "Item não encontrado." }, 404);
    const expectedRevision = Number(body.revision || 0);
    if (expectedRevision && expectedRevision !== Number(current.revision))
      return response({ error: "Este item foi alterado por outra pessoa. Recarregue antes de salvar.", code: "revision_conflict", current: mapItem(current) }, 409);
    const before = mapItem(current);
    const requestedFields = body.fields && typeof body.fields === "object" ? { ...body.fields } : { ...before.fields };
    const crmLink = await normalizeItemCrmLink(env, access, user, requestedFields);
    if (crmLink.error) return response({ error: crmLink.error }, 400);
    const nextFields = crmLink.fields;
    const now = new Date().toISOString();
    const boardRow = await env.DB.prepare(
      "SELECT * FROM todogreen_work_boards WHERE id=? AND workspace_owner_id=? AND status='active'",
    ).bind(current.board_id, access.ownerId).first();
    const boardConfig = normalizeBoardConfig(parse(boardRow?.permissions_json, {}).config || parse(boardRow?.permissions_json, {}));
    const allowedStatuses = new Set(boardConfig.statuses.map((status) => status.id));
    const requestedStatus = cleanId(body.status ?? before.status, before.status);
    const nextStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : before.status;
    const nextDueDate = clean(body.dueDate ?? before.dueDate, 20) || null;
    let nextPriority = clean(body.priority ?? before.priority, 40);
    const automationsExecuted = [];
    if (nextStatus === "bloqueado" && !["alta", "critica"].includes(nextPriority)) {
      nextPriority = "alta";
      automationsExecuted.push("Item bloqueado: prioridade elevada para alta.");
    }
    if (nextDueDate && nextDueDate < now.slice(0, 10) && nextStatus !== "concluido" && !["alta", "critica"].includes(nextPriority)) {
      nextPriority = "alta";
      automationsExecuted.push("Prazo vencido: prioridade elevada para alta.");
    }
    if (nextStatus === "concluido" && before.status !== "concluido") {
      nextFields.completedAt = now;
      nextFields.completedBy = user.id;
      automationsExecuted.push("Conclusão registrada com data e responsável.");
    }
    const candidate = {
      ...before,
      title: clean(body.title ?? before.title, 240),
      description: clean(body.description ?? before.description, 4000),
      status: nextStatus,
      priority: nextPriority,
      responsibleUserId: clean(body.responsibleUserId ?? before.responsibleUserId, 100),
      responsible: clean(body.responsible ?? before.responsible, 160),
      client: clean(crmLink.clientName || (body.client ?? before.client), 200),
      dueDate: nextDueDate || "",
      fields: nextFields,
      relations: body.relations ?? before.relations,
      dependencies: body.dependencies ?? before.dependencies,
    };
    if (candidate.status === "concluido" && before.status !== "concluido") {
      const dependencyIds = (Array.isArray(candidate.dependencies) ? candidate.dependencies : [])
        .map((dependency) => clean(typeof dependency === "string" ? dependency : dependency?.id || dependency?.itemId, 80))
        .filter(Boolean);
      if (dependencyIds.length) {
        const rows = await env.DB.batch(dependencyIds.map((dependencyId) => env.DB.prepare(
          "SELECT id,title,status FROM todogreen_work_items WHERE id=? AND workspace_owner_id=? AND archived_at IS NULL",
        ).bind(dependencyId, access.ownerId)));
        const pending = rows.map((result) => result.results?.[0]).filter((dependency) => !dependency || dependency.status !== "concluido");
        if (pending.length)
          return response({ error: "Conclua primeiro as dependências deste item.", code: "pending_dependencies", dependencies: pending }, 409);
      }
    }
    const eventType = candidate.status !== before.status ? "status-changed" : "item-updated";
    const automationRun = await runAutomationRules(env, access.ownerId, candidate, { before, eventType, now });
    automationsExecuted.push(...automationRun.executed);
    if (automationsExecuted.length) candidate.fields.automation = automationsExecuted.join(" ");
    await env.DB.prepare(
      `UPDATE todogreen_work_items SET
       board_id = ?, title = ?, description = ?, status = ?, priority = ?, responsible_user_id = ?,
       responsible_label = ?, client_label = ?, due_date = ?, fields_json = ?,
       relations_json = ?, dependencies_json = ?, revision = revision + 1,
       updated_by = ?, updated_at = ?
       WHERE id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(
      candidate.boardId, candidate.title, candidate.description,
      candidate.status, candidate.priority,
      candidate.responsibleUserId || null,
      candidate.responsible, candidate.client,
      candidate.dueDate || null, JSON.stringify(candidate.fields),
      JSON.stringify(candidate.relations), JSON.stringify(candidate.dependencies),
      user.id, now, itemId, access.ownerId, current.revision,
    ).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id = ?").bind(itemId).first();
    let item = mapItem(row);
    await event(env, access.ownerId, item.boardId, item.id, user.id, "updated", before, item);
    let recurrenceCreated = null;
    if (item.status === "concluido" && before.status !== "concluido") {
      recurrenceCreated = await createRecurringSuccessor(env, access, user, item, now);
      if (recurrenceCreated) {
        const refreshed = await env.DB.prepare("SELECT * FROM todogreen_work_items WHERE id=?").bind(item.id).first();
        item = mapItem(refreshed);
      }
    }
    if (automationRun.sideEffects.length) {
      const work = executeAutomationSideEffects(env, access.ownerId, user.id, automationRun.sideEffects);
      if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    }
    return response({ item, automationsExecuted, recurrenceCreated });
  }

  if (request.method === "DELETE" && itemId) {
    const current = await env.DB.prepare(
      "SELECT * FROM todogreen_work_items WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL",
    ).bind(itemId, access.ownerId).first();
    if (!current) return response({ ok: true });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE todogreen_work_items SET archived_at = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND workspace_owner_id = ?",
    ).bind(now, now, user.id, itemId, access.ownerId).run();
    await event(env, access.ownerId, current.board_id, itemId, user.id, "archived", mapItem(current), { archivedAt: now });
    return response({ ok: true });
  }

  return response({ error: "Método não permitido." }, 405);
}
