import { describe, expect, it } from "vitest";
import {
  bloqueioPorFechamento,
  conciliacaoConfiavel,
  diasEntre,
  encargosDoAtraso,
  hashDaLinhaDoExtrato,
  mesDeCompetencia,
  periodoTravado,
  resultadoPorEixo,
  saldoDaConta,
  sugerirConciliacao,
  validateBankAccount,
  validatePeriodClose,
  validateStatementLine,
  valorDevido,
} from "./treasuryDomain.js";

const titulo = (extra = {}) => ({
  id: extra.id || "t1",
  tipo: extra.tipo || "revenue",
  valor: extra.valor ?? 1000,
  valorPago: extra.valorPago ?? 0,
  vencimentoEm: extra.vencimentoEm ?? "2026-03-10",
  competenciaEm: extra.competenciaEm,
  mesReferencia: extra.mesReferencia,
  statusFinanceiro: extra.statusFinanceiro || "pending",
  multaPercent: extra.multaPercent ?? 2,
  jurosMesPercent: extra.jurosMesPercent ?? 1,
  numeroDocumento: extra.numeroDocumento || "",
  contraparte: extra.contraparte || "",
  costCenterId: extra.costCenterId,
  accountId: extra.accountId,
  conciliadoEm: extra.conciliadoEm,
});

describe("diasEntre", () => {
  it("conta dias inteiros em UTC e vira o mês", () => {
    expect(diasEntre("2026-03-10", "2026-03-20")).toBe(10);
    expect(diasEntre("2026-01-31", "2026-02-01")).toBe(1);
    expect(diasEntre("2026-03-20", "2026-03-10")).toBe(-10);
    expect(diasEntre("2026-03-10", "2026-03-10")).toBe(0);
  });

  it("devolve null para data inválida em vez de NaN", () => {
    expect(diasEntre("", "2026-03-10")).toBeNull();
    expect(diasEntre("10/03/2026", "2026-03-10")).toBeNull();
  });
});

describe("multa e juros do atraso", () => {
  it("não cobra nada antes do vencimento", () => {
    expect(encargosDoAtraso(titulo(), "2026-03-05")).toMatchObject({ multa: 0, juros: 0, total: 0 });
    // No próprio dia do vencimento também não: o prazo é até o fim do dia.
    expect(encargosDoAtraso(titulo(), "2026-03-10").total).toBe(0);
  });

  it("multa é única e juros são proporcionais aos dias", () => {
    // 1000 aberto, multa 2% = 20; juros 1%/mês por 30 dias = 10.
    expect(encargosDoAtraso(titulo(), "2026-04-09")).toMatchObject({ multa: 20, juros: 10, total: 30, dias: 30 });
    // Metade do mês: metade dos juros, a multa não dobra.
    expect(encargosDoAtraso(titulo(), "2026-03-25")).toMatchObject({ multa: 20, juros: 5, total: 25, dias: 15 });
  });

  it("calcula sobre o saldo ABERTO, não sobre o valor de face", () => {
    const parcial = titulo({ valorPago: 600 });
    expect(encargosDoAtraso(parcial, "2026-04-09")).toMatchObject({ multa: 8, juros: 4 });
  });

  it("título quitado não rende encargo", () => {
    expect(encargosDoAtraso(titulo({ valorPago: 1000 }), "2026-05-01").total).toBe(0);
  });

  it("título cancelado não rende encargo", () => {
    expect(encargosDoAtraso(titulo({ statusFinanceiro: "cancelled" }), "2026-05-01").total).toBe(0);
  });

  it("sem vencimento, dias é null e não há encargo", () => {
    const semData = encargosDoAtraso(titulo({ vencimentoEm: "" }), "2026-05-01");
    expect(semData.dias).toBeNull();
    expect(semData.total).toBe(0);
  });

  it("percentual negativo não gera crédito", () => {
    expect(encargosDoAtraso(titulo({ multaPercent: -5, jurosMesPercent: -1 }), "2026-04-09").total).toBe(0);
  });

  it("valorDevido mostra a composição, não só o total", () => {
    // Um total sem composição é um número que o cliente contesta e ninguém
    // sabe explicar.
    expect(valorDevido(titulo(), "2026-04-09")).toMatchObject({
      principal: 1000, multa: 20, juros: 10, total: 1030, diasDeAtraso: 30,
    });
  });

  it("valorDevido não reporta atraso negativo", () => {
    expect(valorDevido(titulo(), "2026-03-01").diasDeAtraso).toBe(0);
  });
});

