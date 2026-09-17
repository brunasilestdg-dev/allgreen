/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

const irPara = (caminho) => window.history.pushState({}, "", caminho);

const preparar = (caminho) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    ),
  );
  irPara(caminho);
  render(<App />);
};

describe("tela de entrada To Do Green", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    irPara("/");
  });

  it("usa a entrada limpa de ERP na raiz e em /todogreen", async () => {
    preparar("/todogreen");

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeTruthy();
    expect(screen.getByText("LOGIN PRIVADO")).toBeTruthy();
    expect(screen.getByAltText("To Do Green")).toBeTruthy();
    expect(
      screen.getByText(
        /Use o e-mail e a senha inicial recebidos\. No primeiro acesso/i,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Alterar senha inicial" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Solicitar acesso/i }),
    ).toBeTruthy();

    expect(screen.queryByText(/TRANSPORTADORA 100% ELÉTRICA/)).toBeNull();
    expect(screen.queryByText(/Ambiente corporativo To Do Green/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Portal TMS" })).toBeNull();
    expect(document.title).toBe("To Do Green");
  });

  it.each([
    ["/portal-cliente", "PORTAL DO CLIENTE", /Acompanhe pedidos, entregas/i, "Primeiro acesso"],
    ["/portal-motorista", "PORTAL DO MOTORISTA", /Acesse viagens, coletas/i, "Primeiro acesso"],
    ["/portal-tms", "TMS", /Gerencie cargas, viagens, roteirização/i, "Alterar senha inicial"],
  ])(
    "preserva o contexto do portal em %s",
    async (rota, kicker, ajuda, secundaria) => {
      preparar(rota);

      expect(await screen.findByRole("heading", { name: "Entrar" })).toBeTruthy();
      expect(screen.getByText(kicker)).toBeTruthy();
      expect(screen.getByText(ajuda)).toBeTruthy();
      expect(screen.getByRole("button", { name: secundaria })).toBeTruthy();
      expect(screen.getByAltText("To Do Green")).toBeTruthy();
    },
  );
});
