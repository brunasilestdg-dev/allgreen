import { describe, expect, it } from "vitest";
import {
  faixasDeAtraso,
  lancamentoParaConta,
  previsaoSemanalDeCaixa,
  proximoVencimentoMensal,
} from "./contasPonteDomain.js";

const HOJE = "2026-08-30";

describe("ponte de contas da vertical para o motor do app", () => {
  it("traduz o lançamento: receita entra, custo e comissão saem, parcial vira pagamento", () => {
    expect(lancamentoParaConta({ id: "a", tipo: "revenue", valor: 100, vencimentoEm: "2026-09-01" }).direction).toBe("receber");
    expect(lancamentoParaConta({ id: "b", tipo: "cost", valor: 100 }).direction).toBe("pagar");
    expect(lancamentoParaConta({ id: "c", tipo: "commission", valor: 100 }).direction).toBe("pagar");
    const parcial = lancamentoParaConta({ id: "d", tipo: "cost", valor: 100, valorPago: 40 });
    expect(parcial.payments).toEqual([{ amount: 40 }]);
  });

  it("classifica o atraso por faixa e ignora cancelados e quitados", () => {
    const faixas = faixasDeAtraso([
      { id: "1", tipo: "cost", valor: 100, vencimentoEm: "2026-08-25" }, // 5 dias
      { id: "2", tipo: "cost", valor: 200, vencimentoEm: "2026-08-05" }, // 25 dias
      { id: "3", tipo: "cost", valor: 300, vencimentoEm: "2026-06-01" }, // > 60
      { id: "4", tipo: "cost", valor: 400, vencimentoEm: "2026-09-15" }, // a vencer
      { id: "5", tipo: "cost", valor: 500, valorPago: 500, vencimentoEm: "2026-08-01" }, // quitado
      { id: "6", tipo: "cost", valor: 600, vencimentoEm: "2026-08-01", statusFinanceiro: "cancelled" },
    ], HOJE);
    expect(faixas.ate15.total).toBe(100);
    expect(faixas.ate30.total).toBe(200);
    expect(faixas.mais60.total).toBe(300);
    expect(faixas.aVencer.total).toBe(400);
    expect(faixas.ate60.total).toBe(0);
  });

  it("projeta a semana: atrasado cai na primeira, receita menos custo", () => {
    const semanas = previsaoSemanalDeCaixa([
      { id: "r", tipo: "revenue", valor: 1000, vencimentoEm: "2026-08-20" }, // atrasada → semana 1
      { id: "c", tipo: "cost", valor: 400, vencimentoEm: "2026-09-02" }, // semana 1 (30/08–05/09)
      { id: "f", tipo: "revenue", valor: 900, vencimentoEm: "2026-09-08" }, // semana 2
    ], { from: HOJE, weeks: 2 });
    expect(semanas).toHaveLength(2);
    expect(semanas[0].entradas).toBe(1000);
    expect(semanas[0].saidas).toBe(400);
    expect(semanas[0].acumulado).toBe(600);
    expect(semanas[1].entradas).toBe(900);
    expect(semanas[1].acumulado).toBe(1500);
  });

  it("recorrência mensal respeita mês curto e devolve vazio sem data", () => {
    expect(proximoVencimentoMensal("2026-01-31")).toBe("2026-02-28");
    expect(proximoVencimentoMensal("2026-08-15")).toBe("2026-09-15");
    expect(proximoVencimentoMensal("")).toBe("");
  });
});
