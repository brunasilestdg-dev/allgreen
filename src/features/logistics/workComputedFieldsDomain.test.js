import { describe, expect, it } from "vitest";
import {
  calcularCampoDerivado,
  calcularCamposDerivados,
  idsRelacionados,
  itensRelacionados,
} from "./workComputedFieldsDomain.js";

describe("relações do item", () => {
  it("extrai ids de relations e de dependencies", () => {
    const item = { relations: [{ id: "a" }, "b", { id: "a" }], dependencies: ["c"] };
    expect(idsRelacionados(item, "relations")).toEqual(["a", "b"]);
    expect(idsRelacionados(item, "dependencies")).toEqual(["c"]);
  });

  it("resolve os itens relacionados a partir do conjunto", () => {
    const item = { relations: [{ id: "x" }, { id: "y" }] };
    const todos = [{ id: "x", title: "X" }, { id: "y", title: "Y" }, { id: "z" }];
    expect(itensRelacionados(item, todos).map((i) => i.id)).toEqual(["x", "y"]);
  });
});

describe("fórmula", () => {
  it("calcula uma expressão sobre os campos do item", () => {
    const def = { id: "total", type: "formula", formula: "quantidade * preco" };
    const item = { fields: { quantidade: 3, preco: 10 } };
    expect(calcularCampoDerivado(def, item).valor).toBe(30);
  });

  it("devolve o erro da fórmula sem quebrar", () => {
    const def = { id: "x", type: "formula", formula: "a + " };
    const r = calcularCampoDerivado(def, { fields: { a: 1 } });
    expect(r.erro).toBeTruthy();
  });
});

describe("espelhamento (mirror/lookup)", () => {
  const relacionados = [
    { id: "r1", fields: { responsavel: "Ana" } },
    { id: "r2", fields: { responsavel: "Beto" } },
  ];

  it("um único relacionado espelha o valor direto", () => {
    const def = { id: "resp", type: "mirror", sourceField: "responsavel" };
    expect(calcularCampoDerivado(def, {}, { relacionados: [relacionados[0]] }).valor).toBe("Ana");
  });

  it("vários viram uma lista legível", () => {
    const def = { id: "resp", type: "lookup", sourceField: "responsavel" };
    expect(calcularCampoDerivado(def, {}, { relacionados }).valor).toBe("Ana, Beto");
  });

  it("sem relacionados, valor vazio — nunca inventa", () => {
    const def = { id: "resp", type: "mirror", sourceField: "responsavel" };
    expect(calcularCampoDerivado(def, {}, { relacionados: [] }).valor).toBe("");
  });
});

describe("rollup", () => {
  const subitens = [
    { id: "s1", fields: { horas: 4 } },
    { id: "s2", fields: { horas: 6 } },
    { id: "s3", fields: { horas: 2 } },
  ];

  it("soma um campo dos subitens", () => {
    const def = { id: "horasTotais", type: "rollup", aggregate: "sum", sourceField: "horas", sourceRelation: "subitens" };
    expect(calcularCampoDerivado(def, {}, { subitens }).valor).toBe(12);
  });

  it("conta os relacionados por padrão", () => {
    const def = { id: "qtd", type: "rollup", sourceField: "horas", sourceRelation: "subitens" };
    expect(calcularCampoDerivado(def, {}, { subitens }).valor).toBe(3);
  });

  it("média dos subitens", () => {
    const def = { id: "media", type: "rollup", aggregate: "average", sourceField: "horas", sourceRelation: "subitens" };
    expect(calcularCampoDerivado(def, {}, { subitens }).valor).toBe(4);
  });
});

describe("cálculo em lote", () => {
  it("resolve fórmula e espelhamento juntos, ignorando campos comuns", () => {
    const definicoes = [
      { id: "nome", type: "text" }, // ignorado
      { id: "dobro", type: "formula", formula: "base * 2" },
      { id: "cliente", type: "mirror", sourceField: "clienteNome" },
    ];
    const item = { id: "i1", fields: { base: 5 }, relations: [{ id: "c1" }] };
    const todos = [{ id: "c1", fields: { clienteNome: "Acme" } }];
    const derivados = calcularCamposDerivados(item, { definicoes, todos });
    expect(derivados.nome).toBeUndefined();
    expect(derivados.dobro.valor).toBe(10);
    expect(derivados.cliente.valor).toBe("Acme");
  });

  it("sem campos derivados, devolve objeto vazio", () => {
    expect(calcularCamposDerivados({ fields: {} }, { definicoes: [{ id: "a", type: "text" }] })).toEqual({});
  });
});
