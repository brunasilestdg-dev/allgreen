import { describe, expect, it } from "vitest";
import { TODO_GREEN_MODULE_CATALOG } from "./logisticsVerticalDomain.js";
import {
  agruparModulosPorTela,
  grupoAtendeBusca,
  ordenarPorRelevancia,
  relevanciaDoGrupo,
  resumirAssuntos,
  telaDoModulo,
} from "./moduleGroupingDomain.js";

const modulo = (id, name, workspaceRoute, extra = {}) => ({
  id,
  name,
  workspaceRoute,
  route: `/todogreen/${id}`,
  area: "operacional",
  order: 10,
  icon: "Truck",
  description: "",
  ...extra,
});

describe("qual tela o item abre", () => {
  it("é para onde o clique vai, não o endereço do módulo no catálogo", () => {
    // Agrupar pelo `route` manteria os 47 itens separados — que é o problema.
    expect(telaDoModulo(modulo("motoristas", "Motoristas", "/todogreen/operacoes"))).toBe(
      "/todogreen/operacoes",
    );
  });

  it("sem rota de destino, cai no endereço próprio", () => {
    expect(telaDoModulo({ id: "x", route: "/todogreen/x" })).toBe("/todogreen/x");
  });
});

describe("um cartão por tela", () => {
  const catalogo = [
    modulo("operacoes", "Operações", "/todogreen/operacoes", { order: 1 }),
    modulo("rotas", "Rotas", "/todogreen/operacoes", { order: 2 }),
    modulo("motoristas", "Motoristas", "/todogreen/operacoes", { order: 3 }),
    modulo("clientes", "Clientes", "/todogreen/clientes", { order: 4, area: "comercial" }),
  ];

  it("sete nomes que abrem a mesma tela viram um cartão", () => {
    const grupos = agruparModulosPorTela(catalogo);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.rota).sort()).toEqual([
      "/todogreen/clientes",
      "/todogreen/operacoes",
    ]);
  });

  it("os outros nomes viram assuntos, não somem", () => {
    const grupo = agruparModulosPorTela(catalogo).find(
      (g) => g.rota === "/todogreen/operacoes",
    );
    // "motorista" é a palavra que a pessoa digita na busca.
    expect(grupo.assuntos).toEqual(["Motoristas", "Rotas"]);
  });

  it("o nome do grupo não se repete na lista de assuntos", () => {
    const grupo = agruparModulosPorTela(catalogo).find(
      (g) => g.rota === "/todogreen/operacoes",
    );
    expect(grupo.assuntos).not.toContain("Operações");
  });

  it("o título da aba manda no nome do cartão", () => {
    const grupos = agruparModulosPorTela(catalogo, {
      "/todogreen/operacoes": "Operações logísticas",
    });
    const grupo = grupos.find((g) => g.rota === "/todogreen/operacoes");
    // Se a aba se chama assim, o cartão não pode se chamar outra coisa.
    expect(grupo.nome).toBe("Operações logísticas");
    expect(grupo.assuntos).toContain("Operações");
  });

  it("sem título e sem id casando com a rota, usa o de menor ordem", () => {
    const grupos = agruparModulosPorTela([
      modulo("margem", "Margem", "/todogreen/dashboard", { order: 30 }),
      modulo("metas", "Metas", "/todogreen/dashboard", { order: 5 }),
    ]);
    expect(grupos[0].nome).toBe("Metas");
  });

  it("guarda todos os ids que caem na tela", () => {
    const grupo = agruparModulosPorTela(catalogo).find(
      (g) => g.rota === "/todogreen/operacoes",
    );
    expect(grupo.ids.sort()).toEqual(["motoristas", "operacoes", "rotas"]);
  });

  it("catálogo vazio não quebra", () => {
    expect(agruparModulosPorTela([])).toEqual([]);
  });

  it("item sem rota nenhuma é ignorado em vez de virar cartão fantasma", () => {
    expect(agruparModulosPorTela([{ id: "solto", name: "Solto" }])).toEqual([]);
  });
});

