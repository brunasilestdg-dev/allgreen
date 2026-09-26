import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { passwordHash, randomHex, sha256 } from "../worker/auth/credenciais.js";
import { enviarConviteDeAcessoTodoGreen } from "../worker/services/todogreen-access-invites.js";

// O convite da vertical nunca pode trocar a senha de uma conta que já existe.
//
// O link do convite volta na resposta para quem convidou (entrega manual por
// WhatsApp etc.). Quando aceitar o convite redefinia a senha, bastava convidar
// o e-mail de qualquer pessoa, abrir o próprio link e escolher a senha para
// entrar na conta dela — e em todos os espaços dela. Estes testes travam o
// caminho: conta existente confirma com a senha que já usa (ou com a sessão
// aberta nela) e a senha guardada não muda.

let n = 0;
const nextIp = () => `198.19.9.${(++n % 240) + 1}`;

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

async function criarConta(id, email, senha) {
  const salt = randomHex(16);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, `Pessoa ${id}`, email, await passwordHash(senha, salt), salt, agora).run();
  const token = `tok-${id}`;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token, senha };
}

const senhaGuardada = (id) =>
  env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id=?").bind(id).first();

async function convidar(email) {
  const convite = await enviarConviteDeAcessoTodoGreen({
    env,
    access: { ownerId: dona.id },
    user: { id: dona.id },
    email,
    role: "auditor",
    permissions: ["read"],
    name: "",
    origin: "https://app.test",
  });
  return convite.link.split("/todogreen/convite/")[1];
}

let dona;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();
  dona = await criarConta("cce-dona", "cce-dona@parceiro.com.br", "SenhaDaDona2026!");
});

describe("convite da vertical para e-mail que já tem conta", () => {
  it("senha errada não entra e a senha guardada não muda", async () => {
    const vitima = await criarConta("cce-vitima", "cce-vitima@parceiro.com.br", "SenhaDaVitima2026!");
    const antes = await senhaGuardada(vitima.id);
    const token = await convidar(vitima.email);

    const info = await (await pedir(`/api/todogreen/access-invite?token=${token}`)).json();
    expect(info.hasAccount).toBe(true);
    expect(info.signedIn).toBe(false);

    const tentativa = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      corpo: { token, password: "SenhaDoAtacante2026!" },
    });
    expect(tentativa.status).toBe(401);
    expect(await senhaGuardada(vitima.id)).toEqual(antes);

    // A sessão que a pessoa já tinha continua valendo.
    const sessao = await pedir("/api/auth/session", { token: vitima.token });
    expect(sessao.status).toBe(200);

    // E o convite continua pendente: nada foi concedido.
    const convite = await env.DB.prepare(
      "SELECT status FROM todogreen_access_invites WHERE email=? ORDER BY created_at DESC LIMIT 1",
    ).bind(vitima.email).first();
    expect(convite.status).toBe("pending");
  });

  it("com a senha que a pessoa já usa, aceita sem trocar a senha", async () => {
    const pessoa = await criarConta("cce-pessoa", "cce-pessoa@parceiro.com.br", "SenhaDaPessoa2026!");
    const antes = await senhaGuardada(pessoa.id);
    const token = await convidar(pessoa.email);

    const aceite = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      corpo: { token, password: pessoa.senha },
    });
    expect(aceite.status).toBe(200);
    const corpo = await aceite.json();
    expect(corpo.user.id).toBe(pessoa.id);
    expect(corpo.token).toBeTruthy();
    expect(await senhaGuardada(pessoa.id)).toEqual(antes);

    const vinculo = await env.DB.prepare(
      "SELECT role, status FROM tenant_users WHERE tenant_id='todogreen' AND workspace_owner_id=? AND user_id=?",
    ).bind(dona.id, pessoa.id).first();
    expect(vinculo).toMatchObject({ role: "auditor", status: "active" });

    // As outras sessões da pessoa não foram derrubadas.
    expect((await pedir("/api/auth/session", { token: pessoa.token })).status).toBe(200);
  });

  it("com a sessão aberta na própria conta (ex.: entrou pelo Google), aceita sem senha", async () => {
    const pessoa = await criarConta("cce-google", "cce-google@parceiro.com.br", randomHex(32));
    const token = await convidar(pessoa.email);

    const info = await (await pedir(`/api/todogreen/access-invite?token=${token}`, { token: pessoa.token })).json();
    expect(info.signedIn).toBe(true);

    const aceite = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      token: pessoa.token,
      corpo: { token },
    });
    expect(aceite.status).toBe(200);
    expect((await aceite.json()).user.id).toBe(pessoa.id);
  });

  it("a sessão de OUTRA conta não serve para aceitar o convite de alguém", async () => {
    const vitima = await criarConta("cce-alvo", "cce-alvo@parceiro.com.br", "SenhaDoAlvo2026!");
    const token = await convidar(vitima.email);

    const info = await (await pedir(`/api/todogreen/access-invite?token=${token}`, { token: dona.token })).json();
    expect(info.signedIn).toBe(false);

    const tentativa = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      token: dona.token,
      corpo: { token },
    });
    expect(tentativa.status).toBe(401);
  });

  it("e-mail sem conta continua criando a conta com a senha escolhida", async () => {
    const email = `cce-nova-${crypto.randomUUID()}@parceiro.com.br`.toLowerCase();
    const token = await convidar(email);
    const curta = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      corpo: { token, password: "curta", name: "Nova Pessoa" },
    });
    expect(curta.status).toBe(400);

    const aceite = await pedir("/api/todogreen/access-invite", {
      metodo: "POST",
      corpo: { token, password: "SenhaNova2026!", name: "Nova Pessoa" },
    });
    expect(aceite.status).toBe(200);
    expect((await aceite.json()).user.email).toBe(email);
  });
});
