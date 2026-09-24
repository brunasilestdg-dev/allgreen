import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker.js";

// Caracterização do roteador do worker.js: status, corpo e cabeçalhos que cada
// rota devolve nos caminhos de borda (sem banco, sem sessão, falha no meio do
// handler, página pública × API, fallback do SPA). Foi escrito contra a cadeia
// de `if` antiga e continua valendo para a tabela declarativa de
// worker/http/ — é a prova de que a troca não mudou resposta nenhuma.

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let ipSeq = 0;
const proximoIp = () => `203.0.113.${(ipSeq = (ipSeq % 250) + 1)}`;

async function criarPessoa(id) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  ).bind(id, `Pessoa ${id}`, `${id}@rotas.test`, agora).run();
  const token = `token-${id}`;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`sessao-${id}`, id, await sha256(token), agora).run();
  return { id, token };
}

async function vincular(donoId, membroId, papel) {
  await env.DB.prepare(
    `INSERT INTO memberships (id, owner_id, member_id, role, created_at, status)
     VALUES (?, ?, ?, ?, ?, 'ativo')`,
  ).bind(`vinculo-${donoId}-${membroId}`, donoId, membroId, papel, new Date().toISOString()).run();
}

const semBanco = () => ({ ...env, DB: undefined });

// D1 que falha em toda consulta, menos nas que casam `permitir` — por padrão a
// da sessão, para a falha acontecer DENTRO do handler, depois do login.
function bancoQueFalha(permitir = /FROM sessions/) {
  return new Proxy(env.DB, {
    get(alvo, prop) {
      if (prop === "prepare")
        return (sql) => {
          if (permitir && permitir.test(sql)) return alvo.prepare(sql);
          throw new Error("falha simulada do banco");
        };
      const valor = Reflect.get(alvo, prop);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
}

const comBancoQueFalha = (permitir) => ({ ...env, DB: bancoQueFalha(permitir) });

const ASSETS = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith(".png"))
      return new Response("png", { headers: { "content-type": "image/png" } });
    return new Response("<!doctype html><title>SPA</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

function pedir(caminho, { method = "GET", token, body, ambiente = env, headers = {}, comIp = true } = {}) {
  const cabecalhos = { ...headers };
  if (comIp && !cabecalhos["cf-connecting-ip"]) cabecalhos["cf-connecting-ip"] = proximoIp();
  if (token) cabecalhos.authorization = `Bearer ${token}`;
  let corpo;
  if (body !== undefined) {
    cabecalhos["content-type"] ||= "application/json";
    corpo = typeof body === "string" ? body : JSON.stringify(body);
  }
  return worker.fetch(
    new Request(`https://app.test${caminho}`, { method, headers: cabecalhos, body: corpo }),
    ambiente,
    { waitUntil() {}, passThroughOnException() {} },
  );
}

let erros;
beforeEach(() => {
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  erros.mockRestore();
});

let pessoa;
let dona;
let colaboradora;
let estranha;

beforeAll(async () => {
  pessoa = await criarPessoa("rotas-pessoa");
  dona = await criarPessoa("rotas-dona");
  colaboradora = await criarPessoa("rotas-colaboradora");
  estranha = await criarPessoa("rotas-estranha");
  await vincular(dona.id, colaboradora.id, "colaborador");
});

describe("rotas públicas informativas", () => {
  it("/api/status responde a saúde do banco", async () => {
    const ok = await pedir("/api/status");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "operacional", database: "operacional", version: "local" });
    const degradado = await pedir("/api/status", { ambiente: semBanco() });
    expect(await degradado.json()).toMatchObject({ status: "degradado", database: "indisponível" });
  });

  it("/api/system/version só aceita GET", async () => {
    const recusa = await pedir("/api/system/version", { method: "POST" });
    expect(recusa.status).toBe(405);
    expect(await recusa.json()).toEqual({ error: "Método não permitido." });
    const versao = await pedir("/api/system/version");
    expect(versao.status).toBe(200);
    expect(await versao.json()).toMatchObject({ sha: "local", version: "local" });
  });

  it("/api/config expõe só a configuração pública", async () => {
    const resposta = await pedir("/api/config");
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      googleClientId: "",
      videoEnabled: false,
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
      supportEmail: "",
    });
  });
});

