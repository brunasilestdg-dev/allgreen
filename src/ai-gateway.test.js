import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cabecalhosDoGateway,
  fetchPeloGateway,
  gatewayConfig,
  opcoesDoWorkersAi,
  reiniciarDisjuntoresDoGateway,
  rodarWorkersAi,
  statusDoGateway,
} from "../worker/services/ai-gateway.js";

const CONTA = "0123456789abcdef0123456789abcdef";

// Binding falso: `gateway(id).getUrl(provedor)` como o de verdade, que já sabe
// o ID da conta.
const bindingDeIa = (run = vi.fn(async () => ({ response: "ok" }))) => ({
  run,
  gateway: (id) => ({
    getUrl: async (provedor) => `https://gateway.ai.cloudflare.com/v1/${CONTA}/${id}/${provedor}`,
  }),
});

const okJson = (dados) =>
  new Response(JSON.stringify(dados), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => reiniciarDisjuntoresDoGateway());
afterEach(() => vi.restoreAllMocks());

describe("AI Gateway: configuração", () => {
  it("só liga com um ID válido e nunca expõe token no status", () => {
    expect(gatewayConfig({})).toBeNull();
    expect(gatewayConfig({ AI_GATEWAY_ID: "nome com espaço" })).toBeNull();
    expect(gatewayConfig({ AI_GATEWAY_ID: "default" })).toEqual({ id: "default", token: "" });
    const status = statusDoGateway({ AI_GATEWAY_ID: "default", AI_GATEWAY_TOKEN: "segredo-do-gateway" });
    expect(status).toEqual({ configured: true, provedoresExternos: true });
    expect(JSON.stringify(status)).not.toContain("segredo");
  });

  it("Workers AI vai sem log (o conteúdo nunca fica guardado) e o sensível sem cache", () => {
    const env = { AI_GATEWAY_ID: "default" };
    expect(opcoesDoWorkersAi({})).toEqual({});
    expect(opcoesDoWorkersAi(env).gateway).toMatchObject({ id: "default", collectLog: false });
    expect(opcoesDoWorkersAi(env).gateway.skipCache).toBeUndefined();
    expect(opcoesDoWorkersAi(env, { sensivel: true }).gateway).toMatchObject({ skipCache: true, collectLog: false });
    expect(opcoesDoWorkersAi(env, { cacheTtl: 300 }).gateway.cacheTtl).toBe(300);
    // Abaixo do mínimo do gateway (60 s) não liga cache.
    expect(opcoesDoWorkersAi(env, { cacheTtl: 10 }).gateway.cacheTtl).toBeUndefined();
  });

  it("chamada por URL guarda só metadados, bloqueia cobrança sem chave e protege o sensível", () => {
    const env = { AI_GATEWAY_ID: "default", AI_GATEWAY_TOKEN: "tok" };
    expect(cabecalhosDoGateway({ AI_GATEWAY_ID: "default" })).toEqual({});
    const comum = cabecalhosDoGateway(env);
    expect(comum).toMatchObject({
      "cf-aig-authorization": "Bearer tok",
      "cf-aig-collect-log-payload": "false",
      "cf-aig-no-wholesale": "true",
    });
    expect(comum["cf-aig-skip-cache"]).toBeUndefined();
    expect(JSON.parse(comum["cf-aig-metadata"])).toEqual({ app: "allgreen", rota: "padrao" });
    const sensivel = cabecalhosDoGateway(env, { sensivel: true });
    expect(sensivel).toMatchObject({ "cf-aig-collect-log": "false", "cf-aig-skip-cache": "true" });
  });
});