describe("saldo da conta bancária", () => {
  const conta = { id: "bb", saldoInicial: 5000 };

  it("soma só as linhas conciliadas", () => {
    // Título marcado como pago mas não casado com o extrato não moveu o banco.
    const linhas = [
      { bankAccountId: "bb", amount: 1500, conciliadoEm: "2026-03-11" },
      { bankAccountId: "bb", amount: -400, conciliadoEm: "2026-03-12" },
      { bankAccountId: "bb", amount: 9999 },
    ];
    expect(saldoDaConta(conta, linhas)).toBe(6100);
  });

  it("ignora linha de outra conta", () => {
    expect(saldoDaConta(conta, [{ bankAccountId: "itau", amount: 1000, conciliadoEm: "2026-03-11" }])).toBe(5000);
  });

  it("conta sem movimento vale o saldo inicial", () => {
    expect(saldoDaConta(conta, [])).toBe(5000);
  });
});

describe("sugestão de conciliação", () => {
  const linha = (extra = {}) => ({
    bankAccountId: "bb",
    occurredOn: extra.occurredOn || "2026-03-10",
    amount: extra.amount ?? 1000,
    description: extra.description || "",
    document: extra.document || "",
  });

  it("casa por valor exato e mesma data com pontuação alta", () => {
    const candidatos = sugerirConciliacao(linha(), [titulo()]);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].pontos).toBeGreaterThanOrEqual(75);
    expect(candidatos[0].motivos).toContain("valor exato");
    expect(candidatos[0].motivos).toContain("mesma data");
  });

  it("entrada no banco não casa com custo, e saída não casa com receita", () => {
    expect(sugerirConciliacao(linha({ amount: 1000 }), [titulo({ tipo: "cost" })])).toHaveLength(0);
    expect(sugerirConciliacao(linha({ amount: -1000 }), [titulo({ tipo: "revenue" })])).toHaveLength(0);
    expect(sugerirConciliacao(linha({ amount: -1000 }), [titulo({ tipo: "cost" })])).toHaveLength(1);
  });

  it("valor que não bate não é candidato, mesmo na mesma data", () => {
    // Data e descrição sozinhas casariam qualquer coisa do dia.
    expect(sugerirConciliacao(linha({ amount: 777 }), [titulo()])).toHaveLength(0);
  });

  it("casa também com o saldo aberto de uma baixa parcial", () => {
    const parcial = titulo({ valor: 1000, valorPago: 600 });
    const candidatos = sugerirConciliacao(linha({ amount: 400 }), [parcial]);
    expect(candidatos[0].motivos).toContain("valor do saldo aberto");
  });

  it("documento e contraparte na descrição aumentam a confiança", () => {
    const comDoc = sugerirConciliacao(
      linha({ description: "TED RECEBIDA TRANSPORTES ALFA NF 12345" }),
      [titulo({ numeroDocumento: "12345", contraparte: "Transportes Alfa" })],
    );
    expect(comDoc[0].motivos).toContain("documento na descrição");
    expect(comDoc[0].motivos).toContain("contraparte na descrição");
  });

  it("respeita a tolerância de data", () => {
    expect(sugerirConciliacao(linha({ occurredOn: "2026-03-12" }), [titulo()])[0].motivos)
      .toContain("2 dia(s) de diferença");
    // Fora da tolerância, sobra só o valor — que ainda passa do corte de 50.
    const distante = sugerirConciliacao(linha({ occurredOn: "2026-06-01" }), [titulo()]);
    expect(distante[0].pontos).toBe(60);
  });

  it("não sugere lançamento já conciliado", () => {
    expect(sugerirConciliacao(linha(), [titulo({ conciliadoEm: "2026-03-11" })])).toHaveLength(0);
  });

  it("ordena do mais provável e limita a cinco", () => {
    const muitos = Array.from({ length: 8 }, (_, i) => titulo({ id: `t${i}` }));
    expect(sugerirConciliacao(linha(), muitos)).toHaveLength(5);
  });
});

