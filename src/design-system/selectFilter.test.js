import { describe, expect, it } from "vitest";
import { agruparOpcoes, filtrarOpcoes, normalizar, opcaoCasa, proximoIndice } from "./selectFilter.js";

describe("normalizar", () => {
  it("tira acento e caixa", () => {
    expect(normalizar("Operação Ração")).toBe("operacao racao");
    expect(normalizar("  SÃO Paulo ")).toBe("sao paulo");
  });
  it("aguenta nulo/indefinido", () => {
    expect(normalizar(null)).toBe("");
    expect(normalizar(undefined)).toBe("");
  });
});

describe("opcaoCasa", () => {
  it("acha por trecho sem acento no label, descrição e keywords", () => {
    const o = { label: "Paraná", description: "Curitiba", keywords: ["sul"] };
    expect(opcaoCasa(o, "para")).toBe(true);   // label
    expect(opcaoCasa(o, "curi")).toBe(true);   // descrição
    expect(opcaoCasa(o, "sul")).toBe(true);    // keyword
    expect(opcaoCasa(o, "bahia")).toBe(false);
  });
  it("termo vazio casa tudo", () => {
    expect(opcaoCasa({ label: "X" }, "")).toBe(true);
    expect(opcaoCasa({ label: "X" }, "   ")).toBe(true);
  });
});

describe("filtrarOpcoes", () => {
  const opcoes = [
    { value: "sp", label: "São Paulo" },
    { value: "pr", label: "Paraná" },
    { value: "ba", label: "Bahia", disabled: true },
    { value: "pa", label: "Pará" },
  ];
  it("filtra sem acento e preserva a ordem", () => {
    expect(filtrarOpcoes(opcoes, "pa").map((o) => o.value)).toEqual(["sp", "pr", "pa"]);
  });
  it("descarta desabilitadas", () => {
    expect(filtrarOpcoes(opcoes, "bahia").map((o) => o.value)).toEqual([]);
  });
  it("lista vazia/entrada inválida não quebra", () => {
    expect(filtrarOpcoes(null, "x")).toEqual([]);
  });
});

describe("agruparOpcoes", () => {
  it("agrupa preservando a ordem de aparição do grupo", () => {
    const r = agruparOpcoes([
      { value: 1, group: "Sul" }, { value: 2, group: "Norte" }, { value: 3, group: "Sul" },
    ]);
    expect(r.map((g) => g.group)).toEqual(["Sul", "Norte"]);
    expect(r[0].options.map((o) => o.value)).toEqual([1, 3]);
  });
});

describe("proximoIndice", () => {
  const opcoes = [{ label: "a" }, { label: "b", disabled: true }, { label: "c" }];
  it("desce pulando desabilitados", () => {
    expect(proximoIndice(opcoes, 0, 1)).toBe(2);
  });
  it("dá a volta nas pontas", () => {
    expect(proximoIndice(opcoes, 2, 1)).toBe(0);
    expect(proximoIndice(opcoes, 0, -1)).toBe(2);
  });
  it("lista vazia devolve -1", () => {
    expect(proximoIndice([], 0, 1)).toBe(-1);
  });
});
