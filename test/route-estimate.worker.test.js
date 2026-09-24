import { describe, expect, it } from "vitest";
import { ATRIBUICAO_ROTA, handleRouteEstimate } from "../worker/services/route-estimate.js";

const post = (body) =>
  new Request("https://app.test/api/rotas/estimativa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const resposta = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("estimativa de rota do Roteirizador", () => {
  it("sem chave do Geoapify, manda abrir no Maps em vez de usar serviço público proibido", async () => {
    const chamadas = [];
    const res = await handleRouteEstimate(post({ stops: ["Recife", "Olinda"] }), {}, {
      fetcher: async (url) => {
        chamadas.push(String(url));
        return resposta({});
      },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ semProvedor: true });
    expect(chamadas).toEqual([]);
  });

  it("recusa pedido sem origem e destino", async () => {
    const res = await handleRouteEstimate(post({ stops: ["só uma"] }), { GEOAPIFY_API_KEY: "k" });
    expect(res.status).toBe(400);
  });

  it("geocodifica e roteia só pelo Geoapify, com a chave no servidor", async () => {
    const chamadas = [];
    const fetcher = async (url) => {
      const alvo = String(url);
      chamadas.push(alvo);
      if (alvo.includes("/geocode/search"))
        return resposta({ results: [{ lat: -8.05, lon: -34.9, formatted: "Recife, PE" }] });
      if (alvo.includes("/routing"))
        return resposta({
          features: [
            {
              properties: { distance: 7200, time: 900, legs: [] },
              geometry: { type: "LineString", coordinates: [[-34.9, -8.05], [-34.85, -8.01]] },
            },
          ],
        });
      return resposta({}, 404);
    };
    const res = await handleRouteEstimate(post({ stops: ["Recife", "Olinda"] }), { GEOAPIFY_API_KEY: "k" }, { fetcher });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ distanceMeters: 7200, durationSeconds: 900, attribution: ATRIBUICAO_ROTA });
    expect(chamadas.every((url) => url.includes("api.geoapify.com"))).toBe(true);
    expect(chamadas.some((url) => /nominatim|project-osrm/.test(url))).toBe(false);
  });

  it("diz qual endereço não foi encontrado", async () => {
    const fetcher = async () => resposta({ results: [] });
    const res = await handleRouteEstimate(post({ stops: ["Lugar Inexistente 123", "Olinda"] }), { GEOAPIFY_API_KEY: "k" }, { fetcher });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Lugar Inexistente/);
  });
});
