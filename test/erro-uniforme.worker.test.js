import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker.js";

// /api/ai, /api/transcribe e /api/media eram as únicas rotas autenticadas sem
// try/catch no roteador: quando o handler lançava, a pessoa recebia o erro
// opaco do Cloudflare em vez de uma resposta que o app sabe mostrar. Agora
// passam pelo mesmo guarda das demais — JSON 500 com mensagem em português.

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let pessoa;
beforeAll(async () => {
  const id = "erro-uniforme-pessoa";
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, 'Pessoa', 'erro-uniforme@rotas.test', 'hash', 'salt', ?)`,
  ).bind(id, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ('sessao-erro-uniforme', ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(id, await sha256("token-erro-uniforme"), agora).run();
  pessoa = { id, token: "token-erro-uniforme" };
});

let ip = 0;
const pedir = (caminho, { method = "GET", body, ambiente = env } = {}) =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers: {
        authorization: `Bearer ${pessoa.token}`,
        "cf-connecting-ip": `198.51.100.${++ip}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ambiente,
    { waitUntil() {}, passThroughOnException() {} },
  );

let erros;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  erros.mockRestore();
  globalThis.fetch = originalFetch;
});

describe("erro uniforme nas rotas de IA, transcrição e mídia", () => {
  it("/api/ai: falha do banco no meio da resposta vira JSON 500", async () => {
    // A sessão valida normalmente; o que quebra é a leitura do espaço que o
    // handleAi faz para montar o contexto.
    const banco = new Proxy(env.DB, {
      get(alvo, prop) {
        if (prop === "prepare")
          return (sql) => {
            if (/FROM workspaces/.test(sql)) throw new Error("D1 fora do ar");
            return alvo.prepare(sql);
          };
        const valor = Reflect.get(alvo, prop);
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      },
    });
    const resposta = await pedir("/api/ai", {
      method: "POST",
      body: { prompt: "Monte um plano de vendas para a semana" },
      ambiente: { ...env, DB: banco },
    });
    expect(resposta.status).toBe(500);
    expect(resposta.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await resposta.json()).toEqual({
      error: "Não foi possível gerar a resposta agora. Tente novamente em instantes.",
    });
    expect(erros).toHaveBeenCalledWith("AI error", expect.any(Error));
  });

  it("/api/transcribe: exceção fora do try interno vira JSON 500", async () => {
    const ambiente = new Proxy(
      { ...env },
      {
        get(alvo, prop, receptor) {
          if (prop === "AI") throw new Error("binding do Workers AI quebrado");
          return Reflect.get(alvo, prop, receptor);
        },
      },
    );
    const resposta = await pedir("/api/transcribe", {
      method: "POST",
      body: { audio: "AAAA" },
      ambiente,
    });
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      error: "Não foi possível transcrever o áudio agora. Tente novamente em instantes.",
    });
    expect(erros).toHaveBeenCalledWith("Transcription error", expect.any(Error));
  });

  it("/api/media: servidor de vídeo fora do ar vira JSON 500", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://video.exemplo.test/"))
        throw new TypeError("Network connection lost.");
      return originalFetch(input, init);
    });
    const resposta = await pedir(`/api/media?request_id=wan_${"a".repeat(32)}`, {
      ambiente: { ...env, VIDEO_AI_URL: "https://video.exemplo.test", VIDEO_AI_TOKEN: "token-video" },
    });
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      error: "Não foi possível gerar a mídia agora. Tente novamente em instantes.",
    });
    expect(erros).toHaveBeenCalledWith("Media error", expect.any(Error));
  });

  it("quando o handler não lança, a resposta continua a de antes", async () => {
    const semId = await pedir("/api/media");
    expect(semId.status).toBe(400);
    expect(await semId.json()).toEqual({ error: "Identificador de vídeo inválido." });
    const semAi = await pedir("/api/transcribe", { method: "POST", body: { audio: "AAAA" } });
    expect(semAi.status).toBe(503);
    expect(await semAi.json()).toEqual({
      error: "Transcrição indisponível: Workers AI não está configurado.",
    });
    const pedidoCurto = await pedir("/api/ai", { method: "POST", body: { prompt: "oi" } });
    expect(pedidoCurto.status).toBe(400);
    expect(await pedidoCurto.json()).toEqual({ error: "Explique um pouco mais sobre o que precisa." });
    expect(erros).not.toHaveBeenCalled();
  });
});
