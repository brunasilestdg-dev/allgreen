/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { BLOCKED_PATTERNS, polirTexto } from "./rotulosBanidos.js";
import { MODULE_IMPLEMENTATION } from "./shell/catalogoDeModulos.js";
import { MANAGEMENT_TOOLS, PRIMARY_NAVIGATION } from "./shell/navegacao.js";

// ===== O apagador de jargão não pode comer rótulo de tela =====
//
// LogisticsVerticalPolish.js REMOVE palavras banidas ("vertical", "tenant",
// "workspace"...) de todo texto da vertical. É intencional — jargão não
// aparece para a titular. O efeito colateral que este teste impede de voltar:
// batizar um grupo do menu com uma palavra banida. Foi assim que o primeiro
// botão do menu ficou com fundo e SEM NOME (31/08): o grupo se chamava
// "Workspace", e o apagador o esvaziava depois do React montar.
//
// O menu e o catálogo de telas moram em módulos puros (./shell/), então o
// teste importa os dados reais em vez de ler LogisticsVertical.jsx como texto.
// São os mesmos rótulos que o texto mostrava: o nome de cada área do menu, o
// rótulo curto e o título de cada tela, e o título das ferramentas de
// Configurações (que ficavam no mesmo trecho do arquivo).

const rotulosDoMenu = PRIMARY_NAVIGATION.map((area) => area.label);
const navLabels = Object.values(MODULE_IMPLEMENTATION).map((modulo) => modulo.navLabel);
const titulos = [
  ...Object.values(MODULE_IMPLEMENTATION).map((modulo) => modulo.title),
  ...MANAGEMENT_TOOLS.map((ferramenta) => ferramenta.title),
];

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
    expect(polirTexto("renata.paula@todogreen.com.br")).toBe("renata.paula@todogreen.com.br");
    expect(polirTexto("seufuncionario-expo com tenant todogreen")).toContain("To Do Green");
  });

  it("a prova do defeito original: 'Workspace' seria apagado; 'Espaço de trabalho' sobrevive", () => {
    expect(polirTexto("Workspace").trim()).toBe("");
    expect(polirTexto("Espaço de trabalho")).toBe("Espaço de trabalho");
  });
});
