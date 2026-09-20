import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";
import { chavesDoEspaco } from "../worker/services/ai-keys.js";

// "Traga sua própria chave" tem três perguntas que precisam de resposta por
// construção:
//
// 1. A chave volta para a tela em algum lugar? (não pode)
// 2. Ela vai NA FRENTE da chave da plataforma? (precisa — quem trouxe a conta
//    quer que ela seja usada, não que fique de reserva)
// 3. Um espaço alcança a chave de outro? (não pode)

const sha256 = async (valor) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `203.0.114.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const criarConta = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, id, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return `tok-${id}`;
};

// O cofre precisa existir para a chave poder ser guardada. Um segredo de teste,
// que não é o de produção.
const ambiente = () => ({ ...env, WORKSPACE_AI_VAULT_KEY: "chave-de-teste-com-mais-de-32-caracteres-ok" });

const CHAVE_CLAUDE = "sk-ant-api03-teste-do-espaco-de-trabalho";

let tokenDona;
let tokenVizinha;

beforeAll(async () => {
  tokenDona = await criarConta("ia-dona", "ia-dona@teste.test");
  tokenVizinha = await criarConta("ia-vizinha", "ia-vizinha@teste.test");
});

// O teste de conexão fala com o provedor de verdade. Aqui ele é interceptado:
// a suíte não pode depender de rede nem gastar cota de ninguém.
const comProvedorRespondendo = (ok = true) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const alvo = String(entrada?.url || entrada);
    if (alvo.includes("api.anthropic.com"))
      return ok
        ? new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }], model: "claude-opus-5" }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
    throw new Error(`fetch inesperado para ${alvo}`);
  });

describe("cadastrar a própria chave", () => {
  it("guarda cifrada e nunca devolve o segredo para a tela", async () => {
    const espiao = comProvedorRespondendo(true);
    try {
      const salvo = await worker.fetch(
        new Request("https://app.test/api/ai-keys/anthropic", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.9" },
          body: JSON.stringify({ chave: CHAVE_CLAUDE, rotulo: "Conta da diretoria" }),
        }),
        ambiente(), { waitUntil() {}, passThroughOnException() {} },
      );
      expect(salvo.status).toBe(201);
      expect((await salvo.json()).testeOk).toBe(true);
    } finally {
      espiao.mockRestore();
    }

    // No banco, cifrada: o texto da chave não aparece em lugar nenhum da linha.
    const linha = await env.DB.prepare(
      "SELECT * FROM workspace_ai_keys WHERE workspace_owner_id='ia-dona' AND provider='anthropic'",
    ).first();
    expect(JSON.stringify(linha)).not.toContain(CHAVE_CLAUDE);
    expect(linha.secret_prefix).toBe("sk-ant-…");

    // Na tela, só o prefixo. Uma tela que reexibe segredo é segredo que vaza
    // por captura de tela.
    const listagem = await worker.fetch(
      new Request("https://app.test/api/ai-keys", { headers: { authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.10" } }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    const corpo = await listagem.text();
    expect(corpo).not.toContain(CHAVE_CLAUDE);
    expect(corpo).toContain("sk-ant-…");
  });

  it("recusa chave com prefixo de outro provedor antes de gastar chamada", async () => {
    const resposta = await worker.fetch(
      new Request("https://app.test/api/ai-keys/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.11" },
        body: JSON.stringify({ chave: "gsk_isto-e-uma-chave-do-groq" }),
      }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toMatch(/sk-ant-/);
  });

  it("sem cofre configurado, não guarda — e diz por quê", async () => {
    const semCofre = { ...env, WORKSPACE_AI_VAULT_KEY: "" };
    const resposta = await worker.fetch(
      new Request("https://app.test/api/ai-keys", { headers: { authorization: `Bearer ${tokenVizinha}`, "cf-connecting-ip": "203.0.114.12" } }),
      semCofre, { waitUntil() {}, passThroughOnException() {} },
    );
    expect((await resposta.json()).cofreDisponivel).toBe(false);
  });
});

describe("a chave do espaço vem na frente da chave da plataforma", () => {
  it("chavesDoEspaco marca a origem para a cascata promover o provedor", async () => {
    const chaves = await chavesDoEspaco(ambiente(), "ia-dona");
    expect(chaves.ANTHROPIC_API_KEY).toBe(CHAVE_CLAUDE);
    // A marca é o que faz `providerChain` colocar o provedor no início.
    expect(chaves.__DO_ESPACO_ANTHROPIC_API_KEY).toBe("1");
  });

  it("providerChain põe o provedor do espaço antes dos gratuitos da plataforma", async () => {
    const { providerChain } = await import("../worker/services/ai.js");
    const comAmbos = providerChain({
      GEMINI_API_KEY: "chave-da-plataforma",
      GROQ_API_KEY: "chave-da-plataforma",
      ANTHROPIC_API_KEY: CHAVE_CLAUDE,
      __DO_ESPACO_ANTHROPIC_API_KEY: "1",
    }, {});
    expect(comAmbos[0][0]).toBe("claude");

    // Sem a marca, o Claude é reserva: entra na cascata, mas atrás.
    const soDoCofre = providerChain({
      GEMINI_API_KEY: "chave-da-plataforma",
      ANTHROPIC_API_KEY: "chave-do-cofre",
    }, {});
    expect(soDoCofre[0][0]).not.toBe("claude");
    expect(soDoCofre.map(([nome]) => nome)).toContain("claude");
  });

  it("fluxo padrão lidera com o Gemini Flash completo, com o flash-lite logo atrás", async () => {
    const { providerChain } = await import("../worker/services/ai.js");
    const ordem = providerChain({ GEMINI_API_KEY: "chave-da-plataforma" }, {}).map(([nome]) => nome);
    expect(ordem[0]).toBe("gemini-flash");
    expect(ordem).toContain("gemini-lite");
    // O lite continua na cascata, como queda imediata — só deixou de liderar.
    expect(ordem.indexOf("gemini-flash")).toBeLessThan(ordem.indexOf("gemini-lite"));
  });
});

describe("isolamento entre espaços", () => {
  it("a vizinha não enxerga a chave da dona", async () => {
    const resposta = await worker.fetch(
      new Request("https://app.test/api/ai-keys", { headers: { authorization: `Bearer ${tokenVizinha}`, "cf-connecting-ip": "203.0.114.13" } }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    const dados = await resposta.json();
    const claude = dados.provedores.find((item) => item.id === "anthropic");
    expect(claude.minha).toBeNull();
    expect(await chavesDoEspaco(ambiente(), "ia-vizinha")).toEqual({});
  });

  it("pedir o espaço da outra pela query string é recusado", async () => {
    const resposta = await worker.fetch(
      new Request("https://app.test/api/ai-keys?owner=ia-dona", { headers: { authorization: `Bearer ${tokenVizinha}`, "cf-connecting-ip": "203.0.114.14" } }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    expect(resposta.status).toBe(403);
  });
});

describe("remover", () => {
  it("apaga a linha e o espaço volta a usar a chave da plataforma", async () => {
    const resposta = await worker.fetch(
      new Request("https://app.test/api/ai-keys/anthropic", {
        method: "DELETE",
        headers: { authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.15" },
      }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    expect(resposta.status).toBe(200);
    expect(await chavesDoEspaco(ambiente(), "ia-dona")).toEqual({});
  });
});

// ===== A tela de Integrações enxerga a chave do espaço =====
//
// O que este teste impede de voltar: a titular cadastrar a chave dela, o
// Plantû responder usando essa chave, e a tela de Integrações dizer que o
// provedor está INATIVO — porque a conferência só olhava as chaves de busca do
// espaço e o cofre global, nunca as workspace_ai_keys.
describe("integrações mostram a IA do espaço como ativa", () => {
  it("depois de cadastrar a chave, o provedor aparece configurado na tela", async () => {
    const espiao = comProvedorRespondendo(true);
    try {
      const salvo = await worker.fetch(
        new Request("https://app.test/api/ai-keys/anthropic", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.61" },
          body: JSON.stringify({ chave: CHAVE_CLAUDE, rotulo: "Conta da diretoria" }),
        }),
        ambiente(), { waitUntil() {}, passThroughOnException() {} },
      );
      expect([200, 201, 409]).toContain(salvo.status);
    } finally {
      espiao.mockRestore();
    }

    // Vínculo com a vertical: a tela de Integrações é da To Do Green.
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_access_emails
         (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
       VALUES (?, 'todogreen', 'ia-dona', 'ia-dona@teste.test', 'admin', 'active', '["*"]', '', 'ia-dona', ?, ?)`,
    ).bind(crypto.randomUUID(), agora, agora).run();

    const resposta = await worker.fetch(
      new Request("https://app.test/api/todogreen/integrations", {
        headers: { authorization: `Bearer ${tokenDona}`, "cf-connecting-ip": "203.0.114.62" },
      }),
      ambiente(), { waitUntil() {}, passThroughOnException() {} },
    );
    expect(resposta.status).toBe(200);
    const status = await resposta.json();
    const claude = status.ai.find((item) => item.id === "anthropic");
    expect(claude).toBeTruthy();
    // A chave do espaço CONTA como configurada — é a mesma que o Plantû usa.
    expect(claude.configured).toBe(true);
    // E o segredo não vaza no payload da tela.
    expect(JSON.stringify(status)).not.toContain(CHAVE_CLAUDE);
  });
});