describe("API pública v1", () => {
  it("sem banco responde 503 com CORS aberto", async () => {
    const resposta = await pedir("/api/public/v1/me", { ambiente: semBanco() });
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
    expect(await resposta.json()).toEqual({ error: "Banco de dados indisponível." });
  });

  it("sem chave responde 401 e o openapi é público", async () => {
    const semChave = await pedir("/api/public/v1/me");
    expect(semChave.status).toBe(401);
    expect(semChave.headers.get("access-control-allow-origin")).toBe("*");
    expect(await semChave.json()).toEqual({ error: "Chave ausente, inválida ou revogada." });
    const spec = await pedir("/api/public/v1/openapi.json");
    expect(spec.status).toBe(200);
    expect((await spec.json()).openapi).toBe("3.1.0");
  });

  it("falha no meio da chamada vira 500 no formato da API pública", async () => {
    const resposta = await pedir("/api/public/v1/me", {
      ambiente: comBancoQueFalha(null),
      headers: { authorization: "Bearer sf_live_qualquer" },
    });
    expect(resposta.status).toBe(500);
    expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
    expect(await resposta.json()).toEqual({ error: "Não foi possível concluir a chamada." });
    expect(erros).toHaveBeenCalledWith("Public API error", expect.any(Error));
  });
});

describe("agenda e atendimento públicos", () => {
  it("sem banco: página em texto, API em JSON", async () => {
    const pagina = await pedir("/agenda/minha-agenda", { ambiente: semBanco() });
    expect(pagina.status).toBe(503);
    expect(pagina.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(pagina.headers.get("cache-control")).toBeNull();
    expect(await pagina.text()).toBe("Este serviço ainda não está disponível.");
    const api = await pedir("/api/public-scheduling/minha-agenda", { ambiente: semBanco() });
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "Banco de dados indisponível." });
  });

  it("falha no handler: página em texto, API em JSON", async () => {
    const pagina = await pedir("/atendimento/meu-portal", { ambiente: comBancoQueFalha(null) });
    expect(pagina.status).toBe(500);
    expect(pagina.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(pagina.headers.get("cache-control")).toBeNull();
    expect(await pagina.text()).toBe("Este serviço não está disponível agora.");
    const api = await pedir("/api/public-support/meu-portal", { ambiente: comBancoQueFalha(null) });
    expect(api.status).toBe(500);
    expect(await api.json()).toEqual({ error: "Não foi possível concluir a solicitação." });
    expect(erros).toHaveBeenCalledWith("Public platform suite error", expect.any(Error));
  });
});

