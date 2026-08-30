import { describe, expect, it } from "vitest";
import { resumoContaConectada } from "./contaConectadaDomain.js";

// A conta 360 conectada tem de ler operação e financeiro pela MESMA regra das
// telas de origem. Estes testes prendem "o que está em aberto" e "o que está
// vencido" à situação real, não a um segundo cálculo escondido no CRM.

const HOJE = Date.parse("2026-08-30T12:00:00Z");

const operacoes = [
  { id: "o1", clientId: "c1", referencia: "OP-1", situacao: "in_transit", prometidoEm: "2026-08-20", ocorrencias: 2 },
  { id: "o2", clientId: "c1", referencia: "OP-2", situacao: "active", prometidoEm: "2026-09-10" },
  { id: "o3", clientId: "c1", referencia: "OP-3", situacao: "delivered", entregueEm: "2026-08-10" },
  { id: "o4", clientId: "c2", referencia: "OP-4", situacao: "active" },
];

const financeiro = [
  { id: "f1", clientId: "c1", tipo: "revenue", valor: 1000, vencimentoEm: "2026-08-01" },
  { id: "f2", clientId: "c1", tipo: "revenue", valor: 500, vencimentoEm: "2026-09-20" },
  { id: "f3", clientId: "c1", tipo: "revenue", valor: 900, vencimentoEm: "2026-07-01", pagoEm: "2026-07-02" },
  { id: "f4", clientId: "c1", tipo: "cost", valor: 300, vencimentoEm: "2026-08-01" },
  { id: "f5", clientId: "c2", tipo: "revenue", valor: 700, vencimentoEm: "2026-08-01" },
];

describe("resumo da conta conectada", () => {
  const r = resumoContaConectada({ clientId: "c1", operations: operacoes, financial: financeiro, agora: HOJE });

  it("conta só as operações em andamento da conta (nem entregue, nem de outro cliente)", () => {
    expect(r.totalAndamento).toBe(2);
    expect(r.operacoesAndamento.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
  });

  it("marca a operação prometida no passado e não entregue como atrasada, e a lista vem primeiro", () => {
    expect(r.operacoesAtrasadas).toBe(1);
    expect(r.operacoesAndamento[0].id).toBe("o1");
    expect(r.operacoesAndamento[0].atrasada).toBe(true);
  });

  it("soma as ocorrências abertas da conta", () => {
    expect(r.totalOcorrencias).toBe(2);
    expect(r.ocorrenciasAbertas).toHaveLength(1);
  });

  it("títulos a receber em aberto ignoram pagos, custos e outras contas", () => {
    expect(r.titulosAbertos.map((t) => t.id)).toEqual(["f1", "f2"]);
    expect(r.totalAReceber).toBe(1500);
  });

  it("marca vencidos por data e soma o vencido separadamente", () => {
    expect(r.qtdVencidos).toBe(1);
    expect(r.totalVencido).toBe(1000);
    expect(r.titulosAbertos.find((t) => t.id === "f1").atrasado).toBe(true);
    expect(r.titulosAbertos.find((t) => t.id === "f2").atrasado).toBe(false);
  });

  it("sem cliente, devolve o resumo vazio sem quebrar", () => {
    const vazio = resumoContaConectada({ clientId: "", operations: operacoes, financial: financeiro });
    expect(vazio.temAlgo).toBe(false);
    expect(vazio.totalAReceber).toBe(0);
  });

  it("aceita também os campos em inglês do resumo (kind/amount/dueDate)", () => {
    const r2 = resumoContaConectada({
      clientId: "c9",
      financial: [{ id: "x", clientId: "c9", kind: "revenue", amount: 250, dueDate: "2026-08-01" }],
      agora: HOJE,
    });
    expect(r2.totalAReceber).toBe(250);
    expect(r2.qtdVencidos).toBe(1);
  });
});
