import { describe, expect, it } from "vitest";
import {
  SHAPE_CATEGORIES,
  SHAPE_LIBRARY,
  alignNodes,
  anchorPoints,
  distributeNodes,
  findBrokenEdges,
  findCycles,
  findDisconnectedGroups,
  findOrphans,
  fromCsv,
  makeDiagram,
  makeEdge,
  makeNode,
  nearestAnchors,
  orgChartFromRows,
  orthogonalRoute,
  parseMermaid,
  routeToPath,
  shapeSpec,
  shapesByCategory,
  snapToGrid,
  statusColor,
  toCsv,
  toMermaid,
  toSvg,
  validateBpmn,
  validateDiagram,
} from "./features/diagrams/diagramDomain.js";

const no = (id, shape, x, y, text = "") => makeNode(shape, { id, x, y, text });
const liga = (from, to, label = "") =>
  makeEdge({ id: `e-${from}-${to}`, from, to, label });

describe("biblioteca de formas", () => {
  it("toda forma tem id único, categoria conhecida e tamanho", () => {
    const ids = SHAPE_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categorias = new Set(SHAPE_CATEGORIES.map((c) => c.id));
    for (const s of SHAPE_LIBRARY) {
      expect(categorias.has(s.category)).toBe(true);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      expect(s.label).toBeTruthy();
    }
  });

  it("cada categoria tem ao menos uma forma", () => {
    for (const c of SHAPE_CATEGORIES)
      expect(shapesByCategory(c.id).length).toBeGreaterThan(0);
  });

  it("forma desconhecida cai na primeira", () => {
    expect(shapeSpec("inexistente").id).toBe(SHAPE_LIBRARY[0].id);
  });
});

describe("snapToGrid e makeNode", () => {
  it("encaixa na grade de 10", () => {
    expect(snapToGrid(13)).toBe(10);
    expect(snapToGrid(16)).toBe(20);
    expect(snapToGrid(-13)).toBe(-10);
  });

  it("trata entrada inválida e grade inválida", () => {
    expect(snapToGrid("abc")).toBe(0);
    // Grade zero não faz sentido: cai na grade padrão em vez de dividir por zero.
    expect(snapToGrid(17, 0)).toBe(20);
  });

  it("a forma nasce encaixada na grade com o tamanho do tipo", () => {
    const n = makeNode("decisao", { id: "d1", x: 13, y: 27 });
    expect(n).toMatchObject({ x: 10, y: 30, shape: "decisao" });
    expect(n.w).toBe(shapeSpec("decisao").w);
  });
});

describe("anchorPoints e nearestAnchors", () => {
  it("dá os quatro lados da forma", () => {
    const a = anchorPoints({ x: 0, y: 0, w: 100, h: 50 });
    expect(a.top).toEqual({ x: 50, y: 0 });
    expect(a.right).toEqual({ x: 100, y: 25 });
    expect(a.bottom).toEqual({ x: 50, y: 50 });
    expect(a.left).toEqual({ x: 0, y: 25 });
  });

  it("escolhe o par de lados mais próximo entre duas formas", () => {
    const esquerda = { x: 0, y: 0, w: 100, h: 50 };
    const direita = { x: 300, y: 0, w: 100, h: 50 };
    const par = nearestAnchors(esquerda, direita);
    expect(par.fromSide).toBe("right");
    expect(par.toSide).toBe("left");
  });

  it("escolhe topo e base quando uma está acima da outra", () => {
    const cima = { x: 0, y: 0, w: 100, h: 50 };
    const baixo = { x: 0, y: 300, w: 100, h: 50 };
    const par = nearestAnchors(cima, baixo);
    expect(par.fromSide).toBe("bottom");
    expect(par.toSide).toBe("top");
  });
});

