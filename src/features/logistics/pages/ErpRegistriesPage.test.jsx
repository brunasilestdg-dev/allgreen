/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Editar e arquivar por linha: a tela deixou de ser só-criar. Cada fonte tem seu
// caminho — records vai pelos ganchos (atualizar/arquivar), fleet/master pela API
// — e o UPDATE sempre carrega a revision lida (controle otimista).
describe("editar e arquivar por linha", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const stubEmpty = () =>
    vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(new Response(JSON.stringify(
      String(url).includes("/fleet") ? { vehicles: [] } : { records: [] },
    ), { status: 200 }))));

  const abrirForm = () => document.querySelector("form.tdg-registry-form");

  it("records (Plano de contas): Editar chama atualizar com payload + revision", async () => {
    stubEmpty();
    const atualizar = vi.fn(() => Promise.resolve({ id: "acc1", codigo: "1.1", nome: "Caixa Geral", natureza: "ativo", revision: 3 }));
    render(<ErpRegistriesPage
      registros={{ costCenters: [], bankAccounts: [], accounts: [{ id: "acc1", codigo: "1.1", nome: "Caixa", natureza: "ativo", revision: 2 }] }}
      criar={vi.fn()} atualizar={atualizar} arquivar={vi.fn()} setToast={vi.fn()} secao="accounts" areaLabel="Financeiro"
    />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    // Modal em modo edição, pré-preenchido (a natureza vira o campo `tipo`).
    expect(screen.getByRole("dialog", { name: /Editar conta/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Caixa Geral" } });
    fireEvent.submit(abrirForm());

    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(
      "accounts", "acc1", { codigo: "1.1", nome: "Caixa Geral", tipo: "ativo", revision: 2 },
    ));
  });

  it("records (Plano de contas): Arquivar confirma e chama arquivar(colecao, id)", async () => {
    stubEmpty();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const arquivar = vi.fn(() => Promise.resolve());
    render(<ErpRegistriesPage
      registros={{ costCenters: [], bankAccounts: [], accounts: [{ id: "acc1", codigo: "1.1", nome: "Caixa", natureza: "ativo", revision: 2 }] }}
      criar={vi.fn()} atualizar={vi.fn()} arquivar={arquivar} setToast={vi.fn()} secao="accounts" areaLabel="Financeiro"
    />);

    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(arquivar).toHaveBeenCalledWith("accounts", "acc1"));
  });

  it("records: Arquivar cancelado (confirm=false) não chama arquivar", async () => {
    stubEmpty();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const arquivar = vi.fn();
    render(<ErpRegistriesPage
      registros={{ costCenters: [], bankAccounts: [], accounts: [{ id: "acc1", codigo: "1.1", nome: "Caixa", natureza: "ativo", revision: 2 }] }}
      criar={vi.fn()} atualizar={vi.fn()} arquivar={arquivar} setToast={vi.fn()} secao="accounts" areaLabel="Financeiro"
    />);

    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    expect(arquivar).not.toHaveBeenCalled();
  });

  const employee = { id: "e1", employeeCode: "E1", fullName: "Maria", jobTitle: "Analista", department: "Ops", employmentType: "employee", status: "active", revision: 4 };
  const stubEmployees = () => {
    const fn = vi.fn((url, options = {}) => {
      const u = String(url);
      const method = options.method || "GET";
      if (u.includes("/master-data/employees/e1") && method === "PATCH")
        return Promise.resolve(new Response(JSON.stringify({ record: { ...employee, fullName: "Maria Silva", revision: 5 } }), { status: 200 }));
      if (u.includes("/master-data/employees/e1") && method === "DELETE")
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      if (u.includes("/master-data/employees") && method === "GET")
        return Promise.resolve(new Response(JSON.stringify({ records: [employee] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  it("master (Colaboradores): Editar faz PATCH na API com revision", async () => {
    const fetchMock = stubEmployees();
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} atualizar={vi.fn()} arquivar={vi.fn()} setToast={vi.fn()} secao="employees" areaLabel="Colaboradores" />);

    await screen.findByText("Maria");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Maria Silva" } });
    fireEvent.submit(abrirForm());

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, o]) => String(u).includes("/master-data/employees/e1") && o?.method === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(patch[1].body);
      expect(body.revision).toBe(4);
      expect(body.fullName).toBe("Maria Silva");
    });
    // A linha é trocada pelo registro devolvido pela API.
    expect(await screen.findByText("Maria Silva")).toBeInTheDocument();
  });

  it("master (Colaboradores): Arquivar faz DELETE e remove a linha", async () => {
    const fetchMock = stubEmployees();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} atualizar={vi.fn()} arquivar={vi.fn()} setToast={vi.fn()} secao="employees" areaLabel="Colaboradores" />);

    await screen.findByText("Maria");
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([u, o]) => String(u).includes("/master-data/employees/e1") && o?.method === "DELETE");
      expect(del).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByText("Maria")).not.toBeInTheDocument());
  });

  it("master: 409 na edição mostra toast pedindo para recarregar", async () => {
    const fn = vi.fn((url, options = {}) => {
      const u = String(url);
      const method = options.method || "GET";
      if (u.includes("/master-data/employees/e1") && method === "PATCH")
        return Promise.resolve(new Response(JSON.stringify({ error: "Este cadastro mudou. Recarregue antes de salvar." }), { status: 409 }));
      if (u.includes("/master-data/employees") && method === "GET")
        return Promise.resolve(new Response(JSON.stringify({ records: [employee] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fn);
    const setToast = vi.fn();
    render(<ErpRegistriesPage registros={{}} criar={vi.fn()} atualizar={vi.fn()} arquivar={vi.fn()} setToast={setToast} secao="employees" areaLabel="Colaboradores" />);

    await screen.findByText("Maria");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.submit(abrirForm());

    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringMatching(/Recarregue/)));
  });
});
