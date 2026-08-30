import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";
import { chavesDeBuscaDoEspaco } from "../worker/services/search-keys.js";

// "eu quero ilimitado" — a titular quer ligar a busca da pesquisa de empresa
// sem terminal. As mesmas três perguntas do "traga sua própria chave" valem
// aqui:
//
// 1. O segredo (token/chave) volta para a tela? (não pode)
// 2. A URL do SearXNG que o espaço cadastrou entra na cascata? (precisa)
// 3. Um espaço alcança a configuração de outro? (não pode)

const sha256 = async (valor) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

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

const ambiente = () => ({ ...env, WORKSPACE_AI_VAULT_KEY: "chave-de-teste-com-mais-de-32-caracteres-ok" });

const SEARXNG_URL = "https://searx.teste.app/";
const TOKEN = "token-secreto-do-searxng";
const CHAVE_SERPER = "serper-chave-secreta-do-espaco";

let n = 0;
const cabecalhoIp = () => `203.0.117.${(++n % 240) + 1}`;

let tokenDona;
let tokenVizinha;

beforeAll(async () => {
  tokenDona = await criarConta("busca-dona", "busca-dona@teste.test");
  tokenVizinha = await criarConta("busca-vizinha", "busca-vizinha@teste.test");
});

// O teste de conexão exercita a busca de verdade. Aqui a rede é interceptada:
// a suíte não depende de instância nenhuma no ar.
const comBuscaRespondendo = ({ searxng = true, serper = true } = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const alvo = String(entrada?.url || entrada);
    if (alvo.includes("searx.teste.app"))
      return searxng
        ? new Response(JSON.stringify({ results: [{ title: "Transportadora X", url: "https://x.com.br", content: "frete e logística" }] }), { status: 200 })
        : new Response("<html>json desligado</html>", { status: 200, headers: { "content-type": "text/html" } });
    if (alvo.includes("google.serper.dev"))
      return serper
        ? new Response(JSON.stringify({ organic: [{ title: "Notícia de frete", link: "https://noticia.com.br", snippet: "logística no Brasil" }] }), { status: 200 })
        : new Response(JSON.stringify({ message: "unauthorized" }), { status: 403 });
    throw new Error(`fetch inesperado para ${alvo}`);
  });

const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test/api/search-keys${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": cabecalhoIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), ambiente(), { waitUntil() {}, passThroughOnException() {} });

describe("apontar a própria instância de SearXNG", () => {
  it("guarda a URL, cifra o token e nunca devolve o token para a tela", async () => {
    const espiao = comBuscaRespondendo({ searxng: true });
    try {
      const salvo = await pedir("/searxng", { method: "POST", token: tokenDona, body: { url: SEARXNG_URL, token: TOKEN } });
      expect(salvo.status).toBe(201);
      expect((await salvo.json()).testeOk).toBe(true);
    } finally {
      espiao.mockRestore();
    }

    // No banco: a URL em claro (não é segredo), o token cifrado (não aparece).
    const linha = await env.DB.prepare(
      "SELECT * FROM workspace_search_keys WHERE workspace_owner_id='busca-dona' AND provider='searxng'",
    ).first();
    expect(linha.base_url).toBe(SEARXNG_URL);
    expect(JSON.stringify(linha)).not.toContain(TOKEN);

    // Na tela: a URL volta, o token não.
    const listagem = await pedir("", { token: tokenDona });
    const corpo = await listagem.text();
    expect(corpo).toContain("searx.teste.app");
    expect(corpo).not.toContain(TOKEN);
  });

  it("a URL cadastrada entra na cascata como SEARXNG_BASE_URL", async () => {
    const chaves = await chavesDeBuscaDoEspaco(ambiente(), "busca-dona");
    expect(chaves.SEARXNG_BASE_URL).toBe(SEARXNG_URL);
    expect(chaves.SEARXNG_TOKEN).toBe(TOKEN);
  });

  it("instância com JSON desligado é recusada com a dica de correção", async () => {
    const espiao = comBuscaRespondendo({ searxng: false });
    try {
      const resposta = await pedir("/searxng", { method: "POST", token: tokenVizinha, body: { url: SEARXNG_URL } });
      expect(resposta.status).toBe(400);
      const dados = await resposta.json();
      expect(dados.podeSalvarMesmoAssim).toBe(true);
      expect(String(dados.detalhe)).toMatch(/json/i);
    } finally {
      espiao.mockRestore();
    }
  });
});

describe("chave de provedor como reserva", () => {
  it("guarda cifrada e a coloca na cascata pelo nome da variável", async () => {
    const espiao = comBuscaRespondendo({ serper: true });
    try {
      const salvo = await pedir("/serper", { method: "POST", token: tokenDona, body: { chave: CHAVE_SERPER } });
      expect(salvo.status).toBe(201);
    } finally {
      espiao.mockRestore();
    }
    const chaves = await chavesDeBuscaDoEspaco(ambiente(), "busca-dona");
    expect(chaves.SERPER_API_KEY).toBe(CHAVE_SERPER);
  });
});

describe("isolamento entre espaços", () => {
  it("a vizinha não enxerga a configuração da dona", async () => {
    const resposta = await pedir("", { token: tokenVizinha });
    const dados = await resposta.json();
    const searxng = dados.provedores.find((item) => item.id === "searxng");
    expect(searxng.minha).toBeNull();
    expect(await chavesDeBuscaDoEspaco(ambiente(), "busca-vizinha")).toEqual({});
  });

  it("pedir o espaço da outra pela query string é recusado", async () => {
    const resposta = await pedir("?owner=busca-dona", { token: tokenVizinha });
    expect(resposta.status).toBe(403);
  });
});

describe("remover", () => {
  it("apaga a linha e o espaço volta ao que houver no servidor", async () => {
    const resposta = await pedir("/searxng", { method: "DELETE", token: tokenDona });
    expect(resposta.status).toBe(200);
    const chaves = await chavesDeBuscaDoEspaco(ambiente(), "busca-dona");
    expect(chaves.SEARXNG_BASE_URL).toBeUndefined();
  });
});
