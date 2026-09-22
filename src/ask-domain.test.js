import { describe, expect, it } from "vitest";
import {
  DRAFT_KEY,
  MAX_PEDIDO,
  SUGESTOES,
  cleanRequest,
  greeting,
  isSendable,
  readStagedRequest,
  stageRequest,
  suggestionsForToday,
} from "./features/home/askDomain";

const memoria = () => {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
  };
};
const quebrado = {
  getItem: () => {
    throw new Error("bloqueado");
  },
  setItem: () => {
    throw new Error("bloqueado");
  },
};

describe("limpar o pedido", () => {
  it("tira espaço sobrando das pontas", () => {
    expect(cleanRequest("  quanto entrou?  ")).toBe("quanto entrou?");
  });

  it("mantém a quebra de linha do meio, que é do texto da pessoa", () => {
    expect(cleanRequest("linha um\nlinha dois")).toBe("linha um\nlinha dois");
  });

  it("normaliza quebra de linha do Windows", () => {
    expect(cleanRequest("a\r\nb")).toBe("a\nb");
  });

  it("corta pedido gigante em vez de deixar estourar", () => {
    expect(cleanRequest("a".repeat(MAX_PEDIDO + 500))).toHaveLength(MAX_PEDIDO);
  });

  it("valor estranho não quebra", () => {
    expect(cleanRequest(null)).toBe("");
    expect(cleanRequest(undefined)).toBe("");
    expect(cleanRequest(12)).toBe("12");
  });
});

describe("quando dá para enviar", () => {
  it("texto de verdade pode ir", () => {
    expect(isSendable("oi")).toBe(true);
  });

  it("vazio ou só espaço não vai", () => {
    expect(isSendable("")).toBe(false);
    expect(isSendable("    ")).toBe(false);
    expect(isSendable("\n\n")).toBe(false);
  });

  it("uma letra só não vai — quase sempre é toque sem querer", () => {
    expect(isSendable("a")).toBe(false);
  });
});

describe("levar o pedido para a conversa", () => {
  it("guarda e devolve o mesmo texto", () => {
    const s = memoria();
    expect(stageRequest(s, "  monta um orçamento ")).toBe(true);
    expect(readStagedRequest(s)).toBe("monta um orçamento");
    expect(s.getItem(DRAFT_KEY)).toBe("monta um orçamento");
  });

  it("pedido vazio não é guardado", () => {
    const s = memoria();
    expect(stageRequest(s, "   ")).toBe(false);
    expect(readStagedRequest(s)).toBe("");
  });

  it("armazenamento bloqueado não impede de abrir a conversa", () => {
    // Aba anônima com armazenamento negado: a pessoa digita de novo, mas o app
    // não pode travar por causa disso.
    expect(stageRequest(quebrado, "oi")).toBe(false);
    expect(readStagedRequest(quebrado)).toBe("");
  });

  it("sem armazenamento nenhum, não quebra", () => {
    expect(stageRequest(null, "oi")).toBe(false);
    expect(readStagedRequest(null)).toBe("");
  });
});

describe("sugestões da entrada", () => {
  it("são pedidos inteiros, não nomes de tela", () => {
    // "Financeiro" não ensina nada a quem nunca abriu o app.
    for (const s of SUGESTOES) {
      expect(s.length).toBeGreaterThan(20);
      expect(s.split(/\s+/).length).toBeGreaterThan(3);
    }
  });

  it("mostra a quantidade pedida", () => {
    expect(suggestionsForToday(SUGESTOES, 3)).toHaveLength(3);
  });

  it("não repete sugestão na mesma leva", () => {
    const r = suggestionsForToday(SUGESTOES, 3);
    expect(new Set(r).size).toBe(3);
  });

  it("não muda dentro do mesmo dia", () => {
    // Se mudasse a cada abertura, a pessoa perderia a sugestão que ia clicar.
    const manha = new Date("2026-08-05T08:00:00Z");
    const noite = new Date("2026-08-05T22:00:00Z");
    expect(suggestionsForToday(SUGESTOES, 3, manha)).toEqual(
      suggestionsForToday(SUGESTOES, 3, noite),
    );
  });

  it("muda de um dia para o outro", () => {
    const hoje = suggestionsForToday(SUGESTOES, 3, new Date("2026-08-05T10:00:00Z"));
    const amanha = suggestionsForToday(SUGESTOES, 3, new Date("2026-08-06T10:00:00Z"));
    expect(hoje).not.toEqual(amanha);
  });

  it("pedir mais do que existe devolve o que existe", () => {
    expect(suggestionsForToday(["a", "b"], 10)).toHaveLength(2);
  });

  it("lista vazia não quebra", () => {
    expect(suggestionsForToday([], 3)).toEqual([]);
    expect(suggestionsForToday(null, 3)).toEqual([]);
  });
});

describe("saudação", () => {
  it("muda com o horário", () => {
    expect(greeting("Ana", new Date("2026-08-05T09:00:00"))).toBe("Bom dia, Ana");
    expect(greeting("Ana", new Date("2026-08-05T15:00:00"))).toBe("Boa tarde, Ana");
    expect(greeting("Ana", new Date("2026-08-05T21:00:00"))).toBe("Boa noite, Ana");
  });

  it("usa só o primeiro nome", () => {
    expect(greeting("Renata Paula Silva", new Date("2026-08-05T09:00:00"))).toBe(
      "Bom dia, Renata",
    );
  });

  it("sem nome, cumprimenta mesmo assim", () => {
    expect(greeting("", new Date("2026-08-05T09:00:00"))).toBe("Bom dia");
    expect(greeting(null, new Date("2026-08-05T09:00:00"))).toBe("Bom dia");
  });
});
