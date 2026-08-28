import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const createSessionUser = async (id, email) => {
  const token = `workspace-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, id, email, now).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  return { id, email, token };
};

const call = (path, token) => worker.fetch(
  new Request(`https://app.test${path}`, {
    headers: { authorization: `Bearer ${token}` },
  }),
  env,
  { waitUntil() {}, passThroughOnException() {} },
);

let owner;
let seller;

beforeAll(async () => {
  owner = await createSessionUser("workspace-owner", "workspace-owner@example.com");
  seller = await createSessionUser("workspace-seller", "workspace-seller@example.com");
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
      (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,'vendedor','active',?,'',?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    seller.email,
    JSON.stringify(["read", "goal:read", "goal:checkin"]),
    owner.id,
    now,
    now,
  ).run();

  await env.DB.prepare(
    `INSERT INTO tenant_users
      (id,tenant_id,workspace_owner_id,user_id,role,status,permissions_json,invited_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'vendedor','active',?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    owner.id,
    seller.id,
    JSON.stringify(["read", "goal:read", "goal:checkin"]),
    owner.id,
    now,
    now,
  ).run();
});

describe("workspace padrão da vertical To Do Green", () => {
  it("usa o workspace do vínculo quando a URL não informa owner", async () => {
    const response = await call("/api/todogreen/access", seller.token);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ownerId).toBe(owner.id);
    expect(payload.role).toBe("vendedor");
  });

  it("aceita explicitamente o workspace que pertence ao vínculo", async () => {
    const response = await call(
      `/api/todogreen/access?owner=${encodeURIComponent(owner.id)}`,
      seller.token,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).ownerId).toBe(owner.id);
  });

  it("recusa workspace arbitrário", async () => {
    const response = await call("/api/todogreen/access?owner=workspace-alheio", seller.token);
    // 404: não confirmamos a existência de um espaço que não é da conta.
    expect(response.status).toBe(404);
  });
});
