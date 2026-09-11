/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    // findByText: o TG-001 vem do fetch da frota, e o cabeçalho renderiza
    // antes de a resposta chegar — em runner lento a leitura síncrona via a
    // tela ainda com "0 veículos" (flake real na main em 30/08, run 639).
    expect(await screen.findByText("TG-001")).toBeInTheDocument();
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

  it("importa a frota em massa: analisa a planilha e envia só os novos ao servidor", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn((url, opts) => {
      const texto = String(url);
      chamadas.push({ url: texto, method: opts?.method || "GET", body: opts?.body });
      if (texto.includes("/fleet/importar")) {
        return Promise.resolve(new Response(JSON.stringify({ criados: 1, ignorados: [], total: 1 }), { status: 201 }));
      }
      if (texto.includes("/records/operations")) {
        return Promise.resolve(new Response(JSON.stringify({ registros: operations }), { status: 200 }));
      }
      if (texto.includes("/fleet/economics")) {
        return Promise.resolve(new Response(JSON.stringify({ economics: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(fleetPayload), { status: 200 }));
    }));

    render(<DriverFleetCenterPage authHeaders={() => ({ authorization: "Bearer teste" })} operations={operations} />);
    await screen.findByText("TG-001");

    fireEvent.click(screen.getByRole("button", { name: /Importar frota/i }));
    // A placa ABC1D23 já existe na frota carregada; GHI4J56 é nova.
    const csv = "Prefixo,Placa,Classe,Autonomia (km)\nTDG-050,GHI4J56,van,200\nTDG-051,ABC1D23,van,180";
    fireEvent.change(screen.getByPlaceholderText(/Prefixo,Placa,Classe/), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: /^Analisar$/ }));

    // Um novo, um duplicado (placa já na frota).
    expect(await screen.findByText(/1 novos/)).toBeInTheDocument();
    expect(screen.getByText(/1 duplicados/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Importar 1 ve/i }));

    await waitFor(() => {
      const post = chamadas.find((c) => c.method === "POST" && c.url.includes("/fleet/importar"));
      expect(post).toBeTruthy();
      const enviado = JSON.parse(post.body);
      // Só o novo foi enviado; o duplicado ficou de fora.
      expect(enviado.veiculos).toHaveLength(1);
      expect(enviado.veiculos[0].plate).toBe("GHI4J56");
      expect(enviado.veiculos[0].vehicleClass).toBe("van");
      expect(enviado.veiculos[0].energyType).toBe("electric");
    });
  });
});
