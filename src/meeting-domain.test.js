import { describe, expect, it } from "vitest";
import {
  actionDueDate,
  allTags,
  buildMinutesPrompt,
  filterMeetings,
  formatTimestamp,
  makeMeeting,
  minutesToTasks,
  parseActionItem,
  parseMinutes,
  parseTranscript,
  renameSpeaker,
  searchTranscript,
  speakerStats,
} from "./features/meetings/meetingDomain.js";

describe("formatTimestamp", () => {
  it("formata minutos e segundos", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(75)).toBe("01:15");
    expect(formatTimestamp(600)).toBe("10:00");
  });

  it("inclui a hora quando passa de uma hora", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("trata entrada inválida como zero", () => {
    expect(formatTimestamp(-5)).toBe("00:00");
    expect(formatTimestamp("abc")).toBe("00:00");
  });
});

describe("parseTranscript", () => {
  it("separa participante e fala", () => {
    const falas = parseTranscript("Renata: bom dia a todos\nCliente: bom dia");
    expect(falas).toEqual([
      { speaker: "Renata", text: "bom dia a todos", at: "" },
      { speaker: "Cliente", text: "bom dia", at: "" },
    ]);
  });

  it("lê a marcação de tempo", () => {
    const falas = parseTranscript("[01:20] Renata: vamos ao orçamento");
    expect(falas[0]).toEqual({
      speaker: "Renata",
      text: "vamos ao orçamento",
      at: "01:20",
    });
  });

  it("junta linha sem participante à fala anterior", () => {
    const falas = parseTranscript("Renata: primeira parte\ne a continuação aqui");
    expect(falas).toHaveLength(1);
    expect(falas[0].text).toBe("primeira parte e a continuação aqui");
  });

  it("não confunde frase com dois-pontos no fim com participante", () => {
    const falas = parseTranscript("Ficou decidido o seguinte: vamos aprovar.");
    expect(falas[0].speaker).toBe("");
    expect(falas[0].text).toContain("Ficou decidido");
  });

  it("ignora linhas vazias e devolve lista vazia sem texto", () => {
    expect(parseTranscript("\n\n  \n")).toEqual([]);
    expect(parseTranscript(null)).toEqual([]);
  });
});

describe("speakerStats", () => {
  it("mede turnos, palavras e a fatia de cada um", () => {
    const falas = parseTranscript(
      "Renata: uma duas três quatro\nCliente: cinco seis\nRenata: sete oito",
    );
    const stats = speakerStats(falas);
    expect(stats[0]).toMatchObject({ speaker: "Renata", turns: 2, words: 6 });
    expect(stats[0].share).toBeCloseTo(75, 0);
    expect(stats[1]).toMatchObject({ speaker: "Cliente", words: 2 });
  });

  it("agrupa falas sem participante identificado", () => {
    const stats = speakerStats([{ speaker: "", text: "alguma coisa" }]);
    expect(stats[0].speaker).toBe("Não identificado");
  });
});

describe("renameSpeaker", () => {
  it("corrige o nome em todas as falas daquele participante", () => {
    const falas = parseTranscript("Renata: oi\nBrunna: tudo bem\nRenata: sim");
    const corrigido = renameSpeaker(falas, "Brunna", "Renata");
    expect(corrigido.every((f) => f.speaker === "Renata")).toBe(true);
  });
});

describe("searchTranscript", () => {
  it("acha as falas que contêm o termo, com a posição", () => {
    const falas = parseTranscript("Renata: o prazo é agosto\nCliente: e o preço?");
    const achados = searchTranscript(falas, "preço");
    expect(achados).toHaveLength(1);
    expect(achados[0].index).toBe(1);
  });

  it("busca também pelo nome do participante e ignora maiúsculas", () => {
    const falas = parseTranscript("Renata: teste");
    expect(searchTranscript(falas, "RENATA")).toHaveLength(1);
  });

  it("termo vazio não devolve nada", () => {
    expect(searchTranscript(parseTranscript("Renata: x"), "  ")).toEqual([]);
  });
});