describe("confiança da conciliação", () => {
  it("um candidato forte e isolado é confiável", () => {
    expect(conciliacaoConfiavel([{ entryId: "a", pontos: 90 }])).toMatchObject({ entryId: "a" });
  });

  it("empate não é confiável — escolher o primeiro seria chutar", () => {
    expect(conciliacaoConfiavel([{ entryId: "a", pontos: 90 }, { entryId: "b", pontos: 88 }])).toBeNull();
  });

  it("candidato isolado mas fraco não é confiável", () => {
    expect(conciliacaoConfiavel([{ entryId: "a", pontos: 60 }])).toBeNull();
  });

  it("diferença grande entre o primeiro e o segundo é confiável", () => {
    expect(conciliacaoConfiavel([{ entryId: "a", pontos: 95 }, { entryId: "b", pontos: 60 }]))
      .toMatchObject({ entryId: "a" });
  });

  it("lista vazia não é confiável", () => {
    expect(conciliacaoConfiavel([])).toBeNull();
  });
});

describe("hash da linha do extrato", () => {
  it("é determinístico e igual para a mesma linha", () => {
    const linha = { occurredOn: "2026-03-10", amount: 1000, description: "TED  RECEBIDA", document: "123" };
    expect(hashDaLinhaDoExtrato(linha)).toBe(hashDaLinhaDoExtrato({ ...linha }));
  });

  it("normaliza espaço e caixa da descrição", () => {
    expect(hashDaLinhaDoExtrato({ occurredOn: "2026-03-10", amount: 10, description: "TED   ted" }))
      .toBe(hashDaLinhaDoExtrato({ occurredOn: "2026-03-10", amount: 10, description: "ted ted" }));
  });

  it("difere quando o valor ou a data diferem", () => {
    const base = { occurredOn: "2026-03-10", amount: 1000, description: "x" };
    expect(hashDaLinhaDoExtrato(base)).not.toBe(hashDaLinhaDoExtrato({ ...base, amount: 1000.01 }));
    expect(hashDaLinhaDoExtrato(base)).not.toBe(hashDaLinhaDoExtrato({ ...base, occurredOn: "2026-03-11" }));
  });
});

describe("fechamento de período", () => {
  const periodos = [
    { referenceMonth: "2026-01", status: "fechado" },
    { referenceMonth: "2026-02", status: "reaberto" },
  ];

  it("mês fechado trava; reaberto não", () => {
    expect(periodoTravado("2026-01", periodos)).toBe(true);
    expect(periodoTravado("2026-02", periodos)).toBe(false);
    expect(periodoTravado("2026-03", periodos)).toBe(false);
  });

  it("a competência sai de competenciaEm, mesReferencia ou vencimento, nessa ordem", () => {
    expect(mesDeCompetencia({ competenciaEm: "2026-01-15", mesReferencia: "2026-05", vencimentoEm: "2026-09-01" }))
      .toBe("2026-01");
    expect(mesDeCompetencia({ mesReferencia: "2026-05", vencimentoEm: "2026-09-01" })).toBe("2026-05");
    expect(mesDeCompetencia({ vencimentoEm: "2026-09-01" })).toBe("2026-09");
    expect(mesDeCompetencia({})).toBe("");
  });

  it("bloqueia lançamento com competência em mês fechado", () => {
    expect(bloqueioPorFechamento({ competenciaEm: "2026-01-20" }, periodos)).toMatch(/2026-01 está fechada/);
    expect(bloqueioPorFechamento({ competenciaEm: "2026-03-20" }, periodos)).toBe("");
  });

  it("lançamento sem competência não é bloqueado", () => {
    expect(bloqueioPorFechamento({}, periodos)).toBe("");
  });
});

