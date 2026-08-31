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

  it("nenhum item do menu abre a mesma tela que outro", () => {
    // "Sinais de mercado" abria a tela de "Mercado"; "Motoristas", a de
    // "Frota"; "Catálogo", a de "Produtos"; e "Escalas", dentro do DP, abria
    // a tela de RH. Quatro nomes diferentes para quatro telas que já estavam
    // no menu — repetição pura.
    const paginas = [...blocoDaNavegacaoPrincipal.matchAll(/pages: \[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((page) => page[1]));
    const rotaDe = (pagina) => {
      const bloco = blocoDosModulos.match(
        new RegExp(`\n {2}"?${pagina}"?: \\{[\\s\\S]*?\n {2}\\},`),
      );
      return bloco ? (bloco[0].match(/route: "([^"]+)"/) || [])[1] : "";
    };
    const rotas = paginas.map(rotaDe).filter(Boolean);
    expect(rotas.length).toBeGreaterThan(20);
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it("Planejamento é uma área só, e não um item dentro de Operação", () => {
    // Havia uma aba "Planejamento" que na verdade era indicadores, e um item
    // "Planejamento" dentro de Operação. Mesmo nome, dois lugares.
    expect(blocoDaNavegacaoPrincipal).toMatch(/label: "Planejamento", route: "\/todogreen\/planejamento"/);
    expect(blocoDaNavegacaoPrincipal).not.toMatch(/label: "Operação"[^\n]+"planejamento"/);
    expect(blocoDaNavegacaoPrincipal).toMatch(/label: "Indicadores"[^\n]+indicadores/);
  });

  it("nenhum item repete, letra por letra, o nome da própria área", () => {
    const grupos = [...blocoDaNavegacaoPrincipal.matchAll(/label: "([^"]+)", route: "[^"]+", pages: \[([^\]]*)\]/g)];
    const rotuloDe = (pagina) => {
      const bloco = blocoDosModulos.match(
        new RegExp(`\n {2}"?${pagina}"?: \\{[\\s\\S]*?\n {2}\\},`),
      );
      return bloco ? (bloco[0].match(/navLabel: "([^"]+)"/) || [])[1] : "";
    };
    const repetidos = [];
    for (const [, area, paginasCru] of grupos) {
      const paginas = [...paginasCru.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      // Área com uma tela só não abre segundo nível: não há o que repetir.
      if (paginas.length < 2) continue;
      for (const pagina of paginas) if (rotuloDe(pagina) === area) repetidos.push(`${area} › ${pagina}`);
    }
    expect(repetidos).toEqual([]);
  });

  it("cadastro não joga a pessoa em Administração", () => {
    // A aba agregada com as sete abas de todas as áreas saiu do menu: cada
    // cadastro abre recortado pela área dona do dado.
    expect(blocoDaNavegacaoPrincipal).not.toMatch(/label: "Administração"[^\n]+"cadastros"/);
    expect(fonte).toContain("const AREA_DO_CADASTRO");
    expect(fonte).toMatch(/navigationFor\(page, secaoDeCadastro\)/);
  });

  it("funções que tinham dono errado ficam em abas próprias", () => {
    // Taxonomia da titular (30/08): cadastro mora na área dona do dado —
    // fornecedores, itens e depósitos são de Compras; e Suprimentos assina
    // como "Compras". Implantação vive dentro do Workspace (é um tipo de
    // projeto), e o Workspace abre a lista.
    expect(blocoDaNavegacaoPrincipal).toMatch(/label: "Compras"[^\n]+cadastros/);
    expect(blocoDaNavegacaoPrincipal).toMatch(/label: "Workspace"[^\n]+implantacao/);
    expect(blocoDaNavegacaoPrincipal).toMatch(/^const PRIMARY_NAVIGATION[\s\S]{0,400}label: "Workspace"/);
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
