/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalPage from "./LegalPage.jsx";

afterEach(cleanup);

const registros = [
  { id: "l1", titulo: "Contrato Rede Alfa", tipo: "contrato", risco: "alto", situacao: "em_analise", clientId: "c1", fimVigencia: "2999-01-01", revision: 1, atualizadoEm: "2026-09-01" },
  { id: "l2", titulo: "NDA fornecedor", tipo: "nda", risco: "baixo", situacao: "assinado", clientId: "c1", revision: 2, atualizadoEm: "2026-08-20" },
];
const clients = [{ id: "c1", name: "Rede Alfa" }];

describe("página de Jurídico", () => {
  it("mostra o resumo e os documentos em aberto por padrão", () => {
    render(<LegalPage registros={registros} clients={clients} />);
    expect(screen.getByText("Contrato Rede Alfa")).toBeInTheDocument();
    // O assinado (encerrado) some no filtro padrão.
    expect(screen.queryByText("NDA fornecedor")).not.toBeInTheDocument();
    const risco = screen.getByText("Risco alto em aberto").closest("article");
    expect(within(risco).getByText("1")).toBeInTheDocument();
  });

  it("registra um novo documento com título obrigatório", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    const setToast = vi.fn();
    render(<LegalPage registros={registros} clients={clients} criar={criar} setToast={setToast} />);

    fireEvent.click(screen.getByRole("button", { name: /Novo documento/ }));
    // Sem título, não grava.
    fireEvent.click(screen.getByRole("button", { name: /Registrar documento/ }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringMatching(/título/i)));
    expect(criar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Contrato de operação/), { target: { value: "Aditivo prazo" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar documento/ }));
    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][0]).toBe("legal");
    expect(criar.mock.calls[0][1]).toMatchObject({ titulo: "Aditivo prazo" });
  });

  it("muda a situação de um documento pela própria lista", async () => {
    const atualizar = vi.fn().mockResolvedValue({});
    render(<LegalPage registros={registros} clients={clients} atualizar={atualizar} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Situação de Contrato Rede Alfa/ }), { target: { value: "aprovado" } });
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith("legal", "l1", { situacao: "aprovado", revision: 1 }));
  });

  it("o filtro Todos revela também os encerrados", () => {
    render(<LegalPage registros={registros} clients={clients} />);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("NDA fornecedor")).toBeInTheDocument();
  });
});
