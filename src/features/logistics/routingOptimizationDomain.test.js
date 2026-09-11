import { describe, expect, it } from "vitest";
import {
  decodificarPolyline,
  interpretarSolucaoVroom,
  janelaVroom,
  montarProblemaVroom,
} from "./routingOptimizationDomain.js";

const resultado = {
  enderecos: ["Origem", "Parada A", "Parada B", "Destino"],
  paradas: [
    { rotulo: "Origem", coord: [-23.50, -46.80] },
    { rotulo: "Parada A", coord: [-23.55, -46.63] },
    { rotulo: "Parada B", coord: [-23.60, -46.70] },
    { rotulo: "Destino", coord: [-23.90, -46.30] },
  ],
  pontos: [[-23.50, -46.80], [-23.90, -46.30]],
  distanciaKm: 100,
  minutos: 120,
  fonte: "fallback",
};

describe("routingOptimizationDomain", () => {
  it("monta VROOM mantendo origem/destino fixos e converte coordenadas", () => {
    const built = montarProblemaVroom({
      resultado,
      partida: "2026-09-10T08:00",
      janelas: [
        {},
        { inicio: "09:00", fim: "11:00" },
        { inicio: "13:00", fim: "15:00" },
        {},
      ],
    });

    expect(built.ok).toBe(true);
    expect(built.payload.vehicles[0]).toMatchObject({
      id: 1,
      start: [-46.80, -23.50],
      end: [-46.30, -23.90],
    });
    expect(built.payload.jobs).toHaveLength(2);
    expect(built.payload.jobs[0]).toMatchObject({
      id: 1,
      location: [-46.63, -23.55],
      description: "Parada A",
    });
    expect(built.payload.jobs[0].time_windows[0][1]).toBeGreaterThan(
      built.payload.jobs[0].time_windows[0][0],
    );
    expect(built.payload.geometry).toBe(true);
  });

  it("trata janela que cruza meia-noite", () => {
    const janela = janelaVroom({ inicio: "22:00", fim: "02:00" }, "2026-09-10T08:00");
    expect(janela[1] - janela[0]).toBe(4 * 60 * 60);
  });

  it("decodifica polyline precisão 5", () => {
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq" + String.fromCharCode(96) + "@";
    expect(decodificarPolyline(encoded)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("aplica a ordem do VROOM e usa distância, duração e geometria", () => {
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq" + String.fromCharCode(96) + "@";
    const parsed = interpretarSolucaoVroom({
      resultadoAtual: resultado,
      resposta: {
        summary: { cost: 3210, distance: 90000, duration: 5400, unassigned: 0 },
        routes: [{
          vehicle: 1,
          cost: 3210,
          distance: 90000,
          duration: 5400,
          geometry: encoded,
          steps: [
            { type: "start" },
            { type: "job", id: 2 },
            { type: "job", id: 1 },
            { type: "end" },
          ],
        }],
        unassigned: [],
      },
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ordem).toEqual(["Origem", "Parada B", "Parada A", "Destino"]);
    expect(parsed.resultado.paradas.map((p) => p.rotulo)).toEqual([
      "Origem", "Parada B", "Parada A", "Destino",
    ]);
    expect(parsed.resultado.distanciaKm).toBe(90);
    expect(parsed.resultado.minutos).toBe(90);
    expect(parsed.resultado.motor).toBe("vroom");
    expect(parsed.resultado.pontos).toHaveLength(3);
  });

  it("não aplica solução parcial", () => {
    const parsed = interpretarSolucaoVroom({
      resultadoAtual: resultado,
      resposta: {
        routes: [{ steps: [{ type: "job", id: 1 }] }],
        unassigned: [{ id: 2 }],
      },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.motivo).toContain("sem alocação");
  });
});
