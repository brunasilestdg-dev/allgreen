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

  it("conduz a situação pelo fluxo auditado, sem seletor solto de status", async () => {
    // O antigo <select> de status na lista era mudança não auditada; agora a
    // situação só muda por ações do fluxo, que gravam evento imutável.
    render(<LegalPage registros={registros} clients={clients} juridico />);
    expect(screen.queryByRole("combobox", { name: /Situação de/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Abrir fluxo/ }));
    // O documento em análise oferece a ação auditada de arquivar no fluxo.
    await waitFor(() => expect(screen.getByRole("button", { name: "Arquivar" })).toBeInTheDocument());
  });

  it("mostra o painel de renovação para documentos em aberto vencendo", () => {
    const hoje = new Date();
    const em15dias = new Date(hoje.getTime() + 15 * 86400000).toISOString().slice(0, 10);
    const vencendo = [{ id: "l3", titulo: "Contrato a renovar", tipo: "contrato", risco: "medio", situacao: "aprovado", fimVigencia: em15dias, revision: 1, atualizadoEm: "2026-09-01" }];
    render(<LegalPage registros={vencendo} clients={clients} />);
    expect(screen.getByText("Renove antes de vencer")).toBeInTheDocument();
    // Aparece no painel de renovação e no rodapé do cartão.
    expect(screen.getAllByText(/Vence em 15 dias/).length).toBeGreaterThanOrEqual(1);
  });

  it("guarda contraparte estruturada (CNPJ e signatário) em campos", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    render(<LegalPage registros={registros} clients={clients} criar={criar} setToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Novo documento/ }));
    fireEvent.change(screen.getByPlaceholderText(/Contrato de operação/), { target: { value: "Contrato novo" } });
    fireEvent.change(screen.getByLabelText("CNPJ da contraparte"), { target: { value: "12.345.678/0001-95" } });
    fireEvent.change(screen.getByPlaceholderText(/Nome de quem assina/), { target: { value: "Maria Souza" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar documento/ }));
    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][1].campos).toMatchObject({ cnpj: "12345678000195", signatario: "Maria Souza" });
  });

  // CNPJ alfanumérico (emitido desde julho/2026): o campo aceita letras, e o
  // que é guardado mantém as letras em vez de virar outro número.
  it("aceita e guarda o CNPJ alfanumérico da contraparte", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    render(<LegalPage registros={registros} clients={clients} criar={criar} setToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Novo documento/ }));
    fireEvent.change(screen.getByPlaceholderText(/Contrato de operação/), { target: { value: "Contrato novo" } });
    const campo = screen.getByLabelText("CNPJ da contraparte");
    fireEvent.change(campo, { target: { value: "12.abc.345/01de-35" } });
    expect(campo).toHaveValue("12.ABC.345/01DE-35");
    fireEvent.click(screen.getByRole("button", { name: /Registrar documento/ }));
    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][1].campos).toMatchObject({ cnpj: "12ABC34501DE35" });
  });

  it("o filtro Todos revela também os encerrados", () => {
    render(<LegalPage registros={registros} clients={clients} />);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("NDA fornecedor")).toBeInTheDocument();
  });
});
