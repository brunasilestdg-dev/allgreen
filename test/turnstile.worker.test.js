import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker.js";
import entrada from "../worker-entry.js";
import { normalizePublicForm } from "../src/features/forms/publicFormDomain.js";
import {
  cspComTurnstile,
  tokenDoTurnstile,
  turnstileAtivo,
  verificarTurnstile,
} from "../worker/lib/turnstile.js";

// Chaves de teste oficiais da Cloudflare (developers.cloudflare.com/turnstile/
// troubleshooting/testing): valem em qualquer domínio e nunca em produção.
const comTurnstile = {
  ...env,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

let requestNumber = 0;
const nextIp = () => `203.0.113.${(++requestNumber % 240) + 1}`;

const post = (path, body, ambiente = comTurnstile) =>
  worker.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": nextIp() },
      body: JSON.stringify(body),
    }),
    ambiente,
  );

// Responde o siteverify; qualquer outra saída para a rede é erro de teste.
const siteverify = (resposta) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (!url.includes("challenges.cloudflare.com/turnstile/v0/siteverify"))
      throw new Error(`rede inesperada no teste: ${url}`);
    if (resposta instanceof Error) throw resposta;
    return resposta instanceof Response
      ? resposta
      : new Response(JSON.stringify(resposta), {
          headers: { "content-type": "application/json" },
        });
  });

afterEach(() => vi.restoreAllMocks());

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createUser(id) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  ).bind(id, `Pessoa ${id}`, `${id}@example.com`, now).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(
    `INSERT INTO workspaces (user_id, data, updated_at, revision) VALUES (?, '{}', ?, 0)`,
  ).bind(id, now).run();
  return { id, token };
}

describe("Turnstile: regras puras", () => {
  it("só liga com as duas chaves", () => {
    expect(turnstileAtivo({})).toBe(false);
    expect(turnstileAtivo({ TURNSTILE_SITE_KEY: "x" })).toBe(false);
    expect(turnstileAtivo({ TURNSTILE_SECRET_KEY: "y" })).toBe(false);
    expect(turnstileAtivo({ TURNSTILE_SITE_KEY: "x", TURNSTILE_SECRET_KEY: "y" })).toBe(true);
  });

  it("lê o token do JSON do app, do campo do widget ou do cabeçalho", () => {
    expect(tokenDoTurnstile({ turnstileToken: " abc " })).toBe("abc");
    expect(tokenDoTurnstile({ "cf-turnstile-response": "def" })).toBe("def");
    const request = new Request("https://app.test", { headers: { "cf-turnstile-response": "ghi" } });
    expect(tokenDoTurnstile({}, request)).toBe("ghi");
    expect(tokenDoTurnstile({ turnstileToken: "x".repeat(2049) })).toBe("");
  });

  it("acrescenta a origem do widget a script-src e frame-src, e só com ele ligado", () => {
    const base = "default-src 'none'; script-src 'nonce-abc'; form-action 'none'";
    expect(cspComTurnstile(base, {})).toBe(base);
    const csp = cspComTurnstile(base, comTurnstile);
    expect(csp).toContain("script-src 'nonce-abc' https://challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("form-action 'none'");
  });

  it("recusa sem token, aceita o que o siteverify aprova e barra ação trocada", async () => {
    const aprova = async () =>
      new Response(JSON.stringify({ success: true, action: "entrada" }));
    expect(await verificarTurnstile(comTurnstile, "", { fetcher: aprova })).toMatchObject({
      ok: false,
      motivo: "ausente",
    });
    expect(await verificarTurnstile(comTurnstile, "tok", { fetcher: aprova, acao: "entrada" })).toEqual({ ok: true });
    expect(await verificarTurnstile(comTurnstile, "tok", { fetcher: aprova, acao: "agenda" })).toMatchObject({
      ok: false,
      motivo: "acao",
    });
  });

  it("siteverify fora do ar não tranca o cadastro; recusa explícita tranca", async () => {
    const semRede = async () => {
      throw new Error("rede caiu");
    };
    const foraDoAr = async () => new Response("erro", { status: 503 });
    const recusa = async () =>
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }));
    expect((await verificarTurnstile(comTurnstile, "tok", { fetcher: semRede })).ok).toBe(true);
    expect((await verificarTurnstile(comTurnstile, "tok", { fetcher: foraDoAr })).ok).toBe(true);
    expect(await verificarTurnstile(comTurnstile, "tok", { fetcher: recusa })).toMatchObject({
      ok: false,
      codigos: ["invalid-input-response"],
    });
  });
});

