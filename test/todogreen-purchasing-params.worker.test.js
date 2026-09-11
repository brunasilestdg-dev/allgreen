import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Alçadas de compras versionadas: o endpoint /api/todogreen/purchasing-params.

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email, { role = "admin", permissions = ["*"] } = {}) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,workspace_owner_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'active',?,'',?,?,?)`,
  ).bind(crypto.randomUUID(), id, email, role, JSON.stringify(permissions), id, agora, agora).run();
  return { id, email, token: `tok-${id}` };
}

const pedir = (path, { method = "GET", token, body } = {}) => {
  const headers = { "cf-connecting-ip": "203.0.113.7" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(new Request(`https://app.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });
};

let dona;
let auditor;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id,slug,name,segment,status,theme_json,created_at,updated_at) VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)",
  ).bind(agora, agora).run();
  dona = await criarUsuario("pap-owner", "pap-owner@teste.local");
  auditor = await criarUsuario("pap-auditor", "pap-auditor@teste.local", { role: "auditor", permissions: ["read"] });
});

describe("alçadas de compras versionadas (endpoint)", () => {
  it("GET sem linha devolve a régua de fábrica marcada como padrão", async () => {
    const resp = await pedir("/api/todogreen/purchasing-params", { token: dona.token });
    expect(resp.status).toBe(200);
    const dados = await resp.json();
    expect(dados.padrao).toBe(true);
    expect(dados.revision).toBe(0);
    expect(dados.podeEditar).toBe(true);
    expect(dados.bands.map((b) => b.max)).toEqual([5000, 25000, 100000, null]);
    expect(dados.permissoesDisponiveis).toContain("finance:manage");
  });

  it("PUT grava uma régua válida, versiona e persiste", async () => {
    const config = { bands: [
      { max: 100000, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] },
      { max: 2000, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] },
      { max: null, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }, { id: "diretoria", label: "Diretoria", ownerOnly: true }] },
    ] };
    const put = await pedir("/api/todogreen/purchasing-params", { method: "PUT", token: dona.token, body: { config } });
    expect(put.status).toBe(200);
    const salvo = await put.json();
    expect(salvo.padrao).toBe(false);
    expect(salvo.revision).toBe(1);
    // normaliza: ordena por teto, topo vira catch-all
    expect(salvo.bands.map((b) => b.max)).toEqual([2000, 100000, null]);

    const get = await pedir("/api/todogreen/purchasing-params", { token: dona.token });
    const relido = await get.json();
    expect(relido.padrao).toBe(false);
    expect(relido.revision).toBe(1);
    expect(relido.bands.map((b) => b.max)).toEqual([2000, 100000, null]);
  });

  it("PUT recusa régua malformada com 400", async () => {
    const put = await pedir("/api/todogreen/purchasing-params", {
      method: "PUT", token: dona.token,
      body: { config: { bands: [{ max: 100, steps: [{ id: "x", label: "X", permission: "inventado:coisa" }] }] } },
    });
    expect(put.status).toBe(400);
  });

  it("PUT com revisão velha responde 409", async () => {
    const put = await pedir("/api/todogreen/purchasing-params", {
      method: "PUT", token: dona.token,
      body: { revision: 0, config: { bands: [{ max: null, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] }] } },
    });
    expect(put.status).toBe(409);
  });

  it("auditor lê mas não edita", async () => {
    const get = await pedir("/api/todogreen/purchasing-params", { token: auditor.token });
    expect(get.status).toBe(200);
    expect((await get.json()).podeEditar).toBe(false);
    const put = await pedir("/api/todogreen/purchasing-params", {
      method: "PUT", token: auditor.token,
      body: { config: { bands: [{ max: null, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] }] } },
    });
    expect(put.status).toBe(403);
  });
});
