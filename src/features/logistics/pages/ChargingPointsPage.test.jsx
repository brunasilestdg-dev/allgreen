/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChargingPointsPage from "./ChargingPointsPage.jsx";

afterEach(cleanup);

const registros = [
  { id: "p1", nome: "Pátio Guarulhos", operador: "GreenOn", tipoCorrente: "DC", conector: "CCS2", potenciaKw: 150, status: "ativo", latitude: -23.43, longitude: -46.47, servePesado: true, revision: 1 },
  { id: "p2", nome: "Doca AC", operador: "Próprio", tipoCorrente: "AC", conector: "Type2", potenciaKw: 22, status: "ativo", latitude: null, longitude: null, servePesado: false, revision: 1 },
  { id: "p3", nome: "Base Campinas", operador: "Ground", tipoCorrente: "DC", conector: "CCS2", potenciaKw: 60, status: "manutencao", latitude: -22.9, longitude: -47.06, servePesado: true, revision: 1 },
];

describe("página de Pontos de recarga", () => {
  it("mostra o resumo e os pontos ativos por padrão", () => {
    const { container } = render(<ChargingPointsPage registros={registros} />);
    // Dois ativos; o em manutenção some no filtro padrão.
    expect(screen.getByText("Pátio Guarulhos")).toBeInTheDocument();
    expect(screen.getByText("Doca AC")).toBeInTheDocument();
    expect(screen.queryByText("Base Campinas")).not.toBeInTheDocument();
    // Resumo: 2 servem pesado (os dois DC ≥ 50), 2 de 3 no mapa.
    const metrics = container.querySelector(".tdg-recarga-metrics");
    const pesados = within(metrics).getByText("Servem pesado").closest("article");
    expect(within(pesados).getByText("2")).toBeInTheDocument();
    const mapa = within(metrics).getByText("No mapa").closest("article");
    expect(within(mapa).getByText("2/3")).toBeInTheDocument();
  });

  it("o filtro 'Servem pesado' esconde o ponto AC", () => {
    render(<ChargingPointsPage registros={registros} />);
    fireEvent.click(screen.getByRole("button", { name: "Servem pesado" }));
    expect(screen.getByText("Pátio Guarulhos")).toBeInTheDocument();
    expect(screen.queryByText("Doca AC")).not.toBeInTheDocument();
  });

  it("recusa cadastro sem nome e não chama criar", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    const setToast = vi.fn();
    render(<ChargingPointsPage registros={registros} criar={criar} setToast={setToast} />);
    fireEvent.click(screen.getByRole("button", { name: /Novo ponto/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cadastrar ponto/ }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringMatching(/nome/i)));
    expect(criar).not.toHaveBeenCalled();
  });

  it("cadastra um ponto com nome na coleção pontosRecarga", async () => {
    const criar = vi.fn().mockResolvedValue({ id: "novo" });
    render(<ChargingPointsPage registros={registros} criar={criar} setToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Novo ponto/ }));
    fireEvent.change(screen.getByPlaceholderText(/Pátio Guarulhos/), { target: { value: "Novo pátio" } });
    fireEvent.click(screen.getByRole("button", { name: /Cadastrar ponto/ }));
    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar.mock.calls[0][0]).toBe("pontosRecarga");
    expect(criar.mock.calls[0][1]).toMatchObject({ nome: "Novo pátio" });
  });

  it("muda a situação de um ponto pela própria lista", async () => {
    const atualizar = vi.fn().mockResolvedValue({});
    render(<ChargingPointsPage registros={registros} atualizar={atualizar} setToast={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Situação de Pátio Guarulhos/ }), { target: { value: "manutencao" } });
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith("pontosRecarga", "p1", { status: "manutencao", revision: 1 }));
  });
});
