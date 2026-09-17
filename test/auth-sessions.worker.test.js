import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

// "Isso não pode acontecer, em hipótese alguma": uma sessão esquecida aberta
// num aparelho alheio precisa (a) morrer sozinha em no máximo 24 horas e
// (b) poder ser derrubada à distância, de qualquer outro aparelho da conta.

const COOKIE_NAME = "__Host-sf_session";
const cookiePair = (setCookie) => String(setCookie || "").split(";")[0];

const registrar = (email) =>
  worker
    .fetch(
      new Request("https://app.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Pessoa Teste", email, password: "SenhaForte2026!" }),
      }),
      env,
    )
    .then(async (r) => ({
      status: r.status,
      corpo: await r.json(),
      cookie: r.headers.get("set-cookie") || "",
    }));

const entrar = (email) =>
  worker
    .fetch(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "SenhaForte2026!" }),
      }),
      env,
    )
    .then(async (r) => ({
      status: r.status,
      corpo: await r.json(),
      cookie: r.headers.get("set-cookie") || "",
    }));

const sessaoViva = (token) =>
  worker
    .fetch(
      new Request("https://app.test/api/auth/session", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    )
    .then((r) => r.status);

const requisicaoComCookie = (cookie, path = "/api/auth/session", method = "GET") =>
  worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { cookie: cookiePair(cookie) },
    }),
    env,
  );

describe("blindagem da sessão", () => {
  it("login emite cookie HttpOnly seguro e mantém o Bearer compatível", async () => {
    const email = `cookie-${crypto.randomUUID()}@exemplo.com.br`;
    await registrar(email);
    const { status, corpo, cookie } = await entrar(email);

    expect(status).toBe(200);
    expect(corpo.token).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).toContain(`${COOKIE_NAME}=${corpo.token}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=86400");
    expect(await sessaoViva(corpo.token)).toBe(200);
  });

  it("aceita o cookie de sessão sem exigir Bearer", async () => {
    const email = `cookie-valido-${crypto.randomUUID()}@exemplo.com.br`;
    await registrar(email);
    const { cookie } = await entrar(email);

    const resposta = await requisicaoComCookie(cookie);
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).user.email).toBe(email);
  });

  it("recusa sessão expirada e limpa o cookie", async () => {
    const email = `cookie-expirado-${crypto.randomUUID()}@exemplo.com.br`;
    await registrar(email);
    const { cookie } = await entrar(email);
    await env.DB.prepare(
      `UPDATE sessions SET expires_at = ? WHERE user_id =
       (SELECT id FROM users WHERE email = ?)`,
    )
      .bind(new Date(Date.now() - 60_000).toISOString(), email)
      .run();

    const resposta = await requisicaoComCookie(cookie);
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("set-cookie")).toContain(
      `${COOKIE_NAME}=; Path=/`,
    );
    expect(resposta.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("logout revoga somente a sessão usada e limpa o cookie", async () => {
    const email = `cookie-logout-${crypto.randomUUID()}@exemplo.com.br`;
    const { corpo: primeira } = await registrar(email);
    const { cookie } = await entrar(email);

    const logout = await requisicaoComCookie(
      cookie,
      "/api/auth/session",
      "DELETE",
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await requisicaoComCookie(cookie)).status).toBe(401);
    expect(await sessaoViva(primeira.token)).toBe(200);
  });

  it("revogação total aceita cookie e derruba Bearer e cookie", async () => {
    const email = `cookie-revoga-${crypto.randomUUID()}@exemplo.com.br`;
    const { corpo: primeira } = await registrar(email);
    const { cookie } = await entrar(email);

    const resposta = await requisicaoComCookie(
      cookie,
      "/api/auth/sessions",
      "DELETE",
    );
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await sessaoViva(primeira.token)).toBe(401);
    expect((await requisicaoComCookie(cookie)).status).toBe(401);
  });

  it("a sessão nasce com no máximo 24 horas de vida", async () => {
    const email = `ttl-${crypto.randomUUID()}@exemplo.com.br`;
    const { status } = await registrar(email);
    expect(status).toBe(201);
    const linha = await env.DB.prepare(
      `SELECT sessions.expires_at, sessions.created_at FROM sessions
       JOIN users ON users.id = sessions.user_id WHERE users.email = ?`,
    )
      .bind(email)
      .first();
    const vida = new Date(linha.expires_at) - new Date(linha.created_at);
    expect(vida).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(vida).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("DELETE /api/auth/sessions derruba TODAS as sessões da conta, em todos os aparelhos", async () => {
    const email = `revoga-${crypto.randomUUID()}@exemplo.com.br`;
    const { corpo: primeira } = await registrar(email);
    const { corpo: segunda } = await entrar(email);
    expect(await sessaoViva(primeira.token)).toBe(200);
    expect(await sessaoViva(segunda.token)).toBe(200);

    const resposta = await worker.fetch(
      new Request("https://app.test/api/auth/sessions", {
        method: "DELETE",
        headers: { authorization: `Bearer ${segunda.token}` },
      }),
      env,
    );
    expect(resposta.status).toBe(200);
    expect(await sessaoViva(primeira.token)).toBe(401);
    expect(await sessaoViva(segunda.token)).toBe(401);
  });

  it("não derruba a sessão de OUTRA conta", async () => {
    const alvo = `alvo-${crypto.randomUUID()}@exemplo.com.br`;
    const outra = `outra-${crypto.randomUUID()}@exemplo.com.br`;
    const { corpo: doAlvo } = await registrar(alvo);
    const { corpo: daOutra } = await registrar(outra);
    await worker.fetch(
      new Request("https://app.test/api/auth/sessions", {
        method: "DELETE",
        headers: { authorization: `Bearer ${doAlvo.token}` },
      }),
      env,
    );
    expect(await sessaoViva(doAlvo.token)).toBe(401);
    expect(await sessaoViva(daOutra.token)).toBe(200);
  });

  it("sem sessão válida, o pedido é recusado", async () => {
    const resposta = await worker.fetch(
      new Request("https://app.test/api/auth/sessions", {
        method: "DELETE",
        headers: { authorization: "Bearer token-inventado" },
      }),
      env,
    );
    expect(resposta.status).toBe(401);
  });
});