describe("resultado por eixo", () => {
  const lancamentos = [
    titulo({ id: "a", tipo: "revenue", valor: 10000, costCenterId: "cc-mid" }),
    titulo({ id: "b", tipo: "cost", valor: 4000, costCenterId: "cc-mid" }),
    titulo({ id: "c", tipo: "commission", valor: 1000, costCenterId: "cc-mid" }),
    titulo({ id: "d", tipo: "revenue", valor: 2000, costCenterId: "cc-last" }),
    titulo({ id: "e", tipo: "cost", valor: 500 }),
  ];

  it("separa receita, custo e comissão por eixo", () => {
    const linhas = resultadoPorEixo(lancamentos, "costCenterId");
    const mid = linhas.find((l) => l.chave === "cc-mid");
    expect(mid).toMatchObject({ receita: 10000, custo: 4000, comissao: 1000, resultado: 5000, margem: 50 });
  });

  it("ordena por receita e agrupa o que não tem classificação", () => {
    const linhas = resultadoPorEixo(lancamentos, "costCenterId");
    expect(linhas.map((l) => l.chave)).toEqual(["cc-mid", "cc-last", "(sem classificação)"]);
  });

  it("margem é null sem receita, não 0%", () => {
    // Dividir por zero não é zero por cento.
    const semReceita = resultadoPorEixo([titulo({ tipo: "cost", valor: 500, costCenterId: "x" })]);
    expect(semReceita[0].margem).toBeNull();
    expect(semReceita[0].resultado).toBe(-500);
  });

  it("ignora lançamento cancelado", () => {
    const comCancelado = resultadoPorEixo([
      titulo({ tipo: "revenue", valor: 1000, costCenterId: "x" }),
      titulo({ tipo: "revenue", valor: 9999, costCenterId: "x", statusFinanceiro: "cancelled" }),
    ]);
    expect(comCancelado[0].receita).toBe(1000);
  });

  it("funciona com o eixo do plano de contas", () => {
    const linhas = resultadoPorEixo(
      [titulo({ tipo: "revenue", valor: 100, accountId: "3.1" })],
      "accountId",
    );
    expect(linhas[0].chave).toBe("3.1");
  });
});

describe("validação", () => {
  it("conta bancária exige nome e tipo conhecido", () => {
    expect(validateBankAccount({ name: "Banco do Brasil", kind: "corrente" })).toBe("");
    expect(validateBankAccount({ kind: "corrente" })).toMatch(/nome/i);
    expect(validateBankAccount({ name: "X", kind: "inventado" })).toMatch(/tipo/i);
    expect(validateBankAccount({ name: "X" })).toBe("");
  });

  it("linha de extrato exige conta, data e valor diferente de zero", () => {
    const ok = { bankAccountId: "bb", occurredOn: "2026-03-10", amount: 100 };
    expect(validateStatementLine(ok)).toBe("");
    expect(validateStatementLine({ ...ok, bankAccountId: "" })).toMatch(/conta/i);
    expect(validateStatementLine({ ...ok, occurredOn: "" })).toMatch(/data/i);
    // O banco não registra movimento de nada.
    expect(validateStatementLine({ ...ok, amount: 0 })).toMatch(/zero/i);
  });

  it("fechamento exige mês AAAA-MM válido", () => {
    expect(validatePeriodClose("2026-03")).toBe("");
    expect(validatePeriodClose("2026-13")).toMatch(/AAAA-MM/);
    expect(validatePeriodClose("2026-3")).toMatch(/AAAA-MM/);
    expect(validatePeriodClose("")).toMatch(/AAAA-MM/);
  });
});
