import { describe, expect, it } from "vitest";
import { BRASIL_BBOX, photonSuggestionLabels } from "./domain.js";

describe("sugestões de endereço do Photon", () => {
  it("monta rótulos legíveis, sem repetir partes nem sugestões", () => {
    const data = {
      features: [
        { properties: { name: "Avenida Paulista", street: "Avenida Paulista", housenumber: "1000", district: "Bela Vista", city: "São Paulo", state: "São Paulo" } },
        { properties: { name: "Mercado Municipal", street: "Rua da Cantareira", housenumber: "306", city: "São Paulo", state: "São Paulo" } },
        { properties: { name: "Avenida Paulista", street: "Avenida Paulista", housenumber: "1000", district: "Bela Vista", city: "São Paulo", state: "São Paulo" } },
        { properties: {} },
      ],
    };
    expect(photonSuggestionLabels(data)).toEqual([
      "Avenida Paulista, 1000, Bela Vista, São Paulo",
      "Mercado Municipal, Rua da Cantareira, 306, São Paulo",
    ]);
  });

  it("respeita o limite e tolera resposta vazia ou inválida", () => {
    const muitos = { features: Array.from({ length: 9 }, (_, i) => ({ properties: { name: `Rua ${i}`, city: "Recife" } })) };
    expect(photonSuggestionLabels(muitos)).toHaveLength(4);
    expect(photonSuggestionLabels(null)).toEqual([]);
    expect(photonSuggestionLabels({ features: "x" })).toEqual([]);
  });

  it("recorta a busca pelo território brasileiro", () => {
    const [oeste, sul, leste, norte] = BRASIL_BBOX.split(",").map(Number);
    expect(oeste).toBeLessThan(leste);
    expect(sul).toBeLessThan(norte);
    // São Paulo e Manaus dentro da caixa.
    for (const [lon, lat] of [[-46.63, -23.55], [-60.02, -3.1]]) {
      expect(lon > oeste && lon < leste && lat > sul && lat < norte).toBe(true);
    }
  });
});