describe("páginas públicas: falha em texto na página, JSON na API", () => {
  const TOKEN_ORCAMENTO = "a".repeat(32);
  const TOKEN_PORTAL = "b".repeat(48);
  const casos = [
    ["GET", "/f/formulario-teste", undefined, "Public form error", { texto: "Este formulário não está disponível." }],
    ["POST", "/api/public-forms/formulario-teste/submissions", { submissionId: "x" }, "Public form error", { json: "Não foi possível concluir o envio." }],
    ["GET", `/orcamento/${TOKEN_ORCAMENTO}`, undefined, "Public quote error", { texto: "Este orçamento não está disponível." }],
    ["POST", `/api/public-quotes/${TOKEN_ORCAMENTO}/decision`, { decision: "aprovado" }, "Public quote error", { json: "Não foi possível registrar a resposta." }],
    ["GET", `/portal/${TOKEN_PORTAL}`, undefined, "Public client portal error", { texto: "Este portal não está disponível." }],
    ["GET", `/api/portal/${TOKEN_PORTAL}`, undefined, "Public client portal error", { json: "Não foi possível concluir a ação no portal." }],
    ["GET", "/s/site-teste", undefined, "Public site error", { texto: "Esta página não está disponível." }],
    ["GET", "/loja/site-teste", undefined, "Public site error", { texto: "Esta página não está disponível." }],
    ["POST", "/api/public-sites/site-teste/leads", { name: "Ana", email: "ana@exemplo.com" }, "Public site error", { json: "Não foi possível concluir o envio." }],
  ];
  for (const [method, caminho, body, rotulo, esperado] of casos) {
    it(`${method} ${caminho}`, async () => {
      const resposta = await pedir(caminho, { method, body, ambiente: comBancoQueFalha(null) });
      expect(resposta.status).toBe(500);
      if (esperado.texto) {
        expect(resposta.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(resposta.headers.get("cache-control")).toBe("no-store");
        expect(await resposta.text()).toBe(esperado.texto);
      } else {
        expect(resposta.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(await resposta.json()).toEqual({ error: esperado.json });
      }
      expect(erros).toHaveBeenCalledWith(rotulo, expect.any(Error));
    });
  }
});

describe("rotas públicas com resposta de falha em JSON", () => {
  const casos = [
    ["POST", "/api/errors", { message: "quebrou" }, {}, "Error log failure", 200, { ok: true }],
    ["POST", "/api/auth/login", { email: "ninguem@rotas.test", password: "senha-bem-longa" }, {}, "Auth error", 500, { error: "Não foi possível concluir o acesso." }],
    [
      "POST",
      "/api/inbound/whatsapp",
      { entry: [{ changes: [{ value: { metadata: { phone_number_id: "123" }, messages: [] } }] }] },
      {},
      "Inbound WhatsApp error",
      500,
      { error: "Não foi possível receber o WhatsApp." },
    ],
    [
      "POST",
      "/api/inbound/email",
      { to: "caixa@rotas.test", from: "cliente@exemplo.com", subject: "Oi", text: "Olá" },
      { "x-inbound-secret": "email-inbound-secret" },
      "Inbound email error",
      500,
      { error: "Não foi possível receber o e-mail." },
    ],
    ["GET", "/api/collab/invite-info?token=abc", undefined, {}, "Public invite error", 500, { error: "Não foi possível concluir a ação." }],
    ["GET", "/api/todogreen/access-invite?token=abc", undefined, {}, "To Do Green public invite error", 500, { error: "Não foi possível abrir este convite." }],
  ];
  for (const [method, caminho, body, headers, rotulo, status, esperado] of casos) {
    it(`${method} ${caminho}`, async () => {
      const resposta = await pedir(caminho, { method, body, headers, ambiente: comBancoQueFalha(null) });
      expect(resposta.status).toBe(status);
      expect(await resposta.json()).toEqual(esperado);
      expect(erros).toHaveBeenCalledWith(rotulo, expect.any(Error));
    });
  }

  it("POST /api/test-support/todogreen-acesso", async () => {
    const resposta = await pedir("/api/test-support/todogreen-acesso", {
      method: "POST",
      token: pessoa.token,
      comIp: false,
      ambiente: comBancoQueFalha(null),
    });
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "Não foi possível concluir a ação de teste." });
    expect(erros).toHaveBeenCalledWith("Test support error", expect.any(Error));
  });
});