describe("orthogonalRoute", () => {
  it("faz linha reta quando os lados se alinham", () => {
    const rota = orthogonalRoute(
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 300, y: 0, w: 100, h: 50 },
    );
    expect(rota).toHaveLength(2);
    expect(rota[0].y).toBe(rota[1].y);
  });

  it("faz cotovelo quando estão deslocadas, sem diagonal", () => {
    const rota = orthogonalRoute(
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 300, y: 200, w: 100, h: 50 },
    );
    expect(rota.length).toBeGreaterThan(2);
    // Cada trecho é horizontal ou vertical, nunca diagonal.
    for (let i = 1; i < rota.length; i += 1) {
      const mesmoX = rota[i].x === rota[i - 1].x;
      const mesmoY = rota[i].y === rota[i - 1].y;
      expect(mesmoX || mesmoY).toBe(true);
    }
  });

  it("o caminho SVG começa com M e só tem M e L", () => {
    const path = routeToPath(
      orthogonalRoute(
        { x: 0, y: 0, w: 100, h: 50 },
        { x: 300, y: 200, w: 100, h: 50 },
      ),
    );
    expect(path.startsWith("M ")).toBe(true);
    expect(path).not.toMatch(/[CQZA]/);
  });
});

describe("alignNodes e distributeNodes", () => {
  const nos = [
    no("a", "processo", 0, 0),
    no("b", "processo", 100, 50),
    no("c", "processo", 200, 200),
  ];

  it("alinha à esquerda", () => {
    const r = alignNodes(nos, ["a", "b"], "esquerda");
    expect(r.find((n) => n.id === "b").x).toBe(0);
    expect(r.find((n) => n.id === "c").x).toBe(200);
  });

  it("alinha ao topo", () => {
    const r = alignNodes(nos, ["a", "b", "c"], "topo");
    expect(r.every((n) => n.y === 0)).toBe(true);
  });

  it("alinha à direita respeitando a largura", () => {
    const r = alignNodes(nos, ["a", "c"], "direita");
    const a = r.find((n) => n.id === "a");
    const c = r.find((n) => n.id === "c");
    expect(a.x + a.w).toBe(c.x + c.w);
  });

  it("não faz nada com menos de duas formas", () => {
    expect(alignNodes(nos, ["a"], "esquerda")).toBe(nos);
  });

  it("distribui com espaçamento igual", () => {
    const nos4 = [
      no("a", "processo", 0, 0),
      no("b", "processo", 30, 0),
      no("c", "processo", 40, 0),
      no("d", "processo", 300, 0),
    ];
    const r = distributeNodes(nos4, ["a", "b", "c", "d"], "h");
    const xs = ["a", "b", "c", "d"].map((id) => r.find((n) => n.id === id).x);
    const passos = [xs[1] - xs[0], xs[2] - xs[1], xs[3] - xs[2]];
    // Com encaixe na grade, os passos ficam iguais dentro da tolerância da grade.
    expect(Math.max(...passos) - Math.min(...passos)).toBeLessThanOrEqual(10);
  });

  it("distribuir exige pelo menos três formas", () => {
    expect(distributeNodes(nos, ["a", "b"], "h")).toBe(nos);
  });
});

describe("findOrphans e findBrokenEdges", () => {
  it("acha formas sem nenhum conector", () => {
    const nos = [no("a", "processo", 0, 0), no("b", "processo", 200, 0), no("s", "processo", 400, 0)];
    const orfaos = findOrphans(nos, [liga("a", "b")]);
    expect(orfaos.map((n) => n.id)).toEqual(["s"]);
  });

  it("acha conector apontando para forma inexistente", () => {
    const nos = [no("a", "processo", 0, 0)];
    const quebrados = findBrokenEdges(nos, [liga("a", "fantasma")]);
    expect(quebrados).toHaveLength(1);
  });

  it("conector de uma forma para ela mesma é inválido", () => {
    const nos = [no("a", "processo", 0, 0)];
    expect(findBrokenEdges(nos, [liga("a", "a")])).toHaveLength(1);
  });
});

