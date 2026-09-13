import { describe, expect, it } from "vitest";
import {
  provenance, pickBestProvenance, isStale, isMeasured, hasValue,
  describeProvenance, MEASUREMENT_TYPES, CONFIDENCE_LEVELS,
} from "./dataProvenanceDomain.js";

describe("envelope de proveniência", () => {
  it("normaliza tipo e confiança; medido de OCPP", () => {
    const p = provenance(72, { unit: "kWh", source: "OCPP", measurementType: "measured", confidence: "high" });
    expect(p.value).toBe(72);
    expect(p.measurementType).toBe(MEASUREMENT_TYPES.MEASURED);
    expect(p.confidence).toBe(CONFIDENCE_LEVELS.HIGH);
    expect(isMeasured(p)).toBe(true);
  });

  it("dado ausente NÃO é confiável: value null força confiança UNKNOWN", () => {
    const p = provenance(null, { confidence: "high", measurementType: "estimated" });
    expect(hasValue(p)).toBe(false);
    expect(p.confidence).toBe(CONFIDENCE_LEVELS.UNKNOWN);
  });

  it("tipo inválido cai para INFORMED; effectiveAt herda capturedAt", () => {
    const p = provenance(10, { measurementType: "chute", capturedAt: "2026-01-01T00:00:00Z" });
    expect(p.measurementType).toBe(MEASUREMENT_TYPES.INFORMED);
    expect(p.effectiveAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("frescor (stale)", () => {
  const now = Date.parse("2026-01-10T00:00:00Z");
  it("dado recente não é stale; antigo é", () => {
    const recente = provenance(1, { capturedAt: "2026-01-09T12:00:00Z" });
    const antigo = provenance(1, { capturedAt: "2026-01-01T00:00:00Z" });
    const umDia = 24 * 3600 * 1000;
    expect(isStale(recente, { maxAgeMs: umDia, now })).toBe(false);
    expect(isStale(antigo, { maxAgeMs: umDia, now })).toBe(true);
  });
  it("sem capturedAt é considerado stale (não finge atualidade)", () => {
    expect(isStale(provenance(1, {}), { maxAgeMs: 1000, now })).toBe(true);
  });
});

describe("melhor fonte entre várias (hierarquia de verdade)", () => {
  it("medição ganha de estimativa mesmo com confiança igual", () => {
    const medido = provenance(70, { measurementType: "measured", confidence: "medium", capturedAt: "2026-01-01T00:00:00Z" });
    const estimado = provenance(78, { measurementType: "estimated", confidence: "high", capturedAt: "2026-01-05T00:00:00Z" });
    expect(pickBestProvenance([estimado, medido]).value).toBe(70);
  });

  it("tarifa contratual (informed) ganha da referência ANEEL (external)", () => {
    const contratual = provenance(0.78, { measurementType: "informed", source: "contrato" });
    const aneel = provenance(0.92, { measurementType: "external", source: "ANEEL", confidence: "high" });
    expect(pickBestProvenance([aneel, contratual]).source).toBe("contrato");
  });

  it("mesmo tipo e confiança: vence o mais recente", () => {
    const velho = provenance(1, { measurementType: "external", confidence: "high", capturedAt: "2026-01-01T00:00:00Z" });
    const novo = provenance(2, { measurementType: "external", confidence: "high", capturedAt: "2026-02-01T00:00:00Z" });
    expect(pickBestProvenance([velho, novo]).value).toBe(2);
  });

  it("fonte com valor ganha da sem valor", () => {
    const vazio = provenance(null, { measurementType: "measured" });
    const cheio = provenance(5, { measurementType: "estimated" });
    expect(pickBestProvenance([vazio, cheio]).value).toBe(5);
  });

  it("lista vazia devolve null", () => {
    expect(pickBestProvenance([])).toBeNull();
  });
});

describe("rótulo pt-BR", () => {
  it("descreve valor, fonte, tipo e confiança", () => {
    const p = provenance(72, { unit: "kWh", source: "OCPP", measurementType: "measured", confidence: "high" });
    expect(describeProvenance(p)).toBe("72 kWh · OCPP · medido · confiança alta");
  });
  it("sem valor diz 'não informado'", () => {
    expect(describeProvenance(provenance(null, {}))).toBe("não informado");
  });
});
