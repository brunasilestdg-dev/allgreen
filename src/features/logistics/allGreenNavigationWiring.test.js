import { describe, it, expect } from "vitest";
import { permissaoDaPagina, todoGreenRouteToPage } from "./LogisticsVertical.jsx";
import { TODO_GREEN_MODULE_CATALOG } from "./logisticsVerticalDomain.js";

// Guarda que as 7 páginas das lacunas dos 26 blocos All Green estão
// TOTALMENTE integradas: catálogo do menu, rota canônica, permissão e nome
// da tela. Falha qualquer desligação futura antes de virar tela quebrada.

const NOVAS = [
  { id: "tenant-acessos", area: "administracao" },
  { id: "green-on-empresa", area: "financeiro" },
  { id: "roaming-ocpi", area: "operacao" },
  { id: "energia-peak", area: "esg" },
  { id: "fila-alertas", area: "administracao" }, // no menu vive em Operação; a área do módulo é administracao pelo catálogo
  { id: "greenmob-locacao", area: "operacao" },
  { id: "saas-billing", area: "administracao" },
  // Rodada P0/P1/P2 do roadmap.
  { id: "core-grupo", area: "administracao" },
  { id: "ocpp-console", area: "operacao" },
  { id: "green-on-app", area: "operacao" },
  { id: "seguranca-fisica", area: "operacao" },
];

const catalogById = new Map(TODO_GREEN_MODULE_CATALOG.map((m) => [m.id, m]));

describe("All Green · fiação das 7 páginas novas", () => {
  it("todas as 7 páginas estão no catálogo do menu (TODO_GREEN_MODULE_CATALOG)", () => {
    for (const { id } of NOVAS) {
      const m = catalogById.get(id);
      expect(m, `módulo ${id} não está no catálogo`).toBeDefined();
      expect(m.route, `rota canônica do ${id}`).toBe(`/todogreen/${id}`);
      expect(m.workspaceRoute, `workspaceRoute do ${id}`).toBe(`/todogreen/${id}`);
    }
  });

  it("cada rota canônica devolve a página pelo mesmo id", () => {
    for (const { id } of NOVAS) {
      expect(todoGreenRouteToPage(`/todogreen/${id}`)).toBe(id);
    }
  });

  it("permissaoDaPagina devolve algo definido (string), incluindo vazio para páginas sem restrição extra", () => {
    // permissaoDaPagina lê MODULE_IMPLEMENTATION; testar que o registro existe.
    for (const { id } of NOVAS) {
      const p = permissaoDaPagina(id);
      // Aceita string vazia (open a quem tem :read) ou string preenchida
      // (ex.: finance:manage). Se o registro sumisse, devolveria undefined
      // e não string.
      expect(typeof p, `permissaoDaPagina('${id}') deve ser string`).toBe("string");
    }
  });
});
