import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

// Este arquivo nasceu garantindo o contrário do que garante hoje.
//
// A vertical criava as próprias tabelas a cada requisição, porque aplicar
// migração em produção já tinha falhado na prática. O efeito colateral é caro:
// DDL a cada chamada, e — pior — uma migração esquecida some do radar, porque
// a tabela aparece sozinha com o formato que o código do momento decidiu, que
// pode divergir do formato da migração.
//
// A premissa mudou e foi verificada: a publicação aplica as migrações sozinha.
// Então a regra passa a ser: o schema vem das migrações, e o código não o
// inventa em tempo de execução.
//
// A verificação de que nenhum serviço voltou a criar tabela está em
// src/schema-das-migracoes.test.js: o runtime do worker não lê o disco.

let n = 0;
const nextIp = () => `198.51.100.${(++n % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createUser(id, email = `${id}@example.com`) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  )
    .bind(id, `Pessoa ${id}`, email, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  )
    .bind(`session-${id}`, id, await sha256(token), now)
    .run();
  return { id, token };
}

const request = (path, { method = "GET", user, body } = {}) => {
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
};

// Acesso vem de autorização explícita. Antes vinha de o espaço ter um negócio
// chamado "To Do Green" — e nome de negócio é texto que a própria pessoa
// digita no cadastro, então bastava escrevê-lo para virar administradora da
// vertical inteira. Este helper agora faz o que a titular faria: autoriza o
// e-mail na lista da vertical.
const autorizar = async (email, userId, role = "admin") => {
  const now = new Date().toISOString();
  // O tenant é criado pelo seed do catálogo, que só roda em algumas rotas.
  // Aqui a autorização vem antes de qualquer chamada, então ele precisa
  // existir — a chave estrangeira cobra.
  await env.DB.prepare(
    `INSERT INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(now, now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role, status = 'active'`,
  )
    .bind(crypto.randomUUID(), email, role, JSON.stringify(["*"]), userId, now, now)
    .run();
};

// O negócio no espaço continua existindo — só não concede mais nada. O teste
// mantém a escrita para provar justamente isso.
const workspaceComTodoGreen = async (user) => {
  const r = await request("/api/workspace", {
    method: "PUT",
    user,
    body: {
      data: { businesses: [{ id: "b1", name: "To Do Green" }] },
      revision: 0,
    },
  });
  expect(r.status).toBe(200);
};

describe("a vertical funciona com o banco migrado", () => {
  it("quem foi autorizado entra e recebe o catálogo", async () => {
    const email = `tg-${n}-boot@example.com`;
    const user = await createUser(`tg-${n}-boot`, email);
    await autorizar(email, user.id);

    const acesso = await request("/api/todogreen/access", { user });
    expect(acesso.status).toBe(200);
    expect((await acesso.json()).role).toBe("admin");

    const catalogo = await request("/api/todogreen/catalog", { user });
    expect(catalogo.status).toBe(200);
    const d = await catalogo.json();
    expect(d.modules.length).toBeGreaterThan(0);
    expect(d.tenant.slug).toBeTruthy();
    expect(d.products[0]?.id).toBeTruthy();

    const painel = await request("/api/todogreen/dashboard", { user });
    expect(painel.status).toBe(200);
  });

  it("quem não é da To Do Green continua barrado", async () => {
    const user = await createUser(`tg-${n}-fora`);
    const r = await request("/api/todogreen/access", { user });
    expect(r.status).toBe(403);
  });

  it("nome de negócio no espaço não concede acesso", async () => {
    const user = await createUser(`tg-${n}-nome`);
    await workspaceComTodoGreen(user);

    // Escreveu "To Do Green" no cadastro do próprio negócio. Continua fora.
    const r = await request("/api/todogreen/access", { user });
    expect(r.status).toBe(403);
  });

  it("e-mail no domínio da empresa não concede acesso", async () => {
    const user = await createUser(`tg-${n}-dominio`, `tg-${n}-dominio@todogreen.com.br`);
    const r = await request("/api/todogreen/access", { user });
    expect(r.status).toBe(403);
  });

  it("permite autorizar e remover e-mail externo sem deploy", async () => {
    const email = `tg-${n}-admin@example.com`;
    const admin = await createUser(`tg-${n}-admin`, email);
    await autorizar(email, admin.id);

    const create = await request("/api/todogreen/access-list", {
      method: "POST",
      user: admin,
      body: {
        email: "teste@teste.com.br",
        role: "admin",
        note: "Conta de teste",
      },
    });
    expect(create.status).toBe(201);

    const list = await request("/api/todogreen/access-list", { user: admin });
    expect(list.status).toBe(200);
    const emails = (await list.json()).emails.map((item) => item.email);
    expect(emails).toContain("teste@teste.com.br");

    const remove = await request(
      "/api/todogreen/access-list?email=teste%40teste.com.br",
      { method: "DELETE", user: admin },
    );
    expect(remove.status).toBe(200);
  });
});
