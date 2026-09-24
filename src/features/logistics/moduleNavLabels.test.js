import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_IMPLEMENTATION } from "./shell/catalogoDeModulos.js";
import { AREA_DO_CADASTRO, MANAGEMENT_TOOLS, PRIMARY_NAVIGATION, navigationFor } from "./shell/navegacao.js";

// A barra de navegação da vertical derivava o rótulo de cada aba com
// `title.split(" ")[0]` — a primeira palavra do título completo. Isso produzia
// "ESG," com a vírgula grudada, "Receita," e "Custos,", e cortava "TMS Tracker"
// em "TMS". O rótulo curto agora é declarado por módulo.
//
// O catálogo de telas e o menu moram em módulos puros (./shell/), então o
// teste importa os dados reais. Continua lido como texto só o que é JSX do
// esqueleto: a barra que desenha o rótulo e a checagem de permissão antes de
// desenhar a aba, no arquivo onde elas estão.

const pasta = path.dirname(new URL(import.meta.url).pathname);
const fonte = fs.readFileSync(path.join(pasta, "LogisticsVertical.jsx"), "utf8");
// O esqueleto inteiro: o componente principal e o que saiu dele. As travas de
// "isto não pode voltar" valem para todos os arquivos, não só para o principal.
const PASTAS_DO_ESQUELETO = ["shell"];
const arquivosDoEsqueleto = [
  "LogisticsVertical.jsx",
  ...PASTAS_DO_ESQUELETO.flatMap((subpasta) =>
    fs
      .readdirSync(path.join(pasta, subpasta))
      .filter((nome) => /\.jsx?$/.test(nome) && !/\.test\.jsx?$/.test(nome))
      .map((nome) => `${subpasta}/${nome}`),
  ),
];
const fontesDoEsqueleto = arquivosDoEsqueleto
  .map((arquivo) => fs.readFileSync(path.join(pasta, arquivo), "utf8"))
  .join("\n");

const modulos = Object.keys(MODULE_IMPLEMENTATION);
const rotulos = Object.values(MODULE_IMPLEMENTATION).flatMap((modulo) =>
  typeof modulo.navLabel === "string" ? [modulo.navLabel] : [],
);
const moduloDe = (pagina) => (Object.hasOwn(MODULE_IMPLEMENTATION, pagina) ? MODULE_IMPLEMENTATION[pagina] : undefined);
const areasChamadas = (rotulo) => PRIMARY_NAVIGATION.filter((area) => area.label === rotulo);
// O que a área declara depois do rótulo (rota, telas, atalhos), como texto:
// as travas de "a linha da área não menciona X" antes liam a linha do arquivo.
const restoDaArea = (area) =>
  JSON.stringify([area.route, area.pages, area.extras || [], area.jornadasInternas || []]);
const paginasDoMenu = PRIMARY_NAVIGATION.flatMap((area) => area.pages);

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
    expect(fonte).toContain("{modulo.navLabel || modulo.title}");
    expect(fontesDoEsqueleto).not.toContain('item.title.split(" ")[0]');
  });
});

