import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { folhaCompleta } from "./styles/folhaCompleta.js";

// O menu lateral do app é um <aside>, e por muito tempo a regra que o tornava
// barra fixa era escrita como seletor de elemento puro:
//
//   aside { position: fixed; left: 0; top: 0; width: 250px; z-index: 30 }
//
// Isso vale para TODO <aside> da aplicação. O cartão de indicadores do hero da
// vertical é um <aside>. A barra de quadros da Central de Trabalho é um
// <aside>. Os dois viravam menu fixo grudado no canto esquerdo, por cima do
// conteúdo — foi exatamente o que apareceu na tela da To Do Green.
//
// A regra agora é escopada em `.app > aside`. Este teste impede a volta.

// A folha inteira, na ordem em que o navegador a monta.
const css = folhaCompleta();

// Seletores no começo de uma regra (ignorando indentação de media query).
const seletores = css
  .split("\n")
  .map((linha, i) => [i + 1, linha.trim()])
  .filter(([, linha]) => /\{\s*$/.test(linha) || /^[^{}/]+,$/.test(linha))
  .map(([n, linha]) => [n, linha.replace(/\s*\{\s*$/, "").replace(/,$/, "")]);

describe("nenhuma regra de estilo alcança todo <aside> da aplicação", () => {
  it("não existe seletor de aside sem escopo", () => {
    const soltos = seletores.filter(([, sel]) =>
      sel.split(",").some((parte) => /^aside\b/.test(parte.trim())),
    );
    expect(
      soltos.map(([n, sel]) => `linha ${n}: ${sel}`),
      "escope em `.app > aside` — seletor solto transforma qualquer <aside> do produto em menu lateral fixo",
    ).toEqual([]);
  });

  it("o menu do app continua tendo a regra que o torna barra fixa", () => {
    // O contrário do bug também precisa ser guardado: escopar demais deixaria
    // o menu lateral sem posicionamento.
    expect(css).toMatch(/\.app > aside\s*\{[^}]*position:\s*fixed/);
  });
});

describe("as folhas da vertical não posicionam os próprios asides", () => {
  const verticais = [
    "features/logistics/LogisticsVertical.css",
    "features/logistics/LogisticsVerticalWorkCenter.css",
  ];

  for (const arquivo of verticais) {
    it(arquivo, () => {
      const folha = readFileSync(new URL(`./${arquivo}`, import.meta.url), "utf8");
      // Elas devem confiar na grade do container. Se alguma passar a fixar
      // posição, volta o risco de sobreposição.
      expect(folha).not.toMatch(/aside[^{]*\{[^}]*position:\s*(fixed|absolute)/);
    });
  }
});
