import { describe, it, expect } from "vitest";
import {
  normalizarPracas,
  pracasNaRota,
  estimarTotalPedagios,
  kmEntrePontos,
} from "./pedagiosDomain.js";

describe("pedagiosDomain — praças de pedágio da rota (ANTT)", () => {
  it("normaliza só praças ativas com coordenada válida no Brasil", () => {
    const bruto = {
      "praca-de-pedagio": [
        { praca_de_pedagio: "P1", concessionaria: "X", rodovia: "BR-376", uf: "pr", km_m: "635.3", municipio: "São José dos Pinhais", situacao: "Ativo", latitude: "-25.7477", longitude: "-49.1296" },
        { praca_de_pedagio: "Inativa", situacao: "Inativo", latitude: "-25.0", longitude: "-49.0" },
        { praca_de_pedagio: "SemCoord", situacao: "Ativo", latitude: "", longitude: "" },
        { praca_de_pedagio: "ForaDoBrasil", situacao: "Ativo", latitude: "40.7", longitude: "-74.0" },
      ],
    };
    const pracas = normalizarPracas(bruto);
    expect(pracas).toHaveLength(1);
    expect(pracas[0]).toEqual({
      praca: "P1", concessionaria: "X", rodovia: "BR-376", uf: "PR",
      km: "635.3", municipio: "São José dos Pinhais", lat: -25.7477, lon: -49.1296,
    });
  });

  it("aceita a lista direta além do objeto do dataset", () => {
    expect(normalizarPracas([{ praca_de_pedagio: "A", situacao: "Ativo", latitude: "-23", longitude: "-46" }])).toHaveLength(1);
    expect(normalizarPracas(null)).toEqual([]);
  });

  it("casa praças a até 1,5 km da rota, deduplica e ordena pela viagem", () => {
    // Rota reta descendo em latitude (norte → sul) na mesma longitude.
    const polyline = [
      [-23.0, -46.0], [-23.5, -46.0], [-24.0, -46.0], [-24.5, -46.0], [-25.0, -46.0],
    ];
    const pracas = [
      { praca: "Sul", rodovia: "BR-1", km: "3", lat: -24.99, lon: -46.0 },   // perto do fim
      { praca: "Norte", rodovia: "BR-1", km: "1", lat: -23.01, lon: -46.0 }, // perto do começo
      { praca: "Longe", rodovia: "BR-2", km: "9", lat: -24.0, lon: -44.0 },  // ~200 km fora
      { praca: "Norte", rodovia: "BR-1", km: "1", lat: -23.01, lon: -46.0 }, // duplicata
    ];
    const achadas = pracasNaRota(pracas, polyline, 1.5);
    expect(achadas.map((p) => p.praca)).toEqual(["Norte", "Sul"]);
    expect(achadas.every((p) => !("ordem" in p))).toBe(true);
    expect(achadas[0].distanciaKm).toBeGreaterThanOrEqual(0);
  });

  it("sem rota (menos de 2 pontos) não casa nada", () => {
    expect(pracasNaRota([{ praca: "A", lat: -23, lon: -46 }], [[-23, -46]])).toEqual([]);
  });

  it("estima o total só com tarifa informada; sem tarifa devolve null", () => {
    expect(estimarTotalPedagios(3, "18.50")).toBe(55.5);
    expect(estimarTotalPedagios(3, "18,50")).toBe(55.5);
    expect(estimarTotalPedagios(2, "")).toBeNull();
    expect(estimarTotalPedagios(2, "-1")).toBeNull();
    expect(estimarTotalPedagios(0, "18.50")).toBe(0);
  });

  it("kmEntrePontos aproxima a distância real (São Paulo → Curitiba ~ 340 km em linha reta)", () => {
    const d = kmEntrePontos([-23.5505, -46.6333], [-25.4296, -49.2713]);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(360);
  });
});