describe("findCycles", () => {
  it("acha um ciclo simples", () => {
    const nos = [no("a", "processo", 0, 0), no("b", "processo", 0, 0), no("c", "processo", 0, 0)];
    const ciclos = findCycles(nos, [liga("a", "b"), liga("b", "c"), liga("c", "a")]);
    expect(ciclos).toHaveLength(1);
    expect(ciclos[0][0]).toBe(ciclos[0][ciclos[0].length - 1]);
  });

  it("não acusa ciclo num fluxo linear", () => {
    const nos = [no("a", "processo", 0, 0), no("b", "processo", 0, 0)];
    expect(findCycles(nos, [liga("a", "b")])).toEqual([]);
  });

  it("não relata o mesmo ciclo várias vezes", () => {
    const nos = [no("a", "processo", 0, 0), no("b", "processo", 0, 0)];
    expect(findCycles(nos, [liga("a", "b"), liga("b", "a")])).toHaveLength(1);
  });

  it("ignora laço de uma forma para ela mesma", () => {
    const nos = [no("a", "processo", 0, 0)];
    expect(findCycles(nos, [liga("a", "a")])).toEqual([]);
  });
});

describe("findDisconnectedGroups", () => {
  it("separa as ilhas do diagrama", () => {
    const nos = ["a", "b", "c", "d"].map((id) => no(id, "processo", 0, 0));
    const grupos = findDisconnectedGroups(nos, [liga("a", "b"), liga("c", "d")]);
    expect(grupos).toHaveLength(2);
  });

  it("um diagrama todo ligado é um grupo só", () => {
    const nos = ["a", "b", "c"].map((id) => no(id, "processo", 0, 0));
    expect(findDisconnectedGroups(nos, [liga("a", "b"), liga("b", "c")])).toHaveLength(1);
  });

  it("segue a ligação nos dois sentidos", () => {
    const nos = ["a", "b"].map((id) => no(id, "processo", 0, 0));
    expect(findDisconnectedGroups(nos, [liga("b", "a")])).toHaveLength(1);
  });
});

describe("validateBpmn", () => {
  const processoValido = () => ({
    nodes: [
      no("i", "bpmn-inicio", 0, 0, "Começo"),
      no("t", "bpmn-tarefa", 200, 0, "Fazer"),
      no("f", "bpmn-fim", 400, 0, "Fim"),
    ],
    edges: [liga("i", "t"), liga("t", "f")],
  });

  it("processo bem montado não gera problema", () => {
    const { nodes, edges } = processoValido();
    expect(validateBpmn(nodes, edges)).toEqual([]);
  });

  it("não valida BPMN em diagrama que não é BPMN", () => {
    expect(validateBpmn([no("a", "processo", 0, 0)], [])).toEqual([]);
  });

  it("acusa falta de evento inicial e final", () => {
    const regras = validateBpmn([no("t", "bpmn-tarefa", 0, 0)], []).map((p) => p.rule);
    expect(regras).toContain("sem-inicio");
    expect(regras).toContain("sem-fim");
  });

  it("evento inicial não pode receber conector", () => {
    const { nodes, edges } = processoValido();
    const regras = validateBpmn(nodes, [...edges, liga("t", "i")]).map((p) => p.rule);
    expect(regras).toContain("inicio-com-entrada");
  });

  it("evento final não pode ter saída", () => {
    const { nodes, edges } = processoValido();
    const regras = validateBpmn(nodes, [...edges, liga("f", "t")]).map((p) => p.rule);
    expect(regras).toContain("fim-com-saida");
  });

  it("gateway precisa de pelo menos dois caminhos de saída", () => {
    const nodes = [
      no("i", "bpmn-inicio", 0, 0),
      no("g", "bpmn-gateway", 200, 0, "Decide"),
      no("f", "bpmn-fim", 400, 0),
    ];
    const regras = validateBpmn(nodes, [liga("i", "g"), liga("g", "f")]).map(
      (p) => p.rule,
    );
    expect(regras).toContain("gateway-sem-ramo");
  });

  it("gateway com dois ramos passa", () => {
    const nodes = [
      no("i", "bpmn-inicio", 0, 0),
      no("g", "bpmn-gateway", 200, 0),
      no("t1", "bpmn-tarefa", 400, 0),
      no("t2", "bpmn-tarefa", 400, 200),
      no("f", "bpmn-fim", 600, 0),
    ];
    const edges = [
      liga("i", "g"),
      liga("g", "t1"),
      liga("g", "t2"),
      liga("t1", "f"),
      liga("t2", "f"),
    ];
    expect(validateBpmn(nodes, edges)).toEqual([]);
  });

  it("tarefa inalcançável é acusada", () => {
    const nodes = [
      no("i", "bpmn-inicio", 0, 0),
      no("t", "bpmn-tarefa", 200, 0),
      no("solta", "bpmn-tarefa", 200, 300, "Solta"),
      no("f", "bpmn-fim", 400, 0),
    ];
    const regras = validateBpmn(nodes, [liga("i", "t"), liga("t", "f")]).map(
      (p) => p.rule,
    );
    expect(regras).toContain("tarefa-sem-entrada");
  });
});

