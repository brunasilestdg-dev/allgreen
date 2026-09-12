/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EnergyPanel from "./EnergyPanel.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const resp = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const authHeaders = () => ({ authorization: "Bearer t" });

describe("painel de Energia", () => {
  it("mostra consumo, custo e rede quando há frota", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      if (u.includes("/fleet")) return resp({ vehicles: [
        { id: "v1", plate: "AAA1A11", energyType: "electric", odometerKm: 10000, energyConsumptionKwhPerKm: 0.3, emissionFactorKgCo2ePerKwh: 0.0385 },
      ] });
      if (u.includes("/records/pontosRecarga")) return resp({ registros: [
        { id: "p1", tipoCorrente: "DC", potenciaKw: 150, status: "ativo", latitude: -23.5, longitude: -46.6 },
      ] });
      return resp({});
    }));
    render(<EnergyPanel authHeaders={authHeaders} />);
    expect(await screen.findByText("Energia estimada")).toBeInTheDocument();
    // 10000 × 0,3 = 3.000 kWh (aparece na métrica e no maior consumidor)
    expect(screen.getAllByText("3.000 kWh").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Rede de recarga própria")).toBeInTheDocument();
    // Recarga inteligente: com potência instalada (150 kW), a janela fora de
    // ponta e a economia aparecem.
    expect(screen.getByText("Recarga inteligente")).toBeInTheDocument();
    expect(screen.getByText("22h → 17h")).toBeInTheDocument();
  });

  it("sem frota, é honesto: estado vazio, sem chutar consumo", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/records/pontosRecarga")) return resp({ registros: [] });
      return resp({ vehicles: [] });
    }));
    render(<EnergyPanel authHeaders={authHeaders} />);
    expect(await screen.findByText(/O consumo aparece quando a frota/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Energia estimada")).not.toBeInTheDocument());
  });
});
