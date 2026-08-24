import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createUser(id, email, role, permissions) {
  const token = `goals-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, id, email, now).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
      (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`,
  ).bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token, role, permissions };
}

async function linkUserToWorkspace(user, workspaceOwnerId, invitedBy) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_users
      (id,tenant_id,workspace_owner_id,user_id,role,status,permissions_json,invited_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'active',?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    workspaceOwnerId,
    user.id,
    user.role,
    JSON.stringify(user.permissions),
    invitedBy,
    now,
    now,
  ).run();
}

const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  env,
  { waitUntil() {}, passThroughOnException() {} },
);

let admin;
let seller;
let otherSeller;
let goal;
let action;

beforeAll(async () => {
  admin = await createUser("goal-admin", "goal-admin@example.com", "admin", ["*"]);
  seller = await createUser(
    "goal-seller",
    "goal-seller@example.com",
    "vendedor",
    ["read", "goal:read", "goal:checkin"],
  );
  otherSeller = await createUser(
    "goal-other-seller",
    "goal-other-seller@example.com",
    "vendedor",
    ["read", "goal:read", "goal:checkin"],
  );
  // A autorização por e-mail permite entrar na vertical. O vínculo ao tenant
  // define em qual workspace a pessoa trabalha. Sem ele cada vendedor teria
  // um espaço próprio vazio e, corretamente, não encontraria a meta criada
  // pela gestão no workspace da empresa.
  await linkUserToWorkspace(seller, admin.id, admin.id);
  await linkUserToWorkspace(otherSeller, admin.id, admin.id);
});

