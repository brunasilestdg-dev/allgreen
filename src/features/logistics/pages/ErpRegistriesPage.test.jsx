/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErpRegistriesPage from "./ErpRegistriesPage.jsx";

// Regra da titular (30/08): cadastro correlato mora na MESMA tela — veículo
// com motorista — e cadastro sem correlação (tabela de preço) fica sozinho.
// Este teste trava a regra: o grupo mostra as seções juntas, e o ?secao= do
// menu abre o grupo certo.

describe("cadastros agrupados por correlação", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

  const stubFetch = () =>
    vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(new Response(JSON.stringify(
      String(url).includes("/fleet") ? { vehicles: [] } : { records: [] },
    ), { status: 200 }))));

  it("?secao=drivers abre a Frota com veículos E motoristas na mesma tela", async () => {
    window.history.replaceState({}, "", "/todogreen/cadastros?secao=drivers");
    stubFetch();
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} setToast={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^Frota/ })).toHaveClass("active");
    expect(await screen.findByRole("heading", { name: /Veículos/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Motoristas/ })).toBeInTheDocument();
    // Cada seção tem o próprio "Novo ..." — o cadastro nasce no lugar certo.
    expect(screen.getByRole("button", { name: /Novo veículo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Novo motorista/ })).toBeInTheDocument();
    // Tabela de preço não se correlaciona com frota: fica fora desta tela.
    expect(screen.queryByRole("heading", { name: /Tabelas de preço/ })).not.toBeInTheDocument();
  });

  it("Suprimentos junta materiais, depósitos e fornecedores", async () => {
    window.history.replaceState({}, "", "/todogreen/cadastros?secao=warehouses");
    stubFetch();
    render(<ErpRegistriesPage registros={{ items: [], warehouses: [], parties: [] }} criar={vi.fn()} setToast={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /Materiais/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Depósitos/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Fornecedores e parceiros/ })).toBeInTheDocument();
  });
});
