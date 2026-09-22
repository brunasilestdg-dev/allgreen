import { describe, expect, it } from "vitest";
import {
  aggregateValues,
  appendRecordComment,
  computedDatabaseValue,
  createDatabaseRecord,
  lookupValues,
  relationIds,
  removeRecordAndReferences,
  updateRelation,
} from "./features/databases/relational.js";

const seed = () => [
  {
    id: "clients",
    fields: [
      { id: "name", name: "Cliente", type: "text", primary: true },
      {
        id: "projects",
        name: "Projetos",
        type: "relation",
        targetBaseId: "projects",
        reciprocalFieldId: "client",
        multiple: true,
      },
    ],
    rows: [{ id: "c1", cells: { name: "Acme", projects: [] } }],
  },
  {
    id: "projects",
    fields: [
      { id: "title", name: "Projeto", type: "text", primary: true },
      { id: "budget", name: "Orçamento", type: "number" },
      {
        id: "client",
        name: "Cliente",
        type: "relation",
        targetBaseId: "clients",
        reciprocalFieldId: "projects",
        multiple: false,
      },
    ],
    rows: [
      { id: "p1", cells: { title: "Implantação", budget: 1200, client: "" } },
      { id: "p2", cells: { title: "Expansão", budget: 800, client: "" } },
    ],
  },
];

describe("domínio relacional das bases", () => {
  it("normaliza relação antiga de valor único e remove duplicidades", () => {
    expect(relationIds("p1")).toEqual(["p1"]);
    expect(relationIds(["p1", "p1", "", "p2"])).toEqual(["p1", "p2"]);
  });

  it("mantém relação bidirecional ao vincular e desvincular registros", () => {
    let bases = updateRelation(seed(), {
      baseId: "projects",
      rowId: "p1",
      fieldId: "client",
      value: "c1",
    });
    expect(bases[1].rows[0].cells.client).toBe("c1");
    expect(bases[0].rows[0].cells.projects).toEqual(["p1"]);

    bases = updateRelation(bases, {
      baseId: "projects",
      rowId: "p1",
      fieldId: "client",
      value: "",
    });
    expect(bases[0].rows[0].cells.projects).toEqual([]);
  });

  it("faz lookup e rollup sobre vários registros relacionados", () => {
    const bases = updateRelation(seed(), {
      baseId: "clients",
      rowId: "c1",
      fieldId: "projects",
      value: ["p1", "p2"],
    });
    const lookup = {
      type: "lookup",
      relationFieldId: "projects",
      targetFieldId: "budget",
    };
    const rollup = { ...lookup, type: "rollup", rollupOperation: "sum" };
    expect(lookupValues(bases, bases[0].rows[0], lookup)).toEqual([1200, 800]);
    expect(computedDatabaseValue(bases, bases[0], bases[0].rows[0], rollup)).toBe(
      2000,
    );
    expect(aggregateValues(["A", "A", "B"], "count_unique")).toBe(2);
  });

  it("remove referências órfãs ao excluir um registro", () => {
    const linked = updateRelation(seed(), {
      baseId: "projects",
      rowId: "p1",
      fieldId: "client",
      value: "c1",
    });
    const clean = removeRecordAndReferences(linked, "clients", "c1");
    expect(clean[0].rows).toHaveLength(0);
    expect(clean[1].rows[0].cells.client).toBe("");
  });

  it("cria registro-página com conteúdo, anexos e comentários persistíveis", () => {
    const row = createDatabaseRecord("r1", "2026-07-29T10:00:00.000Z");
    const commented = appendRecordComment(row, {
      id: "cm1",
      text: "Aprovado",
      authorId: "u1",
      authorName: "Renata",
      createdAt: "2026-07-29T11:00:00.000Z",
    });
    expect(row).toMatchObject({ content: "", attachments: [], comments: [] });
    expect(commented.comments[0].text).toBe("Aprovado");
    expect(commented.updatedAt).toBe("2026-07-29T11:00:00.000Z");
  });
});
