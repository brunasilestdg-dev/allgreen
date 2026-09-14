import { describe, expect, it, vi } from "vitest";
import { handleTodoGreenIntegrations, todoGreenIntegrationStatus } from "../../../worker/services/todogreen-integrations.js";

describe("integrações da vertical", () => {
  it("mostra prontidão por conector sem expor credenciais", () => {
    const status = todoGreenIntegrationStatus({
      AI: { run: vi.fn() },
      DB: { prepare: vi.fn() },
      GROQ_API_KEY: "segredo-groq",
      SEARXNG_BASE_URL: "https://busca.example.com",
      EVOLUTION_API_BASE_URL: "https://whatsapp.example.com/",
      EVOLUTION_API_KEY: "segredo-evolution",
      EVOLUTION_INSTANCE: "todo-green",
      NFE_CERT_PFX: "certificado-secreto",
      NFE_CERT_PASSWORD: "senha-certificado",
      SEFAZ_CONNECTOR_URL: "https://sefaz.example.com/transmitir",
    });

    expect(status.ai.find((item) => item.id === "cloudflare")?.configured).toBe(true);
    expect(status.ai.find((item) => item.id === "groq")?.configured).toBe(true);
    expect(status.search.providers.find((item) => item.id === "searxng")?.configured).toBe(true);
    expect(status.automationEngine).toEqual(expect.objectContaining({
      id: "cloudflare-native",
      configured: true,
      status: "connected",
      requiresExternalServer: false,
    }));
    expect(status.automation.every((item) => item.status === "connected")).toBe(true);
    expect(status.messaging).toEqual([
      expect.objectContaining({ id: "evolution-api", configured: true, status: "configured" }),
    ]);

    expect(status.operational).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "track3r", status: "requires_setup" }),
      expect.objectContaining({ id: "sistemas-tracker", status: "requires_setup" }),
      expect.objectContaining({ id: "sefaz-fiscal", configured: true, status: "configured" }),
      expect.objectContaining({ id: "antt-ciot-direct" }),
      expect.objectContaining({ id: "ocpp", status: "external_dependency" }),
    ]));
    expect(status.management).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "monday", status: "external_dependency" }),
      expect.objectContaining({ id: "power-bi", status: "external_dependency" }),
    ]));
    expect(status.market).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "linkedin", status: "external_dependency" }),
      expect.objectContaining({ id: "web-search", canTest: true }),
    ]));
    expect(status.communication).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "microsoft-365", status: "external_dependency" }),
      expect.objectContaining({ id: "google-workspace-actions", status: "external_dependency" }),
    ]));

    expect(JSON.stringify(status)).not.toMatch(/n8n|node-red|activepieces|windmill|temporal|airflow|kestra|huginn/i);
    expect(JSON.stringify(status)).not.toContain("segredo-groq");
    expect(JSON.stringify(status)).not.toContain("segredo-evolution");
    expect(JSON.stringify(status)).not.toContain("certificado-secreto");
    expect(JSON.stringify(status)).not.toContain("senha-certificado");
  });

  it("SEFAZ com certificado mas SEM conector não conta como configurada", () => {
    // A honestidade do módulo: só o certificado não transmite (falta o conector
    // que assina e faz o mTLS). A régua não pode dizer "configurada".
    const status = todoGreenIntegrationStatus({
      DB: { prepare: vi.fn() },
      // Valores de teste (não são segredos): a régua só checa presença.
      NFE_CERT_PFX: "x",
      NFE_CERT_PASSWORD: "x",
    });
    const sefaz = status.operational.find((item) => item.id === "sefaz-fiscal");
    expect(sefaz.configured).toBe(false);
    expect(sefaz.status).toBe("external_dependency");
  });

  it("recusa teste de provedor sem permissão de integração", async () => {
    const response = await handleTodoGreenIntegrations(
      new Request("https://example.com/api/todogreen/integrations", { method: "POST", body: "{}" }),
      {},
      { role: "auditor", permissions: ["read"] },
    );
    expect(response.status).toBe(403);
  });
});