describe("parseMinutes", () => {
  const ata = `Resumo
Conversamos sobre o orçamento do casamento.

Decisões
- Aprovar o valor de R$ 4.000
- Fechar o contrato nesta semana

Tarefas
- Enviar contrato assinado — Renata — 05/08
- Confirmar sabor do bolo — Cliente — 10/08

Riscos
- Data pode mudar por causa do salão

Perguntas pendentes
- Quantos convidados exatamente?

Temas
- orçamento
- contrato`;

  it("divide a ata nas seções conhecidas", () => {
    const m = parseMinutes(ata);
    expect(m.resumo).toContain("orçamento do casamento");
    expect(m.decisoes).toHaveLength(2);
    expect(m.tarefas).toHaveLength(2);
    expect(m.riscos).toHaveLength(1);
    expect(m.pendencias).toHaveLength(1);
    expect(m.temas).toEqual(["orçamento", "contrato"]);
  });

  it("tolera markdown, maiúsculas e falta de acento nos títulos", () => {
    const m = parseMinutes("## DECISOES\n- **algo importante**\n\n**Tarefas:**\n1. fazer x");
    expect(m.decisoes[0]).toBe("algo importante");
    expect(m.tarefas[0]).toBe("fazer x");
  });

  it("aceita 'Ações' como sinônimo de tarefas", () => {
    expect(parseMinutes("Ações\n- ligar para o cliente").tarefas).toEqual([
      "ligar para o cliente",
    ]);
  });

  it("devolve seções vazias sem texto", () => {
    const m = parseMinutes("");
    expect(m.resumo).toBe("");
    expect(m.decisoes).toEqual([]);
  });

  it("ignora conteúdo antes da primeira seção", () => {
    const m = parseMinutes("blá blá introdução\nResumo\nO texto certo");
    expect(m.resumo).toBe("O texto certo");
  });
});

describe("parseActionItem", () => {
  it("lê tarefa, responsável e prazo separados por travessão", () => {
    expect(parseActionItem("Enviar contrato — Renata — 05/08")).toEqual({
      title: "Enviar contrato",
      owner: "Renata",
      due: "05/08",
    });
  });

  it("lê o formato entre parênteses", () => {
    expect(parseActionItem("Enviar contrato (Renata, 05/08)")).toEqual({
      title: "Enviar contrato",
      owner: "Renata",
      due: "05/08",
    });
  });

  it("funciona sem responsável nem prazo", () => {
    expect(parseActionItem("Revisar a proposta")).toEqual({
      title: "Revisar a proposta",
      owner: "",
      due: "",
    });
  });

  it("aceita só o prazo, sem responsável", () => {
    expect(parseActionItem("Pagar o fornecedor — até 12/09")).toMatchObject({
      title: "Pagar o fornecedor",
      due: "12/09",
      owner: "",
    });
  });

  it("limpa o prefixo 'Responsável:'", () => {
    expect(parseActionItem("Fechar caixa — Responsável: Ana").owner).toBe("Ana");
  });
});

describe("actionDueDate", () => {
  it("usa o ano da reunião quando o prazo não traz ano", () => {
    expect(actionDueDate("05/08", "2026-07-29")).toBe("2026-08-05");
  });

  it("respeita o ano quando ele vem escrito", () => {
    expect(actionDueDate("05/08/2027", "2026-07-29")).toBe("2027-08-05");
    expect(actionDueDate("05/08/27", "2026-07-29")).toBe("2027-08-05");
  });

  it("rejeita data impossível", () => {
    expect(actionDueDate("31/02", "2026-01-01")).toBe("");
    expect(actionDueDate("40/13", "2026-01-01")).toBe("");
    expect(actionDueDate("", "2026-01-01")).toBe("");
    expect(actionDueDate("semana que vem", "2026-01-01")).toBe("");
  });
});