describe("Turnstile no cadastro e no login", () => {
  it("/api/config só entrega a chave pública com o Turnstile ligado", async () => {
    const desligado = await worker.fetch(new Request("https://app.test/api/config"), env);
    expect((await desligado.json()).turnstileSiteKey).toBe("");
    const ligado = await worker.fetch(new Request("https://app.test/api/config"), comTurnstile);
    const config = await ligado.json();
    expect(config.turnstileSiteKey).toBe("1x00000000000000000000AA");
    expect(JSON.stringify(config)).not.toContain("0000000000000000000000000000000AA");
  });

  it("sem as chaves, o cadastro segue como antes (nenhuma chamada ao siteverify)", async () => {
    const rede = vi.spyOn(globalThis, "fetch");
    const resposta = await post(
      "/api/auth/register",
      { name: "Sem Anti Robô", email: "sem-turnstile@example.com", password: "senha-segura-1" },
      env,
    );
    expect(resposta.status).toBe(201);
    expect(rede).not.toHaveBeenCalled();
  });

  it("com as chaves, cadastro sem token é recusado antes de criar a conta", async () => {
    const resposta = await post("/api/auth/register", {
      name: "Robô",
      email: "robo-sem-token@example.com",
      password: "senha-segura-1",
    });
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ turnstile: true });
    const conta = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("robo-sem-token@example.com")
      .first();
    expect(conta).toBeNull();
  });

  it("cadastro com token aprovado cria a conta; token recusado não", async () => {
    const rede = siteverify({ success: true, action: "entrada" });
    const ok = await post("/api/auth/register", {
      name: "Pessoa Real",
      email: "pessoa-real@example.com",
      password: "senha-segura-1",
      turnstileToken: "token-bom",
    });
    expect(ok.status).toBe(201);
    const [url, init] = rede.mock.calls[0];
    expect(String(url)).toContain("/turnstile/v0/siteverify");
    const enviado = new URLSearchParams(init.body);
    expect(enviado.get("response")).toBe("token-bom");
    expect(enviado.get("secret")).toBe(comTurnstile.TURNSTILE_SECRET_KEY);

    vi.restoreAllMocks();
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const recusado = await post("/api/auth/register", {
      name: "Token Gasto",
      email: "token-gasto@example.com",
      password: "senha-segura-1",
      turnstileToken: "token-usado",
    });
    expect(recusado.status).toBe(403);
    expect(await recusado.json()).toMatchObject({ turnstile: true });
  });

  it("login sem token é barrado antes de conferir a senha", async () => {
    const resposta = await post("/api/auth/login", {
      email: "qualquer@example.com",
      password: "senha-segura-1",
    });
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ turnstile: true });
  });

  it("pedido de acesso à To Do Green também pede o token", async () => {
    // As rotas da vertical passam pela entrada (worker-entry.js).
    const resposta = await entrada.fetch(
      new Request("https://app.test/api/todogreen/solicitar-acesso", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": nextIp() },
        body: JSON.stringify({ nome: "Visitante", email: "visitante@example.com" }),
      }),
      comTurnstile,
      { waitUntil() {}, passThroughOnException() {} },
    );
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ turnstile: true });
  });
});

describe("Turnstile nas páginas públicas", () => {
  it("formulário público desenha o widget, libera a CSP e exige o token no envio", async () => {
    const owner = await createUser("turnstile-form-owner");
    const form = normalizePublicForm(
      {
        id: "form-turnstile",
        name: "Contato protegido",
        slug: "contato-protegido",
        fields: [{ id: "assunto", label: "Assunto", type: "text", required: true }],
      },
      { ownerId: owner.id, workspaceOwnerId: owner.id },
    );
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO public_forms (id, workspace_owner_id, created_by, slug, snapshot_json, published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind("form-turnstile", owner.id, owner.id, "contato-protegido", JSON.stringify(form), agora, agora).run();

    const semChave = await worker.fetch(new Request("https://app.test/f/contato-protegido"), env);
    const htmlSemChave = await semChave.text();
    expect(htmlSemChave).not.toContain('class="cf-turnstile"');
    expect(htmlSemChave).not.toContain("turnstile/v0/api.js");
    expect(semChave.headers.get("content-security-policy")).not.toContain("challenges.cloudflare.com");

    const pagina = await worker.fetch(new Request("https://app.test/f/contato-protegido"), comTurnstile);
    const html = await pagina.text();
    expect(html).toContain('class="cf-turnstile"');
    expect(html).toContain('data-action="formulario"');
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(pagina.headers.get("content-security-policy")).toContain(
      "frame-src https://challenges.cloudflare.com",
    );

    const envio = await post("/api/public-forms/contato-protegido/submissions", {
      values: { assunto: "Olá" },
    });
    expect(envio.status).toBe(400);
    expect(await envio.json()).toMatchObject({ turnstile: true });
  });

  it("agenda pública: widget na página e recusa de envio sem token", async () => {
    const owner = await createUser("turnstile-agenda-owner");
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO booking_pages
        (id, workspace_owner_id, created_by, name, slug, duration_minutes, timezone, weekdays_json, start_time, end_time, location, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Visita técnica', 'visita-protegida', 30, 'America/Sao_Paulo', '[1,2,3,4,5]', '09:00', '18:00', '', 1, ?, ?)`,
    ).bind("agenda-turnstile", owner.id, owner.id, agora, agora).run();

    const pagina = await worker.fetch(new Request("https://app.test/agenda/visita-protegida"), comTurnstile);
    const html = await pagina.text();
    expect(html).toContain('data-action="agenda"');
    expect(pagina.headers.get("content-security-policy")).toContain(
      "script-src https://challenges.cloudflare.com",
    );

    const envio = await post("/api/public-scheduling/visita-protegida/book", {
      name: "Cliente",
      email: "cliente@example.com",
      startAt: "2099-01-05T10:00",
    });
    expect(envio.status).toBe(400);
    expect(await envio.json()).toMatchObject({ turnstile: true });
  });
});
