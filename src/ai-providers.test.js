import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askOpenAICompatible,
  configuredAiProviders,
  publicAiResult,
} from "../worker.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rede gratuita de IA", () => {
  it("nunca expõe ao aplicativo qual infraestrutura respondeu", () => {
    const result = publicAiResult({
      content: "Resposta útil",
      degraded: false,
      provider: "Provedor interno",
      model: "modelo-interno",
      providerFailures: ["detalhe privado"],
      routingMode: "deep",
    });

    expect(result).toEqual({ content: "Resposta útil", degraded: false });
    expect(JSON.stringify(result)).not.toMatch(
      /provider|model|failure|routing|Provedor interno|modelo-interno/i,
    );
  });

  it("informa somente o estado de configuração e nunca expõe chaves", () => {
    const providers = configuredAiProviders({
      AI: { run: vi.fn() },
      GROQ_API_KEY: "segredo-groq",
      SAMBANOVA_API_KEY: "segredo-samba",
    });

    // Contar provedores travava o catálogo: incluir Claude e ChatGPT (0072,
    // "traga sua própria chave") quebrava o teste sem que nada de errado
    // tivesse acontecido. O que precisa ser verdade é que o catálogo cubra os
    // provedores e não vaze chave — não que tenha um tamanho específico.
    expect(providers.map((item) => item.id)).toEqual(
      expect.arrayContaining(["anthropic", "openai", "google", "cloudflare", "groq", "sambanova"]),
    );
    expect(providers.find((item) => item.id === "cloudflare")?.configured).toBe(
      true,
    );
    // Provedor sem chave configurada aparece na lista, mas como não configurado.
    expect(providers.find((item) => item.id === "anthropic")?.configured).toBe(false);
    expect(providers.find((item) => item.id === "groq")?.configured).toBe(true);
    expect(
      providers.find((item) => item.id === "sambanova")?.configured,
    ).toBe(true);
    expect(JSON.stringify(providers)).not.toContain("segredo-groq");
    expect(JSON.stringify(providers)).not.toContain("segredo-samba");
    expect(providers.every((item) => !("key" in item))).toBe(true);
  });

  it("conversa com APIs compatíveis sem enviar a chave no corpo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "modelo-respondente",
          choices: [{ message: { content: "Resposta útil" } }],
          usage: { total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await askOpenAICompatible({
      endpoint: "https://ia.exemplo.test/v1/chat/completions",
      token: "segredo",
      model: "modelo-grátis",
      provider: "Provedor teste",
      prompt: "Ajude a empresa",
      system: "Seja objetivo",
    });

    expect(result).toMatchObject({
      content: "Resposta útil",
      provider: "Provedor teste",
      model: "modelo-respondente",
    });
    const request = fetchMock.mock.calls[0][1];
    expect(request.headers.authorization).toBe("Bearer segredo");
    expect(request.body).not.toContain("segredo");
  });

  it("transforma falha remota em erro seguro e identificável", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("limite", { status: 429 }),
    );

    await expect(
      askOpenAICompatible({
        endpoint: "https://ia.exemplo.test/v1/chat/completions",
        token: "segredo",
        model: "modelo",
        provider: "Provedor teste",
        prompt: "Olá",
        system: "Ajude",
      }),
    ).rejects.toThrow("Provedor teste indisponível (429)");
  });
});

