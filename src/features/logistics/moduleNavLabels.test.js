import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A barra de navegação da vertical derivava o rótulo de cada aba com
// `title.split(" ")[0]` — a primeira palavra do título completo. Isso produzia
// "ESG," com a vírgula grudada, "Receita," e "Custos,", e cortava "TMS Tracker"
// em "TMS". O rótulo curto agora é declarado por módulo.
//
// Este teste lê o arquivo como texto porque LogisticsVertical.jsx é um
// componente pesado: importá-lo só para conferir rótulos arrastaria a árvore
// inteira de dependências para dentro do teste.

const arquivo = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "LogisticsVertical.jsx",
);
const fonte = fs.readFileSync(arquivo, "utf8");

const blocoDosModulos = fonte.slice(
  fonte.indexOf("const MODULE_IMPLEMENTATION"),
  fonte.indexOf("const fieldLabels"),
);
const blocoDaNavegacaoPrincipal = fonte.slice(
  fonte.indexOf("const PRIMARY_NAVIGATION"),
  fonte.indexOf("const MANAGEMENT_TOOLS"),
);

const modulos = [...blocoDosModulos.matchAll(/^ {2}"?([a-z-]+)"?: \{/gm)].map((m) => m[1]);
const rotulos = [...blocoDosModulos.matchAll(/navLabel: "([^"]+)"/g)].map((m) => m[1]);

describe("rótulos da navegação da vertical", () => {
  it("todo módulo declara o próprio rótulo curto", () => {
    expect(modulos.length).toBeGreaterThan(0);
    expect(rotulos).toHaveLength(modulos.length);
  });

  it("nenhum rótulo termina em pontuação solta", () => {
    // Era exatamente isto que aparecia na tela: "ESG,", "Receita,", "Custos,".
    const quebrados = rotulos.filter((rotulo) => /[,;:.]$/.test(rotulo));
    expect(quebrados).toEqual([]);
  });

  it("nenhum rótulo está vazio ou com espaço sobrando", () => {
    for (const rotulo of rotulos) {
      expect(rotulo.trim()).toBe(rotulo);
      expect(rotulo.length).toBeGreaterThan(0);
    }
  });

  it("dois módulos não disputam o mesmo rótulo", () => {
    // Duas abas escritas igual são duas abas que o usuário não sabe distinguir.
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("a barra usa o rótulo declarado, não a primeira palavra do título", () => {
    expect(fonte).toContain("{item.navLabel}");
    expect(fonte).not.toContain('item.title.split(" ")[0]');
  });
});

describe("propriedade das abas principais", () => {
  it("nenhuma tela aparece em duas abas principais", () => {
    const paginas = [...blocoDaNavegacaoPrincipal.matchAll(/pages: \[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((page) => page[1]));

    expect(paginas.length).toBeGreaterThan(0);
    expect(new Set(paginas).size).toBe(paginas.length);
  });

  it("funções que tinham dono errado ficam em abas próprias", () => {
    expect(blocoDaNavegacaoPrincipal).toContain('label: "Cadastros"');
    expect(blocoDaNavegacaoPrincipal).toContain('label: "Suprimentos"');
    expect(blocoDaNavegacaoPrincipal).toContain('label: "Documentos"');
    expect(blocoDaNavegacaoPrincipal).toContain('label: "Administração"');
    expect(blocoDaNavegacaoPrincipal).toContain('label: "Operação", route: "/todogreen/operacoes"');
    // Ocorrência de entrega (atraso, insucesso, reentrega) pertence à Operação,
    // não a um item solto no topo do menu.
    expect(blocoDaNavegacaoPrincipal).not.toMatch(/label: "Ocorrências"/);
    expect(blocoDaNavegacaoPrincipal).toMatch(/label: "Operação"[^\n]+ocorrencias/);
    expect(blocoDaNavegacaoPrincipal).not.toMatch(/label: "Documentos"[^\n]+relatorios/);
    expect(blocoDaNavegacaoPrincipal).toContain('label: "ESG", route: "/todogreen/central-esg", pages: ["central-esg", "esg", "metodologia"]');
  });
});

describe("permissão não sai do texto da tela", () => {
  it("a aba de Acessos exige a permissão de gerenciar acessos", () => {
    // Antes, um script lia o texto do painel e decidia:
    //   /admin|owner|access:manage|gerenciar/i.test(panel.textContent)
    // Bastava um e-mail como "admin@cliente.com" aparecer na lista para a tela
    // liberar a gestão. A permissão agora vem do papel do vínculo.
    expect(blocoDosModulos).toMatch(/permission: "access:manage"/);
  });

  it("a barra filtra por permissão antes de desenhar a aba", () => {
    expect(fonte).toMatch(/podeAcessarFuncionalidade\(role, remoteAccess\.permissions, item\.permission\)/);
  });

  it("nenhum módulo de tela decide acesso lendo textContent", () => {
    expect(fonte).not.toMatch(/textContent[^\n]*\b(admin|owner|gerenciar)\b/);
  });
});
