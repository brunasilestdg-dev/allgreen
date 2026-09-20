import { describe, expect, it } from "vitest";
import { TRACK3R_WEBHOOKS } from "../src/features/logistics/track3rWebhookDomain.js";
import {
  TRACK3R_WEBHOOK_TOKEN_KEYS,
  autenticarTokenWebhookTrack3r,
  estadoTokensWebhookTrack3r,
} from "../worker/services/todogreen-track3r-webhook-auth.js";

const integracao = { webhook_secret_env_key: "TODOGREEN_TRACK3R_WEBHOOK_SECRET" };
const LEGADO = "segredo-legado";

describe("tokens individuais dos 13 webhooks TRACK3R", () => {
  it("gera 13 chaves estáveis e distintas sem colocar valores nas URLs", () => {
    const chaves = TRACK3R_WEBHOOKS.map(([tipo]) => TRACK3R_WEBHOOK_TOKEN_KEYS[tipo]);
    expect(chaves).toHaveLength(13);
    expect(new Set(chaves).size).toBe(13);
    expect(chaves[0]).toBe("TODOGREEN_TRACK3R_TOKEN_OCORRENCIAS");
    expect(chaves.at(-1)).toBe("TODOGREEN_TRACK3R_TOKEN_LISTAS");
  });

  it("mantém o legado enquanto nenhum segredo individual foi cadastrado", () => {
    const env = { TODOGREEN_TRACK3R_WEBHOOK_SECRET: LEGADO };
    const modo = estadoTokensWebhookTrack3r(env, integracao);
    expect(modo).toMatchObject({ individual: false, configurados: 0, disponivel: true });
    expect(autenticarTokenWebhookTrack3r(env, integracao, "faturas", LEGADO).autorizado).toBe(true);
    expect(autenticarTokenWebhookTrack3r(env, integracao, "ocorrencias", "errado").autorizado).toBe(false);
  });

  it("um token individual desativa o fallback compartilhado para todos", () => {
    const env = {
      TODOGREEN_TRACK3R_WEBHOOK_SECRET: LEGADO,
      TODOGREEN_TRACK3R_TOKEN_OCORRENCIAS: "segredo-ocorrencias",
      TODOGREEN_TRACK3R_TOKEN_ENCOMENDAS: "segredo-encomendas",
    };
    expect(estadoTokensWebhookTrack3r(env, integracao))
      .toMatchObject({ individual: true, configurados: 2, disponivel: true });
    expect(autenticarTokenWebhookTrack3r(env, integracao, "ocorrencias",
      "segredo-ocorrencias").autorizado).toBe(true);
    expect(autenticarTokenWebhookTrack3r(env, integracao, "encomendas",
      "segredo-ocorrencias").autorizado).toBe(false);
    expect(autenticarTokenWebhookTrack3r(env, integracao, "encomendas", LEGADO).autorizado).toBe(false);
    expect(autenticarTokenWebhookTrack3r(env, integracao, "faturas", LEGADO))
      .toMatchObject({ configurado: false, autorizado: false });
  });

  it("falha fechada quando dois tipos têm o mesmo valor de token", () => {
    const env = {
      TODOGREEN_TRACK3R_TOKEN_OCORRENCIAS: "mesmo-valor",
      TODOGREEN_TRACK3R_TOKEN_ENCOMENDAS: "mesmo-valor",
    };
    expect(autenticarTokenWebhookTrack3r(env, integracao, "ocorrencias", "mesmo-valor"))
      .toMatchObject({ configurado: false, autorizado: false });
    expect(autenticarTokenWebhookTrack3r(env, integracao, "encomendas", "mesmo-valor"))
      .toMatchObject({ configurado: false, autorizado: false });
  });
});
