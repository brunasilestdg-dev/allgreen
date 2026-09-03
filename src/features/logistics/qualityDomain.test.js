import { describe, expect, it } from "vitest";
import {
  resumoQualidade,
  validarNaoConformidade,
  normalizarGravidade,
  normalizarSituacaoQualidade,
  normalizarTipo,
  situacaoEncerrada,
} from "./qualityDomain.js";

const HOJE = Date.parse("2026-08-30T12:00:00Z");

describe("domínio de qualidade", () => {
  it("exige título para registrar a não conformidade", () => {
    expect(validarNaoConformidade({})).toMatch(/título/i);
    expect(validarNaoConformidade({ titulo: "Avaria na doca" })).toBe("");
    expect(validarNaoConformidade({ title: "SLA estourado" })).toBe("");
  });

  it("normaliza valores fora da lista para o padrão", () => {
    expect(normalizarTipo("foguete")).toBe("processo");
    expect(normalizarGravidade("apocaliptica")).toBe("media");
    expect(normalizarSituacaoQualidade("inventada")).toBe("aberta");
    expect(normalizarTipo("sla")).toBe("sla");
    expect(normalizarGravidade("critica")).toBe("critica");
  });

  it("sabe quais situações encerram a NC", () => {
    expect(situacaoEncerrada("resolvida")).toBe(true);
    expect(situacaoEncerrada("aberta")).toBe(false);
    expect(situacaoEncerrada("reincidente")).toBe(false);
  });

  it("resume abertas, críticas, atrasadas e reincidentes", () => {
    const registros = [
      { id: "1", situacao: "aberta", gravidade: "critica", prazo: "2026-08-01" }, // aberta, crítica, atrasada
      { id: "2", situacao: "em_acao", gravidade: "media", prazo: "2999-01-01" }, // aberta, no prazo
      { id: "3", situacao: "resolvida", gravidade: "alta", prazo: "2026-01-01" }, // encerrada, não conta atraso
      { id: "4", situacao: "reincidente", gravidade: "alta" }, // aberta e reincidente
    ];
    const r = resumoQualidade(registros, HOJE);
    expect(r.total).toBe(4);
    expect(r.abertas).toBe(3);
    expect(r.criticas).toBe(1);
    expect(r.atrasadas).toBe(1);
    expect(r.reincidentes).toBe(1);
    expect(r.resolvidas).toBe(1);
  });

  it("aceita os campos em inglês (status/severity/dueDate)", () => {
    const r = resumoQualidade([{ id: "x", status: "aberta", severity: "critica", dueDate: "2026-08-01" }], HOJE);
    expect(r.criticas).toBe(1);
    expect(r.atrasadas).toBe(1);
  });
});
