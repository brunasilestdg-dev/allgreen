import { describe, it, expect } from "vitest";
import {
  fatorGrossUp,
  precoPorGrossUp,
  calcularDre,
  dimensionarHeadcount,
  grossUpDaRegua,
} from "./operationEngineDomain.js";
import { PARAMS_OPERACAO_PADRAO } from "./operationParamsSeed.js";

describe("fatorGrossUp", () => {
  it("reproduz o 1.3252 da régua da titular", () => {
    const f = fatorGrossUp({ icmsPct: 0.12, pisCofinsPct: 0.0925, comissaoPct: 0.05 });
    expect(f).toBeCloseTo(1.3252, 4);
  });
  it("devolve null quando o tributo estoura 100% (preço não existe)", () => {
    expect(fatorGrossUp({ icmsPct: 1, pisCofinsPct: 0.09 })).toBeNull();
    expect(fatorGrossUp({ icmsPct: 0.12, pisCofinsPct: 0.9, comissaoPct: 0.2 })).toBeNull();
  });
  it("devolve null quando falta dado essencial", () => {
    expect(fatorGrossUp({ icmsPct: 0.12 })).toBeNull();
    expect(fatorGrossUp({})).toBeNull();
  });
  it("comissão ausente conta como zero", () => {
    const semComissao = fatorGrossUp({ icmsPct: 0.12, pisCofinsPct: 0.0925 });
    const comZero = fatorGrossUp({ icmsPct: 0.12, pisCofinsPct: 0.0925, comissaoPct: 0 });
    expect(semComissao).toBeCloseTo(comZero, 10);
  });
});

describe("precoPorGrossUp", () => {
  const gu = fatorGrossUp({ icmsPct: 0.12, pisCofinsPct: 0.0925, comissaoPct: 0.05 });
  it("aplica overhead, margem e gross-up sobre o custo direto", () => {
    // 1000 × 1,10 × 1,30 × 1,3252 = 1895,04
    expect(precoPorGrossUp(1000, { overheadPct: 0.1, margemPct: 0.3, grossUpFator: gu })).toBeCloseTo(1895.04, 1);
  });
  it("custo zero dá preço zero, não null", () => {
    expect(precoPorGrossUp(0, { grossUpFator: gu })).toBe(0);
  });
  it("null quando falta custo ou gross-up, ou custo negativo", () => {
    expect(precoPorGrossUp(undefined, { grossUpFator: gu })).toBeNull();
    expect(precoPorGrossUp(1000, {})).toBeNull();
    expect(precoPorGrossUp(-5, { grossUpFator: gu })).toBeNull();
  });
});

describe("calcularDre", () => {
  it("desconta custo, overhead, comissão e impostos da receita", () => {
    const dre = calcularDre({ receita: 10000, custoDireto: 6000, overheadPct: 0.1, comissaoPct: 0.05, impostosPct: 0.1425 });
    expect(dre.overhead).toBe(600);
    expect(dre.comissao).toBe(500);
    expect(dre.impostos).toBe(1425);
    expect(dre.custosOperacionais).toBe(6600);
    expect(dre.margemBruta).toBe(2900); // 10000 - 6600 - 500
    expect(dre.margemLiquida).toBe(1475); // 2900 - 1425
    expect(dre.margemPct).toBeCloseTo(14.75, 2);
  });
  it("margemPct é null quando não há receita (evita divisão por zero)", () => {
    const dre = calcularDre({ receita: 0, custoDireto: 0 });
    expect(dre.margemPct).toBeNull();
  });
  it("null quando falta receita ou custo", () => {
    expect(calcularDre({ custoDireto: 100 })).toBeNull();
    expect(calcularDre({ receita: 100 })).not.toBeNull(); // custo default 0
  });
});

describe("dimensionarHeadcount", () => {
  const hc = PARAMS_OPERACAO_PADRAO.headcount;
  it("multiplica o núcleo fixo pelo número de bases", () => {
    const um = dimensionarHeadcount(hc, { basesQtd: 1 });
    const tres = dimensionarHeadcount(hc, { basesQtd: 3 });
    expect(tres.custoNucleo).toBeCloseTo(um.custoNucleo * 3, 2);
  });
  it("aplica a reserva de motorista à força variável", () => {
    const r = dimensionarHeadcount(hc, { basesQtd: 1, motoristas: 10 });
    // 10 motoristas × (1 + 0,20) = 12 dimensionados
    expect(r.motoristasDimensionados).toBeCloseTo(10 * (1 + hc.reserva_motorista_pct), 2);
  });
  it("núcleo por base = líder + auxiliar × qtd", () => {
    const nb = hc.camadas.nucleo_base;
    const esperado = nb.lider_operacoes_mes + nb.auxiliar_mes * nb.qtd_auxiliares;
    const r = dimensionarHeadcount(hc, { basesQtd: 1 });
    expect(r.nucleoPorBase).toBeCloseTo(esperado, 2);
  });
  it("bases nunca cai abaixo de 1", () => {
    const r = dimensionarHeadcount(hc, { basesQtd: 0 });
    expect(r.bases).toBe(1);
  });
});

describe("grossUpDaRegua", () => {
  it("lê os tributos da régua padrão e casa com o fator declarado", () => {
    const f = grossUpDaRegua(PARAMS_OPERACAO_PADRAO);
    expect(f).toBeCloseTo(PARAMS_OPERACAO_PADRAO.globais.impostos.gross_up_fator, 3);
  });
});