describe("busca", () => {
  const grupo = {
    nome: "Operações",
    area: "operacional",
    descricao: "Rotas, viagens e entregas.",
    assuntos: ["Motoristas", "Veículos", "Ocorrências"],
  };

  it("encontra pelo assunto, não só pelo nome do cartão", () => {
    // Sem isto, juntar os cartões esconderia "motorista": trocaria um problema
    // por outro.
    expect(grupoAtendeBusca(grupo, "motorista")).toBe(true);
    expect(grupoAtendeBusca(grupo, "veículo")).toBe(true);
  });

  it("acento e caixa não atrapalham", () => {
    expect(grupoAtendeBusca(grupo, "OCORRENCIAS")).toBe(true);
    expect(grupoAtendeBusca(grupo, "veiculos")).toBe(true);
  });

  it("busca vazia mostra tudo", () => {
    expect(grupoAtendeBusca(grupo, "")).toBe(true);
    expect(grupoAtendeBusca(grupo, "   ")).toBe(true);
  });

  it("o que não existe não aparece", () => {
    expect(grupoAtendeBusca(grupo, "folha de pagamento")).toBe(false);
  });
});

describe("resumo dos assuntos", () => {
  it("lista curta sai inteira", () => {
    expect(resumirAssuntos(["Rotas", "Viagens"])).toBe("Rotas · Viagens");
  });

  it("lista longa não vira parede de texto", () => {
    const r = resumirAssuntos(["a", "b", "c", "d", "e", "f", "g"], 5);
    expect(r).toBe("a · b · c · d · e e mais 2");
  });

  it("sem assunto, nada a mostrar", () => {
    expect(resumirAssuntos([])).toBe("");
  });
});

describe("o catálogo de verdade", () => {
  const grupos = agruparModulosPorTela(TODO_GREEN_MODULE_CATALOG);

  it("nenhuma tela aparece com dois nomes diferentes", () => {
    const rotas = grupos.map((g) => g.rota);
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it("agrupa de verdade: sobram menos cartões que itens de catálogo", () => {
    expect(grupos.length).toBeLessThan(TODO_GREEN_MODULE_CATALOG.length);
  });

  it("nenhum item do catálogo se perde no caminho", () => {
    const idsAgrupados = grupos.flatMap((g) => g.ids).sort();
    const idsCatalogo = TODO_GREEN_MODULE_CATALOG.map((m) => m.id).sort();
    expect(idsAgrupados).toEqual(idsCatalogo);
  });

  it("todo grupo tem nome, rota e área", () => {
    for (const grupo of grupos) {
      expect(grupo.nome).toBeTruthy();
      expect(grupo.rota).toMatch(/^\/todogreen\//);
      expect(grupo.area).toBeTruthy();
    }
  });

  it("as palavras que a pessoa procura continuam achando a tela certa", () => {
    const melhor = (termo) =>
      ordenarPorRelevancia(
        grupos.filter((g) => grupoAtendeBusca(g, termo)),
        termo,
      )[0];
    expect(melhor("motorista").rota).toBe("/todogreen/cadastros");
    expect(melhor("forecast").rota).toBe("/todogreen/receita");
    expect(melhor("pipeline").rota).toBe("/todogreen/oportunidades");
    // "contrato" também aparece na descrição do ESG; o assunto de Propostas
    // pesa mais que uma menção em texto corrido.
    expect(melhor("contrato").rota).toBe("/todogreen/propostas");
  });
});

describe("relevância", () => {
  const operacoes = {
    nome: "Operações",
    area: "operacional",
    descricao: "Rotas e entregas.",
    assuntos: ["Motoristas"],
    order: 10,
  };
  const esg = {
    nome: "ESG",
    area: "esg",
    descricao: "Contrato de energia renovável.",
    assuntos: [],
    order: 1,
  };

  it("bater no nome vale mais que bater num assunto, que vale mais que na descrição", () => {
    expect(relevanciaDoGrupo(operacoes, "operações")).toBe(3);
    expect(relevanciaDoGrupo(operacoes, "motorista")).toBe(2);
    expect(relevanciaDoGrupo(esg, "contrato")).toBe(1);
  });

  it("sem relação nenhuma, zero", () => {
    expect(relevanciaDoGrupo(operacoes, "folha de pagamento")).toBe(0);
  });

  it("o assunto ganha da menção em texto corrido", () => {
    const propostas = { nome: "Propostas", descricao: "", assuntos: ["Contratos"], order: 20 };
    const ordenados = ordenarPorRelevancia([esg, propostas], "contrato");
    expect(ordenados[0].nome).toBe("Propostas");
  });

  it("sem busca, a ordem do catálogo é mantida", () => {
    const ordenados = ordenarPorRelevancia([operacoes, esg], "");
    expect(ordenados.map((g) => g.nome)).toEqual(["ESG", "Operações"]);
  });
});