describe("Metas To Do Green", () => {
  it("exige sessão", async () => {
    expect((await call("/api/todogreen/goals")).status).toBe(401);
  });

  it("administrador cria meta manual com responsável, período e evidência", async () => {
    const result = await call("/api/todogreen/goals", {
      method: "POST",
      token: admin.token,
      body: {
        title: "Receita contratada no trimestre",
        description: "Compromisso comercial do vendedor responsável.",
        category: "commercial",
        scopeType: "seller",
        scopeId: seller.id,
        scopeLabel: "Vendedor responsável",
        metricKey: "manual",
        unit: "currency",
        direction: "increase",
        measurementMode: "manual",
        baselineValue: 0,
        targetValue: 1_000_000,
        currentValue: 0,
        weight: 100,
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        cadence: "monthly",
        ownerUserId: seller.id,
        ownerEmail: seller.email,
        ownerLabel: "Vendedor responsável",
        evidenceRequired: true,
        status: "active",
      },
    });
    expect(result.status).toBe(201);
    goal = (await result.json()).goal;
    expect(goal.title).toBe("Receita contratada no trimestre");
    expect(goal.targetValue).toBe(1_000_000);
    expect(goal.measurementMode).toBe("manual");
    expect(goal.revision).toBe(1);
  });

  it("vendedor enxerga somente a meta vinculada a ele", async () => {
    const hidden = await call("/api/todogreen/goals", {
      method: "POST",
      token: admin.token,
      body: {
        title: "Meta interna da diretoria",
        category: "management",
        scopeType: "company",
        scopeLabel: "To Do Green",
        metricKey: "manual",
        direction: "increase",
        measurementMode: "manual",
        targetValue: 10,
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        cadence: "monthly",
        ownerEmail: admin.email,
        ownerLabel: "Diretoria",
        status: "active",
      },
    });
    expect(hidden.status).toBe(201);

    const result = await call("/api/todogreen/goals", { token: seller.token });
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload.goals.map((item) => item.id)).toContain(goal.id);
    expect(payload.goals.some((item) => item.title === "Meta interna da diretoria")).toBe(false);

    const other = await call(`/api/todogreen/goals/${goal.id}`, { token: otherSeller.token });
    expect(other.status).toBe(404);
  });

  it("vendedor não cria nem altera o alvo", async () => {
    const create = await call("/api/todogreen/goals", {
      method: "POST",
      token: seller.token,
      body: {
        title: "Meta autoatribuída",
        category: "commercial",
        scopeType: "seller",
        metricKey: "manual",
        direction: "increase",
        targetValue: 1,
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
      },
    });
    expect(create.status).toBe(403);

    const update = await call(`/api/todogreen/goals/${goal.id}`, {
      method: "PATCH",
      token: seller.token,
      body: { revision: goal.revision, targetValue: 1 },
    });
    expect(update.status).toBe(403);
  });

  it("meta com evidência obrigatória recusa check-in sem comprovação", async () => {
    const result = await call(`/api/todogreen/goals/${goal.id}/checkins`, {
      method: "POST",
      token: seller.token,
      body: {
        measuredValue: 400_000,
        narrative: "Contratos aprovados no mês.",
      },
    });
    expect(result.status).toBe(400);
    expect((await result.json()).error).toMatch(/evidência/i);
  });

  it("registra check-in, snapshot e histórico sem reescrever o passado", async () => {
    const result = await call(`/api/todogreen/goals/${goal.id}/checkins`, {
      method: "POST",
      token: seller.token,
      body: {
        measuredValue: 400_000,
        narrative: "Contratos aprovados no mês.",
        risks: "Uma proposta ainda depende de aprovação.",
        blockers: "",
        nextSteps: "Acompanhar a aprovação comercial e concluir a assinatura.",
        evidenceNote: "Contratos registrados no módulo de propostas.",
        nextReviewAt: "2026-08-31",
      },
    });
    expect(result.status).toBe(201);
    const updated = (await result.json()).goal;
    expect(updated.currentValue).toBe(400_000);
    expect(updated.progress.attainmentPercent).toBe(40);

    const detail = await call(`/api/todogreen/goals/${goal.id}`, { token: seller.token });
    expect(detail.status).toBe(200);
    const payload = await detail.json();
    expect(payload.checkins).toHaveLength(1);
    expect(payload.events.some((item) => item.action === "checkin")).toBe(true);

    const snapshots = await env.DB.prepare(
      "SELECT measured_value,attainment_percent FROM todogreen_goal_snapshots WHERE goal_id=?",
    ).bind(goal.id).all();
    expect(snapshots.results).toHaveLength(1);
    expect(snapshots.results[0].measured_value).toBe(400_000);
    expect(snapshots.results[0].attainment_percent).toBe(40);
  });

  it("responsável cria ação e conclui usando revisão otimista", async () => {
    const created = await call(`/api/todogreen/goals/${goal.id}/actions`, {
      method: "POST",
      token: seller.token,
      body: {
        title: "Concluir assinatura pendente",
        description: "Cobrar a aprovação final e atualizar o contrato.",
        ownerEmail: seller.email,
        ownerLabel: "Vendedor responsável",
        dueAt: "2026-08-20",
        priority: "high",
      },
    });
    expect(created.status).toBe(201);
    action = (await created.json()).action;
    expect(action.status).toBe("open");

    const stale = await call(`/api/todogreen/goals/${goal.id}/actions/${action.id}`, {
      method: "PATCH",
      token: seller.token,
      body: { revision: 999, status: "done" },
    });
    expect(stale.status).toBe(409);

    const done = await call(`/api/todogreen/goals/${goal.id}/actions/${action.id}`, {
      method: "PATCH",
      token: seller.token,
      body: { revision: action.revision, status: "done" },
    });
    expect(done.status).toBe(200);

    const saved = await env.DB.prepare(
      "SELECT status,completed_at FROM todogreen_goal_actions WHERE id=?",
    ).bind(action.id).first();
    expect(saved.status).toBe("done");
    expect(saved.completed_at).toBeTruthy();
  });

  it("protege alteração concorrente da meta", async () => {
    const result = await call(`/api/todogreen/goals/${goal.id}`, {
      method: "PATCH",
      token: admin.token,
      body: {
        revision: 999,
        title: "Título alterado",
        changeReason: "Ajuste administrativo documentado.",
      },
    });
    expect(result.status).toBe(409);
  });
});
