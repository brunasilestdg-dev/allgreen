import { describe, expect, it } from "vitest";
import { VERTICAIS, rotuloStatus, verticalPorId } from "./verticalsCatalog.js";

describe("catálogo de verticais", () => {
  it("expõe as três verticais na ordem do produto", () => {
    expect(VERTICAIS.map((v) => v.id)).toEqual(["todogreen", "greenon", "greenmob"]);
  });

  it("cada vertical tem rota, status e ao menos um módulo", () => {
    for (const vertical of VERTICAIS) {
      expect(vertical.route.startsWith("/")).toBe(true);
      expect(["real", "parcial", "mvp", "prepared", "external"]).toContain(vertical.status);
      expect(vertical.modules.length).toBeGreaterThan(0);
    }
  });

  it("busca por id devolve a vertical correta e null quando não existe", () => {
    expect(verticalPorId("greenon").name).toBe("Green On");
    expect(verticalPorId("inexistente")).toBeNull();
  });

  it("traduz o status para rótulo legível", () => {
    expect(rotuloStatus("real")).toBe("Operacional");
    expect(rotuloStatus("mvp")).toBe("MVP");
    expect(rotuloStatus("desconhecido")).toBe("desconhecido");
  });
});
