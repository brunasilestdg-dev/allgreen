/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolvePrimaryRoute } from "./PrimaryAppRouter.jsx";

describe("roteador principal", () => {
  it("resolve páginas públicas antes da autenticação", () => {
    expect(resolvePrimaryRoute("/s/minha-loja/contato", false)).toEqual({
      kind: "public-site", slug: "minha-loja", page: "contato",
    });
  });

  it("separa portal do cliente e vertical interna", () => {
    expect(resolvePrimaryRoute("/portal-cliente/operacoes", true).kind).toBe("customer-portal");
    expect(resolvePrimaryRoute("/portal-motorista/rotas", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/todogreen/precificacao", true).kind).toBe("todogreen");
  });

  it("não deixa rota interna passar sem sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/clientes", false).kind).toBe("login");
  });

  it("entrega as demais rotas ao ambiente principal", () => {
    expect(resolvePrimaryRoute("/", true).kind).toBe("workspace");
  });
});
