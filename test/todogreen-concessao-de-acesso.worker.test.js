import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { TODO_GREEN_PERMISSIONS } from "../src/features/logistics/logisticsVerticalDomain.js";

// Quem concede o quê no painel Acessos.
//
// A liderança (e quem recebe `access:manage`) aprova pedidos de acesso ao lado
// de owner/admin — decisão da titular. Mas a API aceitava QUALQUER papel do
// corpo, inclusive admin e desenvolvedor ("*"), e nada impedia o e-mail de ser
// o do próprio gestor: uma liderança comercial virava admin (financeiro,
// fiscal, folha com CPF e salário) com uma requisição. Estes testes travam a
// régua: quem não administra tudo só concede o que ele mesmo tem, nunca um
// papel de administração, e não mexe no próprio acesso nem no de quem
// administra.

const sha256 = async (valor) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.102.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const DONA = "cda-dona";

const criarConta = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return `tok-${id}`;
};

const liberar = async (email, role, permissions) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'',?,?,?,?)`,
  ).bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), DONA, DONA, agora, agora).run();
};

const conceder = (token, body) => pedir(`/api/todogreen/access-list?owner=${DONA}`, { method: "POST", token, body });

let tokenDona;
let tokenLider;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,slug,name,segment,status,theme_json,created_at,updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica-sustentavel','active','{}',?,?)`,
  ).bind(agora, agora).run();
  tokenDona = await criarConta(DONA, "cda-dona@todogreen.test");
  await liberar("cda-dona@todogreen.test", "admin", ["*"]);
  tokenLider = await criarConta("cda-lider", "cda-lider@todogreen.test");
  await liberar("cda-lider@todogreen.test", "lideranca_comercial", TODO_GREEN_PERMISSIONS.lideranca_comercial);
  // Um acesso de administração ainda sem conta: o convite dele é a credencial.
  await liberar("cda-admin-sem-conta@todogreen.test", "admin", ["*"]);
});

describe("a liderança cuida da fila de acesso, não da administração", () => {
  it("não concede admin, desenvolvedor nem proprietário", async () => {
    for (const role of ["admin", "desenvolvedor", "owner"]) {
      const resposta = await conceder(tokenLider, { email: `cda-${role}@empresa.test`, role, notify: false });
      expect({ role, status: resposta.status }).toEqual({ role, status: 403 });
    }
  });

  it("não concede papel nem funcionalidade que ela mesma não tem", async () => {
    const financeiro = await conceder(tokenLider, { email: "cda-fin@empresa.test", role: "financeiro", notify: false });
    expect(financeiro.status).toBe(403);
    const avulsa = await conceder(tokenLider, {
      email: "cda-avulsa@empresa.test", role: "vendedor", permissions: ["read", "finance:manage"], notify: false,
    });
    expect(avulsa.status).toBe(403);
  });

  it("concede o que é da alçada dela — vendedor — como antes", async () => {
    const resposta = await conceder(tokenLider, { email: "cda-vendedor@empresa.test", role: "vendedor", notify: false });
    expect(resposta.status).toBe(201);
  });

  it("não mexe no próprio acesso", async () => {
    const resposta = await conceder(tokenLider, { email: "cda-lider@todogreen.test", role: "vendedor", notify: false });
    expect(resposta.status).toBe(403);
  });

  it("não revoga quem administra, mas revoga o que ela concedeu", async () => {
    const dona = await pedir(`/api/todogreen/access-list?owner=${DONA}&email=cda-dona@todogreen.test`, {
      method: "DELETE", token: tokenLider,
    });
    expect(dona.status).toBe(403);
    const ainda = await env.DB.prepare(
      "SELECT status FROM todogreen_access_emails WHERE workspace_owner_id=? AND email='cda-dona@todogreen.test'",
    ).bind(DONA).first();
    expect(ainda.status).toBe("active");

    const vendedor = await pedir(`/api/todogreen/access-list?owner=${DONA}&email=cda-vendedor@empresa.test`, {
      method: "DELETE", token: tokenLider,
    });
    expect(vendedor.status).toBe(200);
  });

  it("não reenvia (nem recebe o link de) convite de um acesso de administração", async () => {
    const resposta = await conceder(tokenLider, { action: "resend", email: "cda-admin-sem-conta@todogreen.test" });
    expect(resposta.status).toBe(403);
    expect((await resposta.json()).inviteLink).toBeUndefined();
  });

  it("não aprova um pedido da fila como admin", async () => {
    const email = `cda-pedido-${crypto.randomUUID()}@empresa.test`.toLowerCase();
    await pedir("/api/todogreen/solicitar-acesso", { method: "POST", body: { nome: "Pedido", email } });
    const fila = await (await pedir(`/api/todogreen/access-requests?owner=${DONA}`, { token: tokenLider })).json();
    const pedido = fila.requests.find((item) => item.email === email);
    expect(pedido).toBeTruthy();
    const comoAdmin = await pedir(`/api/todogreen/access-requests?owner=${DONA}`, {
      method: "POST", token: tokenLider, body: { id: pedido.id, decisao: "aprovar", role: "admin" },
    });
    expect(comoAdmin.status).toBe(403);
    const comoVendedor = await pedir(`/api/todogreen/access-requests?owner=${DONA}`, {
      method: "POST", token: tokenLider, body: { id: pedido.id, decisao: "aprovar", role: "vendedor" },
    });
    expect(comoVendedor.status).toBe(200);
  });
});

describe("quem administra continua administrando", () => {
  it("admin concede admin, mas proprietário só o proprietário concede", async () => {
    const admin = await conceder(tokenDona, { email: "cda-novo-admin@empresa.test", role: "admin", notify: false });
    expect(admin.status).toBe(201);
    const owner = await conceder(tokenDona, { email: "cda-novo-owner@empresa.test", role: "owner", notify: false });
    expect(owner.status).toBe(403);
  });
});
