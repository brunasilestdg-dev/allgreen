import { describe, expect, it } from "vitest";
import {
  APRESENTACAO_ASSUNTO,
  contextoDeMercado,
  linkComposeGmail,
  montarEmailApresentacao,
} from "./apresentacaoComercialDomain.js";

// A abordagem muda com o CONTATO REAL e o CONTEXTO da empresa. Regra da titular:
// nunca "retomar" contato que não existiu; personalizar quando há contexto de
// mercado, genérico só quando não há. Puro e testável — a tela só monta daqui.

describe("montarEmailApresentacao", () => {
  it("usa o assunto padrão e só o primeiro nome na saudação", () => {
    const { assunto, corpo } = montarEmailApresentacao({
      contatoNome: "Ana Paula Souza",
      contaNome: "Acme Log",
      temperatura: "Morno",
      houveContato: true,
    });
    expect(assunto).toBe(APRESENTACAO_ASSUNTO);
    expect(corpo.startsWith("Olá, Ana,")).toBe(true);
    expect(corpo).toContain("Acme Log");
  });

  it("sem nome do contato, saúda de forma neutra", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "Acme" });
    expect(corpo.startsWith("Olá,\n")).toBe(true);
  });

  it("NUNCA diz 'retomando' quando não houve contato — mesmo Morno/Quente", () => {
    const morno = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: false }).corpo;
    const quente = montarEmailApresentacao({ contaNome: "X", temperatura: "Quente", houveContato: false }).corpo;
    expect(morno).not.toContain("Retomando");
    expect(morno).not.toContain("seguir com a conversa");
    expect(morno).toContain("gostaria de me apresentar");
    expect(quente).not.toContain("Retomando");
    expect(quente).toContain("gostaria de me apresentar");
  });

  it("com contato real, Quente retoma a conversa e Morno retoma o contato", () => {
    const quente = montarEmailApresentacao({ contaNome: "X", temperatura: "Quente", houveContato: true }).corpo;
    const morno = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: true }).corpo;
    expect(quente).toContain("seguir com a conversa");
    expect(morno).toContain("Retomando nosso contato");
  });

  it("Frio se apresenta, sem inventar histórico", () => {
    const frio = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" }).corpo;
    expect(frio).toContain("gostaria de me apresentar");
    expect(frio).not.toContain("Retomando");
  });

  it("personaliza pela RFQ em aberto quando a pesquisa a comprovou", () => {
    const contexto = contextoDeMercado({ openRfqs: [{ url: "x" }] });
    const semContato = montarEmailApresentacao({ contaNome: "Acme", temperatura: "Frio", houveContato: false, contexto }).corpo;
    const comContato = montarEmailApresentacao({ contaNome: "Acme", temperatura: "Morno", houveContato: true, contexto }).corpo;
    expect(semContato).toContain("cotações de transporte em aberto");
    expect(semContato).toContain("queria me apresentar");
    expect(semContato).not.toContain("Retomando");
    expect(comContato).toContain("cotações de transporte em aberto");
    expect(comContato).toContain("Retomando");
  });

  it("personaliza pelo segmento quando há contexto, mas não RFQ", () => {
    const contexto = contextoDeMercado({}, { segmento: "varejo farmacêutico" });
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio", contexto });
    expect(corpo).toContain("varejo farmacêutico");
  });

  it("sem contexto nenhum, cai no genérico honesto (apresentação), sem retomar", () => {
    const contexto = contextoDeMercado({});
    expect(contexto.temContexto).toBe(false);
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: false, contexto });
    expect(corpo).toContain("gostaria de me apresentar");
    expect(corpo).not.toContain("Retomando");
  });

  it("sempre traz a proposta de valor (frota elétrica, POD, roteirização)", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" });
    expect(corpo).toContain("Frota 100% elétrica");
    expect(corpo).toContain("POD");
    expect(corpo).toContain("Roteirização");
  });
});

describe("contextoDeMercado", () => {
  it("marca RFQ em aberto e relevância ESG a partir da pesquisa", () => {
    const c = contextoDeMercado({ openRfqs: [{ url: "a" }], esg: { relevance: "Alta" }, suggestedSegment: { value: "Bebidas" } });
    expect(c.rfqAberta).toBe(true);
    expect(c.esgRelevante).toBe(true);
    expect(c.segmento).toBe("Bebidas");
    expect(c.temContexto).toBe(true);
  });

  it("relatório vazio não tem contexto", () => {
    expect(contextoDeMercado({}).temContexto).toBe(false);
    expect(contextoDeMercado(null).temContexto).toBe(false);
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
