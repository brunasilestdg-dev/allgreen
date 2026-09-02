import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consultarCepNormalizado,
  normalizarEnderecoCep,
  probeTodoGreenExternalIntegration,
  runTodoGreenExternalIntegration,
  todoGreenExternalIntegrationCatalog,
} from "../worker/services/todogreen-integration-gateway.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gateway seletivo de integrações da To Do Green", () => {
  it("mantém fontes públicas utilizáveis e self-hosted desligado sem servidor", () => {
    const catalog = todoGreenExternalIntegrationCatalog({});

    expect(catalog.registration.find((item) => item.id === "opencep")).toEqual(
      expect.objectContaining({ configured: true, mode: "public-free", canTest: true }),
    );
    expect(catalog.registration.find((item) => item.id === "ibge")).toEqual(
      expect.objectContaining({ configured: true, mode: "official-public" }),
    );
    expect(catalog.routing.find((item) => item.id === "osrm")).toEqual(
      expect.objectContaining({ configured: false, status: "requires_setup" }),
    );
  });

  it("aceita apenas URL http/https para serviços self-hosted", () => {
    const valid = todoGreenExternalIntegrationCatalog({
      TODOGREEN_OSRM_BASE_URL: "https://rotas.example.com/",
    });
    const invalid = todoGreenExternalIntegrationCatalog({
      TODOGREEN_OSRM_BASE_URL: "file:///etc/passwd",
    });

    expect(valid.routing.find((item) => item.id === "osrm")?.configured).toBe(true);
    expect(invalid.routing.find((item) => item.id === "osrm")?.configured).toBe(false);
  });

  it("consulta CEP pelo backend e rejeita CEP inválido", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cep: "01001000", cidade: "São Paulo" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTodoGreenExternalIntegration({}, "opencep", "cep", { cep: "01001-000" });
    expect(result.cep).toBe("01001000");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://opencep.com/v1/01001000");

    await expect(
      runTodoGreenExternalIntegration({}, "opencep", "cep", { cep: "123" }),
    ).rejects.toThrow("CEP inválido");
  });

  it("faz rota somente no host OSRM configurado pelo servidor", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await runTodoGreenExternalIntegration(
      { TODOGREEN_OSRM_BASE_URL: "https://rotas.example.com" },
      "osrm",
      "route",
      {
        points: [
          { latitude: -23.55, longitude: -46.63 },
          { latitude: -23.56, longitude: -46.65 },
        ],
      },
    );

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/rotas\.example\.com\/route\/v1\/driving\//,
    );
  });

  it("não libera Open Charge Map sem chave", async () => {
    const catalog = todoGreenExternalIntegrationCatalog({});
    expect(catalog.intelligence.find((item) => item.id === "open-charge-map")?.configured).toBe(false);

    await expect(
      runTodoGreenExternalIntegration({}, "open-charge-map", "nearby", {
        latitude: -23.55,
        longitude: -46.63,
      }),
    ).rejects.toThrow("OPENCHARGEMAP_API_KEY");
  });

  it("testa uma fonte pública sem exigir credencial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ cep: "01001000" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const result = await probeTodoGreenExternalIntegration({}, "opencep");
    expect(result).toEqual(expect.objectContaining({ provider: "opencep", ok: true, configured: true }));
  });

  it("normaliza CEP dos vários provedores para o mesmo formato", () => {
    // ViaCEP / OpenCEP
    expect(normalizarEnderecoCep({ cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "sp" }, "01001000"))
      .toEqual({ cep: "01001000", logradouro: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP" });
    // BrasilAPI (street/neighborhood/city/state)
    expect(normalizarEnderecoCep({ street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP" }, "01001000"))
      .toEqual({ cep: "01001000", logradouro: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP" });
    // Não encontrado (ViaCEP devolve { erro: true } com 200) e vazio
    expect(normalizarEnderecoCep({ erro: true }, "00000000")).toBeNull();
    expect(normalizarEnderecoCep({}, "00000000")).toBeNull();
  });

  it("consulta CEP com fallback: pula o provedor que falha e usa o próximo", async () => {
    const fetchMock = vi.fn(async (url) => {
      const alvo = String(url);
      if (alvo.includes("opencep.com")) throw new Error("timeout");
      if (alvo.includes("viacep.com.br"))
        return new Response(JSON.stringify({ logradouro: "Rua A", bairro: "Centro", localidade: "Curitiba", uf: "PR" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      throw new Error("não deveria chegar na BrasilAPI");
    });
    vi.stubGlobal("fetch", fetchMock);

    const endereco = await consultarCepNormalizado({}, "80010-000");
    expect(endereco).toEqual({ cep: "80010000", logradouro: "Rua A", bairro: "Centro", cidade: "Curitiba", uf: "PR" });
  });

  it("rejeita CEP inválido antes de qualquer rede", async () => {
    await expect(consultarCepNormalizado({}, "123")).rejects.toThrow("CEP inválido");
  });
});