describe("propriedade das abas principais", () => {
  it("nenhuma tela aparece em duas abas principais", () => {
    expect(paginasDoMenu.length).toBeGreaterThan(0);
    expect(new Set(paginasDoMenu).size).toBe(paginasDoMenu.length);
  });

  it("nenhum item do menu abre a mesma tela que outro", () => {
    // "Sinais de mercado" abria a tela de "Mercado"; "Motoristas", a de
    // "Frota"; "Catálogo", a de "Produtos"; e "Escalas", dentro do DP, abria
    // a tela de RH. Quatro nomes diferentes para quatro telas que já estavam
    // no menu — repetição pura.
    const rotas = paginasDoMenu.map((pagina) => moduloDe(pagina)?.route).filter(Boolean);
    expect(rotas.length).toBeGreaterThan(20);
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it("Planejamento é uma área só, e não um item dentro de Operação", () => {
    // Havia uma aba "Planejamento" que na verdade era indicadores, e um item
    // "Planejamento" dentro de Operação. Mesmo nome, dois lugares.
    expect(areasChamadas("Planejamento").map((area) => area.route)).toEqual(["/todogreen/planejamento"]);
    expect(PRIMARY_NAVIGATION.filter((area) => area.pages.includes("planejamento")).map((area) => area.label)).toEqual([
      "Planejamento",
    ]);
    for (const area of areasChamadas("Operação")) expect(restoDaArea(area)).not.toMatch(/"planejamento"/);
    expect(areasChamadas("Indicadores").length).toBeGreaterThan(0);
    for (const area of areasChamadas("Indicadores")) expect(area.pages).toContain("indicadores");
  });

  it("nenhum item repete, letra por letra, o nome da própria área", () => {
    const repetidos = [];
    for (const area of PRIMARY_NAVIGATION) {
      // Área com uma tela só não abre segundo nível: não há o que repetir.
      if (area.pages.length < 2) continue;
      for (const pagina of area.pages)
        if (moduloDe(pagina)?.navLabel === area.label) repetidos.push(`${area.label} › ${pagina}`);
    }
    expect(repetidos).toEqual([]);
  });

  it("cadastro não joga a pessoa em Administração", () => {
    // A aba agregada com as sete abas de todas as áreas saiu do menu: cada
    // cadastro abre recortado pela área dona do dado.
    for (const area of areasChamadas("Administração")) expect(restoDaArea(area)).not.toMatch(/"cadastros"/);
    expect(Object.keys(AREA_DO_CADASTRO).length).toBeGreaterThan(0);
    // O mapa decide de verdade onde o menu fica quando a tela é de cadastro.
    for (const [secao, area] of Object.entries(AREA_DO_CADASTRO)) expect(navigationFor("cadastros", secao).id).toBe(area);
    expect(fonte).toMatch(/navigationFor\(page, secaoDeCadastro\)/);
  });

  it("funções que tinham dono errado ficam em abas próprias", () => {
    // Taxonomia da titular (30/08): cadastro mora na área dona do dado —
    // fornecedores, itens e depósitos são de Compras; e Suprimentos assina
    // como "Compras". Implantação vive dentro do Workspace (é um tipo de
    // projeto), e o Workspace abre a lista.
    expect(areasChamadas("Compras").some((area) => /cadastros/.test(restoDaArea(area)))).toBe(true);
    // "Espaço de trabalho", nunca "Workspace": o polidor apaga a palavra
    // banida e o botão ficava com fundo e sem nome (31/08).
    expect(areasChamadas("Espaço de trabalho").some((area) => area.pages.includes("implantacao"))).toBe(true);
    // "Espaço de trabalho" continua no topo do menu, logo depois de Principal
    // e de "Green Tech Core" (11 páginas do roadmap All Green). Antes isto era
    // uma janela de 1.400 caracteres no texto do arquivo, que com as áreas de
    // hoje só admitia as três primeiras posições.
    const posicaoDoEspaco = PRIMARY_NAVIGATION.findIndex((area) => area.label === "Espaço de trabalho");
    expect(posicaoDoEspaco).toBeGreaterThanOrEqual(0);
    expect(posicaoDoEspaco).toBeLessThanOrEqual(2);
    expect(areasChamadas("Documentos").length).toBeGreaterThan(0);
    expect(areasChamadas("Administração").length).toBeGreaterThan(0);
    expect(areasChamadas("Operação").some((area) => area.route === "/todogreen/operacoes")).toBe(true);
    // Ocorrência de entrega (atraso, insucesso, reentrega) pertence à Operação,
    // não a um item solto no topo do menu.
    expect(areasChamadas("Ocorrências")).toEqual([]);
    expect(areasChamadas("Operação").some((area) => area.pages.includes("ocorrencias"))).toBe(true);
    for (const area of areasChamadas("Documentos")) expect(restoDaArea(area)).not.toMatch(/relatorios/);
    expect(
      areasChamadas("ESG").some(
        (area) =>
          area.route === "/todogreen/central-esg" &&
          JSON.stringify(area.pages) === JSON.stringify(["central-esg", "esg", "energia", "metodologia"]),
      ),
    ).toBe(true);
    // As 11 telas do roadmap All Green agora moram numa área dedicada
    // "Green Tech Core" no topo do menu — junta o que era espalhado.
    expect(areasChamadas("Green Tech Core").length).toBeGreaterThan(0);
    expect(areasChamadas("Green Tech Core").some((area) => area.pages.includes("core-grupo"))).toBe(true);
  });
});

describe("permissão não sai do texto da tela", () => {
  it("a aba de Acessos exige a permissão de gerenciar acessos", () => {
    // Antes, um script lia o texto do painel e decidia:
    //   /admin|owner|access:manage|gerenciar/i.test(panel.textContent)
    // Bastava um e-mail como "admin@cliente.com" aparecer na lista para a tela
    // liberar a gestão. A permissão agora vem do papel do vínculo.
    expect(MODULE_IMPLEMENTATION.acessos.permission).toBe("access:manage");
    expect(MANAGEMENT_TOOLS.find((item) => item.id === "acessos")?.permission).toBe("access:manage");
  });

  it("a barra filtra por permissão antes de desenhar a aba", () => {
    expect(fonte).toMatch(/podeAcessarFuncionalidade\(role, remoteAccess\.permissions, item\.permission\)/);
  });

  it("nenhum módulo de tela decide acesso lendo textContent", () => {
    // Pasta renomeada ou esvaziada não pode tirar arquivo da varredura calada.
    for (const subpasta of PASTAS_DO_ESQUELETO)
      expect(arquivosDoEsqueleto.some((arquivo) => arquivo.startsWith(`${subpasta}/`))).toBe(true);
    expect(fontesDoEsqueleto).not.toMatch(/textContent[^\n]*\b(admin|owner|gerenciar)\b/);
  });
});
