import { describe, expect, it } from "vitest";
import {
  resumoJuridico,
  validarDocumentoJuridico,
  normalizarRisco,
  normalizarSituacaoJuridica,
  normalizarTipoJuridico,
  situacaoJuridicaEncerrada,
} from "./legalDomain.js";

const HOJE = Date.parse("2026-09-03T12:00:00Z");

describe("domínio jurídico", () => {
  it("exige título para registrar o documento", () => {
    expect(validarDocumentoJuridico({})).toMatch(/título/i);
    expect(validarDocumentoJuridico({ titulo: "Contrato Rede Alfa" })).toBe("");
    expect(validarDocumentoJuridico({ title: "NDA" })).toBe("");
  });

  it("normaliza valores fora da lista para o padrão", () => {
    expect(normalizarTipoJuridico("foguete")).toBe("minuta");
    expect(normalizarRisco("catastrofico")).toBe("medio");
    expect(normalizarSituacaoJuridica("inventada")).toBe("rascunho");
    expect(normalizarTipoJuridico("aditivo")).toBe("aditivo");
    expect(normalizarRisco("alto")).toBe("alto");
  });

  it("sabe quais situações encerram o documento", () => {
    expect(situacaoJuridicaEncerrada("assinado")).toBe(true);
    expect(situacaoJuridicaEncerrada("arquivado")).toBe(true);
    expect(situacaoJuridicaEncerrada("recusado")).toBe(true);
    expect(situacaoJuridicaEncerrada("em_analise")).toBe(false);
    expect(situacaoJuridicaEncerrada("aprovado")).toBe(false);
  });

  it("resume em análise, aguardando assinatura, risco alto, vencidos e assinados", () => {
    const registros = [
      { id: "1", situacao: "em_analise", risco: "alto", fimVigencia: "2026-08-01" }, // aberto, risco alto, vencido
      { id: "2", situacao: "aprovado", risco: "medio", fimVigencia: "2999-01-01" }, // aberto, aguardando assinatura, no prazo
      { id: "3", situacao: "assinado", risco: "alto", fimVigencia: "2026-01-01" }, // encerrado, não conta vencido nem risco aberto
      { id: "4", situacao: "rascunho", risco: "baixo" }, // aberto
    ];
    const r = resumoJuridico(registros, HOJE);
    expect(r.total).toBe(4);
    expect(r.emAnalise).toBe(1);
    expect(r.aguardandoAssinatura).toBe(1);
    expect(r.riscoAlto).toBe(1);
    expect(r.vencidos).toBe(1);
    expect(r.assinados).toBe(1);
  });

  it("aceita os campos em inglês (status/risk/effectiveEnd)", () => {
    const r = resumoJuridico([{ id: "x", status: "em_analise", risk: "alto", effectiveEnd: "2026-08-01" }], HOJE);
    expect(r.riscoAlto).toBe(1);
    expect(r.vencidos).toBe(1);
  });
});
