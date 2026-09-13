import { describe, expect, it } from "vitest";
import {
  linhasDoExtrato,
  extratoCsv,
  lotesDeRepasse,
  conciliarRepasses,
  normalizarContrato,
  validarContrato,
  referenciaDoContrato,
  lancamentoDoContrato,
} from "./greenPayStatementDomain.js";

describe("extrato", () => {
  const lancamentos = [
    { tipo: "entrega", status: "pago", dataServico: "2026-01-05", valor: 10, referencia: "op1" },
    { tipo: "km", status: "aprovado", dataServico: "2026-01-20", valor: 5, referencia: "op2" },
    { tipo: "desconto", status: "pendente", dataServico: "2026-02-01", valor: -3, observacao: "avaria" },
  ];
  it("filtra pela janela e ordena do mais recente ao mais antigo", () => {
    const linhas = linhasDoExtrato(lancamentos, { de: "2026-01-01", ate: "2026-01-31" });
    expect(linhas).toHaveLength(2);
    expect(linhas[0].data).toBe("2026-01-20"); // mais recente primeiro
    expect(linhas[1].data).toBe("2026-01-05");
  });
  it("CSV com cabeçalho, separador ; e valor com 2 casas", () => {
    const csv = extratoCsv(linhasDoExtrato(lancamentos.slice(0, 1)));
    const linhas = csv.split("\n");
    expect(linhas[0]).toBe("Data;Tipo;Situação;Referência;Valor (R$)");
    expect(linhas[1]).toBe("2026-01-05;Entrega;Pago;op1;10.00");
  });
  it("escapa campo com ; ou aspas", () => {
    const csv = extratoCsv([{ data: "2026-01-05", tipoRotulo: "Ajuste", statusRotulo: "Pago", referencia: 'bônus "extra"; jan', valor: 5 }]);
    expect(csv).toContain('"bônus ""extra""; jan"');
  });
});

describe("conciliação do repasse", () => {
  const pagos = [
    { status: "pago", settlementId: "s1", driverId: "d1", valor: 100 },
    { status: "pago", settlementId: "s1", driverId: "d1", valor: 50 },
    { status: "pago", settlementId: "s2", driverId: "d2", valor: 80 },
    { status: "pago", settlementId: "s3", driverId: "d3", valor: 40 },
    { status: "aprovado", settlementId: "s9", driverId: "d9", valor: 999 }, // não pago, ignorado
  ];
  it("agrupa os lotes pagos por settlement", () => {
    const lotes = lotesDeRepasse(pagos);
    expect(lotes).toHaveLength(3);
    expect(lotes.find((l) => l.settlementId === "s1").total).toBe(150);
  });
  it("confere, aponta divergência, sem-retorno e saída órfã", () => {
    const retornos = [
      { referenciaExterna: "s1", valor: 150, idExterno: "x1" }, // confere
      { referenciaExterna: "s2", valor: 70, idExterno: "x2" }, // diverge (80 esperado)
      { referenciaExterna: "s7", valor: 25, idExterno: "x7" }, // sem lote → saída órfã
      // s3 pago no razão, sem retorno externo → sem_retorno
    ];
    const c = conciliarRepasses(pagos, retornos);
    expect(c.conferido.map((x) => x.settlementId)).toEqual(["s1"]);
    expect(c.divergente).toHaveLength(1);
    expect(c.divergente[0].diferenca).toBe(-10);
    expect(c.semRetorno.map((x) => x.settlementId)).toEqual(["s3"]);
    expect(c.semLancamento.map((x) => x.settlementId)).toEqual(["s7"]);
    expect(c.resumo.ok).toBe(false); // há divergência e saída órfã
  });
  it("tudo batendo, sem órfã: ok", () => {
    const retornos = [
      { referenciaExterna: "s1", valor: 150 },
      { referenciaExterna: "s2", valor: 80 },
      { referenciaExterna: "s3", valor: 40 },
    ];
    expect(conciliarRepasses(pagos, retornos).resumo.ok).toBe(true);
  });
});

describe("contratos de ganho recorrente", () => {
  it("normaliza dia (1–28) e valor; ativo por padrão", () => {
    const c = normalizarContrato({ driverId: "d1", descricao: "Ajuda", valor: 300, diaDoMes: 40 });
    expect(c.diaDoMes).toBe(28);
    expect(c.ativo).toBe(true);
  });
  it("valida motorista, descrição e valor > 0", () => {
    expect(validarContrato({})).toMatch(/motorista/i);
    expect(validarContrato({ driverId: "d1" })).toMatch(/descreva/i);
    expect(validarContrato({ driverId: "d1", descricao: "x" })).toMatch(/valor/i);
    expect(validarContrato({ driverId: "d1", descricao: "x", valor: 1 })).toBe("");
  });
  it("gera o lançamento do mês com referência única (idempotência)", () => {
    const l = lancamentoDoContrato({ id: "k1", driverId: "d1", descricao: "Ajuda de custo", valor: 300, diaDoMes: 5 }, "2026-03");
    expect(l.tipo).toBe("contrato");
    expect(l.valor).toBe(300);
    expect(l.dataServico).toBe("2026-03-05");
    expect(l.idempotencia).toBe(referenciaDoContrato("k1", "2026-03"));
  });
  it("contrato inativo ou mês inválido não gera nada", () => {
    expect(lancamentoDoContrato({ id: "k1", driverId: "d1", descricao: "x", valor: 300, ativo: false }, "2026-03")).toBe(null);
    expect(lancamentoDoContrato({ id: "k1", driverId: "d1", descricao: "x", valor: 300 }, "2026")).toBe(null);
  });
});
