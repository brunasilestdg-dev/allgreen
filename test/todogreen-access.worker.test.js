import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Os dois furos que este arquivo existe para manter fechados:
//
// 1) qualquer conta com e-mail "@todogreen.com.br" entrava na vertical inteira,
//    e a regra estava num repositório público;
// 2) o espaço de trabalho vinha de `?owner=` sem verificação — bastava trocar o
//    parâmetro para operar o espaço de outra pessoa.
//
// Um teste que passa por acidente aqui é uma porta reaberta em produção.

let n = 0;
const nextIp = () => `198.18.0.${(++n % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
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

const pedir = (caminho, token) =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      headers: token
        ? { authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() }
        : { "cf-connecting-ip": nextIp() },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

// Endpoint interno qualquer serve de sonda: todos passam pela mesma porta.
const SONDA = "/api/todogreen/pricing-parameters";

let doDominio;
let liberado;
let deFora;

beforeAll(async () => {
  await pedir("/api/todogreen/portal/sessao");
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  // Conta com o domínio da empresa e NENHUM vínculo registrado.
  doDominio = await criarUsuario("acc-dominio", "invasor@todogreen.com.br");
  liberado = await criarUsuario("acc-ok", "liberado@parceiro.com.br");
  deFora = await criarUsuario("acc-fora", "qualquer@outraempresa.com");

  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'auditor', 'active', '[]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), liberado.email, liberado.id, agora, agora).run();
});

describe("acesso por domínio de e-mail", () => {
  it("ter e-mail do domínio da empresa não dá acesso a nada", async () => {
    const r = await pedir(SONDA, doDominio.token);
    // Era 200 antes: o domínio sozinho abria a vertical inteira.
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/não tem acesso/i);
  });

  it("quem foi liberado explicitamente entra", async () => {
    expect((await pedir(SONDA, liberado.token)).status).toBe(200);
  });

  it("quem não foi liberado não entra", async () => {
    expect((await pedir(SONDA, deFora.token)).status).toBe(403);
  });

  it("sem sessão, nem começa", async () => {
    expect((await pedir(SONDA)).status).toBe(401);
  });

  it("o domínio não vale nem com o parâmetro de espaço na mão", async () => {
    const r = await pedir(`${SONDA}?owner=${doDominio.id}`, doDominio.token);
    expect(r.status).toBe(403);
  });
});

describe("espaço de trabalho pedido na query string", () => {
  it("pedir o espaço de outra pessoa é recusado", async () => {
    const r = await pedir(`${SONDA}?owner=${deFora.id}`, liberado.token);
    // Antes o parâmetro era aceito como veio e a sessão passava a operar o
    // espaço alheio. Agora responde 404 (não 403): não confirmamos a existência
    // de um espaço que não é seu, igual aos registros.
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatch(/não pertence à sua conta/i);
  });

  it("um espaço inventado também é recusado", async () => {
    const r = await pedir(`${SONDA}?owner=espaco-que-nao-existe`, liberado.token);
    expect(r.status).toBe(404);
  });

  it("o próprio espaço continua funcionando", async () => {
    expect((await pedir(`${SONDA}?owner=${liberado.id}`, liberado.token)).status).toBe(200);
  });

  it("sem pedir espaço nenhum, usa o da própria sessão", async () => {
    expect((await pedir(SONDA, liberado.token)).status).toBe(200);
  });

  it("a recusa por espaço é distinguível da recusa por falta de vínculo", async () => {
    const semVinculo = await (await pedir(SONDA, deFora.token)).json();
    const espacoAlheio = await (
      await pedir(`${SONDA}?owner=${deFora.id}`, liberado.token)
    ).json();
    // Tratar as duas como a mesma coisa esconderia tentativa de acesso
    // indevido no meio do ruído de quem simplesmente não tem acesso.
    expect(semVinculo.error).not.toBe(espacoAlheio.error);
  });
});

describe("a porta é a mesma em todos os serviços", () => {
  const rotas = [
    "/api/todogreen/pricing-parameters",
    "/api/todogreen/esg/fatores",
    "/api/todogreen/dashboards",
    "/api/todogreen/requests",
    "/api/todogreen/clients",
    // A Frota tinha autenticação e regra de acesso próprias, com o domínio
    // dentro delas. Passou a usar a mesma porta.
    "/api/todogreen/fleet",
    // E o endpoint que a tela consulta para saber se abre. Era o que mais
    // importava e o último a continuar com regra própria: além do domínio,
    // dava admin a quem tivesse um negócio chamado "To Do Green" no espaço.
    "/api/todogreen/access",
    "/api/todogreen/catalog",
  ];

  it("nenhum serviço aceita o e-mail de domínio sem vínculo", async () => {
    for (const rota of rotas) {
      const r = await pedir(rota, doDominio.token);
      expect([401, 403]).toContain(r.status);
    }
  });

  it("nenhum serviço aceita espaço de trabalho alheio", async () => {
    for (const rota of rotas) {
      const r = await pedir(`${rota}?owner=${deFora.id}`, liberado.token);
      // 404: não confirmamos a existência de um espaço que não é seu.
      expect(r.status).toBe(404);
    }
  });
});

describe("a Frota entrou na mesma porta", () => {
  it("quem foi liberado lista a própria frota", async () => {
    const r = await pedir("/api/todogreen/fleet", liberado.token);
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).vehicles)).toBe(true);
  });

  it("sem sessão a Frota devolve 401, não a lista", async () => {
    expect((await pedir("/api/todogreen/fleet")).status).toBe(401);
  });

  it("a frota de outro espaço não aparece", async () => {
    const agora = new Date().toISOString();
    // Um veículo cadastrado no espaço de outra pessoa.
    await env.DB.prepare(
      `INSERT INTO todogreen_fleet_vehicles
         (id, tenant_id, workspace_owner_id, prefix, revision, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'CARRETA-ALHEIA', 1, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), deFora.id, deFora.id, deFora.id, agora, agora).run();

    const r = await pedir("/api/todogreen/fleet", liberado.token);
    expect(r.status).toBe(200);
    const prefixos = (await r.json()).vehicles.map((v) => v.prefix);
    expect(prefixos).not.toContain("CARRETA-ALHEIA");
  });
});

describe("o endpoint que a tela consulta para saber se abre", () => {
  it("responde o papel de quem tem vínculo", async () => {
    const r = await pedir("/api/todogreen/access", liberado.token);
    expect(r.status).toBe(200);
    expect((await r.json()).role).toBe("auditor");
  });

  it("negócio chamado To Do Green no espaço não vira acesso", async () => {
    const dono = await criarUsuario("acc-nome", "dono@empresadele.com.br");
    const agora = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO workspaces (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?)",
    ).bind(dono.id, JSON.stringify({ businesses: [{ id: "b1", name: "To Do Green" }] }), agora).run();

    const r = await pedir("/api/todogreen/access", dono.token);
    expect(r.status).toBe(403);
  });
});
