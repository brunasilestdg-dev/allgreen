import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Os arquivos que "polem" a vertical To Do Green rodam a cada mutação do DOM,
// através de um MutationObserver ligado ao corpo da página. Isso torna uma
// gravação de texto sem comparação prévia num laço infinito: gravar
// `textContent` troca o nó de texto mesmo quando o valor é idêntico, a troca
// conta como mutação, a mutação reacorda o observador, e a aba trava girando.
//
// A pessoa vê "carregando" para sempre. Sem erro no console, sem nada.

const arquivo = (nome) =>
  readFileSync(new URL(`./features/logistics/${nome}`, import.meta.url), "utf8");

const OBSERVADORES = [
  "LogisticsVerticalCredentials.js",
  // LogisticsVerticalPolish.js foi removido (#117): era um apagador de DOM
  // (MutationObserver global) que já não era carregado em produção — código
  // morto. A parte pura e testada (polirTexto) migrou para rotulosBanidos.js,
  // sem tocar no DOM.
  // LogisticsVerticalNavigation.js foi removido: era navegação imperativa
  // (MutationObserver global + clique sintético) sobre um DOM que o React
  // parou de gerar — código morto. A navegação da precificação agora é
  // dirigida pela rota, no próprio React.
];

describe("gravar o mesmo texto realimenta o observador", () => {
  it("é por isso que a comparação é obrigatória", async () => {
    const dom = new JSDOM("<body><span id='alvo'>igual</span></body>");
    const { document, MutationObserver } = dom.window;
    let mutacoes = 0;
    new MutationObserver(() => {
      mutacoes += 1;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    document.getElementById("alvo").textContent = "igual";
    await new Promise((r) => setTimeout(r, 20));

    expect(mutacoes).toBeGreaterThan(0);
  });
});

describe("nenhum arquivo que roda a cada mutação grava texto sem comparar", () => {
  for (const nome of OBSERVADORES) {
    it(nome, () => {
      const fonte = arquivo(nome);
      if (!fonte.includes("MutationObserver")) return;

      // Gravações de texto diretas, sem passar pelo auxiliar que compara.
      const diretas = fonte
        .split("\n")
        .map((linha, i) => [i + 1, linha])
        .filter(
          ([, linha]) =>
            /\.textContent\s*=[^=]/.test(linha) &&
            // A própria definição do auxiliar compara antes de gravar.
            !/textContent\s*!==/.test(linha) &&
            !/^\s*\/\//.test(linha),
        );

      expect(
        diretas.map(([n, l]) => `linha ${n}: ${l.trim()}`),
        "grave por setTextIfChanged (compara antes) — gravação direta trava a aba",
      ).toEqual([]);
    });
  }
});

describe("a insistência da tela de acesso tem fim", () => {
  it("o reagendamento é limitado", () => {
    const fonte = arquivo("LogisticsVerticalCredentials.js");
    // Quem já tem acesso nunca vê a tela de login: sem limite, o temporizador
    // ficaria rodando para sempre por baixo da vertical.
    expect(fonte).toMatch(/RETRY_LIMIT/);
    expect(fonte).toMatch(/tentativa\s*>=\s*RETRY_LIMIT/);
  });

  it("os ouvintes de evento não passam o evento como contador", () => {
    const fonte = arquivo("LogisticsVerticalCredentials.js");
    // addEventListener(nome, scheduleEnsure) entregaria o Event como primeiro
    // argumento; `Event >= 40` é falso e o limite nunca valeria.
    expect(fonte).not.toMatch(/addEventListener\([^,]+,\s*scheduleEnsure\s*\)/);
  });
});
