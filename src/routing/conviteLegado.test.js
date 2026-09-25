import { describe, expect, it } from "vitest";
import { destinoDoConviteLegado } from "./conviteLegado.js";

describe("link antigo de convite", () => {
  it("leva ao fluxo atual de convite, que existe no servidor", () => {
    expect(destinoDoConviteLegado("?convite=abc123")).toBe("/convite/abc123");
    expect(destinoDoConviteLegado("?x=1&convite=abc%20123")).toBe("/convite/abc%20123");
  });

  it("sem convite legível, não redireciona", () => {
    expect(destinoDoConviteLegado("")).toBe("");
    expect(destinoDoConviteLegado("?convite=")).toBe("");
    expect(destinoDoConviteLegado("?convite=%E0%A4%A")).toBe("");
    expect(destinoDoConviteLegado("?outro=1")).toBe("");
  });

  it("descarta espaços em volta do código e ignora % solto", () => {
    expect(destinoDoConviteLegado("?x=1&convite=abc&y=2")).toBe("/convite/abc");
    expect(destinoDoConviteLegado("?convite=%20abc%20")).toBe("/convite/abc");
    expect(destinoDoConviteLegado("?convite=100%")).toBe("");
  });

  it("o App não volta a chamar a rota morta /api/collab/join", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/fetch\([^)]*\/api\/collab\/join/);
  });
});