describe("AI Gateway: roteamento com contingência", () => {
  const env = () => ({ AI_GATEWAY_ID: "allgreen", AI_GATEWAY_TOKEN: "tok", AI: bindingDeIa() });
  const init = { method: "POST", headers: { authorization: "Bearer chave-do-provedor" }, body: "{}" };
  const rota = { provedor: "groq", caminho: "/chat/completions" };

  it("sem token, a chamada por URL vai direto ao provedor (binding não autentica URL)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ ok: true }));
    await fetchPeloGateway({ AI_GATEWAY_ID: "allgreen", AI: bindingDeIa() }, rota, "https://api.groq.com/openai/v1/chat/completions", init);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("com token, passa pelo gateway levando a chave do provedor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ ok: true }));
    await fetchPeloGateway(env(), rota, "https://api.groq.com/openai/v1/chat/completions", init);
    const [url, enviado] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://gateway.ai.cloudflare.com/v1/${CONTA}/allgreen/groq/chat/completions`);
    expect(enviado.headers.authorization).toBe("Bearer chave-do-provedor");
    expect(enviado.headers["cf-aig-authorization"]).toBe("Bearer tok");
  });

  it("falha do próprio gateway cai para o provedor direto e pausa o gateway", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ code: 2009, message: "Unauthorized" }] }), { status: 401 }),
      )
      .mockResolvedValue(okJson({ ok: true }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const direto = "https://api.groq.com/openai/v1/chat/completions";
    const resposta = await fetchPeloGateway(env(), rota, direto, init);
    expect(resposta.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toBe(direto);
    // Pausado: o próximo pedido nem tenta o gateway.
    await fetchPeloGateway(env(), rota, direto, init);
    expect(String(fetchMock.mock.calls[2][0])).toBe(direto);
  });

  it("erro do provedor (cota, no formato dele) segue para a cascata sem repetir", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 }));
    const resposta = await fetchPeloGateway(env(), rota, "https://api.groq.com/openai/v1/chat/completions", init);
    expect(resposta.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Workers AI: passa o gateway ao binding e repete sem ele se o gateway falhar", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("AiError: gateway not found"))
      .mockResolvedValue({ response: "ok" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ambiente = { AI_GATEWAY_ID: "allgreen", AI: bindingDeIa(run) };
    const resultado = await rodarWorkersAi(ambiente, "@cf/meta/llama-3.2-3b-instruct", { prompt: "oi" });
    expect(resultado).toEqual({ response: "ok" });
    expect(run.mock.calls[0][2]).toMatchObject({ gateway: { id: "allgreen", collectLog: false } });
    expect(run.mock.calls[1]).toHaveLength(2);
  });

  it("cota diária de neurons não é culpa do gateway: o erro segue", async () => {
    const run = vi.fn().mockRejectedValue(new Error("3036: You have used up your daily free allocation of 10,000 neurons"));
    const ambiente = { AI_GATEWAY_ID: "allgreen", AI: bindingDeIa(run) };
    await expect(rodarWorkersAi(ambiente, "@cf/x", {})).rejects.toThrow(/3036/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("AI Gateway na cascata", () => {
  it("Groq pelo gateway quando ligado; pedido sensível sem log nem cache", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okJson({ choices: [{ message: { content: "ok" } }] }));
    const { runWithFallback } = await import("../worker/services/ai.js");
    const env = {
      GROQ_API_KEY: "chave-groq",
      AI_GATEWAY_ID: "allgreen",
      AI_GATEWAY_TOKEN: "tok",
      AI: bindingDeIa(),
    };
    const resposta = await runWithFallback(env, {
      prompt: "Confira o cadastro: CPF 529.982.247-25",
      system: "Ajude o RH",
    });
    expect(resposta.ok).toBe(true);
    const [url, enviado] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://gateway.ai.cloudflare.com/v1/${CONTA}/allgreen/groq/chat/completions`);
    expect(enviado.headers).toMatchObject({
      authorization: "Bearer chave-groq",
      "cf-aig-collect-log": "false",
      "cf-aig-skip-cache": "true",
    });
    expect(JSON.parse(enviado.headers["cf-aig-metadata"]).rota).toBe("sensivel");
  });

  it("sem AI_GATEWAY_ID, nada muda: o provedor é chamado direto", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okJson({ choices: [{ message: { content: "ok" } }] }));
    const { runWithFallback } = await import("../worker/services/ai.js");
    await runWithFallback({ GROQ_API_KEY: "chave-groq" }, { prompt: "Plano de vendas", system: "s" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers["cf-aig-authorization"]).toBeUndefined();
  });
});