describe("IA local auto-hospedada na cascata", () => {
  it("só liga Ollama/vLLM com endereço E modelo, e aparece no catálogo", async () => {
    const { providerChain } = await import("../worker/services/ai.js");
    const nomes = (env) => providerChain(env).map(([nome]) => nome);
    expect(nomes({ TODOGREEN_OLLAMA_BASE_URL: "https://ia.empresa.test" })).not.toContain("ollama");
    expect(nomes({ TODOGREEN_VLLM_MODEL: "qwen3" })).not.toContain("vllm");
    expect(nomes({ TODOGREEN_OLLAMA_BASE_URL: "ftp://ia.empresa.test", TODOGREEN_OLLAMA_MODEL: "llama3.2" })).not.toContain("ollama");

    const env = {
      AI: { run: vi.fn() },
      TODOGREEN_OLLAMA_BASE_URL: "https://ia.empresa.test/",
      TODOGREEN_OLLAMA_MODEL: "llama3.2",
      TODOGREEN_VLLM_BASE_URL: "https://vllm.empresa.test",
      TODOGREEN_VLLM_MODEL: "qwen3-8b",
    };
    const ordem = nomes(env);
    expect(ordem).toEqual(expect.arrayContaining(["ollama", "vllm"]));
    // Antes do menor modelo da Cloudflare, que é a última rede gratuita.
    expect(ordem.indexOf("ollama")).toBeLessThan(ordem.indexOf("llama"));

    const catalogo = configuredAiProviders(env);
    expect(catalogo.find((item) => item.id === "ollama")?.configured).toBe(true);
    expect(catalogo.find((item) => item.id === "vllm")?.configured).toBe(true);
    expect(configuredAiProviders({}).find((item) => item.id === "ollama")?.configured).toBe(false);
  });

  it("chama o endpoint compatível com a OpenAI do servidor da empresa", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Oi do servidor local" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { providerChain } = await import("../worker/services/ai.js");
    const env = {
      TODOGREEN_OLLAMA_BASE_URL: "https://ia.empresa.test/",
      TODOGREEN_OLLAMA_MODEL: "llama3.2",
    };
    const [, run] = providerChain(env, { preferredProvider: "ollama" }).find(([nome]) => nome === "ollama");
    const resposta = await run("Olá", "Seja breve");
    expect(resposta).toMatchObject({ content: "Oi do servidor local", provider: "IA local (Ollama)" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://ia.empresa.test/v1/chat/completions");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("llama3.2");
  });
});

describe("rota sensível (LGPD)", () => {
  const envCompleto = {
    AI: { run: vi.fn() },
    GEMINI_API_KEY: "g",
    GROQ_API_KEY: "q",
    CEREBRAS_API_KEY: "c",
    SAMBANOVA_API_KEY: "s",
    MISTRAL_API_KEY: "m",
    OPENROUTER_API_KEY: "o",
    HF_TOKEN: "h",
    XAI_API_KEY: "x",
  };

  it("reconhece dado pessoal sensível, mas não trata CNPJ de empresa como sensível", async () => {
    const { pedidoSensivel } = await import("../worker/services/ai.js");
    expect(pedidoSensivel("O CPF do motorista é 529.982.247-25")).toBe(true);
    expect(pedidoSensivel("cartão 4111 1111 1111 1111")).toBe(true);
    expect(pedidoSensivel("qual é a senha do portal?")).toBe(true);
    expect(pedidoSensivel("o laudo do colaborador saiu")).toBe(true);
    expect(pedidoSensivel("atestado médico com CID F32")).toBe(true);
    expect(pedidoSensivel("histórico de doenças do motorista")).toBe(true);
    // "Diagnóstico" é palavra de negócio aqui; sozinho não desvia o pedido.
    expect(pedidoSensivel("Faça um diagnóstico financeiro da operação")).toBe(false);
    expect(pedidoSensivel("Proposta para o cliente CNPJ 11.222.333/0001-81")).toBe(false);
    expect(pedidoSensivel("Monte um plano de vendas para o trimestre")).toBe(false);
  });

  it("tira da cascata quem treina com o conteúdo ou depende do provedor final", async () => {
    const { providerChain } = await import("../worker/services/ai.js");
    const nomes = providerChain(envCompleto, { sensitive: true, confirmPaid: true }).map(([nome]) => nome);
    for (const fora of ["gemini-flash", "gemini-lite", "gemma", "mistral", "openrouter", "huggingface", "xai"])
      expect(nomes).not.toContain(fora);
    expect(nomes).toEqual(expect.arrayContaining(["cerebras", "groq", "gpt-oss", "sambanova"]));
    // Preferência de provedor não reintroduz quem saiu.
    const preferido = providerChain(envCompleto, { sensitive: true, preferredProvider: "gemini-flash" });
    expect(preferido.map(([nome]) => nome)).not.toContain("gemini-flash");
    // Fora da rota sensível, nada muda: o Gemini continua liderando.
    expect(providerChain(envCompleto)[0][0]).toBe("gemini-flash");
  });

  it("um pedido com CPF nunca chega ao Gemini gratuito, mesmo com a chave cadastrada", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { runWithFallback } = await import("../worker/services/ai.js");
    const resposta = await runWithFallback(envCompleto, {
      prompt: "Confira o cadastro: CPF 529.982.247-25",
      system: "Ajude o RH",
    });
    expect(resposta.ok).toBe(true);
    const destinos = fetchMock.mock.calls.map(([url]) => String(url));
    expect(destinos.some((url) => url.includes("generativelanguage.googleapis.com"))).toBe(false);
    expect(destinos[0]).toContain("api.cerebras.ai");
  });
});
