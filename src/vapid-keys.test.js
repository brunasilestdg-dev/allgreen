import { describe, expect, it } from "vitest";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { gerarChavesVapid } from "../scripts/gerar-chaves-vapid.mjs";

describe("gerador de chaves VAPID", () => {
  it("gera um par que a lib de Web Push do Worker aceita para assinar", async () => {
    const { publicKey, privateKey } = await gerarChavesVapid();
    // Ponto P-256 não comprimido: 65 bytes → 87 caracteres base64url.
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Assinatura do navegador de teste (mesma usada nos testes do resumo semanal).
    const subscription = {
      endpoint: "https://push.example.com/abc",
      expirationTime: null,
      keys: {
        p256dh: "BBcbXQS6JPMajokpCFSRDHm01L7XO7PDC0Z1bwAfyKFypdJHs7RutE_HYLqomJOc0FO0H1XOJN5kkSi_zlDXEhc",
        auth: "wXFF86sqhUHxDpvV2v6gBg",
      },
    };
    const payload = await buildPushPayload(
      { data: { title: "Teste", body: "ok" }, options: { ttl: 60 } },
      subscription,
      { subject: "mailto:teste@example.com", publicKey, privateKey },
    );
    expect(payload.headers.authorization).toMatch(/^WebPush /);
  });
});