describe("rotas autenticadas: portaria", () => {
  const AUTENTICADAS = [
    "/api/ai",
    "/api/plan",
    "/api/ai/stream",
    "/api/transcribe",
    "/api/media",
    "/api/workspace",
    "/api/workspace/backups",
    "/api/webhooks",
    "/api/tasks/action",
    "/api/events",
    "/api/outbox/send",
    "/api/inbox",
    "/api/inbox/personal",
    "/api/inbox/conversations",
    "/api/quotes/share",
    "/api/forms/status",
    "/api/client-portals/status",
    "/api/collab",
    "/api/collab/invite",
    "/api/tasks/notify",
    "/api/sites/publish",
    "/api/free-suite/apps",
    "/api/platform/agenda",
    "/api/todogreen/access",
    "/api/ai-keys",
    "/api/search-keys",
    "/api/push/subscribe",
  ];

  it("GET /api/ai responde 405 antes de pedir sessão", async () => {
    const resposta = await pedir("/api/ai");
    expect(resposta.status).toBe(405);
    expect(await resposta.json()).toEqual({ error: "Método não permitido." });
  });

  for (const caminho of AUTENTICADAS)
    it(`${caminho} sem sessão responde 401`, async () => {
      const resposta = await pedir(caminho, { method: "POST", body: {} });
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual({ error: "Sua sessão expirou. Entre novamente." });
    });

  it("falha ao validar a sessão responde 500", async () => {
    const resposta = await pedir("/api/workspace", { token: pessoa.token, ambiente: comBancoQueFalha(null) });
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "Não foi possível validar sua sessão." });
    expect(erros).toHaveBeenCalledWith("Session check error", expect.any(Error));
  });

  const EXIGEM_BANCO = [
    "/api/workspace",
    "/api/workspace/backups",
    "/api/tasks/action",
    "/api/events",
    "/api/outbox/send",
    "/api/inbox",
    "/api/inbox/personal",
    "/api/inbox/conversations",
    "/api/forms/status",
    "/api/client-portals/status",
    "/api/collab",
    "/api/sites/publish",
    "/api/free-suite/apps",
    "/api/platform/agenda",
    "/api/todogreen/access",
    "/api/ai-keys",
    "/api/search-keys",
    "/api/plan",
    "/api/webhooks",
    "/api/push/subscribe",
  ];
  for (const caminho of EXIGEM_BANCO)
    it(`${caminho} sem banco responde 503 antes da sessão`, async () => {
      const resposta = await pedir(caminho, { method: "POST", body: {}, ambiente: semBanco() });
      expect(resposta.status).toBe(503);
      expect(await resposta.json()).toEqual({ error: "O serviço de contas ainda não está configurado." });
    });

  // Sem D1 o sessionUser devolve { id: "local" } (modo local): estas rotas não
  // têm checagem de banco e chegam ao handler.
  const SEM_BANCO = [
    ["POST", "/api/ai", "{", 400, { error: "Solicitação inválida." }],
    ["POST", "/api/ai/stream", "{", 503, { error: "Streaming indisponível.", fallback: true }],
    ["POST", "/api/transcribe", "{", 503, { error: "Transcrição indisponível: Workers AI não está configurado." }],
    ["GET", "/api/media", undefined, 400, { error: "Identificador de vídeo inválido." }],
    ["POST", "/api/quotes/share", "{", 400, { error: "Dados inválidos." }],
    ["POST", "/api/tasks/notify", "{", 503, { error: "O envio de e-mail não está configurado." }],
  ];
  for (const [method, caminho, body, status, esperado] of SEM_BANCO)
    it(`${caminho} funciona sem banco, como usuário local`, async () => {
      const resposta = await pedir(caminho, { method, body, ambiente: semBanco() });
      expect(resposta.status).toBe(status);
      expect(await resposta.json()).toEqual(esperado);
    });
});

describe("chaves de IA e de busca: só dono ou admin", () => {
  it("colaboradora recebe 403 nas duas", async () => {
    const ia = await pedir(`/api/ai-keys?owner=${dona.id}`, { token: colaboradora.token });
    expect(ia.status).toBe(403);
    expect(await ia.json()).toEqual({ error: "Somente o dono ou um administrador do espaço cadastra chaves de IA." });
    const busca = await pedir(`/api/search-keys?owner=${dona.id}`, { token: colaboradora.token });
    expect(busca.status).toBe(403);
    expect(await busca.json()).toEqual({ error: "Somente o dono ou um administrador do espaço configura a busca." });
  });

  it("quem não é do espaço recebe 403", async () => {
    for (const caminho of ["/api/ai-keys", "/api/search-keys"]) {
      const resposta = await pedir(`${caminho}?owner=${dona.id}`, { token: estranha.token });
      expect(resposta.status).toBe(403);
      expect(await resposta.json()).toEqual({ error: "Você não tem acesso a este espaço." });
    }
  });
});

