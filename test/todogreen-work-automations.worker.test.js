import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { runTodoGreenScheduledWorkAutomations } from "../worker/services/todogreen-work-center.js";

const userId = "tdg-work-automation-owner";
const email = "automacoes@todogreen.test";
const token = "tok-tdg-work-automation-owner";

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pedir = (path, { method = "GET", body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "cf-connecting-ip": "198.51.100.204",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  env,
  { waitUntil() {}, passThroughOnException() {} },
);

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, 'Gestora de automações', ?, 'h', 's', ?)`,
  ).bind(userId, email, now).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${userId}`, userId, await sha256(token), now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
     (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', '["work:manage"]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), email, userId, now, now).run();
});

describe("automações configuráveis da Central de Trabalho", () => {
  let boardId;
  let item;
  let rule;

  it("cria uma regra vinculada ao quadro", async () => {
    const initial = await (await pedir("/api/todogreen/work-center")).json();
    boardId = initial.boards[0].id;
    const response = await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: {
        name: "Atribuir espera ao Comercial",
        boardId,
        trigger: "status-changed",
        conditionField: "status",
        conditionOperator: "equals",
        conditionValue: "aguardando",
        actionType: "assign-person",
        actionValue: "Equipe Comercial",
      },
    });
    expect(response.status).toBe(201);
    rule = (await response.json()).automationRule;
    expect(rule).toEqual(expect.objectContaining({ name: "Atribuir espera ao Comercial", enabled: true }));
  });

  it("executa a regra no servidor quando o status muda", async () => {
    const created = await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: { boardId, title: "Preparar proposta", type: "tarefa", priority: "media" },
    });
    item = (await created.json()).item;
    const response = await pedir(`/api/todogreen/work-center/${item.id}`, {
      method: "PATCH",
      body: { status: "aguardando", revision: item.revision },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    item = data.item;
    expect(item.responsible).toBe("Equipe Comercial");
    expect(data.automationsExecuted).toContain("Regra “Atribuir espera ao Comercial” executada.");
  });

  it("permite pausar e deixa de executar", async () => {
    const paused = await pedir(`/api/todogreen/work-center/automations/${rule.id}`, {
      method: "PATCH",
      body: { enabled: false, revision: rule.revision },
    });
    rule = (await paused.json()).automationRule;
    expect(rule.enabled).toBe(false);

    const reset = await pedir(`/api/todogreen/work-center/${item.id}`, {
      method: "PATCH",
      body: { status: "novo", responsible: "", revision: item.revision },
    });
    item = (await reset.json()).item;
    const awaiting = await pedir(`/api/todogreen/work-center/${item.id}`, {
      method: "PATCH",
      body: { status: "aguardando", revision: item.revision },
    });
    const data = await awaiting.json();
    expect(data.item.responsible).toBe("");
    expect(data.automationsExecuted).not.toContain("Regra “Atribuir espera ao Comercial” executada.");
  });

  it("lista e exclui a regra sem expor outro espaço", async () => {
    const listed = await (await pedir("/api/todogreen/work-center/automations")).json();
    expect(listed.automationRules.some((candidate) => candidate.id === rule.id)).toBe(true);
    expect((await pedir(`/api/todogreen/work-center/automations/${rule.id}`, { method: "DELETE" })).status).toBe(200);
    const after = await (await pedir("/api/todogreen/work-center/automations")).json();
    expect(after.automationRules.some((candidate) => candidate.id === rule.id)).toBe(false);
  });

  it("processa prazo vencido pelo cron sem abrir o cartão", async () => {
    const automation = await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: {
        name: "Vencido vira crítico",
        boardId,
        trigger: "date-overdue",
        conditionField: "",
        conditionOperator: "equals",
        conditionValue: "",
        actionType: "change-priority",
        actionValue: "critica",
      },
    });
    expect(automation.status).toBe(201);
    const created = await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: { boardId, title: "Pendência vencida", dueDate: "2026-08-01", priority: "baixa" },
    });
    const overdueItem = (await created.json()).item;
    expect(overdueItem.priority).toBe("alta");

    const run = await runTodoGreenScheduledWorkAutomations(env, new Date("2026-08-12T15:00:00.000Z"));
    expect(run.updated).toBeGreaterThanOrEqual(1);
    const row = await env.DB.prepare("SELECT priority, updated_by FROM todogreen_work_items WHERE id = ?")
      .bind(overdueItem.id).first();
    expect(row.priority).toBe("critica");
    expect(row.updated_by).toBe("system:automation");
  });

  it("vincula a conta do CRM e exige confirmação humana antes do WhatsApp", async () => {
    const clientId = `client-whatsapp-${crypto.randomUUID()}`;
    const contactId = `contact-${crypto.randomUUID()}`;
    const createdClient = await pedir("/api/todogreen/clients", {
      method: "POST",
      body: {
        id: clientId,
        nome: "Cliente WhatsApp",
        crm: { contacts: [{ id: contactId, name: "Ana Compras", phone: "+5511999999999", relationshipRole: "Compras" }] },
      },
    });
    expect(createdClient.status).toBe(201);
    const listed = await (await pedir("/api/todogreen/work-center")).json();
    expect(listed.clients).toContainEqual(expect.objectContaining({ id: clientId, name: "Cliente WhatsApp" }));

    const automation = await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: {
        name: "Preparar abordagem",
        boardId,
        trigger: "item-created",
        conditionField: "type",
        conditionOperator: "equals",
        conditionValue: "tarefa",
        actionType: "prepare-whatsapp",
        actionValue: "Olá, Ana. Podemos conversar sobre a operação logística?",
      },
    });
    expect(automation.status).toBe(201);
    const created = await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: {
        boardId,
        title: "Falar com compras",
        type: "tarefa",
        fields: { clientId, contactId, contactName: "Ana Compras" },
      },
    });
    const createdData = await created.json();
    expect(createdData.item.fields.pendingWhatsapp).toEqual(expect.objectContaining({ status: "pending", contactId }));

    const confirmed = await pedir(`/api/todogreen/work-center/${createdData.item.id}/whatsapp-confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    const confirmedData = await confirmed.json();
    expect(confirmedData.item.fields.pendingWhatsapp.status).toBe("sent");
    expect(confirmedData.delivery.provider).toBeTruthy();
  });

  it("cria e configura quadros com grupos, campos e visualizações próprias", async () => {
    const response = await pedir("/api/todogreen/work-center/boards", {
      method: "POST",
      body: {
        name: "Novos Negócios",
        description: "Pipeline operacional da área comercial",
        specialist: "commercial",
        config: {
          statuses: [{ id: "qualificacao", label: "Qualificação", color: "#2563eb" }, { id: "concluido", label: "Concluído", color: "#15803d" }],
          groups: [{ id: "rfqs", name: "RFQs", color: "#176a4a" }],
          fields: [{ id: "margem", label: "Margem", type: "percentage" }],
          views: ["table", "kanban", "gantt", "dashboard"],
          defaultView: "kanban",
        },
      },
    });
    expect(response.status).toBe(201);
    const board = (await response.json()).board;
    expect(board.config.statuses.map((status) => status.id)).toEqual(["qualificacao", "concluido"]);
    expect(board.config.groups[0].name).toBe("RFQs");
    expect(board.config.fields[0]).toEqual(expect.objectContaining({ id: "margem", type: "percentage" }));
    expect(board.config.views).toContain("gantt");
  });

  it("expõe comentários, menções, subitens e histórico no detalhe", async () => {
    const parentResponse = await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: { boardId, title: "Implantar cliente", fields: { groupId: "principal" } },
    });
    const parent = (await parentResponse.json()).item;
    const subitemResponse = await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: { boardId, title: "Validar integração", fields: { parentId: parent.id } },
    });
    expect(subitemResponse.status).toBe(201);
    const commentResponse = await pedir(`/api/todogreen/work-center/${parent.id}/comments`, {
      method: "POST",
      body: { body: "@Bruna validar SLA antes da ativação" },
    });
    expect(commentResponse.status).toBe(201);
    const comment = (await commentResponse.json()).comment;
    expect(comment.mentions).toContain("Bruna");

    const detailResponse = await pedir(`/api/todogreen/work-center/${parent.id}/detail`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.comments).toHaveLength(1);
    expect(detail.subitems).toContainEqual(expect.objectContaining({ title: "Validar integração" }));
    expect(detail.events.some((entry) => entry.action === "commented-and-mentioned")).toBe(true);
  });

  it("bloqueia conclusão com dependência pendente e cria a próxima recorrência", async () => {
    const dependency = (await (await pedir("/api/todogreen/work-center", {
      method: "POST", body: { boardId, title: "Aprovar escopo" },
    })).json()).item;
    let recurring = (await (await pedir("/api/todogreen/work-center", {
      method: "POST",
      body: { boardId, title: "Revisão semanal", dueDate: "2026-08-24", dependencies: [dependency.id], fields: { recurrence: { frequency: "weekly" } } },
    })).json()).item;

    const blocked = await pedir(`/api/todogreen/work-center/${recurring.id}`, {
      method: "PATCH", body: { status: "concluido", revision: recurring.revision },
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("pending_dependencies");

    const dependencyDone = await pedir(`/api/todogreen/work-center/${dependency.id}`, {
      method: "PATCH", body: { status: "concluido", revision: dependency.revision },
    });
    expect(dependencyDone.status).toBe(200);
    const completed = await pedir(`/api/todogreen/work-center/${recurring.id}`, {
      method: "PATCH", body: { status: "concluido", revision: recurring.revision },
    });
    expect(completed.status).toBe(200);
    const data = await completed.json();
    expect(data.recurrenceCreated).toEqual(expect.objectContaining({ title: "Revisão semanal", dueDate: "2026-08-31", status: "novo" }));
  });

  it("ações novas do Monday: update-field, set-date, create-item e duplicate-item", async () => {
    const board = (await (await pedir("/api/todogreen/work-center")).json()).boards[0].id;

    // update-field grava em fields.<chave>; set-date carimba a data de entrega.
    await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: { name: "Marca área e prazo", boardId: board, trigger: "status-changed",
        conditionField: "status", conditionOperator: "equals", conditionValue: "aguardando",
        actionType: "update-field", actionValue: "area=Financeiro" },
    });
    await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: { name: "Prazo para hoje", boardId: board, trigger: "status-changed",
        conditionField: "status", conditionOperator: "equals", conditionValue: "aguardando",
        actionType: "set-date", actionValue: "hoje" },
    });
    const alvo = (await (await pedir("/api/todogreen/work-center", {
      method: "POST", body: { boardId: board, title: "Item com campo e data" },
    })).json()).item;
    const mexido = await (await pedir(`/api/todogreen/work-center/${alvo.id}`, {
      method: "PATCH", body: { status: "aguardando", revision: alvo.revision },
    })).json();
    expect(mexido.item.fields.area).toBe("Financeiro");
    expect(mexido.item.dueDate).toBe(new Date().toISOString().slice(0, 10));

    // create-item cria um item NOVO no quadro quando o gatilho dispara.
    await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: { name: "Abre subtarefa", boardId: board, trigger: "status-changed",
        conditionField: "status", conditionOperator: "equals", conditionValue: "bloqueado",
        actionType: "create-item", actionValue: "Revisar contrato gerado pela automação" },
    });
    const gatilho = (await (await pedir("/api/todogreen/work-center", {
      method: "POST", body: { boardId: board, title: "Dispara criação" },
    })).json()).item;
    await pedir(`/api/todogreen/work-center/${gatilho.id}`, {
      method: "PATCH", body: { status: "bloqueado", revision: gatilho.revision },
    });
    const lista = await (await pedir("/api/todogreen/work-center")).json();
    const criados = (lista.items || []).filter((i) => i.title === "Revisar contrato gerado pela automação");
    expect(criados.length).toBeGreaterThanOrEqual(1);

    // A regra sem valor (duplicate-item) é aceita na criação.
    const semValor = await pedir("/api/todogreen/work-center/automations", {
      method: "POST",
      body: { name: "Duplica ao concluir", boardId: board, trigger: "status-changed",
        conditionField: "status", conditionOperator: "equals", conditionValue: "concluido",
        actionType: "duplicate-item", actionValue: "" },
    });
    expect(semValor.status).toBe(201);
  });
});
