import { describe, expect, it } from "vitest";
import { emailFailureReason } from "../worker/mensageria/envio.js";

const brevoError = (status, code, message) =>
  Object.assign(new Error(`Falha no envio (${status}) ${message}`), {
    status,
    providerCode: code,
    providerMessage: message,
  });

describe("emailFailureReason", () => {
  it("explica o bloqueio de IP do Brevo", () => {
    expect(
      emailFailureReason(
        brevoError(401, "unauthorized", "We have detected you are using an unrecognised IP address 172.1.1.1."),
      ),
    ).toMatch(/IPs autorizados/);
  });

  it("explica remetente não validado", () => {
    expect(
      emailFailureReason(brevoError(400, "invalid_parameter", "Sender is not valid")),
    ).toMatch(/MAIL_SENDER/);
  });

  it("explica chave inválida", () => {
    expect(emailFailureReason(brevoError(401, "unauthorized", "Key not found"))).toMatch(/BREVO_API_KEY/);
  });

  it("explica conta não liberada", () => {
    expect(
      emailFailureReason(brevoError(403, "permission_denied", "Your SMTP account is not yet activated")),
    ).toMatch(/não está liberada/);
  });

  it("cai num motivo genérico sem expor detalhes internos", () => {
    expect(emailFailureReason(new Error("fetch failed"))).toMatch(/serviço de e-mail/);
    expect(emailFailureReason(brevoError(500, "", ""))).toMatch(/código 500/);
  });
});
