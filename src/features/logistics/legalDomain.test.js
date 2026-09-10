import { describe, expect, it } from "vitest";
import {
  acoesJuridicasDisponiveis,
  diasParaVencer,
  documentosVencendo,
  resolverAcaoJuridica,
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

  it("conta os dias até o vencimento em dias de calendário (UTC)", () => {
    expect(diasParaVencer("2026-09-03", HOJE)).toBe(0); // vence hoje
    expect(diasParaVencer("2026-09-13", HOJE)).toBe(10); // dez dias à frente
    expect(diasParaVencer("2026-08-24", HOJE)).toBe(-10); // já venceu há dez dias
    expect(diasParaVencer("", HOJE)).toBeNull();
    expect(diasParaVencer("data-invalida", HOJE)).toBeNull();
    // Aceita timestamp completo, usando só a data.
    expect(diasParaVencer("2026-09-13T23:59:00Z", HOJE)).toBe(10);
  });

  it("lista os documentos em aberto que vencem dentro da janela, urgentes primeiro", () => {
    const registros = [
      { id: "1", situacao: "aprovado", fimVigencia: "2026-09-20" }, // vence em 17 dias
      { id: "2", situacao: "em_analise", fimVigencia: "2026-08-30" }, // vencido há 4 dias (entra, negativo)
      { id: "3", situacao: "assinado", fimVigencia: "2026-09-05" }, // encerrado: fora
      { id: "4", situacao: "rascunho", fimVigencia: "2027-01-01" }, // muito longe: fora da janela de 30
      { id: "5", situacao: "aprovado" }, // sem data: fora
    ];
    const venc = documentosVencendo(registros, { dias: 30 }, HOJE);
    expect(venc.map((r) => r.id)).toEqual(["2", "1"]); // ordenado: mais urgente (negativo) primeiro
    expect(venc[0].diasParaVencer).toBe(-4);
    expect(venc[1].diasParaVencer).toBe(17);
  });

  it("resume os documentos vencendo em até 30 dias (sem contar os já vencidos)", () => {
    const registros = [
      { id: "1", situacao: "aprovado", fimVigencia: "2026-09-20" }, // 17 dias: vencendo
      { id: "2", situacao: "em_analise", fimVigencia: "2026-08-30" }, // vencido: conta em vencidos, não em vencendo
      { id: "3", situacao: "aprovado", fimVigencia: "2027-06-01" }, // longe: nenhum
    ];
    const r = resumoJuridico(registros, HOJE);
    expect(r.vencendo).toBe(1);
    expect(r.vencidos).toBe(1);
  });

  it("oferece marcar assinado e arquivar como ações auditadas do fluxo", () => {
    const doAprovado = acoesJuridicasDisponiveis("aprovado", { juridico: true }).map((a) => a.id);
    expect(doAprovado).toContain("marcar_assinado");
    expect(doAprovado).toContain("arquivar");
  });

  it("resolve marcar_assinado como transição auditada de aprovado para assinado", () => {
    const r = resolverAcaoJuridica("aprovado", "marcar_assinado", { juridico: true });
    expect(r.ok).toBe(true);
    expect(r.para).toBe("assinado");
    expect(r.kind).toBe("assinatura");
    // Só a partir de aprovado.
    expect(resolverAcaoJuridica("rascunho", "marcar_assinado", { juridico: true }).ok).toBe(false);
  });

  it("resolve arquivar como transição auditada para arquivado a partir de qualquer situação em aberto", () => {
    const r = resolverAcaoJuridica("em_analise", "arquivar", { juridico: false });
    expect(r.ok).toBe(true);
    expect(r.para).toBe("arquivado");
    expect(r.kind).toBe("arquivamento");
  });
});
