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

  it("resolve todos os nomes legados pela mesma fonte", () => {
    expect(todoGreenCanonicalPage("/todogreen/comercial")).toBe("clientes");
    expect(todoGreenCanonicalPage("/todogreen/parametros-simulador")).toBe("regua");
    expect(todoGreenCanonicalPage("/todogreen/agentes")).toBe("agentes-funcoes");
    expect(todoGreenCanonicalPage("/todogreen/rastreamento")).toBe("motorista-frota");
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
