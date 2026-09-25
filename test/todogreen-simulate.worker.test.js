import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { TODO_GREEN_PERMISSIONS } from "../src/features/logistics/logisticsVerticalDomain.js";

// Simulação oficial (`POST /api/todogreen/simulate`, todogreen-core.js).
//
// Os outros dois caminhos que gravam cenário de preço — a coleção de
// simulações dos registros e o pedido ao Deal Desk — exigem `pricing:simulate`.
// Este gravava para qualquer papel da vertical: em 24/09/2026 um usuário de RH
// criava cenário em `pricing_scenarios`, a tabela que alimenta o painel
// comercial e que o Deal Desk aceita como base de um pedido de aprovação.

let ip = 0;
const nextIp = () => `198.51.101.${(++ip % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id,name,email,password_hash,password_salt,created_at)
     VALUES (?,?,?,'h','s',?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at)
     VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

async function autorizar(usuario, role, workspaceOwnerId = "") {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,workspace_owner_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'active',?,'',?,?,?)`,
  ).bind(
    crypto.randomUUID(), workspaceOwnerId, usuario.email, role,
    JSON.stringify(role === "admin" ? ["*"] : TODO_GREEN_PERMISSIONS[role]), usuario.id, agora, agora,
  ).run();
}

const simular = (token, persist) => worker.fetch(new Request("https://app.test/api/todogreen/simulate", {
  method: "POST",
  headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    productId: "middle-mile",
    persist,
    inputs: {
      origin: "São Paulo, SP", destination: "Campinas, SP", distanceKm: 100,
      tripsPerMonth: 20, daysPerMonth: 20, vehicleType: "VUC elétrico", vehicleClass: "vuc",
      vehicles: 1, drivers: 1, price: 100,
    },
  }),
}), env, { waitUntil() {}, passThroughOnException() {} });

const cenariosDe = async (userId) =>
  (await env.DB.prepare("SELECT id FROM pricing_scenarios WHERE created_by = ?").bind(userId).all()).results;

let rh;
let vendedora;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();
  const dona = await criarUsuario("simula-dona", "dona@simula.test");
  rh = await criarUsuario("simula-rh", "rh@simula.test");
  vendedora = await criarUsuario("simula-vendedora", "vendedora@simula.test");
  await autorizar(dona, "admin");
  await autorizar(rh, "rh", dona.id);
  await autorizar(vendedora, "vendedor", dona.id);
});

describe("simulação oficial", () => {
  it("quem não simula preço não salva cenário", async () => {
    expect(TODO_GREEN_PERMISSIONS.rh).not.toContain("pricing:simulate");
    const r = await simular(rh.token, true);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/não pode salvar simulações/);
    expect(await cenariosDe(rh.id)).toHaveLength(0);
  });

  it("quem simula preço salva o cenário", async () => {
    const r = await simular(vendedora.token, true);
    expect(r.status).toBe(200);
    const { scenario } = await r.json();
    expect((await cenariosDe(vendedora.id)).map((linha) => linha.id)).toEqual([scenario.id]);
  });
});