describe("minutesToTasks", () => {
  it("transforma as tarefas da ata em tarefas com prazo resolvido", () => {
    const minutes = parseMinutes(
      "Tarefas\n- Enviar contrato — Renata — 05/08\n- Revisar proposta",
    );
    const tarefas = minutesToTasks(minutes, { referencia: "2026-07-29" });
    expect(tarefas).toHaveLength(2);
    expect(tarefas[0]).toMatchObject({
      title: "Enviar contrato",
      owner: "Renata",
      dueDate: "2026-08-05",
    });
    expect(tarefas[1]).toMatchObject({ title: "Revisar proposta", dueDate: "" });
  });

  it("descarta linhas sem título", () => {
    expect(minutesToTasks({ tarefas: ["", "—"] }, {})).toEqual([]);
  });

  it("lida com ata sem tarefas", () => {
    expect(minutesToTasks(null, {})).toEqual([]);
  });
});

describe("buildMinutesPrompt", () => {
  it("inclui a transcrição, os dados da reunião e a proibição de inventar", () => {
    const falas = parseTranscript("[00:10] Renata: vamos fechar");
    const prompt = buildMinutesPrompt(
      { title: "Alinhamento", date: "2026-07-29", participants: ["Renata", "Ana"] },
      falas,
    );
    expect(prompt).toContain("Alinhamento");
    expect(prompt).toContain("Renata, Ana");
    expect(prompt).toContain("[00:10] Renata: vamos fechar");
    expect(prompt).toContain("Não invente decisões");
    expect(prompt).toContain("Perguntas pendentes");
  });
});

describe("filterMeetings e allTags", () => {
  const reunioes = [
    {
      id: "a",
      title: "Alinhamento com o cliente",
      client: "Padaria X",
      tags: ["vendas"],
      participants: ["Renata"],
      transcript: "falamos de preço",
      minutes: { resumo: "" },
    },
    {
      id: "b",
      title: "Retrospectiva",
      client: "",
      tags: ["interno", "vendas"],
      participants: [],
      transcript: "",
      minutes: { resumo: "melhorias do processo" },
    },
  ];

  it("filtra por texto no título, transcrição ou resumo", () => {
    expect(filterMeetings(reunioes, { term: "preço" }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMeetings(reunioes, { term: "melhorias" }).map((m) => m.id)).toEqual(["b"]);
  });

  it("filtra por etiqueta e por cliente", () => {
    expect(filterMeetings(reunioes, { tag: "interno" }).map((m) => m.id)).toEqual(["b"]);
    expect(filterMeetings(reunioes, { client: "Padaria X" }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMeetings(reunioes, { tag: "vendas" })).toHaveLength(2);
  });

  it("sem filtro devolve tudo", () => {
    expect(filterMeetings(reunioes, {})).toHaveLength(2);
  });

  it("lista as etiquetas em ordem, sem repetir", () => {
    expect(allTags(reunioes)).toEqual(["interno", "vendas"]);
  });
});

describe("makeMeeting", () => {
  it("cria reunião sem consentimento marcado e sem ata", () => {
    const m = makeMeeting("m1", { businessId: "b1" });
    expect(m.consent).toBe(false);
    expect(m.minutes).toBeNull();
    expect(m.businessId).toBe("b1");
  });
});

describe("dica de contexto para a transcrição", () => {
  it("junta participantes e cliente, sem repetir nem inventar", async () => {
    const { transcriptionHint } = await import("./features/meetings/meetingDomain.js");
    expect(
      transcriptionHint({ participants: ["Ana", " Joaquim ", "Ana", ""], client: "Três Corações" }),
    ).toBe("Participantes: Ana, Joaquim. Cliente: Três Corações.");
    expect(transcriptionHint({ participants: [], client: "" })).toBe("");
    expect(transcriptionHint(null)).toBe("");
    expect(transcriptionHint({ participants: ["x".repeat(400)] })).toHaveLength(300);
  });
});
