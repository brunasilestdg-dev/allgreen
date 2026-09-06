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
  it("usa o assunto padrão e só o primeiro nome na saudação (com ponto)", () => {
    const { assunto, corpo } = montarEmailApresentacao({
      contatoNome: "Ana Paula Souza",
      contaNome: "Acme Log",
      temperatura: "Morno",
      houveContato: true,
    });
    expect(assunto).toBe(APRESENTACAO_ASSUNTO);
    expect(corpo.startsWith("Olá, Ana.")).toBe(true);
    expect(corpo).toContain("Acme Log");
  });

  it("assina em primeira pessoa com o nome do remetente", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "Acme", remetenteNome: "Bruna Paula" });
    expect(corpo).toContain("Meu nome é Bruna e represento a To Do Green, a única transportadora 100% elétrica do Brasil");
    expect(corpo.trimEnd().endsWith("Bruna · To Do Green")).toBe(true);
  });

  it("sem remetente, fala e assina em nome da equipe", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "Acme" });
    expect(corpo).toContain("Represento a To Do Green");
    expect(corpo).toContain("Equipe comercial · To Do Green");
  });

  it("NUNCA diz 'retomando' quando não houve contato — mesmo Morno/Quente", () => {
    const morno = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: false }).corpo;
    const quente = montarEmailApresentacao({ contaNome: "X", temperatura: "Quente", houveContato: false }).corpo;
    expect(morno).not.toContain("Retomando");
    expect(morno).not.toContain("seguir com a conversa");
    expect(morno).toContain("possibilidade de uma conversa");
    expect(quente).not.toContain("Retomando");
    expect(quente).toContain("possibilidade de uma conversa");
  });

  it("com contato real, Quente retoma a conversa e Morno retoma o contato", () => {
    const quente = montarEmailApresentacao({ contaNome: "X", temperatura: "Quente", houveContato: true }).corpo;
    const morno = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: true }).corpo;
    expect(quente).toContain("seguir com a conversa");
    expect(morno).toContain("Retomando nosso contato");
  });

  it("Frio se apresenta, sem inventar histórico", () => {
    const frio = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" }).corpo;
    expect(frio).toContain("possibilidade de uma conversa");
    expect(frio).not.toContain("Retomando");
  });

  it("personaliza pela RFQ em aberto quando a pesquisa a comprovou", () => {
    const contexto = contextoDeMercado({ openRfqs: [{ url: "x" }] });
    const semContato = montarEmailApresentacao({ contaNome: "Acme", temperatura: "Frio", houveContato: false, contexto }).corpo;
    const comContato = montarEmailApresentacao({ contaNome: "Acme", temperatura: "Morno", houveContato: true, contexto }).corpo;
    expect(semContato).toContain("cotações de transporte em aberto");
    expect(semContato).not.toContain("Retomando");
    expect(comContato).toContain("cotações de transporte em aberto");
    expect(comContato).toContain("Retomando");
  });

  it("personaliza pelo segmento quando há contexto, mas não RFQ", () => {
    const contexto = contextoDeMercado({}, { segmento: "varejo farmacêutico" });
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio", contexto });
    expect(corpo).toContain("varejo farmacêutico");
  });

  it("sem contexto nenhum, cai na prospecção honesta, sem retomar", () => {
    const contexto = contextoDeMercado({});
    expect(contexto.temContexto).toBe(false);
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Morno", houveContato: false, contexto });
    expect(corpo).toContain("possibilidade de uma conversa");
    expect(corpo).not.toContain("Retomando");
  });

  it("traz a proposta de valor completa e a pergunta de fechamento", () => {
    const { corpo } = montarEmailApresentacao({ contaNome: "X", temperatura: "Frio" });
    expect(corpo).toContain("Frota 100% elétrica");
    expect(corpo).toContain("POD");
    expect(corpo).toContain("Roteirização");
    expect(corpo).toContain("SLA de entrega de 99%");
    expect(corpo).toContain("Frota mista, da moto à carreta");
    expect(corpo).toContain("faz sentido buscar uma alternativa para otimizar a sua operação?");
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

  it("inclui cc quando informado, e omite quando vazio", () => {
    expect(linkComposeGmail({ para: "a@x.com", cc: "chefe@x.com" })).toContain("cc=chefe%40x.com");
    expect(linkComposeGmail({ para: "a@x.com" })).not.toContain("cc=");
  });

  it("aguenta campos vazios sem quebrar", () => {
    expect(linkComposeGmail()).toContain("to=");
  });
});
