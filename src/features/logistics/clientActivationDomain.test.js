import { describe, expect, it } from "vitest";
import { buildClientActivationReadiness } from "./clientActivationDomain.js";

const checkOperacao = (snapshot) =>
  buildClientActivationReadiness(snapshot).checks.find((item) => item.id === "operation");

describe("gate de go-live: operação (costura 2 — rascunho + confirmar)", () => {
  it("sem operação, o gate pede o cadastro real e não fabrica nada", () => {
    const check = checkOperacao({ operation: null });
    expect(check.ready).toBe(false);
    expect(check.detail).toMatch(/não cria operação fictícia/i);
  });

  it("operação em RASCUNHO não libera: exige confirmação", () => {
    // O go-live pré-cadastra o rascunho, mas ele não conta como operação real.
    const check = checkOperacao({ operation: { id: "op1", status: "rascunho", reference: "R-1" } });
    expect(check.ready).toBe(false);
    expect(check.detail).toMatch(/rascunho/i);
    expect(check.detail).toMatch(/confirme/i);
  });

  it("operação confirmada (fora do rascunho) libera o gate", () => {
    const check = checkOperacao({ operation: { id: "op1", status: "active", reference: "R-1" } });
    expect(check.ready).toBe(true);
    expect(check.detail).toMatch(/vinculada/i);
  });

  it("status vazio conta como confirmado (compatível com operações antigas)", () => {
    // Operações legadas podem não ter status — só o rascunho recém-semeado
    // deve travar, nunca uma operação real já existente sem esse campo.
    const check = checkOperacao({ operation: { id: "op1", status: "", reference: "R-1" } });
    expect(check.ready).toBe(true);
  });
});
