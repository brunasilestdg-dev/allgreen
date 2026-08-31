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
    stubFetch();
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} setToast={vi.fn()} secao="drivers" />);

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
    stubFetch();
    render(<ErpRegistriesPage registros={{ items: [], warehouses: [], parties: [] }} criar={vi.fn()} setToast={vi.fn()} secao="warehouses" />);

    expect(screen.getByRole("heading", { name: /Materiais/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Depósitos/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Fornecedores e parceiros/ })).toBeInTheDocument();
  });

  // Regra da titular: cada cadastro no galho da sua área. Entrar por Frota não
  // pode despejar as sete abas de todas as áreas na tela — era exatamente isso
  // que acontecia ao clicar em "Cadastro · Veículos" no menu da Frota.
  it("entrando pela área, só os cadastros daquela área aparecem", async () => {
    stubFetch();
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} setToast={vi.fn()} secao="vehicles" areaLabel="Frota" />);

    expect(screen.getByRole("heading", { name: "Cadastros de Frota" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Veículos/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Grupos de cadastros/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Financeiro/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Dados da empresa/ })).not.toBeInTheDocument();
  });

  // Trocar de cadastro pelo menu antes não trocava de grupo: o estado inicial
  // era calculado uma única vez, na montagem da tela.
  it("trocar de seção pelo menu troca o grupo mostrado", async () => {
    stubFetch();
    const { rerender } = render(<ErpRegistriesPage registros={{}} criar={vi.fn()} setToast={vi.fn()} secao="vehicles" areaLabel="Frota" />);
    expect(await screen.findByRole("heading", { name: /Veículos/ })).toBeInTheDocument();

    rerender(<ErpRegistriesPage registros={{ costCenters: [], accounts: [], bankAccounts: [] }} criar={vi.fn()} setToast={vi.fn()} secao="accounts" areaLabel="Financeiro" />);
    expect(await screen.findByRole("heading", { name: /Plano de contas/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Veículos/ })).not.toBeInTheDocument();
  });
});
