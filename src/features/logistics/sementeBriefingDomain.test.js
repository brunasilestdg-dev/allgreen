import { describe, expect, it } from "vitest";
import { montarPauta, pontosDeAtencaoAltos } from "./sementeBriefingDomain.js";

const conta = (extra = {}) => ({
  id: "c", nome: "Conta", temperatura: null, proximaAcao: null, prazoDaProximaAcao: null,
  contatosComCanal: 1, pesquisaExterna: "2026-08-01T00:00:00Z", ...extra,
});
const AGORA = "2026-08-13T12:00:00Z";
const pautaPorId = (resultado, id) => resultado.pautas.find((item) => item.id === id);

describe("a pauta do dia", () => {
  it("prazo vencido vem primeiro, porque é o que já passou da hora", () => {
    const resultado = montarPauta({
      indice: [
        conta({ nome: "Alfa", proximaAcao: "Enviar proposta", prazoDaProximaAcao: "2026-08-01" }),
        conta({ nome: "Beta", temperatura: "Quente" }),
      ],
      agora: AGORA,
    });
    expect(resultado.pautas[0].id).toBe("prazo-vencido");
    expect(resultado.pautas[0].contas).toEqual(["Alfa"]);
  });

  it("prazo no futuro não é pendência", () => {
    const resultado = montarPauta({
      indice: [conta({ nome: "Alfa", proximaAcao: "Ligar", prazoDaProximaAcao: "2026-12-01" })],
      agora: AGORA,
    });
    expect(pautaPorId(resultado, "prazo-vencido")).toBeUndefined();
  });

  it("conta quente sem próxima ação é pauta separada da conta fria", () => {
    // É onde se perde negócio pronto, e merece urgência diferente.
    const resultado = montarPauta({
      indice: [conta({ nome: "Quente", temperatura: "Quente" }), conta({ nome: "Fria", temperatura: "Frio" })],
      agora: AGORA,
    });
    expect(pautaPorId(resultado, "quente-sem-acao").contas).toEqual(["Quente"]);
    expect(pautaPorId(resultado, "quente-sem-acao").urgencia).toBe("alta");
    expect(pautaPorId(resultado, "sem-acao").contas).toEqual(["Fria"]);
    expect(pautaPorId(resultado, "sem-acao").urgencia).toBe("media");
  });

  it("toda pauta traz os nomes, não só o número", () => {
    // Número sem nome obriga a pessoa a ir procurar, e aí ela não usa mais.
    const resultado = montarPauta({ indice: [conta({ nome: "Alfa", contatosComCanal: 0 })], agora: AGORA });
    expect(pautaPorId(resultado, "sem-canal").contas).toEqual(["Alfa"]);
    expect(pautaPorId(resultado, "sem-canal").porque.length).toBeGreaterThan(20);
  });

  it("mostra quatro nomes e diz quantos ficaram de fora", () => {
    // Cortar em silêncio faria a pessoa achar que são só quatro.
    const muitas = Array.from({ length: 10 }, (_, indice) => conta({ nome: `Conta ${indice}`, contatosComCanal: 0 }));
    const item = pautaPorId(montarPauta({ indice: muitas, agora: AGORA }), "sem-canal");
    expect(item.contas).toHaveLength(4);
    expect(item.quantidade).toBe(10);
    expect(item.restantes).toBe(6);
  });

  it("toda pauta vem com a pergunta pronta para a Semente", () => {
    const resultado = montarPauta({ indice: [conta({ nome: "Alfa", contatosComCanal: 0, pesquisaExterna: null })], agora: AGORA });
    for (const item of resultado.pautas) expect(item.pergunta.length).toBeGreaterThan(15);
  });

  it("tarefas vencidas do usuário entram na pauta", () => {
    const resultado = montarPauta({
      indice: [conta({ nome: "Alfa" })],
      tarefasVencidas: [{ titulo: "Ligar para compras" }],
      agora: AGORA,
    });
    expect(pautaPorId(resultado, "tarefas-vencidas").contas).toEqual(["Ligar para compras"]);
    expect(pautaPorId(resultado, "tarefas-vencidas").urgencia).toBe("alta");
  });

  it("carteira em dia é uma resposta legítima", () => {
    // Inventar pendência para o painel não ficar vazio é como se perde a
    // confiança na pauta.
    const resultado = montarPauta({
      indice: [conta({ nome: "Alfa", proximaAcao: "Ligar", prazoDaProximaAcao: "2026-12-01" })],
      agora: AGORA,
    });
    expect(resultado.pautas).toEqual([]);
    expect(resultado.leitura).toBe("Carteira em dia: 1 conta(s), nenhuma pendência aberta.");
  });

  it("carteira vazia e carteira em dia são estados diferentes", () => {
    expect(montarPauta({ indice: [], agora: AGORA }).leitura).toBe("Sua carteira ainda não tem contas.");
  });

  it("aguenta entrada ausente sem quebrar o painel", () => {
    expect(montarPauta().pautas).toEqual([]);
    expect(montarPauta({ indice: [null, undefined] }).carteira).toBe(0);
  });

  it("ordena por urgência e, dentro dela, pelo tamanho do problema", () => {
    const resultado = montarPauta({
      indice: [
        conta({ nome: "A", temperatura: "Quente" }),
        conta({ nome: "B", contatosComCanal: 0 }),
        conta({ nome: "C", contatosComCanal: 0 }),
      ],
      agora: AGORA,
    });
    expect(resultado.pautas[0].urgencia).toBe("alta");
    const medias = resultado.pautas.filter((item) => item.urgencia === "media");
    expect(medias[0].quantidade).toBeGreaterThanOrEqual(medias.at(-1).quantidade);
  });
});

describe("selo proativo (falar primeiro)", () => {
  it("conta só os pontos de alta urgência", () => {
    const pauta = { pautas: [{ urgencia: "alta" }, { urgencia: "alta" }, { urgencia: "media" }, { urgencia: "baixa" }] };
    expect(pontosDeAtencaoAltos(pauta)).toBe(2);
  });
  it("carteira em dia não acende o selo", () => {
    expect(pontosDeAtencaoAltos({ pautas: [] })).toBe(0);
    expect(pontosDeAtencaoAltos(null)).toBe(0);
    expect(pontosDeAtencaoAltos(undefined)).toBe(0);
  });
  it("integra com montarPauta: prazo vencido acende o selo", () => {
    const pauta = montarPauta({
      indice: [{ id: "c1", nome: "DHL", proximaAcao: "Ligar", prazoDaProximaAcao: "2020-01-01" }],
      agora: "2026-09-06T00:00:00Z",
    });
    expect(pontosDeAtencaoAltos(pauta)).toBeGreaterThanOrEqual(1);
  });
});
