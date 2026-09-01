import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// #83: enviar e-mail para um contato, salvando-o no CRM se ainda não existir.
// O que dá para provar sem rede: a porta exige sessão, valida a entrada e — sem
// credencial de e-mail no cofre — avisa em vez de falhar com erro de rede (o
// mesmo padrão de `pushEnabled`/`fiscalTransmissionEnabled`). O envio real e o
// auto-cadastro do contato dependem da chave Brevo, ausente no ambiente de teste.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createUser(id, email, role, permissions = ["*"]) {
  const token = `email-${id}`;
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
  return { id, email, token };
}

const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }),
  env,
  { waitUntil() {}, passThroughOnException() {} },
);

let admin;
let motorista;

beforeAll(async () => {
  admin = await createUser("email-admin", "email-admin@example.com", "admin", ["*"]);
  motorista = await createUser("email-driver", "email-driver@example.com", "motorista", ["read"]);
});

describe("enviar e-mail To Do Green", () => {
  it("exige sessão", async () => {
    const r = await call("/api/todogreen/send-email", { method: "POST", body: { to: "a@b.com", assunto: "x", mensagem: "y" } });
    expect(r.status).toBe(401);
  });

  it("recusa e-mail de destino inválido", async () => {
    const r = await call("/api/todogreen/send-email", {
      method: "POST", token: admin.token, body: { to: "sem-arroba", assunto: "Oi", mensagem: "Texto" },
    });
    expect(r.status).toBe(400);
  });

  it("exige assunto e mensagem", async () => {
    const r = await call("/api/todogreen/send-email", {
      method: "POST", token: admin.token, body: { to: "pessoa@empresa.com", assunto: "", mensagem: "" },
    });
    expect(r.status).toBe(400);
  });

  it("sem credencial de e-mail no cofre, avisa em vez de falhar", async () => {
    const r = await call("/api/todogreen/send-email", {
      method: "POST", token: admin.token, body: { to: "pessoa@empresa.com", assunto: "Proposta", mensagem: "Segue a proposta." },
    });
    expect(r.status).toBe(503);
    const dados = await r.json();
    expect(String(dados.error || "")).toMatch(/e-mail/i);
  });

  it("motorista não usa o envio do espaço", async () => {
    const r = await call("/api/todogreen/send-email", {
      method: "POST", token: motorista.token, body: { to: "pessoa@empresa.com", assunto: "Oi", mensagem: "Texto" },
    });
    expect(r.status).toBe(403);
  });
});
