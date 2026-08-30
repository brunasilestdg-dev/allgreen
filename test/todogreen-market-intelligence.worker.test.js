import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMarketResearchPlans,
  handleTodoGreenMarketIntelligence,
} from "../worker/services/todogreen-market-intelligence.js";

const access = (ownerId, permissions = ["read", "market:read", "market:research"]) => ({
  ownerId, role: "marketing", permissions,
});
const user = { id: "market-user", email: "mercado@todogreen.test", name: "Mercado" };
const call = (ownerId, path = "", init = {}, permissions) => handleTodoGreenMarketIntelligence(
  new Request(`https://app.test/api/todogreen/market-intelligence${path}`, init),
  { ...env, SERPER_API_KEY: "serper-test" },
  access(ownerId, permissions),
  user,
);

afterEach(() => vi.unstubAllGlobals());

describe("inteligência de mercado fora da carteira", () => {
  it("monta planos gerais de RFQ e notícia sem exigir cliente no CRM", () => {
    const plans = buildMarketResearchPlans({ kind: "all", year: 2026 });
    expect(plans.some((item) => item.kind === "rfq")).toBe(true);
    expect(plans.some((item) => item.kind === "news")).toBe(true);
    expect(plans.some((item) => item.kind === "decisors")).toBe(false);
    expect(plans.filter((item) => item.kind === "rfq").every((item) => item.query.includes("-bitrem"))).toBe(true);
    expect(plans.some((item) => item.kind === "rfq" && item.query.includes("elétrico"))).toBe(true);
  });

  it("pesquisa, preserva a fonte e isola os resultados por workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.headers["x-api-key"]).toBe("serper-test");
      return new Response(JSON.stringify({
        organic: [{
          title: "Empresa abre novo centro de distribuição",
          link: "https://noticias.example/novo-cd",
          snippet: "Expansão logística anunciada para o Brasil.",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const created = await call("market-space-a", "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "news" }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).resultCount).toBe(1);

    const own = await (await call("market-space-a")).json();
    expect(own.items).toHaveLength(1);
    expect(own.items[0]).toMatchObject({
      kind: "news",
      title: "Empresa abre novo centro de distribuição",
      url: "https://noticias.example/novo-cd",
      provider: "Serper",
    });

    const neighbour = await (await call("market-space-b")).json();
    expect(neighbour.items).toHaveLength(0);
  });

  it("exige empresa para possíveis decisores e permissão para pesquisar", async () => {
    const missingCompany = await call("market-space-a", "", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "decisors" }),
    });
    expect(missingCompany.status).toBe(400);

    const readOnly = await call("market-space-a", "", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "news" }),
    }, ["read", "market:read"]);
    expect(readOnly.status).toBe(403);
  });
});
