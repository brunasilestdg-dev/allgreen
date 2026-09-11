import { describe, expect, it } from "vitest";
import { atribuicoesDeTours, toursAplicaveis, toursSemMotorista } from "./DispatchPanel.jsx";

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
