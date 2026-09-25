import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker.js";

// Caminho /api/* que nenhuma rota da tabela reconhece responde JSON 404 em
// português. Antes, um caminho que só casava o prefixo autenticado antigo
// (/api/inboxqualquer) caía no handleMedia, e qualquer outro /api/*
// desconhecido recebia o index.html do SPA com 200 — um cliente da API lia
// HTML achando que era resposta. Fora de /api/ o SPA continua servindo.

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ASSETS = {
  async fetch() {
    return new Response("<!doctype html><title>SPA</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

let token;
beforeAll(async () => {
  const id = "rota-inexistente-pessoa";
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, 'Pessoa', 'rota-inexistente@rotas.test', 'hash', 'salt', ?)`,
  ).bind(id, agora).run();
  token = "token-rota-inexistente";
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ('sessao-rota-inexistente', ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(id, await sha256(token), agora).run();
});

const pedir = (caminho, { method = "GET", comSessao = false } = {}) =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers: comSessao ? { authorization: `Bearer ${token}` } : {},
    }),
    { ...env, ASSETS },
    { waitUntil() {}, passThroughOnException() {} },
  );

async function esperar404(resposta) {
  expect(resposta.status).toBe(404);
  expect(resposta.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await resposta.json()).toEqual({ error: "Rota da API não encontrada." });
}

describe("rota /api inexistente", () => {
  it("caminho /api/* desconhecido responde JSON 404, não o index.html", async () => {
    for (const caminho of ["/api/rota-que-nao-existe", "/api/ai/qualquer", "/api/workspaces"])
      await esperar404(await pedir(caminho));
  });

  it("rota pública que não reconhece o caminho de API também dá 404", async () => {
    // handlePublicQuote devolve null para o que não é decisão nem página.
    await esperar404(await pedir("/api/public-quotes/nao-e-token"));
  });

  it("prefixo da caixa de entrada sem handler não cai mais no handleMedia", async () => {
    await esperar404(await pedir("/api/inboxqualquer", { comSessao: true }));
    await esperar404(await pedir("/api/inbox/qualquer", { method: "POST", comSessao: true }));
  });

  it("fora de /api/ o SPA continua servindo", async () => {
    for (const caminho of ["/pagina-que-nao-existe", "/api", "/apis/x"]) {
      const resposta = await pedir(caminho);
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("x-frame-options")).toBe("DENY");
      expect(await resposta.text()).toContain("<title>SPA</title>");
    }
  });
});
