import { describe, expect, it } from "vitest";
import {
  documentFingerprint,
  makeSignature,
  normalizeForSigning,
  signatureBlockText,
  signatureCode,
  signatureStatus,
  verifySignature,
} from "./domain.js";

describe("normalizeForSigning", () => {
  it("ignora fim de linha, espaço no fim da linha e sobra nas pontas", () => {
    expect(normalizeForSigning("  Olá  \r\nmundo   \r\n  ")).toBe("Olá\nmundo");
  });

  it("trata vazio e nulo como texto vazio", () => {
    expect(normalizeForSigning(null)).toBe("");
    expect(normalizeForSigning(undefined)).toBe("");
  });
});

describe("documentFingerprint", () => {
  it("é determinística e tem 16 caracteres hexadecimais", () => {
    const a = documentFingerprint("Contrato de prestação de serviços");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(documentFingerprint("Contrato de prestação de serviços")).toBe(a);
  });

  it("muda quando o conteúdo muda de verdade", () => {
    const antes = documentFingerprint("Valor: R$ 1.000,00");
    const depois = documentFingerprint("Valor: R$ 10.000,00");
    expect(depois).not.toBe(antes);
  });

  it("não muda com diferença apenas de fim de linha", () => {
    expect(documentFingerprint("linha 1\r\nlinha 2")).toBe(
      documentFingerprint("linha 1\nlinha 2"),
    );
  });
});

describe("signatureCode", () => {
  it("gera código legível no formato SF-XXXX-XXXX sem caracteres ambíguos", () => {
    const code = signatureCode("abcdef1234567890", "2026-07-29T12:00:00.000Z");
    expect(code).toMatch(/^SF-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(code).toBe(signatureCode("abcdef1234567890", "2026-07-29T12:00:00.000Z"));
  });

  it("muda quando a data de assinatura muda", () => {
    expect(signatureCode("abcdef1234567890", "2026-07-29T12:00:00.000Z")).not.toBe(
      signatureCode("abcdef1234567890", "2026-07-30T12:00:00.000Z"),
    );
  });
});

describe("makeSignature e verifySignature", () => {
  const conteudo = "Contrato entre as partes.\nValor: R$ 2.500,00";

  it("registra quem assinou, quando e a impressão digital do conteúdo", () => {
    const sig = makeSignature({
      signerName: "  Renata  ",
      signerEmail: "renata@exemplo.com",
      signerRole: "Contratada",
      content: conteudo,
      signedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(sig.signerName).toBe("Renata");
    expect(sig.signerRole).toBe("Contratada");
    expect(sig.fingerprint).toBe(documentFingerprint(conteudo));
    expect(sig.code).toBe(signatureCode(sig.fingerprint, sig.signedAt));
    expect(sig.id).toBeTruthy();
  });

  it("confirma integridade quando o documento não mudou", () => {
    const sig = makeSignature({ signerName: "Renata", content: conteudo });
    const check = verifySignature(sig, conteudo);
    expect(check.valid).toBe(true);
    expect(check.reason).toBe("ok");
  });

  it("acusa alteração quando o documento muda depois de assinado", () => {
    const sig = makeSignature({ signerName: "Renata", content: conteudo });
    const check = verifySignature(sig, `${conteudo}\nCláusula nova.`);
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("alterado");
    expect(check.message).toMatch(/alterado/i);
  });

  it("rejeita registro sem impressão digital", () => {
    expect(verifySignature({}, conteudo).reason).toBe("invalida");
    expect(verifySignature(null, conteudo).valid).toBe(false);
  });
});

describe("signatureStatus", () => {
  const conteudo = "Proposta comercial";

  it("informa que não há assinatura", () => {
    expect(signatureStatus([], conteudo).state).toBe("sem-assinatura");
    expect(signatureStatus(undefined, conteudo).total).toBe(0);
  });

  it("fica assinado quando todas as assinaturas conferem", () => {
    const sigs = [
      makeSignature({ signerName: "Renata", content: conteudo }),
      makeSignature({ signerName: "Cliente", content: conteudo }),
    ];
    expect(signatureStatus(sigs, conteudo)).toEqual({
      state: "assinado",
      valid: 2,
      total: 2,
    });
  });

  it("fica alterado quando o texto muda depois", () => {
    const sigs = [makeSignature({ signerName: "Renata", content: conteudo })];
    const status = signatureStatus(sigs, "Proposta comercial revisada");
    expect(status.state).toBe("alterado");
    expect(status.valid).toBe(0);
  });
});

describe("signatureBlockText", () => {
  const conteudo = "Recibo de serviço prestado";

  it("é vazio quando não há assinaturas", () => {
    expect(signatureBlockText([], conteudo)).toBe("");
  });

  it("lista assinante, código, impressão digital e o aviso legal", () => {
    const sig = makeSignature({
      signerName: "Renata",
      signerEmail: "renata@exemplo.com",
      signerRole: "Prestadora",
      content: conteudo,
      signedAt: "2026-07-29T12:00:00.000Z",
    });
    const bloco = signatureBlockText([sig], conteudo);
    expect(bloco).toContain("ASSINATURAS ELETRÔNICAS");
    expect(bloco).toContain("Assinado por: Renata — Prestadora");
    expect(bloco).toContain("renata@exemplo.com");
    expect(bloco).toContain(sig.code);
    expect(bloco).toContain(sig.fingerprint);
    expect(bloco).toContain("Lei 14.063/2020");
    expect(bloco).not.toContain("ATENÇÃO");
  });

  it("avisa dentro do bloco quando o documento foi alterado", () => {
    const sig = makeSignature({ signerName: "Renata", content: conteudo });
    const bloco = signatureBlockText([sig], "Recibo alterado");
    expect(bloco).toContain("ATENÇÃO");
  });
});
