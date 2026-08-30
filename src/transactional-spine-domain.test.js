import { describe, expect, it } from "vitest";
import {
  canTransitionServiceOrder,
  precoDaSimulacao,
  precoUnitarioDaOs,
  serviceOrderAmounts,
  settlementState,
  validateAllocation,
} from "./features/logistics/transactionalSpineDomain.js";

describe("espinha transacional To Do Green", () => {
  it("impede pular a execução da ordem de serviço", () => {
    expect(canTransitionServiceOrder("draft", "released")).toBe(true);
    expect(canTransitionServiceOrder("draft", "completed")).toBe(false);
    expect(canTransitionServiceOrder("completed", "in_progress")).toBe(false);
  });

  it("calcula o valor faturável sem permitir desconto acima do bruto", () => {
    expect(serviceOrderAmounts({ quantity: 10, unitPrice: 12, discountAmount: 200, taxAmount: 5 }))
      .toEqual({ quantity: 10, unitPrice: 12, grossAmount: 120, discountAmount: 120, taxAmount: 5, netAmount: 5 });
  });

  it("exige rateio integral e pelo menos uma dimensão", () => {
    expect(validateAllocation(100, [{ amount: 60, clientId: "c" }, { amount: 40, vehicleId: "v" }]).valid).toBe(true);
    expect(validateAllocation(100, [{ amount: 90, clientId: "c" }]).valid).toBe(false);
    expect(validateAllocation(100, [{ amount: 100 }]).valid).toBe(false);
  });

  it("não permite baixa maior que o saldo", () => {
    expect(settlementState(100, 40)).toMatchObject({ valid: true, remaining: 60, status: "partial" });
    expect(settlementState(100, 100)).toMatchObject({ valid: true, remaining: 0, status: "settled" });
    expect(settlementState(100, 101).valid).toBe(false);
  });
});

describe("aceite → OS: herança de preço", () => {
  it("lê o preço recomendado da simulação pelas chaves conhecidas", () => {
    expect(precoDaSimulacao({ precoRecomendado: 1200 })).toBe(1200);
    expect(precoDaSimulacao({ recommendedPrice: 999 })).toBe(999);
    expect(precoDaSimulacao({ custoCarregado: 500 })).toBe(null); // não é o preço
    expect(precoDaSimulacao(null)).toBe(null);
  });

  it("o preço digitado vence tudo (por unidade)", () => {
    const r = precoUnitarioDaOs({ unitPrice: 800, contractMonthlyValue: 1000, simulacaoResult: { precoRecomendado: 1200 } });
    expect(r).toEqual({ preco: 800, origem: "digitado", modo: "unidade" });
  });

  it("valor do contrato sem marca é MENSAL: não multiplica pela quantidade", () => {
    const r = precoUnitarioDaOs({ unitPrice: 0, contractValue: 1000, simulacaoResult: { precoRecomendado: 1200 } });
    expect(r).toEqual({ preco: 1000, origem: "contrato", modo: "mensal" });
  });

  it("contrato marcado por_unidade herda como preço por unidade", () => {
    const r = precoUnitarioDaOs({ unitPrice: 0, contractValue: 50, contractPricingMode: "por_unidade" });
    expect(r).toEqual({ preco: 50, origem: "contrato", modo: "unidade" });
  });

  it("sem contrato com valor, cai para o preço da simulação (por unidade)", () => {
    const r = precoUnitarioDaOs({ unitPrice: 0, contractValue: 0, simulacaoResult: { precoRecomendado: 1200 } });
    expect(r).toEqual({ preco: 1200, origem: "simulacao", modo: "unidade" });
  });

  it("sem nenhuma fonte, não inventa preço", () => {
    expect(precoUnitarioDaOs({ unitPrice: 0, contractValue: 0, simulacaoResult: {} })).toEqual({ preco: null, origem: "ausente", modo: "unidade" });
  });

  it("OS mensal não multiplica o valor fechado pela quantidade de viagens", () => {
    const mensal = serviceOrderAmounts({ quantity: 20, unitPrice: 30000, mode: "mensal" });
    expect(mensal.grossAmount).toBe(30000);
    expect(mensal.netAmount).toBe(30000);
    const porViagem = serviceOrderAmounts({ quantity: 20, unitPrice: 300, mode: "unidade" });
    expect(porViagem.grossAmount).toBe(6000);
  });
});
