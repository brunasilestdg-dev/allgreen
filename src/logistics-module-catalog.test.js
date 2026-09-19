import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guarda contra a regressão CAT-01: um módulo com implementação registrada em
// MODULE_IMPLEMENTATION (rota + página renderizada) mas ausente de
// IMPLEMENTED_MODULE_IDS aparece como "Em implantação" (cinza) e some do menu,
// apesar de pronto e com backend. Foi assim que a área Green Tech Core inteira
// ficou escondida. Este teste lê os dois catálogos da fonte e falha quando eles
// divergem — a próxima vez que alguém adicionar uma tela e esquecer de liberá-la
// vira teste vermelho, não funcionalidade invisível.

const src = readFileSync(
  fileURLToPath(new URL("./features/logistics/LogisticsVertical.jsx", import.meta.url)),
  "utf8",
);

const conjuntoImplementados = () => {
  const inicio = src.indexOf("IMPLEMENTED_MODULE_IDS = new Set([");
  const bloco = src.slice(inicio, src.indexOf("]);", inicio));
  return new Set([...bloco.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
};

const chavesDeImplementacao = () => {
  const inicio = src.indexOf("MODULE_IMPLEMENTATION = Object.freeze({");
  const bloco = src.slice(inicio, src.indexOf("});", inicio));
  return [...bloco.matchAll(/^ {2}"([^"]+)":\s*\{/gm)].map((m) => m[1]);
};

describe("catálogos de módulos da vertical (CAT-01)", () => {
  it("os dois catálogos foram encontrados e não estão vazios", () => {
    expect(conjuntoImplementados().size).toBeGreaterThan(50);
    expect(chavesDeImplementacao().length).toBeGreaterThan(20);
  });

  it("todo módulo com implementação registrada está marcado como liberado", () => {
    const implementados = conjuntoImplementados();
    const escondidos = chavesDeImplementacao().filter((id) => !implementados.has(id));
    expect(
      escondidos,
      `Módulos com MODULE_IMPLEMENTATION mas fora de IMPLEMENTED_MODULE_IDS (aparecem como "Em implantação"): ${escondidos.join(", ")}`,
    ).toEqual([]);
  });
});
