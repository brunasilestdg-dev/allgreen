import { describe, expect, it } from "vitest";
import {
  QUALIDADE_MEDICAO,
  SITUACOES_SLA,
  TIPOS_EVENTO_VALIDOS,
  efeitosDoEvento,
  filtrarOperacoes,
  medicaoDoEvento,
  normalizarQualidade,
  normalizarTipoEvento,
  ocorrenciasDaLinha,
  ordenarLinhaDoTempo,
  paginar,
  previsaoContraCombinado,
  resumirOperacoes,
  slaDaOperacao,
} from "./operationTrackingDomain.js";

const AGORA = "2026-08-07T12:00:00.000Z";
const h = (n) => new Date(new Date(AGORA).getTime() + n * 3600 * 1000).toISOString();

describe("SLA é dois instantes, não um rótulo", () => {
  it("entregue antes do combinado é no prazo", () => {
    const r = slaDaOperacao({ prometidoEm: h(2), entregueEm: h(1) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_SLA.noPrazo);
    expect(r.cumprido).toBe(true);
    expect(r.atrasoHoras).toBe(0);
  });

  it("entregue depois guarda quantas horas de atraso", () => {
    const r = slaDaOperacao({ prometidoEm: h(0), entregueEm: h(3.5) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_SLA.atrasado);
    expect(r.cumprido).toBe(false);
    expect(r.atrasoHoras).toBe(3.5);
  });

  it("em andamento dentro do prazo não é nem cumprido nem descumprido", () => {
    const r = slaDaOperacao({ prometidoEm: h(5) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_SLA.emCurso);
    expect(r.cumprido).toBeNull();
  });

  it("prazo estourado e ainda em andamento é situação própria", () => {
    // Diferente de "entregue com atraso": ainda dá para agir.
    const r = slaDaOperacao({ prometidoEm: h(-4) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_SLA.atrasadoEmCurso);
    expect(r.atrasoHoras).toBe(4);
    expect(r.cumprido).toBeNull();
  });

  it("sem prazo combinado, não inventa julgamento", () => {
    const r = slaDaOperacao({ entregueEm: h(1) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_SLA.semPrazo);
    expect(r.cumprido).toBeNull();
  });

  it("data ilegível não vira zero", () => {
    expect(slaDaOperacao({ prometidoEm: "amanhã" }, AGORA).situacao).toBe(SITUACOES_SLA.semPrazo);
  });
});

describe("previsão contra combinado", () => {
  it("mostra o atraso chegando antes de ele acontecer", () => {
    const r = previsaoContraCombinado({ prometidoEm: h(0), previsaoEm: h(2.5) });
    expect(r.comparavel).toBe(true);
    expect(r.vaiAtrasar).toBe(true);
    expect(r.diferencaHoras).toBe(2.5);
  });

  it("previsão adiantada não é atraso", () => {
    expect(previsaoContraCombinado({ prometidoEm: h(3), previsaoEm: h(1) }).vaiAtrasar).toBe(false);
  });

  it("sem os dois lados, não compara", () => {
    expect(previsaoContraCombinado({ prometidoEm: h(1) }).comparavel).toBe(false);
  });
});

describe("busca e filtros", () => {
  const lista = [
    { referencia: "OP-100", origem: "São Paulo", destino: "Campinas", dataServico: h(-48), entregueEm: h(-47), prometidoEm: h(-46), ocorrencias: 0 },
    { referencia: "OP-200", origem: "Curitiba", destino: "Joinville", dataServico: h(-24), prometidoEm: h(-30), ocorrencias: 2 },
    { referencia: "OP-300", origem: "Recife", destino: "Natal", dataServico: h(0), prometidoEm: h(10), ocorrencias: 0 },
  ];

  it("a busca ignora acento e maiúscula", () => {
    expect(filtrarOperacoes(lista, { busca: "sao paulo" }, AGORA)).toHaveLength(1);
    expect(filtrarOperacoes(lista, { busca: "CURITIBA" }, AGORA)).toHaveLength(1);
  });

  it("busca por referência", () => {
    expect(filtrarOperacoes(lista, { busca: "OP-200" }, AGORA)[0].referencia).toBe("OP-200");
  });

  it("filtra atrasadas, incluindo as que ainda estão em andamento", () => {
    const r = filtrarOperacoes(lista, { situacao: "atrasadas" }, AGORA);
    expect(r.map((o) => o.referencia)).toEqual(["OP-200"]);
  });

  it("filtra por ocorrência", () => {
    expect(filtrarOperacoes(lista, { situacao: "com_ocorrencia" }, AGORA)).toHaveLength(1);
  });

  it("filtra entregues e em andamento", () => {
    expect(filtrarOperacoes(lista, { situacao: "entregues" }, AGORA)).toHaveLength(1);
    expect(filtrarOperacoes(lista, { situacao: "em_andamento" }, AGORA)).toHaveLength(2);
  });

  it("o filtro até inclui o dia inteiro", () => {
    // Filtrar "até hoje" tem que trazer o que aconteceu hoje de manhã.
    const hoje = AGORA.slice(0, 10);
    const r = filtrarOperacoes([{ referencia: "X", dataServico: `${hoje}T23:00:00.000Z` }], { ate: hoje }, AGORA);
    expect(r).toHaveLength(1);
  });
});

describe("paginação com os números à vista", () => {
  const lista = Array.from({ length: 45 }, (_, i) => ({ referencia: `OP-${i}` }));

  it("diz de quantos até quantos, de um total", () => {
    const r = paginar(lista, { pagina: 2, porPagina: 20 });
    expect(r.itens).toHaveLength(20);
    expect(r.primeiro).toBe(21);
    expect(r.ultimo).toBe(40);
    expect(r.total).toBe(45);
    expect(r.paginas).toBe(3);
  });

  it("página fora do intervalo cai na última", () => {
    expect(paginar(lista, { pagina: 99, porPagina: 20 }).pagina).toBe(3);
  });

  it("lista vazia não mente sobre o intervalo", () => {
    const r = paginar([], { pagina: 1 });
    expect(r.primeiro).toBe(0);
    expect(r.ultimo).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe("resumo", () => {
  it("pontualidade só conta entrega concluída", () => {
    const r = resumirOperacoes(
      [
        { prometidoEm: h(-10), entregueEm: h(-11) },
        { prometidoEm: h(-10), entregueEm: h(-8) },
        { prometidoEm: h(5) },
      ],
      AGORA,
    );
    expect(r.total).toBe(3);
    expect(r.emAndamento).toBe(1);
    expect(r.pontualidadePercent).toBe(50);
  });

  it("sem entrega concluída, pontualidade não existe — e não é zero", () => {
    expect(resumirOperacoes([{ prometidoEm: h(5) }], AGORA).pontualidadePercent).toBeNull();
  });

  it("conta separadamente o que nem prazo tem", () => {
    expect(resumirOperacoes([{ entregueEm: h(-1) }], AGORA).semPrazoCombinado).toBe(1);
  });
});

describe("linha do tempo", () => {
  const eventos = [
    { id: "3", tipo: "entrega", ocorridoEm: h(6) },
    { id: "1", tipo: "coleta", ocorridoEm: h(0) },
    { id: "2", tipo: "ocorrencia", ocorridoEm: h(3) },
  ];

  it("ordena por quando aconteceu, não por quando foi registrado", () => {
    // Um evento lançado com atraso não pode reescrever a ordem da viagem.
    expect(ordenarLinhaDoTempo(eventos).map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("separa as ocorrências sem perder a ordem", () => {
    expect(ocorrenciasDaLinha(eventos).map((e) => e.id)).toEqual(["2"]);
  });

  it("evento sem data não quebra a ordenação", () => {
    expect(ordenarLinhaDoTempo([{ id: "a" }, { id: "b", ocorridoEm: h(1) }]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("contrato do evento de operação", () => {
  it("lista o vocabulário canônico dos tipos, na ordem da viagem", () => {
    expect(TIPOS_EVENTO_VALIDOS).toEqual([
      "coleta", "transito", "chegada", "entrega", "ocorrencia", "reagendamento", "documento",
    ]);
  });

  it("normaliza qualquer tipo ao conjunto canônico, com transito como padrão", () => {
    expect(normalizarTipoEvento("entrega")).toBe("entrega");
    expect(normalizarTipoEvento(" Entrega ")).toBe("entrega");
    expect(normalizarTipoEvento("inventado")).toBe("transito");
    expect(normalizarTipoEvento("")).toBe("transito");
    expect(normalizarTipoEvento(null)).toBe("transito");
  });

  it("declara os efeitos por tipo — entrega fecha o ciclo, ocorrência conta incidente", () => {
    expect(efeitosDoEvento("entrega")).toEqual({ tipo: "entrega", concluiEntrega: true, contaOcorrencia: false });
    expect(efeitosDoEvento("ocorrencia")).toEqual({ tipo: "ocorrencia", concluiEntrega: false, contaOcorrencia: true });
    expect(efeitosDoEvento("transito")).toEqual({ tipo: "transito", concluiEntrega: false, contaOcorrencia: false });
    // Tipo desconhecido cai em transito e não dispara efeito nenhum.
    expect(efeitosDoEvento("xpto")).toEqual({ tipo: "transito", concluiEntrega: false, contaOcorrencia: false });
  });
});

describe("medição do evento (km e energia como fato)", () => {
  it("normaliza a origem ao vocabulário de qualidade, com padrão", () => {
    expect(QUALIDADE_MEDICAO).toEqual(["medido", "documentado", "estimado", "presumido"]);
    expect(normalizarQualidade("medido")).toBe("medido");
    expect(normalizarQualidade(" Documentado ")).toBe("documentado");
    expect(normalizarQualidade("chute")).toBe("estimado");
    expect(normalizarQualidade("chute", "presumido")).toBe("presumido");
    expect(normalizarQualidade(null)).toBe("estimado");
  });

  it("devolve null quando o evento não mede nada", () => {
    expect(medicaoDoEvento({})).toBeNull();
    expect(medicaoDoEvento({ tipo: "entrega", titulo: "X" })).toBeNull();
    expect(medicaoDoEvento({ distanciaKm: "", energiaKwh: "" })).toBeNull();
    expect(medicaoDoEvento({ distanciaKm: "abc" })).toBeNull();
  });

  it("lê km e energia de forma independente; medida informada nasce 'medido'", () => {
    expect(medicaoDoEvento({ distanciaKm: 42 })).toEqual({
      distanciaKm: 42, distanciaOrigem: "medido", energiaKwh: null, energiaOrigem: null,
    });
    expect(medicaoDoEvento({ energiaKwh: 13.5 })).toEqual({
      distanciaKm: null, distanciaOrigem: null, energiaKwh: 13.5, energiaOrigem: "medido",
    });
    expect(medicaoDoEvento({ distanciaKm: 40, energiaKwh: 12, distanciaOrigem: "documentado" })).toEqual({
      distanciaKm: 40, distanciaOrigem: "documentado", energiaKwh: 12, energiaOrigem: "medido",
    });
  });

  it("zera valores negativos — não existe distância nem energia negativa num fato", () => {
    expect(medicaoDoEvento({ distanciaKm: -10, energiaKwh: -3 })).toEqual({
      distanciaKm: 0, distanciaOrigem: "medido", energiaKwh: 0, energiaOrigem: "medido",
    });
  });
});
