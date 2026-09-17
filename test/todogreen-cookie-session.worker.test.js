import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

const COOKIE_NAME = "__Host-sf_session";

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("sessão segura da vertical All Green", () => {
  it("aceita cookie HttpOnly de sessão sem exigir Bearer no navegador", async () => {
    const id = `cookie-tdg-${crypto.randomUUID()}`;
    const email = `${id}@parceiro.com.br`;
    const token = `tok-${crypto.randomUUID()}`;
    const agora = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
       VALUES (?, 'Pessoa Cookie', ?, 'h', 's', ?)`,
    ).bind(id, email, agora).run();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
    ).bind(`ses-${id}`, id, await sha256(token), agora).run();

    await env.DB.prepare(
      `INSERT INTO todogreen_access_emails
         (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'auditor', 'active', '[]', '', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), email, id, agora, agora).run();

    const response = await worker.fetch(
      new Request("https://app.test/api/todogreen/pricing-parameters", {
        headers: {
          cookie: `${COOKIE_NAME}=${token}`,
          "cf-connecting-ip": "198.18.0.250",
        },
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );

    expect(response.status).toBe(200);
  });
});
