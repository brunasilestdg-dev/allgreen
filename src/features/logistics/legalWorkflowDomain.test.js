import { describe, expect, it } from "vitest";
import { acoesJuridicasDisponiveis, resolverAcaoJuridica } from "./legalDomain.js";

describe("fluxo jurídico — ações disponíveis por situação", () => {
  it("no rascunho, o solicitante pode enviar e comentar; não pode aprovar", () => {
    const ids = acoesJuridicasDisponiveis("rascunho", { juridico: false }).map((a) => a.id);
    expect(ids).toContain("submeter");
    expect(ids).toContain("comentar");
    expect(ids).not.toContain("aprovar");
    expect(ids).not.toContain("solicitar_ajuste");
  });

  it("em análise, só o Jurídico vê validar/reprovar/pedir ajuste", () => {
    const solicitante = acoesJuridicasDisponiveis("em_analise", { juridico: false }).map((a) => a.id);
    const juridico = acoesJuridicasDisponiveis("em_analise", { juridico: true }).map((a) => a.id);
    expect(solicitante).not.toContain("aprovar");
    expect(juridico).toEqual(expect.arrayContaining(["aprovar", "reprovar", "solicitar_ajuste"]));
  });

  it("com ajustes solicitados, o solicitante reenvia", () => {
    expect(acoesJuridicasDisponiveis("ajuste_solicitado", {}).map((a) => a.id)).toContain("submeter");
  });
});

describe("fluxo jurídico — resolução de ação (o servidor valida)", () => {
  it("enviar do rascunho exige conteúdo (arquivo ou texto)", () => {
    expect(resolverAcaoJuridica("rascunho", "submeter", { temTexto: false, temAnexo: false }).ok).toBe(false);
    expect(resolverAcaoJuridica("rascunho", "submeter", { temAnexo: true })).toMatchObject({ ok: true, para: "em_analise", kind: "submissao" });
    expect(resolverAcaoJuridica("rascunho", "submeter", { temTexto: true })).toMatchObject({ ok: true, para: "em_analise" });
  });

  it("reenvio a partir de ajuste_solicitado grava kind 'reenvio'", () => {
    expect(resolverAcaoJuridica("ajuste_solicitado", "submeter", { temTexto: true })).toMatchObject({ ok: true, para: "em_analise", kind: "reenvio" });
  });

  it("não-Jurídico não valida nem reprova", () => {
    expect(resolverAcaoJuridica("em_analise", "aprovar", { juridico: false }).ok).toBe(false);
    expect(resolverAcaoJuridica("em_analise", "aprovar", { juridico: true })).toMatchObject({ ok: true, para: "aprovado", kind: "validado" });
  });

  it("solicitar ajuste e reprovar exigem mensagem", () => {
    expect(resolverAcaoJuridica("em_analise", "solicitar_ajuste", { juridico: true, temTexto: false }).ok).toBe(false);
    expect(resolverAcaoJuridica("em_analise", "solicitar_ajuste", { juridico: true, temTexto: true })).toMatchObject({ ok: true, para: "ajuste_solicitado", kind: "ajuste_solicitado" });
    expect(resolverAcaoJuridica("em_analise", "reprovar", { juridico: true, temTexto: true })).toMatchObject({ ok: true, para: "recusado", kind: "reprovado" });
  });

  it("não deixa pular etapa (aprovar direto do rascunho)", () => {
    expect(resolverAcaoJuridica("rascunho", "aprovar", { juridico: true }).ok).toBe(false);
  });

  it("comentar não muda a situação (para = null)", () => {
    expect(resolverAcaoJuridica("em_analise", "comentar", { temTexto: true })).toMatchObject({ ok: true, para: null, kind: "comentario" });
  });

  it("ação desconhecida é recusada", () => {
    expect(resolverAcaoJuridica("rascunho", "hackear", {}).ok).toBe(false);
  });
});
