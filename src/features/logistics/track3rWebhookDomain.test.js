import { describe, expect, it } from "vitest";
import { TRACK3R_WEBHOOKS, montarKitWebhookTrack3r } from "./track3rWebhookDomain.js";

describe("kit de webhooks TRACK3R", () => {
  it("gera os 13 endpoints oficiais sem token na URL", () => {
    const kit = montarKitWebhookTrack3r({
      origin: "https://orianone.app/",
      integrationId: "int-track3r-1",
    });
    expect(TRACK3R_WEBHOOKS).toHaveLength(13);
    expect(kit.endpoints).toHaveLength(13);
    expect(kit.method).toBe("POST");
    expect(kit.authHeader).toBe("Token");
    expect(kit.endpoints[0].url).toBe(
      "https://orianone.app/api/todogreen/tms/webhook/int-track3r-1/ocorrencias",
    );
    expect(kit.endpoints.at(-1).url).toBe(
      "https://orianone.app/api/todogreen/tms/webhook/int-track3r-1/listas",
    );
    expect(JSON.stringify(kit)).not.toMatch(/secret|apiKey|token=/i);
  });

  it("não inventa URL sem integração real", () => {
    expect(montarKitWebhookTrack3r({ origin: "https://orianone.app", integrationId: "" })).toBeNull();
  });
});
