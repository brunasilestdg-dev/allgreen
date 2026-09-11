/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PurchaseApprovalPanel from "./PurchaseApprovalPanel.jsx";

const authHeaders = () => ({ authorization: "Bearer t" });

// A régua de fábrica como o servidor a devolve (topo com max:null).
const bandsPadrao = [
  { max: 5000, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] },
  { max: 25000, steps: [
    { id: "gestor", label: "Gestor", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
  ] },
  { max: 100000, steps: [
    { id: "gestor", label: "Gestor", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
    { id: "head", label: "Head", permission: "deal:approve" },
  ] },
  { max: null, steps: [
    { id: "gestor", label: "Gestor", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
    { id: "head", label: "Head", permission: "deal:approve" },
    { id: "diretoria", label: "Diretoria", ownerOnly: true },
  ] },
];

const resposta = (dados, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(dados) });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PurchaseApprovalPanel", () => {
  it("carrega a régua e envia a config editada no PUT", async () => {
    let putBody = null;
    global.fetch = vi.fn((_url, opcoes = {}) => {
      if (opcoes.method === "PUT") {
        putBody = JSON.parse(opcoes.body);
        return resposta({ bands: bandsPadrao, revision: 1, padrao: false, podeEditar: true });
      }
      return resposta({ bands: bandsPadrao, revision: 0, padrao: true, podeEditar: true });
    });

    render(<PurchaseApprovalPanel authHeaders={authHeaders} setToast={vi.fn()} />);
    // Carregou: a faixa de fábrica aparece e o botão de ativar existe (é admin).
    expect(await screen.findByText(/Até R\$\s*5\.000/)).toBeTruthy();
    const salvar = screen.getByRole("button", { name: /Ativar nova versão/ });

    // Adiciona "Financeiro" à primeira faixa (que de fábrica só tem Gestor).
    const primeiraFaixa = screen.getAllByText("Financeiro")[0].closest("fieldset");
    fireEvent.click(within(primeiraFaixa).getByLabelText("Financeiro"));

    fireEvent.click(salvar);
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.revision).toBe(0);
    expect(Array.isArray(putBody.config.bands)).toBe(true);
    expect(putBody.config.bands).toHaveLength(4);
    // A primeira faixa agora carrega os dois aprovadores, na ordem do catálogo.
    expect(putBody.config.bands[0].steps.map((s) => s.id)).toEqual(["gestor", "financeiro"]);
    // O topo continua sem teto.
    expect(putBody.config.bands[3].max).toBeNull();
  });

  it("papel sem edição só lê", async () => {
    global.fetch = vi.fn(() => resposta({ bands: bandsPadrao, revision: 0, padrao: true, podeEditar: false }));
    render(<PurchaseApprovalPanel authHeaders={authHeaders} setToast={vi.fn()} />);
    expect(await screen.findByText(/consulta as alçadas, mas não as altera/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ativar nova versão/ })).toBeNull();
  });
});
