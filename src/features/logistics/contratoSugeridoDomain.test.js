import { describe, expect, it } from "vitest";
import { sugestaoDeContrato } from "./contratoSugeridoDomain.js";

const cenario = (extra = {}) => ({
  id: "cen-1",
  result: {
    productId: "middle-mile",
    selectedPrice: 42000,
    recommendedPrice: 45000,
    inputs: { contractMonths: 12 },
    assumptions: { taxPercent: 8.65 },
    ...extra.result,
  },
  ...extra,
});
const proposta = (extra = {}) => ({ id: "p1", scenarioId: "cen-1", ...extra });

describe("sugestão de contrato a partir da proposta aceita", () => {
  it("puxa o preço que a simulação aprovou (o selecionado manda)", () => {
    const s = sugestaoDeContrato(proposta(), [cenario()]);
    expect(s.valorMensal).toBe("42000");
  });

  it("cai no recomendado quando não houve preço selecionado", () => {
    const s = sugestaoDeContrato(proposta(), [cenario({ result: { selectedPrice: 0, recommendedPrice: 45000, inputs: {}, assumptions: {} } })]);
    expect(s.valorMensal).toBe("45000");
  });

  it("valor total é mensal × meses do contrato", () => {
    const s = sugestaoDeContrato(proposta(), [cenario()]);
    expect(s.valorTotal).toBe("504000");
  });

  it("sem os meses, não inventa o valor total", () => {
    const s = sugestaoDeContrato(proposta(), [cenario({ result: { selectedPrice: 42000, inputs: {}, assumptions: {} } })]);
    expect(s.valorMensal).toBe("42000");
    expect(s.valorTotal).toBeUndefined();
  });

  it("traz serviço e imposto do cenário", () => {
    const s = sugestaoDeContrato(proposta(), [cenario()]);
    expect(s.servicoId).toBe("middle-mile");
    expect(s.aliquotaImposto).toBe("8.65");
  });

  it("nunca chuta 0: campo sem origem confiável fica de fora", () => {
    const s = sugestaoDeContrato(proposta(), [cenario({ result: { productId: "last-mile", selectedPrice: 0, recommendedPrice: 0, inputs: { contractMonths: 0 }, assumptions: { taxPercent: 0 } } })]);
    expect(s.valorMensal).toBeUndefined();
    expect(s.valorTotal).toBeUndefined();
    expect(s.aliquotaImposto).toBeUndefined();
    expect(s.servicoId).toBe("last-mile");
  });

  it("proposta sem cenário vinculado não sugere nada", () => {
    expect(sugestaoDeContrato(proposta({ scenarioId: "some" }), [cenario()])).toEqual({});
    expect(sugestaoDeContrato(proposta(), [])).toEqual({});
  });

  it("aguenta entrada ausente sem quebrar", () => {
    expect(sugestaoDeContrato(null, [])).toEqual({});
    expect(sugestaoDeContrato(undefined)).toEqual({});
  });
});
