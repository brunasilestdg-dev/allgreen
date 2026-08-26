/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolvePrimaryRoute } from "./PrimaryAppRouter.jsx";

describe("roteador principal", () => {
  it("resolve páginas públicas antes da autenticação", () => {
    expect(resolvePrimaryRoute("/s/minha-loja/contato", false)).toEqual({
      kind: "public-site", slug: "minha-loja", page: "contato",
    });
  });

  it("separa portal do cliente, app do motorista, central de frota e vertical interna", () => {
    expect(resolvePrimaryRoute("/portal-cliente/operacoes", true).kind).toBe("customer-portal");
    // /portal-motorista é o APP do motorista (celular, minhas viagens);
    // /motorista-frota é a central interna DE gestão de frota. São telas
    // diferentes e a rota precisa distinguir.
    expect(resolvePrimaryRoute("/portal-motorista/rotas", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/central-motorista", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/motorista-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/central-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/todogreen/precificacao", true).kind).toBe("todogreen");
  });

  it("não deixa rota interna passar sem sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/clientes", false).kind).toBe("login");
  });

  it("entrega as demais rotas ao ambiente principal", () => {
    expect(resolvePrimaryRoute("/", true).kind).toBe("workspace");
  });
});
