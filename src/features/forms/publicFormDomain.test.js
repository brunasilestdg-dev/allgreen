import { describe, expect, it } from "vitest";
import {
  createPublicFormFromProcess,
  normalizePublicForm,
  publicFormAnswerSummary,
  publicFormEmbedCode,
  publicFormFieldIsVisible,
  slugifyPublicForm,
  validatePublicFormSubmission,
} from "./publicFormDomain.js";

describe("domínio de formulários públicos", () => {
  it("normaliza identidade visual, slug, destino e recursos opcionais", () => {
    const form = normalizePublicForm(
      {
        name: "Solicitação Ágil",
        appearance: { primaryColor: "red", textColor: "#112233" },
        payment: {
          enabled: true,
          required: true,
          method: "link",
          link: "javascript:alert(1)",
        },
        signature: { enabled: true, required: true },
        destination: { type: "lead" },
      },
      { ownerId: "u1", workspaceOwnerId: "w1", businessId: "b1" },
      "2026-07-29T20:00:00.000Z",
    );
    expect(form.slug).toBe("solicitacao-agil");
    expect(form.appearance.primaryColor).toBe("#0b9f8f");
    expect(form.appearance.textColor).toBe("#112233");
    expect(form.payment.link).toBe("");
    expect(form.signature.required).toBe(true);
    expect(form.destination.type).toBe("lead");
    expect(form.workspaceOwnerId).toBe("w1");
  });

  it("avalia campos condicionais e valida somente o que está visível", () => {
    const form = normalizePublicForm({
      name: "Triagem",
      contact: {
        collectName: true,
        requireName: true,
        collectEmail: true,
        requireEmail: true,
      },
      privacy: { consentRequired: true },
      fields: [
        {
          id: "kind",
          label: "Tipo",
          type: "select",
          required: true,
          options: ["Outro", "Financeiro"],
        },
        {
          id: "details",
          label: "Detalhes",
          type: "longtext",
          required: true,
          condition: { fieldId: "kind", operator: "equals", value: "Outro" },
        },
      ],
    });
    expect(publicFormFieldIsVisible(form.fields[1], { kind: "Financeiro" })).toBe(
      false,
    );
    const ok = validatePublicFormSubmission(form, {
      contact: { name: "Renata", email: "renata@example.com" },
      values: { kind: "Financeiro" },
      privacyConsent: true,
    });
    expect(ok.valid).toBe(true);
    const invalid = validatePublicFormSubmission(form, {
      contact: { name: "Renata", email: "invalido" },
      values: { kind: "Outro" },
      privacyConsent: false,
    });
    expect(invalid.errors.email).toMatch(/válido/);
    expect(invalid.errors.details).toMatch(/obrigatório/);
    expect(invalid.errors.privacy).toBeTruthy();
  });

  it("trata upload, assinatura e pagamento como requisitos reais", () => {
    const form = normalizePublicForm({
      name: "Contrato",
      contact: {
        collectName: false,
        collectEmail: false,
        collectPhone: false,
      },
      privacy: { consentRequired: false },
      fields: [{ id: "proof", label: "Comprovante", type: "file", required: true }],
      signature: { enabled: true, required: true },
      payment: { enabled: true, required: true },
    });
    const invalid = validatePublicFormSubmission(form, {
      values: {},
      attachments: [],
      signature: {},
      payment: {},
    });
    expect(Object.keys(invalid.errors)).toEqual(
      expect.arrayContaining(["proof", "signature", "payment"]),
    );
    const valid = validatePublicFormSubmission(form, {
      values: {},
      attachments: [{ fieldId: "proof", name: "comprovante.pdf" }],
      signature: { name: "Renata", consent: true },
      payment: { acknowledged: true },
    });
    expect(valid.valid).toBe(true);
  });

  it("reaproveita os campos e o destino de um processo sem duplicar o motor", () => {
    const form = createPublicFormFromProcess(
      {
        id: "process-1",
        name: "Atendimento",
        serviceCode: "ATD",
        fields: [
          {
            id: "subject",
            name: "Assunto",
            type: "text",
            required: true,
          },
        ],
      },
      {},
      { ownerId: "u1" },
    );
    expect(form.destination).toMatchObject({
      type: "process",
      processId: "process-1",
    });
    expect(form.fields[0]).toMatchObject({
      id: "subject",
      processFieldId: "subject",
      label: "Assunto",
    });
  });

  it("gera resumo e código incorporável seguros", () => {
    const form = normalizePublicForm({
      name: "Contato",
      fields: [
        { id: "subject", label: "Assunto", type: "text" },
        { id: "ok", label: "Aceite", type: "checkbox" },
      ],
    });
    expect(publicFormAnswerSummary(form, { subject: "Teste", ok: true })).toBe(
      "Assunto: Teste\nAceite: Sim",
    );
    expect(publicFormEmbedCode("https://app.test/f/contato", 'Form "A"')).toContain(
      'title="Form &quot;A&quot;"',
    );
    expect(slugifyPublicForm("  Árvore & Ação ")).toBe("arvore-acao");
  });
});
