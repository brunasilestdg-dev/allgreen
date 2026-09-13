// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DispatchPanel, {
  atribuicoesDeTours,
  nomesNaoAtribuidas,
  resumoDaRota,
  toursAplicaveis,
  toursSemMotorista,
} from "./DispatchPanel.jsx";

// A regra que protege o despacho: uma rota sem motorista livre NUNCA é aplicada
// (gravaria um veículo comprometido sem condutor, e a operação reapareceria como
// candidata — "atribuída" e pendente ao mesmo tempo).

describe("atribuicoesDeTours", () => {
  it("só monta atribuição para rotas COM motorista", () => {
    const tours = [
      { motoristaId: "m1", motoristaNome: "João", placa: "ABC1D23", operacoes: ["op1", "op2"] },
      { motoristaId: "", motoristaNome: "", placa: "XYZ9Z99", operacoes: ["op3"] },
    ];
    const atribuicoes = atribuicoesDeTours(tours);
    expect(atribuicoes).toHaveLength(2);
    expect(atribuicoes.map((a) => a.operationId)).toEqual(["op1", "op2"]);
    expect(atribuicoes.every((a) => a.driverId === "m1")).toBe(true);
    // op3 (rota sem motorista) não entra.
    expect(atribuicoes.find((a) => a.operationId === "op3")).toBeUndefined();
  });

  it("devolve vazio quando nenhuma rota tem motorista", () => {
    const tours = [{ motoristaId: "", placa: "P1", operacoes: ["op1"] }];
    expect(atribuicoesDeTours(tours)).toEqual([]);
  });

  it("aguenta entrada indefinida ou rota sem operações", () => {
    expect(atribuicoesDeTours(undefined)).toEqual([]);
    expect(atribuicoesDeTours([{ motoristaId: "m1" }])).toEqual([]);
  });
});

describe("toursSemMotorista", () => {
  it("conta quantas rotas ficaram sem motorista", () => {
    expect(toursSemMotorista([
      { motoristaId: "m1" }, { motoristaId: "" }, { motoristaId: null },
    ])).toBe(2);
    expect(toursSemMotorista([])).toBe(0);
    expect(toursSemMotorista(undefined)).toBe(0);
  });
});

describe("toursAplicaveis", () => {
  it("leva ao servidor somente rotas com motorista e operação", () => {
    const pronta = { motoristaId: "m1", operacoes: ["op1"], paradas: [{ operationId: "op1" }] };
    expect(toursAplicaveis([pronta, { motoristaId: "", operacoes: ["op2"] }, { motoristaId: "m2" }])).toEqual([pronta]);
  });
});

describe("resumoDaRota", () => {
  it("formata km e tempo (com horas quando passa de 60 min)", () => {
    expect(resumoDaRota({ distanciaKm: 12, duracaoMin: 30 })).toBe("12 km · 30 min");
    expect(resumoDaRota({ distanciaKm: 84.5, duracaoMin: 95 })).toBe("84.5 km · 1h35");
  });
  it("omite o que não tem número e devolve vazio sem dados (não inventa ETA)", () => {
    expect(resumoDaRota({ distanciaKm: 12 })).toBe("12 km");
    expect(resumoDaRota({ duracaoMin: 40 })).toBe("40 min");
    expect(resumoDaRota({})).toBe("");
    expect(resumoDaRota({ distanciaKm: 0, duracaoMin: 0 })).toBe("");
    expect(resumoDaRota(undefined)).toBe("");
  });
});

describe("nomesNaoAtribuidas", () => {
  it("resolve o nome do cliente por id e cai no id quando não está no lote", () => {
    const operacoes = [
      { id: "op1", cliente: "Padaria Sol" },
      { id: "op2", referencia: "NF 123" },
    ];
    expect(nomesNaoAtribuidas(["op1", "op2", "op9"], operacoes)).toEqual(["Padaria Sol", "NF 123", "op9"]);
  });
  it("aguenta entradas ausentes", () => {
    expect(nomesNaoAtribuidas(undefined, undefined)).toEqual([]);
    expect(nomesNaoAtribuidas(["x"], null)).toEqual(["x"]);
  });
});

describe("botões do painel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // Hierarquia do painel: abrir/fechar e otimizar são a ação principal
  // (`tdg-action`); "Recarregar" é apoio e fica sem classe de propósito — a
  // regra-base de botões o veste como secundário no ERP e no Portal TMS (ver
  // TmsPortal.css). Com `tdg-action tdg-action-ghost` ele viraria um segundo
  // "Otimizar rotas" dentro de `.tdg`, onde a fantasma perde para a principal.
  it("mantém a ação principal em tdg-action e o Recarregar como apoio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ operacoes: [], semCoordenadas: 0, motoristas: [{ id: "m1" }], veiculos: [] }),
    })));
    const { container } = render(<DispatchPanel authHeaders={() => ({})} setToast={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir despacho" }));
    await screen.findByText("Operações a despachar");

    expect(screen.getByRole("button", { name: "Fechar" })).toHaveClass("tdg-action");
    const recarregar = screen.getByRole("button", { name: "Recarregar" });
    expect(recarregar).not.toHaveClass("tdg-action");
    expect(recarregar).toBeEnabled();
    const otimizar = screen.getByRole("button", { name: "Otimizar rotas" });
    expect(otimizar).toHaveClass("tdg-action");
    // Sem operação nem veículo livre, otimizar é indisponível — não escondido.
    expect(otimizar).toBeDisabled();
    // Só esses três botões antes de haver um plano para aplicar.
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });
});
