import { describe, expect, it } from "vitest";
import {
  assertUniqueRouteOwnership,
  todoGreenCanonicalPage,
  todoGreenRouteSegment,
} from "./todoGreenRouteOwnership.js";

describe("propriedade de rota da To Do Green", () => {
  it("mantém a Central de Trabalho sob o Espaço de trabalho", () => {
    expect(todoGreenRouteSegment("/todogreen/central-trabalho?aba=kanban")).toBe("central-trabalho");
    expect(todoGreenCanonicalPage("/todogreen/central-trabalho?aba=kanban")).toBe("espaco");
  });

  it("recusa duas telas donas da mesma rota", () => {
    expect(() => assertUniqueRouteOwnership([
      { id: "espaco", route: "/todogreen/espaco" },
      { id: "outra-tela", route: "/todogreen/espaco" },
    ])).toThrow(/pertence/);
  });

  it("aceita uma rota para cada tela", () => {
    expect(assertUniqueRouteOwnership([
      { id: "clientes", route: "/todogreen/clientes" },
      { id: "oportunidades", route: "/todogreen/oportunidades" },
    ])).toBe(true);
  });
});
