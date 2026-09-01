/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

// A entrada pela rota da To Do Green veste a identidade da transportadora na
// PRÓPRIA tela React de login. O antigo módulo LogisticsVerticalBranding.js
// fazia isso por fora, gravando textContent sem comparar dentro de um
// MutationObserver do body — gravar dispara mutação, que grava de novo:
// laço infinito que congelava a aba sempre que o login aparecia sob
// /todogreen. O módulo foi removido; este teste garante que a marca continua
// aparecendo — e que a raiz continua sendo o Seu Funcionário.

const irPara = (caminho) => window.history.pushState({}, "", caminho);

describe("tela de entrada por rota", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    irPara("/");
  });

  it("em /todogreen, o login é da To Do Green", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    irPara("/todogreen");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /Ambiente corporativo To Do Green/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Entre no ambiente To Do Green" })).toBeTruthy();
    expect(screen.getAllByText("To Do Green").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Tenha o funcionário que sua empresa precisa/)).toBeNull();
    expect(document.title).toBe("To Do Green");
    // Acesso por convite: nada de auto-cadastro na entrada da vertical.
    expect(screen.queryByRole("tab", { name: "Criar conta" })).toBeNull();
    expect(screen.getByText(/peça a um administrador para autorizar/)).toBeTruthy();
  });

  it("na raiz, o login continua do Seu Funcionário", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    irPara("/");
    render(<App />);
    expect(await screen.findByText(/Tenha o funcionário que sua empresa precisa/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Ambiente corporativo To Do Green/ })).toBeNull();
  });
});
