import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Memória conversacional do Plantû (0091): a conversa persiste, mas é PRIVADA
// de quem perguntou. Estes testes existem para impedir de voltar:
//   • a thread de uma pessoa aparecer para outra (vazamento entre espaços);
//   • a hidratação vazar a conversa de outro usuário do mesmo espaço.

let n = 0;
const nextIp = () => `198.30.0.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

async function autorizar(usuario) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.email, JSON.stringify(["*"]), usuario.id, agora, agora).run();
}

async function semearMensagem(ownerId, userId, role, content) {
  await env.DB.prepare(
    `INSERT INTO todogreen_ai_messages
       (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
     VALUES (?, 'todogreen', ?, ?, 'plantu', ?, ?, NULL, ?, NULL)`,
  ).bind(crypto.randomUUID(), ownerId, userId, role, content, new Date().toISOString()).run();
}

const pedirHistorico = (token) =>
  worker.fetch(
    new Request("https://app.test/api/todogreen/semente", {
      method: "POST",
      headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ historicoPersistido: true }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

let ana;
let bruno;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  ana = await criarUsuario("mem-ana", "ana@memoria.test");
  bruno = await criarUsuario("mem-bruno", "bruno@memoria.test");
  await autorizar(ana);
  await autorizar(bruno);

  // Conversa da Ana, no espaço dela.
  await semearMensagem(ana.id, ana.id, "user", "Quais contas estão frias?");
  await semearMensagem(ana.id, ana.id, "assistant", "Três contas estão frias: A, B e C.");
});

describe("memória conversacional do Plantû", () => {
  it("hidrata a conversa guardada da própria pessoa, em ordem", async () => {
    const resposta = await pedirHistorico(ana.token);
    expect(resposta.status).toBe(200);
    const { mensagens } = await resposta.json();
    expect(mensagens.map((m) => m.de)).toEqual(["voce", "semente"]);
    expect(mensagens[0].texto).toBe("Quais contas estão frias?");
    expect(mensagens[1].texto).toBe("Três contas estão frias: A, B e C.");
  });

  it("não vaza a thread de uma pessoa para outra (isolamento por espaço/usuário)", async () => {
    const resposta = await pedirHistorico(bruno.token);
    expect(resposta.status).toBe(200);
    const { mensagens } = await resposta.json();
    expect(mensagens).toEqual([]);
  });
});
