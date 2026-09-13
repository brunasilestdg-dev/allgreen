import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Isolamento por coleção no agregado /api/todogreen/records (P0).
//
// O que estes testes impedem de voltar: uma coleção que falha ao ler
// (tabela/coluna ausente, SQL incompatível com o schema remoto) derrubar o
// agregado inteiro — o que fazia a tela mostrar TUDO zerado, como se não
// houvesse dado. Agora: o que lê aparece; o que falha entra em `errors`; e zero
// de verdade continua zero. Ver AUDITORIA_CONSOLIDACAO_TDG.md §4.
//
// Este arquivo é dedicado porque um dos testes DROPA uma tabela para simular a
// falha em produção — o pool de workers isola o storage por arquivo de teste, e
// o drop é o último teste, então não afeta os anteriores.

let n = 0;
const nextIp = () => `198.51.7.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return { id, email, token: `tok-${id}` };
}

async function autorizar(usuario) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'admin', 'active', '["*"]', '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.id, usuario.email, usuario.id, agora, agora).run();
}

const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let gestora;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();
  gestora = await criarUsuario("rp-gestora", "gestora@rp.com.br");
  await autorizar(gestora);
  // Uma oportunidade real, para provar que ela SOBREVIVE quando outra coleção cai.
  const criada = await pedir("/api/todogreen/records/opportunities", {
    metodo: "POST",
    token: gestora.token,
    corpo: { cliente: "Cliente Resiliente", valorMensal: 10000 },
  });
  expect(criada.status).toBe(201);
});

describe("agregado de records isola falha por coleção", () => {
  it("com tudo saudável: oportunidade aparece, financeiro é zero REAL (sem errors)", async () => {
    const r = await pedir("/api/todogreen/records", { token: gestora.token });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.opportunities.map((o) => o.cliente)).toContain("Cliente Resiliente");
    // Zero de verdade: coleção lida e vazia, SEM entrada em errors.
    expect(corpo.financial).toEqual([]);
    expect(corpo.errors).toBeUndefined();
  });

  it("financeiro indisponível NÃO zera oportunidades e vira errors.financial", async () => {
    // Simula a causa de produção: a tabela de uma coleção some/quebra.
    await env.DB.exec("DROP TABLE todogreen_financial_entries");

    const r = await pedir("/api/todogreen/records", { token: gestora.token });
    // Sucesso PARCIAL: 200, não 500.
    expect(r.status).toBe(200);
    const corpo = await r.json();
    // As outras coleções continuam vindo.
    expect(corpo.opportunities.map((o) => o.cliente)).toContain("Cliente Resiliente");
    // A que falhou é marcada como indisponível — não como zero silencioso.
    expect(corpo.errors).toBeDefined();
    expect(corpo.errors.financial).toBeTruthy();
    expect(corpo.financial).toEqual([]);
    // A mensagem é amigável, sem detalhe técnico de SQL/D1.
    expect(corpo.errors.financial.message).not.toMatch(/SQL|D1|no such table|SQLITE/i);
  });
});
