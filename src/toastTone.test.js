import { describe, expect, it } from "vitest";
import { textoDoToast, tomDoToast } from "./toastTone.js";

describe("tom do toast", () => {
  it("mensagem de erro comum é classificada como erro", () => {
    expect(tomDoToast("Não foi possível concluir a operação.")).toBe("erro");
    expect(tomDoToast("Item não encontrado ou alterado por outra pessoa.")).toBe("erro");
    expect(tomDoToast("Informe a quantidade entregue.")).toBe("erro");
    expect(tomDoToast("Sem permissão financeira.")).toBe("erro");
  });

  it("mensagem de sucesso continua verde", () => {
    expect(tomDoToast("Ordem de serviço criada")).toBe("ok");
    expect(tomDoToast("Baixa registrada")).toBe("ok");
    expect(tomDoToast("Título lançado")).toBe("ok");
  });

  it("tom explícito no objeto vence a heurística", () => {
    expect(tomDoToast({ mensagem: "Tudo certo", tom: "erro" })).toBe("erro");
    expect(tomDoToast({ message: "Não foi possível", tone: "success" })).toBe("ok");
  });

  it("extrai o texto de string ou objeto", () => {
    expect(textoDoToast("oi")).toBe("oi");
    expect(textoDoToast({ mensagem: "olá" })).toBe("olá");
    expect(textoDoToast({ message: "hi" })).toBe("hi");
    expect(textoDoToast(null)).toBe("");
  });
});
