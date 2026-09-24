import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

let requestNumber = 0;
const nextIp = () => {
  requestNumber += 1;
  return `203.0.113.${(requestNumber % 250) + 1}`;
};

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createUser(id, email) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, `Pessoa ${id}`, email || `${id}@example.com`, "hash", "salt", now)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(`session-${id}`, id, await sha256(token), "2099-01-01T00:00:00.000Z", now)
    .run();
  return { id, token, email: email || `${id}@example.com` };
}

function req(path, { method = "GET", token, body } = {}) {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
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

const login = (email, password) =>
  req("/api/auth/login", { method: "POST", body: { email, password } });

describe("acesso com senha provisória (contingência ao convite por e-mail)", () => {
  it("cria a conta, obriga a trocar no primeiro acesso e libera depois", async () => {
    const owner = await createUser("tmp-owner-1");
    const created = await req("/api/collab/create-access", {
      method: "POST",
      token: owner.token,
      body: { name: "Pessoa Nova", email: "Pessoa.Nova@Example.com", role: "gestor" },
    });
    expect(created.status).toBe(200);
    const data = await created.json();
    expect(data.email).toBe("pessoa.nova@example.com");
    expect(data.tempPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);

    const membership = await env.DB.prepare(
      "SELECT role, status FROM memberships WHERE owner_id = ? AND member_id = ?",
    )
      .bind(owner.id, data.memberId)
      .first();
    expect(membership).toEqual({ role: "gestor", status: "ativo" });

    const first = await login(data.email, data.tempPassword);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.user.mustChangePassword).toBe(true);

    const session = await req("/api/auth/session", { token: firstBody.token });
    expect((await session.json()).user.mustChangePassword).toBe(true);

    const wrong = await req("/api/auth/password", {
      method: "POST",
      token: firstBody.token,
      body: { currentPassword: "errada-123", newPassword: "MinhaSenha#2026" },
    });
    expect(wrong.status).toBe(401);

    const changed = await req("/api/auth/password", {
      method: "POST",
      token: firstBody.token,
      body: { currentPassword: data.tempPassword, newPassword: "MinhaSenha#2026" },
    });
    expect(changed.status).toBe(200);

    const after = await req("/api/auth/session", { token: firstBody.token });
    expect((await after.json()).user.mustChangePassword).toBeUndefined();
    expect((await login(data.email, data.tempPassword)).status).toBe(401);
    const second = await login(data.email, "MinhaSenha#2026");
    expect((await second.json()).user.mustChangePassword).toBeUndefined();

    const list = await req("/api/collab", { token: owner.token });
    const member = (await list.json()).members.find((m) => m.id === data.memberId);
    expect(member.mustChangePassword).toBe(0);
  });

  it("não define senha de e-mail que já tem conta", async () => {
    const owner = await createUser("tmp-owner-2");
    await createUser("tmp-existing", "ja.existe@example.com");
    const response = await req("/api/collab/create-access", {
      method: "POST",
      token: owner.token,
      body: { name: "Já Existe", email: "ja.existe@example.com" },
    });
    expect(response.status).toBe(409);
  });

  it("gera nova senha provisória só para quem ainda não fez o primeiro acesso", async () => {
    const owner = await createUser("tmp-owner-3");
    const created = await (
      await req("/api/collab/create-access", {
        method: "POST",
        token: owner.token,
        body: { name: "Perdeu Senha", email: "perdeu@example.com" },
      })
    ).json();
    const reset = await req("/api/collab/reset-access", {
      method: "POST",
      token: owner.token,
      body: { memberId: created.memberId },
    });
    expect(reset.status).toBe(200);
    const resetBody = await reset.json();
    expect(resetBody.tempPassword).not.toBe(created.tempPassword);
    expect((await login("perdeu@example.com", created.tempPassword)).status).toBe(401);

    const logged = await (await login("perdeu@example.com", resetBody.tempPassword)).json();
    await req("/api/auth/password", {
      method: "POST",
      token: logged.token,
      body: { currentPassword: resetBody.tempPassword, newPassword: "SenhaPropria#1" },
    });
    const blocked = await req("/api/collab/reset-access", {
      method: "POST",
      token: owner.token,
      body: { memberId: created.memberId },
    });
    expect(blocked.status).toBe(409);
  });

  it("só o dono ou admin do espaço cria acesso; outro dono não reseta membro alheio", async () => {
    const owner = await createUser("tmp-owner-4");
    const stranger = await createUser("tmp-stranger-4");
    const created = await (
      await req("/api/collab/create-access", {
        method: "POST",
        token: owner.token,
        body: { name: "Membro Quatro", email: "membro4@example.com" },
      })
    ).json();
    const denied = await req(`/api/collab/create-access?owner=${owner.id}`, {
      method: "POST",
      token: stranger.token,
      body: { name: "Intrusa", email: "intrusa@example.com" },
    });
    expect(denied.status).toBe(403);
    const notFound = await req("/api/collab/reset-access", {
      method: "POST",
      token: stranger.token,
      body: { memberId: created.memberId },
    });
    expect(notFound.status).toBe(404);
  });
});
