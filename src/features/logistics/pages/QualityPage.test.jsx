/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QualityPage from "./QualityPage.jsx";

afterEach(cleanup);

const registros = [
  { id: "q1", titulo: "Avaria na doca", tipo: "avaria", gravidade: "critica", situacao: "aberta", clientId: "c1", prazo: "2026-01-01", revision: 1, atualizadoEm: "2026-08-20" },
  { id: "q2", titulo: "SLA estourado", tipo: "sla", gravidade: "media", situacao: "resolvida", clientId: "c1", revision: 2, atualizadoEm: "2026-08-10" },
];
const clients = [{ id: "c1", name: "Rede Alfa" }];
const operations = [{ id: "op1", referencia: "OP-1" }];

describe("página de Qualidade", () => {
  it("mostra o resumo e as não conformidades abertas por padrão", () => {
    render(<QualityPage registros={registros} clients={clients} operations={operations} />);
    // Uma aberta (a resolvida some no filtro padrão).
    expect(screen.getByText("Avaria na doca")).toBeInTheDocument();
    expect(screen.queryByText("SLA estourado")).not.toBeInTheDocument();
    // Resumo: 1 aberta, 1 crítica.
    const criticas = screen.getByText("Críticas abertas").closest("article");
    expect(within(criticas).getByText("1")).toBeInTheDocument();
  });

  it("registra uma nova não conformidade com título obrigatório", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    const setToast = vi.fn();
    render(<QualityPage registros={registros} clients={clients} operations={operations} criar={criar} setToast={setToast} />);

    fireEvent.click(screen.getByRole("button", { name: /Nova não conformidade/ }));
    // Sem título, não grava.
    fireEvent.click(screen.getByRole("button", { name: /Registrar não conformidade/ }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringMatching(/título/i)));
    expect(criar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("O que saiu do padrão"), { target: { value: "Documento faltando" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar não conformidade/ }));
    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][0]).toBe("quality");
    expect(criar.mock.calls[0][1]).toMatchObject({ titulo: "Documento faltando" });
  });

  it("muda a situação de uma NC pela própria lista", async () => {
    const atualizar = vi.fn().mockResolvedValue({});
    render(<QualityPage registros={registros} clients={clients} operations={operations} atualizar={atualizar} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Situação de Avaria na doca/ }), { target: { value: "em_acao" } });
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith("quality", "q1", { situacao: "em_acao", revision: 1 }));
  });

  it("o filtro Todas revela também as encerradas", () => {
    render(<QualityPage registros={registros} clients={clients} operations={operations} />);
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(screen.getByText("SLA estourado")).toBeInTheDocument();
  });
});
