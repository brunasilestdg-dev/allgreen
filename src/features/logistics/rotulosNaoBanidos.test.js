/* @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED_PATTERNS, polirTexto } from "./rotulosBanidos.js";

// ===== O apagador de jargão não pode comer rótulo de tela =====
//
// LogisticsVerticalPolish.js REMOVE palavras banidas ("vertical", "tenant",
// "workspace"...) de todo texto da vertical. É intencional — jargão não
// aparece para a titular. O efeito colateral que este teste impede de voltar:
// batizar um grupo do menu com uma palavra banida. Foi assim que o primeiro
// botão do menu ficou com fundo e SEM NOME (31/08): o grupo se chamava
// "Workspace", e o apagador o esvaziava depois do React montar.
//
// O arquivo é lido como texto, no padrão de moduleNavLabels.test.js: importar
// LogisticsVertical.jsx arrastaria a árvore inteira para dentro do teste.

const fonte = fs.readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), "LogisticsVertical.jsx"),
  "utf8",
);

const blocoDaNavegacao = fonte.slice(
  fonte.indexOf("const PRIMARY_NAVIGATION"),
  fonte.indexOf("const MANAGEMENT_TOOLS"),
);
const blocoDosModulos = fonte.slice(
  fonte.indexOf("const MODULE_IMPLEMENTATION"),
  fonte.indexOf("const fieldLabels"),
);

const rotulosDoMenu = [...blocoDaNavegacao.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
const navLabels = [...blocoDosModulos.matchAll(/navLabel: "([^"]+)"/g)].map((m) => m[1]);
const titulos = [...blocoDosModulos.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);

describe("rótulos sobrevivem ao polimento", () => {
  it("nenhum rótulo de área do menu é alterado pelo apagador", () => {
    expect(rotulosDoMenu.length).toBeGreaterThan(5);
    for (const rotulo of rotulosDoMenu) expect(polirTexto(rotulo)).toBe(rotulo);
  });

  it("nenhum navLabel nem título perde PALAVRA nem fica vazio", () => {
    // O mapa LABELS encurta títulos de propósito ("Oportunidades e pipeline" →
    // "Oportunidades") — renomear é permitido. O que este teste barra é o
    // APAGADOR: padrão banido comendo palavra de rótulo, que é como um botão
    // fica com fundo e sem nome.
    expect(navLabels.length).toBeGreaterThan(20);
    for (const rotulo of [...navLabels, ...titulos]) {
      for (const padrao of BLOCKED_PATTERNS) {
        padrao.lastIndex = 0;
        expect(rotulo.replace(padrao, "")).toBe(rotulo);
      }
      expect(polirTexto(rotulo).trim().length).toBeGreaterThan(0);
    }
  });

  it("a troca de palavra respeita fronteira: nada de 'ativoidade' nem e-mail quebrado", () => {
    // "funcional" → "ativo" não pode comer o miolo de "funcionalidade"...
    expect(polirTexto("Autorize usuários por perfil pronto ou selecione cada funcionalidade."))
      .toBe("Autorize usuários por perfil pronto ou selecione cada funcionalidade.");
    // ...mas a troca de verdade continua valendo onde ela nasceu.
    expect(polirTexto("40 funcionais · 13 backlog")).toBe("40 ativas · 13 planejado");
    // E domínio/e-mail não é lugar de renomear empresa.
    expect(polirTexto("bruna.paula@todogreen.com.br")).toBe("bruna.paula@todogreen.com.br");
    expect(polirTexto("seufuncionario-expo com tenant todogreen")).toContain("To Do Green");
  });

  it("a prova do defeito original: 'Workspace' seria apagado; 'Espaço de trabalho' sobrevive", () => {
    expect(polirTexto("Workspace").trim()).toBe("");
    expect(polirTexto("Espaço de trabalho")).toBe("Espaço de trabalho");
  });
});
