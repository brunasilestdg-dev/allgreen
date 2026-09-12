import { describe, expect, it } from "vitest";
import {
  TIPOS_CHAVE_PIX,
  tipoPixValido,
  normalizarChavePix,
  validarChavePix,
  rotuloTipoPix,
} from "./pixDomain.js";

describe("PIX — tipos", () => {
  it("os quatro tipos oficiais", () => {
    expect(TIPOS_CHAVE_PIX.map((t) => t.id)).toEqual(["cpf", "email", "telefone", "aleatoria"]);
    expect(tipoPixValido("cpf")).toBe(true);
    expect(tipoPixValido("banco")).toBe(false);
    expect(rotuloTipoPix("aleatoria")).toBe("Chave aleatória");
  });
});

describe("PIX — normalização", () => {
  it("CPF e telefone viram dígitos; telefone ganha DDI 55; e-mail minúsculo", () => {
    expect(normalizarChavePix("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizarChavePix("telefone", "(11) 98765-4321")).toBe("5511987654321");
    expect(normalizarChavePix("email", "  Joao@Pix.COM ")).toBe("joao@pix.com");
    expect(normalizarChavePix("aleatoria", "a1b2c3d4-e5f6-7890-ab12-cd34ef567890"))
      .toBe("a1b2c3d4-e5f6-7890-ab12-cd34ef567890");
  });
});

describe("PIX — validação por tipo", () => {
  it("CPF válido passa; inválido e sequência são recusados", () => {
    expect(validarChavePix("cpf", "529.982.247-25").valido).toBe(true);
    expect(validarChavePix("cpf", "111.111.111-11").valido).toBe(false);
    expect(validarChavePix("cpf", "529.982.247-24").erro).toMatch(/CPF/i);
  });

  it("e-mail válido/ inválido", () => {
    expect(validarChavePix("email", "joao@pix.com").valido).toBe(true);
    expect(validarChavePix("email", "joao-sem-arroba").valido).toBe(false);
  });

  it("telefone exige DDD + número", () => {
    expect(validarChavePix("telefone", "11987654321").valido).toBe(true); // 11 díg → 5511987654321
    expect(validarChavePix("telefone", "1234").valido).toBe(false);
  });

  it("aleatória precisa do formato UUID", () => {
    expect(validarChavePix("aleatoria", "a1b2c3d4-e5f6-7890-ab12-cd34ef567890").valido).toBe(true);
    expect(validarChavePix("aleatoria", "chave-qualquer").valido).toBe(false);
  });

  it("tipo inválido ou chave vazia são recusados", () => {
    expect(validarChavePix("banco", "x").valido).toBe(false);
    expect(validarChavePix("cpf", "").erro).toMatch(/Informe a chave/i);
  });

  it("devolve a chave normalizada quando válida", () => {
    expect(validarChavePix("telefone", "(11) 98765-4321").chave).toBe("5511987654321");
  });
});
