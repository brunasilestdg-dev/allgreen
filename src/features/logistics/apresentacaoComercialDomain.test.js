import { describe, expect, it } from "vitest";
import {
  APRESENTACAO_ASSUNTO,
  linkComposeGmail,
  montarEmailApresentacao,
} from "./apresentacaoComercialDomain.js";

// A "melhor abordagem por perfil": o corpo muda com a TEMPERATURA da conta, e a
// saudação usa só o primeiro nome do contato. Puro e testável — a tela só monta
// daqui.

describe("montarEmailApresentacao", () => {
  it("usa o assunto padrão e só o primeiro nome na saudação", () => {
    const { assunto, corpo } = montarEmailApresentacao({
      contatoNome: "Ana Paula Souza",
      contaNome: "Acme Log",
      temperatura: "Morno",
    });
    expect(assunto).toBe(APRESENTACAO_ASSUNTO);
    expect(corpo.startsWith("Olá, Ana,")).toBe(true);
    expect(corpo).toContain("Acme Log");
  });

  it("sem nome do contato, saúda de forma neutra", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "Acme" });
    expect(corpo.startsWith("Olá,\n")).toBe(true);
  });

  it("Quente retoma, Morno reconecta, Frio se apresenta — aberturas distintas", () => {
    const quente = montarEmailApresentacao({ contaNome: "X", temperatura: "Quente" }).corpo;
    const morno = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno" }).corpo;
    const frio = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" }).corpo;
    expect(quente).toContain("seguir com a conversa");
    expect(morno).toContain("Retomando nosso contato");
    expect(frio).toContain("gostaria de me apresentar");
    expect(new Set([quente, morno, frio]).size).toBe(3);
  });

  it("temperatura desconhecida cai na abertura padrão", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Roxo" });
    expect(corpo).toContain("Segue em anexo a apresentação da To Do Green");
  });

  it("sempre traz a proposta de valor (frota elétrica, POD, roteirização)", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" });
    expect(corpo).toContain("Frota 100% elétrica");
    expect(corpo).toContain("POD");
    expect(corpo).toContain("Roteirização");
  });
});

describe("linkComposeGmail", () => {
  it("codifica destinatário, assunto e corpo na URL do compose", () => {
    const url = linkComposeGmail({ para: "a b@x.com", assunto: "Olá & tchau", corpo: "linha 1\nlinha 2" });
    expect(url).toContain("to=a%20b%40x.com");
    expect(url).toContain("su=Ol%C3%A1%20%26%20tchau");
    expect(url).toContain("body=linha%201%0Alinha%202");
  });

  it("aguenta campos vazios sem quebrar", () => {
    expect(linkComposeGmail()).toContain("to=");
  });
});
