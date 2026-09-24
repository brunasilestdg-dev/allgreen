import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

let requestNumber = 0;
const nextIp = () => {
  requestNumber += 1;
  return `198.51.100.${(requestNumber % 250) + 1}`;
};

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createUser(id, email) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, `Pessoa ${id}`, email || `${id}@example.com`, "hash", "salt", now)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions
      (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      `session-${id}`,
      id,
      await sha256(token),
      "2099-01-01T00:00:00.000Z",
      now,
    )
    .run();
  return { id, token, email: email || `${id}@example.com` };
}

async function seedInvite({
  code,
  ownerId,
  email,
  name = "Convidado",
  role = "colaborador",
  status = "enviado",
  token,
  expiresInDays = 7,
}) {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  await env.DB.prepare(
    `INSERT INTO invites
      (code, owner_id, role, created_at, expires_at, token, email, name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      code,
      ownerId,
      role,
      now.toISOString(),
      expiresAt,
      await sha256(token),
      email,
      name,
      status,
    )
    .run();
  return { code, token, email, name, role, expiresAt };
}

function req(path, { method = "GET", user, body } = {}) {
  const headers = { "cf-connecting-ip": nextIp() };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

describe("convites de equipe com D1 local", () => {
  it("cria o convite e devolve o link mesmo sem e-mail configurado (o admin copia e envia)", async () => {
    const owner = await createUser("invite-owner-1");
    const response = await req("/api/collab/invite", {
      method: "POST",
      user: owner,
      body: { name: "Nova Pessoa", email: "nova@example.com", role: "colaborador" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // O convite vale pelo link: sem e-mail configurado, o link vem na resposta
    // para o admin repassar por onde quiser, e emailSent avisa que não foi enviado.
    expect(body.link).toMatch(/\/convite\//);
    expect(body.emailSent).toBe(false);
    expect(body.emailError).toMatch(/não está configurado/);
    expect(typeof body.id).toBe("string");
  });

  it("retorna os dados públicos de um convite válido", async () => {
    const owner = await createUser("invite-owner-2");
    await seedInvite({
      code: "code-info-1",
      ownerId: owner.id,
      email: "convidada@example.com",
      name: "Convidada Teste",
      role: "gestor",
      token: "token-info-1",
    });
    const response = await req(
      "/api/collab/invite-info?token=token-info-1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      name: "Convidada Teste",
      email: "convidada@example.com",
      role: "gestor",
      hasAccount: false,
    });
  });

  it("recusa token inexistente", async () => {
    const response = await req("/api/collab/invite-info?token=nao-existe");
    expect(response.status).toBe(404);
  });

  it("recusa convite expirado", async () => {
    const owner = await createUser("invite-owner-3");
    await seedInvite({
      code: "code-expired-1",
      ownerId: owner.id,
      email: "expirada@example.com",
      token: "token-expired-1",
      expiresInDays: -1,
    });
    const response = await req(
      "/api/collab/invite-info?token=token-expired-1",
    );
    expect(response.status).toBe(410);
  });

  it("cria uma conta nova e ativa a associação ao aceitar o convite", async () => {
    const owner = await createUser("invite-owner-4");
    await seedInvite({
      code: "code-accept-1",
      ownerId: owner.id,
      email: "novo-colaborador@example.com",
      name: "Novo Colaborador",
      role: "colaborador",
      token: "token-accept-1",
    });
    const response = await req("/api/collab/invite/accept", {
      method: "POST",
      body: { token: "token-accept-1", password: "senha-segura-123" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.ownerId).toBe(owner.id);
    expect(body.token).toEqual(expect.any(String));

    const membership = await env.DB.prepare(
      `SELECT memberships.role, memberships.status FROM memberships
      JOIN users ON users.id = memberships.member_id
      WHERE memberships.owner_id = ? AND users.email = ?`,
    )
      .bind(owner.id, "novo-colaborador@example.com")
      .first();
    expect(membership).toMatchObject({ role: "colaborador", status: "ativo" });

    const invite = await env.DB.prepare(
      "SELECT status FROM invites WHERE code = ?",
    )
      .bind("code-accept-1")
      .first();
    expect(invite.status).toBe("ativo");
  });

  it("recusa aceitar convite já utilizado", async () => {
    const owner = await createUser("invite-owner-5");
    await seedInvite({
      code: "code-used-1",
      ownerId: owner.id,
      email: "usado@example.com",
      token: "token-used-1",
      status: "ativo",
    });
    const response = await req("/api/collab/invite/accept", {
      method: "POST",
      body: { token: "token-used-1", password: "senha-segura-123" },
    });
    expect(response.status).toBe(410);
  });

  it("exige login com o e-mail correto quando a conta já existe", async () => {
    const owner = await createUser("invite-owner-6");
    const existing = await createUser(
      "invite-existing-member",
      "existente@example.com",
    );
    const stranger = await createUser("invite-stranger", "estranho@example.com");
    await seedInvite({
      code: "code-existing-1",
      ownerId: owner.id,
      email: "existente@example.com",
      token: "token-existing-1",
    });

    const withoutSession = await req("/api/collab/invite/accept", {
      method: "POST",
      body: { token: "token-existing-1" },
    });
    expect(withoutSession.status).toBe(401);

    const wrongSession = await req("/api/collab/invite/accept", {
      method: "POST",
      user: stranger,
      body: { token: "token-existing-1" },
    });
    expect(wrongSession.status).toBe(401);

    const rightSession = await req("/api/collab/invite/accept", {
      method: "POST",
      user: existing,
      body: { token: "token-existing-1" },
    });
    expect(rightSession.status).toBe(200);
    const membership = await env.DB.prepare(
      "SELECT status FROM memberships WHERE owner_id = ? AND member_id = ?",
    )
      .bind(owner.id, existing.id)
      .first();
    expect(membership.status).toBe("ativo");
  });

  it("cancela um convite pendente e recusa cancelar um já aceito", async () => {
    const owner = await createUser("invite-owner-7");
    await seedInvite({
      code: "code-cancel-1",
      ownerId: owner.id,
      email: "cancelavel@example.com",
      token: "token-cancel-1",
    });
    const cancelled = await req("/api/collab/cancel", {
      method: "POST",
      user: owner,
      body: { id: "code-cancel-1" },
    });
    expect(cancelled.status).toBe(200);
    const soft = await env.DB.prepare("SELECT status FROM invites WHERE code = ?")
      .bind("code-cancel-1")
      .first();
    expect(soft).not.toBeNull();
    expect(soft.status).toBe("cancelado");

    const cancelledLookup = await req(
      "/api/collab/invite-info?token=token-cancel-1",
    );
    expect(cancelledLookup.status).toBe(410);

    await seedInvite({
      code: "code-cancel-2",
      ownerId: owner.id,
      email: "ja-ativo@example.com",
      token: "token-cancel-2",
      status: "ativo",
    });
    await req("/api/collab/cancel", {
      method: "POST",
      user: owner,
      body: { id: "code-cancel-2" },
    });
    const stillActive = await env.DB.prepare(
      "SELECT status FROM invites WHERE code = ?",
    )
      .bind("code-cancel-2")
      .first();
    expect(stillActive.status).toBe("ativo");
  });

  it("suspende e reativa o acesso de um colaborador, bloqueando o workspace", async () => {
    const owner = await createUser("invite-owner-8");
    const member = await createUser("invite-member-8");
    await env.DB.prepare(
      `INSERT INTO memberships (id, owner_id, member_id, role, created_at, status)
      VALUES (?, ?, ?, 'colaborador', ?, 'ativo')`,
    )
      .bind("membership-8", owner.id, member.id, new Date().toISOString())
      .run();

    const before = await req(`/api/workspace?owner=${owner.id}`, {
      user: member,
    });
    expect(before.status).toBe(200);

    const suspend = await req("/api/collab/member-status", {
      method: "POST",
      user: owner,
      body: { memberId: member.id, status: "suspenso" },
    });
    expect(suspend.status).toBe(200);

    const blocked = await req(`/api/workspace?owner=${owner.id}`, {
      user: member,
    });
    expect(blocked.status).toBe(403);

    const reactivate = await req("/api/collab/member-status", {
      method: "POST",
      user: owner,
      body: { memberId: member.id, status: "ativo" },
    });
    expect(reactivate.status).toBe(200);

    const restored = await req(`/api/workspace?owner=${owner.id}`, {
      user: member,
    });
    expect(restored.status).toBe(200);
  });

  it("altera o papel de um colaborador e recusa alterar o próprio papel", async () => {
    const owner = await createUser("invite-owner-9");
    const member = await createUser("invite-member-9");
    await env.DB.prepare(
      `INSERT INTO memberships (id, owner_id, member_id, role, created_at, status)
      VALUES (?, ?, ?, 'colaborador', ?, 'ativo')`,
    )
      .bind("membership-9", owner.id, member.id, new Date().toISOString())
      .run();

    const changed = await req("/api/collab/member-role", {
      method: "POST",
      user: owner,
      body: { memberId: member.id, role: "gestor" },
    });
    expect(changed.status).toBe(200);
    const membership = await env.DB.prepare(
      "SELECT role FROM memberships WHERE owner_id = ? AND member_id = ?",
    )
      .bind(owner.id, member.id)
      .first();
    expect(membership.role).toBe("gestor");

    const selfChange = await req("/api/collab/member-role", {
      method: "POST",
      user: owner,
      body: { memberId: owner.id, role: "colaborador" },
    });
    expect(selfChange.status).toBe(400);
  });

  it("registra as ações administrativas no histórico e isola por dono do espaço", async () => {
    const owner = await createUser("invite-owner-10");
    const stranger = await createUser("invite-stranger-10");
    const member = await createUser("invite-member-10");
    await env.DB.prepare(
      `INSERT INTO memberships (id, owner_id, member_id, role, created_at, status)
      VALUES (?, ?, ?, 'colaborador', ?, 'ativo')`,
    )
      .bind("membership-10", owner.id, member.id, new Date().toISOString())
      .run();

    await req("/api/collab/member-role", {
      method: "POST",
      user: owner,
      body: { memberId: member.id, role: "gestor" },
    });
    await req("/api/collab/member-status", {
      method: "POST",
      user: owner,
      body: { memberId: member.id, status: "suspenso" },
    });

    const asOwner = await req("/api/collab/audit", {
      method: "POST",
      user: owner,
    });
    expect(asOwner.status).toBe(200);
    const ownerBody = await asOwner.json();
    const actions = ownerBody.logs.map((l) => l.action);
    expect(actions).toContain("papel_alterado");
    expect(actions).toContain("colaborador_suspenso");

    const asStranger = await req("/api/collab/audit", {
      method: "POST",
      user: stranger,
    });
    const strangerBody = await asStranger.json();
    expect(strangerBody.logs).toHaveLength(0);
  });
});
