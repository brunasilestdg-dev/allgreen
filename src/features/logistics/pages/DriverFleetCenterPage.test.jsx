/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DriverFleetCenterPage from "./DriverFleetCenterPage.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fleetPayload = {
  vehicles: [
    {
      id: "v1",
      prefix: "TG-001",
      plate: "ABC1D23",
      status: "in-operation",
      operationalUnit: "São Paulo",
      energyType: "electric",
      batterySohPercent: 92,
      nominalRangeKm: 220,
      realRangeKm: 190,
      odometerKm: 12800,
      fields: {
        currentDriver: "Ana Souza",
        lastAddress: "Av. Paulista, 1000",
        currentRoute: "Rota SP-01",
        speedKmh: 42,
        hourmeter: 812,
      },
    },
  ],
  access: { canWrite: true },
};

const operations = [
  {
    id: "op1",
    motorista: "Ana Souza",
    placa: "ABC1D23",
    referencia: "Rota SP-01",
    origem: "CD Osasco",
    destino: "Cliente Paulista",
    entregas: 14,
    pacotes: 60,
    distanciaKm: 84,
    ocorrencias: 1,
    situacao: "em_rota",
    etaEm: "2026-08-24T14:30:00Z",
    prometidoEm: "2026-08-24T16:00:00Z",
  },
];

describe("Gestão operacional de frota", () => {
  it("renderiza a visão gerencial dentro do ERP", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(fleetPayload), { status: 200 }))));

    render(<DriverFleetCenterPage authHeaders={() => ({ authorization: "Bearer teste" })} operations={operations} />);

    expect(await screen.findByRole("heading", { name: "Gestão operacional de frota" })).toBeInTheDocument();
    expect(screen.getAllByText("Ana Souza").length).toBeGreaterThan(0);
    expect(screen.getByText("TG-001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir portal motorista/i })).toBeInTheDocument();
  });

  it("carrega operações sozinho no modo portal externo", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(new Response(JSON.stringify(
      String(url).includes("/records/operations")
        ? { registros: operations }
        : fleetPayload,
    ), { status: 200 }))));

    render(<DriverFleetCenterPage authHeaders={() => ({ authorization: "Bearer teste" })} mode="driver-portal" />);

    expect(await screen.findByRole("heading", { name: "Portal do motorista" })).toBeInTheDocument();
    expect((await screen.findAllByText(/Rota SP-01/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Abrir portal motorista/i })).not.toBeInTheDocument();
  });
});
