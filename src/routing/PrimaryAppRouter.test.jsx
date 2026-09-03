/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolvePrimaryRoute } from "./PrimaryAppRouter.jsx";

describe("roteador principal", () => {
  it("resolve páginas públicas antes da autenticação", () => {
    expect(resolvePrimaryRoute("/s/minha-loja/contato", false)).toEqual({
      kind: "public-site", slug: "minha-loja", page: "contato",
    });
  });

  it("separa cliente, TMS, motorista, central de frota e vertical interna", () => {
    expect(resolvePrimaryRoute("/portal-cliente/operacoes", true).kind).toBe("customer-portal");
    expect(resolvePrimaryRoute("/portal-tms", true).kind).toBe("tms-portal");
    expect(resolvePrimaryRoute("/portal-tms/roteirizacao", true).kind).toBe("tms-portal");
    expect(resolvePrimaryRoute("/portal-motorista/rotas", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/central-motorista", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/motorista-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/central-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/todogreen/precificacao", true).kind).toBe("todogreen");
  });

  it("usa a raiz como entrada da To Do Green e preserva o portal escolhido", () => {
    expect(resolvePrimaryRoute("/", false).kind).toBe("todogreen-login");
    expect(resolvePrimaryRoute("/portal-cliente", false).kind).toBe("customer-login");
    expect(resolvePrimaryRoute("/portal-motorista", false).kind).toBe("driver-login");
    // O TMS tem a própria entrada no login (aba "Portal TMS"), como cliente e
    // motorista — para quem entra pelo TMS voltar ao TMS depois de autenticar.
    expect(resolvePrimaryRoute("/portal-tms", false).kind).toBe("tms-login");
  });

  it("usa o login da To Do Green para as rotas internas sem sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/clientes", false).kind).toBe("todogreen-login");
    expect(resolvePrimaryRoute("/portal-tms/fiscal", false).kind).toBe("tms-login");
  });

  it("abre o convite individual da To Do Green sem reutilizar uma sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/convite/token-opaco", false)).toEqual({
      kind: "todogreen-access-invite",
      token: "token-opaco",
    });
  });

  it("entrega as demais rotas ao ambiente principal", () => {
    expect(resolvePrimaryRoute("/", true).kind).toBe("workspace");
  });
});