describe("rotas autenticadas: falha no handler vira JSON 500 com o texto da rota", () => {
  const OUTRO = "rotas-outro-espaco";
  const casos = [
    ["GET", "/api/workspace", undefined, "Workspace error", "Não foi possível sincronizar seus dados."],
    ["GET", "/api/webhooks", undefined, "Webhook error", "Não foi possível configurar o envio automático."],
    ["GET", "/api/workspace/backups", undefined, "Workspace backup error", "Não foi possível acessar os backups deste espaço."],
    ["POST", "/api/tasks/action", { taskId: "t1", action: "assume" }, "Task action error", "Não foi possível atualizar esta tarefa."],
    ["GET", "/api/events", undefined, "Product event error", "Não foi possível registrar este evento."],
    ["POST", `/api/outbox/send?owner=${OUTRO}`, { channel: "email", to: "a@b.co", body: "oi" }, "Outbox send error", "Não foi possível enviar a mensagem."],
    ["GET", "/api/inbox/personal", undefined, "Personal inbox error", "Não foi possível acessar sua caixa de entrada pessoal."],
    ["GET", "/api/inbox/conversations", undefined, "Inbox conversations error", "Não foi possível acessar as conversas da caixa."],
    ["GET", "/api/inbox", undefined, "Inbox error", "Não foi possível acessar a caixa de entrada."],
    ["GET", "/api/quotes/status", undefined, "Quotes error", "Não foi possível compartilhar o orçamento."],
    ["GET", "/api/forms/status", undefined, "Forms error", "Não foi possível gerenciar este formulário."],
    ["GET", "/api/client-portals/status", undefined, "Client portals error", "Não foi possível gerenciar este portal."],
    ["GET", `/api/collab?owner=${OUTRO}`, undefined, "Collab error", "Não foi possível concluir a ação de colaboração."],
    ["GET", "/api/sites/leads?site_id=site-x", undefined, "Sites error", "Não foi possível concluir a publicação."],
    ["GET", `/api/free-suite/apps?owner=${OUTRO}`, undefined, "Free suite error", "Não foi possível concluir a ação no laboratório."],
    ["GET", `/api/platform/agenda?owner=${OUTRO}`, undefined, "Platform suite error", "Não foi possível concluir a ação nesta central."],
    ["POST", "/api/push/subscribe", { endpoint: "https://push.example.com/x", keys: { p256dh: "p", auth: "a" } }, "Push error", "Não foi possível concluir a ação de notificação."],
    ["GET", `/api/ai-keys?owner=${OUTRO}`, undefined, "AI keys error", "Não foi possível salvar a chave de IA."],
    ["GET", `/api/search-keys?owner=${OUTRO}`, undefined, "Search keys error", "Não foi possível salvar a configuração de busca."],
  ];
  for (const [method, caminho, body, rotulo, mensagem] of casos)
    it(`${method} ${caminho}`, async () => {
      const resposta = await pedir(caminho, { method, body, token: pessoa.token, ambiente: comBancoQueFalha() });
      expect(resposta.status).toBe(500);
      expect(resposta.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await resposta.json()).toEqual({ error: mensagem });
      expect(erros).toHaveBeenCalledWith(rotulo, expect.any(Error));
    });

  it("POST /api/ai/stream mantém o sinal de fallback", async () => {
    const resposta = await pedir("/api/ai/stream", {
      method: "POST",
      body: { prompt: "Monte um plano de vendas" },
      token: pessoa.token,
      ambiente: { ...comBancoQueFalha(), GEMINI_API_KEY: "chave-de-teste" },
    });
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ error: "Streaming indisponível.", fallback: true });
    expect(erros).toHaveBeenCalledWith("Stream error", expect.any(Error));
  });
});

describe("fallback do SPA", () => {
  const comAssets = () => ({ ...env, ASSETS });

  it("serve o HTML com anti-clickjacking", async () => {
    const resposta = await pedir("/qualquer-pagina", { ambiente: comAssets() });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("x-frame-options")).toBe("DENY");
    expect(resposta.headers.get("x-robots-tag")).toBeNull();
    expect(await resposta.text()).toContain("<title>SPA</title>");
  });

  it("marca noindex nas superfícies privadas", async () => {
    for (const caminho of ["/portal-cliente/abc", "/portal-motorista", "/portal-colaborador/x", "/todogreen"]) {
      const resposta = await pedir(caminho, { ambiente: comAssets() });
      expect(resposta.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("devolve asset que não é HTML sem mexer nos cabeçalhos", async () => {
    const resposta = await pedir("/icone-192.png", { ambiente: comAssets() });
    expect(resposta.headers.get("content-type")).toBe("image/png");
    expect(resposta.headers.get("x-frame-options")).toBeNull();
  });

  it("rota pública que não reconhece o caminho segue para o SPA", async () => {
    for (const caminho of ["/orcamento/nao-e-token", "/f/formulario/extra", "/portal/curto"]) {
      const resposta = await pedir(caminho, { ambiente: comAssets() });
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("x-frame-options")).toBe("DENY");
      expect(await resposta.text()).toContain("<title>SPA</title>");
    }
  });
});