describe("validateDiagram", () => {
  it("diagrama limpo passa sem erro nem aviso", () => {
    const nodes = [no("a", "processo", 0, 0), no("b", "processo", 300, 0)];
    const r = validateDiagram(nodes, [liga("a", "b")]);
    expect(r.ok).toBe(true);
    expect(r.items).toEqual([]);
  });

  it("separa erros de avisos", () => {
    const nodes = [
      no("a", "processo", 0, 0),
      no("b", "processo", 300, 0),
      no("orfa", "processo", 600, 0, "Sozinha"),
    ];
    const r = validateDiagram(nodes, [liga("a", "b"), liga("a", "fantasma")]);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.warnings).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("avisa quando o diagrama tem partes que não se conectam", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => no(id, "processo", 0, 0));
    const r = validateDiagram(nodes, [liga("a", "b"), liga("c", "d")]);
    expect(r.items.some((i) => i.rule === "ilhas")).toBe(true);
  });
});

describe("orgChartFromRows", () => {
  const linhas = [
    { id: "1", nome: "Renata", "responde a": "" },
    { id: "2", nome: "Ana", "responde a": "1" },
    { id: "3", nome: "Carlos", "responde a": "1" },
    { id: "4", nome: "Duda", "responde a": "2" },
  ];

  it("cria uma forma por pessoa e um conector por vínculo", () => {
    const { nodes, edges } = orgChartFromRows(linhas);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(3);
    expect(nodes.map((n) => n.text)).toContain("Renata");
  });

  it("posiciona por nível de hierarquia", () => {
    const { nodes } = orgChartFromRows(linhas);
    const y = (nome) => nodes.find((n) => n.text === nome).y;
    expect(y("Renata")).toBeLessThan(y("Ana"));
    expect(y("Ana")).toBeLessThan(y("Duda"));
    expect(y("Ana")).toBe(y("Carlos"));
  });

  it("ignora vínculo com chefe inexistente", () => {
    const { edges } = orgChartFromRows([
      { id: "1", nome: "Renata", "responde a": "999" },
    ]);
    expect(edges).toEqual([]);
  });

  it("não entra em laço quando alguém responde a si mesmo", () => {
    const { nodes, edges } = orgChartFromRows([
      { id: "1", nome: "Renata", "responde a": "1" },
    ]);
    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });

  it("aceita nomes de campo diferentes", () => {
    const { nodes } = orgChartFromRows(
      [{ codigo: "a", pessoa: "Zé", chefe: "" }],
      { idField: "codigo", nameField: "pessoa", parentField: "chefe" },
    );
    expect(nodes[0].text).toBe("Zé");
  });

  it("lida com lista vazia", () => {
    expect(orgChartFromRows([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("statusColor", () => {
  it("verde para situação boa", () => {
    expect(statusColor("Concluído")).toBe("#16a34a");
    expect(statusColor("no prazo")).toBe("#16a34a");
  });

  it("laranja para atenção e vermelho para risco", () => {
    expect(statusColor("Em andamento")).toBe("#17a673");
    expect(statusColor("Atrasado")).toBe("#dc2626");
  });

  it("ignora acento e maiúscula", () => {
    expect(statusColor("CRITICO")).toBe("#dc2626");
    expect(statusColor("crítico")).toBe("#dc2626");
  });

  it("sem valor ou valor desconhecido não pinta", () => {
    expect(statusColor("")).toBe("");
    expect(statusColor("qualquer coisa")).toBe("");
  });
});

describe("Mermaid nos dois sentidos", () => {
  const nodes = [
    no("inicio", "inicio-fim", 0, 0, "Começo"),
    no("decide", "decisao", 0, 200, "Aprovado?"),
    no("fim", "inicio-fim", 0, 400, "Fim"),
  ];
  const edges = [liga("inicio", "decide"), liga("decide", "fim", "sim")];

  it("gera flowchart com as formas certas", () => {
    const m = toMermaid(nodes, edges);
    expect(m.startsWith("flowchart TD")).toBe(true);
    expect(m).toContain("decide{Aprovado?}");
    expect(m).toContain("inicio([Começo])");
    expect(m).toContain("|sim|");
  });

  it("volta de Mermaid para formas e conectores", () => {
    const { nodes: n2, edges: e2 } = parseMermaid(toMermaid(nodes, edges));
    expect(n2).toHaveLength(3);
    expect(e2).toHaveLength(2);
    expect(n2.find((n) => n.id === "decide").shape).toBe("decisao");
    expect(e2.find((e) => e.label === "sim")).toBeTruthy();
  });

  it("lê Mermaid escrito à mão", () => {
    const { nodes: n2, edges: e2 } = parseMermaid(
      "flowchart TD\n  A[Pedido] --> B{Tem estoque?}\n  B -->|não| C[Comprar]",
    );
    expect(n2.map((n) => n.text).sort()).toEqual(["Comprar", "Pedido", "Tem estoque?"]);
    expect(e2).toHaveLength(2);
    expect(e2[1].label).toBe("não");
  });

  it("texto vazio não gera nada", () => {
    expect(parseMermaid("")).toEqual({ nodes: [], edges: [] });
  });

  it("escapa caracteres que quebrariam o Mermaid", () => {
    const m = toMermaid([no("x", "processo", 0, 0, 'Com "aspas" e [colchete]')], []);
    expect(m).not.toContain('"');
    expect(m).toContain("Com aspas e colchete");
  });
});

describe("CSV nos dois sentidos", () => {
  const nodes = [no("a", "processo", 10, 20, "Receber pedido")];
  const edges = [liga("a", "a2", "ok")];

  it("gera cabeçalho e uma linha por item", () => {
    const csv = toCsv(nodes, edges);
    const linhas = csv.split("\n");
    expect(linhas[0]).toContain("tipo;id;forma");
    expect(linhas).toHaveLength(3);
  });

  it("volta de CSV para formas e conectores", () => {
    const { nodes: n2, edges: e2 } = fromCsv(toCsv(nodes, edges));
    expect(n2).toHaveLength(1);
    expect(n2[0]).toMatchObject({ id: "a", text: "Receber pedido", x: 10, y: 20 });
    expect(e2[0]).toMatchObject({ from: "a", to: "a2", label: "ok" });
  });

  it("protege valor que contém ponto e vírgula", () => {
    const csv = toCsv([no("a", "processo", 0, 0, "um; dois")], []);
    expect(csv).toContain('"um; dois"');
    expect(fromCsv(csv).nodes[0].text).toBe("um; dois");
  });
});

describe("toSvg", () => {
  const nodes = [no("a", "processo", 0, 0, "Um"), no("b", "decisao", 300, 200, "Dois")];

  it("gera SVG com as formas, o conector e o texto", () => {
    const svg = toSvg(nodes, [liga("a", "b")]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<rect");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<path");
    expect(svg).toContain("Um");
  });

  it("funciona com diagrama vazio", () => {
    const svg = toSvg([], []);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("não deixa caractere que quebraria o XML no texto", () => {
    const svg = toSvg([no("a", "processo", 0, 0, "a < b & c > d")], []);
    expect(svg).not.toContain("a < b");
  });

  it("ignora conector com ponta inexistente", () => {
    const svg = toSvg(nodes, [liga("a", "fantasma")]);
    expect(svg).not.toContain("<path");
  });
});

describe("makeDiagram", () => {
  it("nasce vazio e nomeado", () => {
    const d = makeDiagram("d1", { businessId: "b" });
    expect(d.nodes).toEqual([]);
    expect(d.edges).toEqual([]);
    expect(d.name).toBe("Diagrama sem nome");
  });
});
