import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

// "Isso não pode acontecer, em hipótese alguma": uma sessão esquecida aberta
// num aparelho alheio precisa (a) morrer sozinha em no máximo 24 horas e
// (b) poder ser derrubada à distância, de qualquer outro aparelho da conta.

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
    .then(async (r) => ({ status: r.status, corpo: await r.json() }));

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
    .then(async (r) => ({ status: r.status, corpo: await r.json() }));

const sessaoViva = (token) =>
  worker
    .fetch(
      new Request("https://app.test/api/auth/session", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    )
    .then((r) => r.status);

describe("blindagem da sessão", () => {
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
