import { describe, expect, it } from "vitest";
import { itemVisivelNaFilaDeInteligencia } from "./marketIntelligenceQueueDomain.js";

describe("fila ativa de inteligência comercial", () => {
  it("remove revisados e descartados da tela principal", () => {
    expect(itemVisivelNaFilaDeInteligencia({ status: "reviewed" })).toBe(false);
    expect(itemVisivelNaFilaDeInteligencia({ status: "dismissed" })).toBe(false);
  });

  it("mantém novos e oportunidades visíveis", () => {
    expect(itemVisivelNaFilaDeInteligencia({ status: "new" })).toBe(true);
    expect(itemVisivelNaFilaDeInteligencia({ status: "opportunity" })).toBe(true);
    expect(itemVisivelNaFilaDeInteligencia({})).toBe(true);
  });
});
