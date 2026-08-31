import { describe, expect, it } from "vitest";
import {
  arquivosVisiveis,
  arvoreDePastas,
  caminhoDaPasta,
  contarPorPasta,
  criaCiclo,
  nomeDisponivel,
  normalizarPasta,
  pastasVisiveis,
  podeVerPasta,
  problemaDaPasta,
  visibilidadeValida,
} from "./pastasDomain.js";

const BRUNA = { email: "bruna@todogreen.com.br", papel: "vendedor", permissoes: ["crm:manage"] };
const JOAO = { email: "joao@todogreen.com.br", papel: "vendedor", permissoes: ["crm:manage"] };
const FINANCEIRO = { email: "fin@todogreen.com.br", papel: "financeiro", permissoes: ["read", "finance:manage"] };
const DONA = { email: "dona@todogreen.com.br", papel: "owner", permissoes: ["*"] };

const pastas = [
  { id: "p1", nome: "Privada da Bruna", visibilidade: "private", donoEmail: BRUNA.email },
  { id: "p2", paiId: "p1", nome: "Dentro da privada", visibilidade: "shared" },
  { id: "p3", nome: "Financeiro", visibilidade: "area", permissaoDaArea: "finance:manage" },
  { id: "p4", nome: "Do espaço", visibilidade: "shared" },
  { id: "p5", nome: "Privada compartilhada", visibilidade: "private", donoEmail: BRUNA.email, membros: [JOAO.email] },
];

describe("quem vê cada pasta", () => {
  it("privada é da dona dela e de quem ela listar", () => {
    expect(podeVerPasta(pastas, "p1", BRUNA)).toBe(true);
    expect(podeVerPasta(pastas, "p1", JOAO)).toBe(false);
    expect(podeVerPasta(pastas, "p5", JOAO)).toBe(true);
  });

  it("pasta da área é de quem tem a permissão, e só", () => {
    expect(podeVerPasta(pastas, "p3", FINANCEIRO)).toBe(true);
    expect(podeVerPasta(pastas, "p3", BRUNA)).toBe(false);
  });

  it("pasta do espaço é de todos", () => {
    expect(podeVerPasta(pastas, "p4", JOAO)).toBe(true);
    expect(podeVerPasta(pastas, "p4", FINANCEIRO)).toBe(true);
  });

  it("A REGRA QUE MAIS IMPORTA: subpasta do espaço dentro de privada continua invisível", () => {
    // Sem isto bastaria criar uma subpasta "shared" para vazar o que o pai
    // protege — e ninguém que arrasta um documento pensa nisso.
    expect(podeVerPasta(pastas, "p2", JOAO)).toBe(false);
    expect(podeVerPasta(pastas, "p2", FINANCEIRO)).toBe(false);
    expect(podeVerPasta(pastas, "p2", BRUNA)).toBe(true);
  });

  it("pasta órfã (pai arquivado) não é promovida a pública", () => {
    const orfa = [{ id: "x", paiId: "sumiu", nome: "Órfã", visibilidade: "shared" }];
    expect(podeVerPasta(orfa, "x", JOAO)).toBe(false);
  });

  it("pasta de área SEM permissão escolhida é fechada, não aberta", () => {
    // Abrir por engano é o erro caro.
    const semArea = [{ id: "y", nome: "Área nenhuma", visibilidade: "area", donoEmail: BRUNA.email }];
    expect(podeVerPasta(semArea, "y", JOAO)).toBe(false);
    expect(podeVerPasta(semArea, "y", BRUNA)).toBe(true);
  });

  it("dona e administração veem tudo, inclusive privada de terceiro", () => {
    for (const id of ["p1", "p2", "p3", "p5"]) expect(podeVerPasta(pastas, id, DONA)).toBe(true);
  });

  it("ciclo no cadastro não vira laço infinito na leitura", () => {
    const anel = [
      { id: "a", paiId: "b", nome: "A", visibilidade: "shared" },
      { id: "b", paiId: "a", nome: "B", visibilidade: "shared" },
    ];
    expect(podeVerPasta(anel, "a", JOAO)).toBe(false);
  });

  it("pastasVisiveis devolve só a fatia de cada pessoa", () => {
    expect(pastasVisiveis(pastas, JOAO).map((p) => p.id).sort()).toEqual(["p4", "p5"]);
    expect(pastasVisiveis(pastas, BRUNA).map((p) => p.id).sort()).toEqual(["p1", "p2", "p4", "p5"]);
    expect(pastasVisiveis(pastas, FINANCEIRO).map((p) => p.id).sort()).toEqual(["p3", "p4"]);
  });
});

describe("os arquivos seguem a pasta", () => {
  const arquivos = [
    { id: "a1", folderId: "" },
    { id: "a2", folderId: "p1" },
    { id: "a3", folderId: "p2" },
    { id: "a4", folderId: "p4" },
  ];

  it("arquivo em pasta invisível desaparece; arquivo sem pasta continua visível", () => {
    // O acervo que já existia não pode sumir numa migração — esconder tudo
    // seria o mesmo que apagar.
    expect(arquivosVisiveis(arquivos, pastas, JOAO).map((a) => a.id)).toEqual(["a1", "a4"]);
    expect(arquivosVisiveis(arquivos, pastas, BRUNA).map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("conta por pasta para a tela mostrar quanto tem em cada uma", () => {
    const contagem = contarPorPasta(arquivos);
    expect(contagem.get("p1")).toBe(1);
    expect(contagem.get("")).toBe(1);
    expect(contagem.get("p3")).toBeUndefined();
  });
});

describe("árvore e caminho", () => {
  it("monta a hierarquia com profundidade e ordena por nome", () => {
    const arvore = arvoreDePastas(pastas);
    const raiz = arvore.map((p) => p.nome);
    expect(raiz).toEqual([...raiz].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const privada = arvore.find((p) => p.id === "p1");
    expect(privada.filhas.map((f) => f.id)).toEqual(["p2"]);
    expect(privada.filhas[0].profundidade).toBe(1);
  });

  it("órfã aparece na raiz marcada, em vez de desaparecer calada", () => {
    const arvore = arvoreDePastas([{ id: "x", paiId: "sumiu", nome: "Órfã", visibilidade: "shared" }]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].orfa).toBe(true);
  });

  it("caminho devolve a trilha de cima para baixo, sem laço", () => {
    expect(caminhoDaPasta(pastas, "p2").map((p) => p.nome)).toEqual(["Privada da Bruna", "Dentro da privada"]);
    const anel = [
      { id: "a", paiId: "b", nome: "A", visibilidade: "shared" },
      { id: "b", paiId: "a", nome: "B", visibilidade: "shared" },
    ];
    expect(caminhoDaPasta(anel, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("as travas do cadastro", () => {
  it("pasta não entra dentro de si mesma nem da própria descendência", () => {
    expect(criaCiclo(pastas, "p1", "p1")).toBe(true);
    expect(criaCiclo(pastas, "p1", "p2")).toBe(true);
    expect(criaCiclo(pastas, "p4", "p1")).toBe(false);
  });

  it("duas irmãs com o mesmo nome são barradas, mas em pais diferentes tudo bem", () => {
    expect(nomeDisponivel(pastas, { paiId: "", nome: "Financeiro" })).toBe(false);
    expect(nomeDisponivel(pastas, { paiId: "", nome: "financeiro" })).toBe(false);
    expect(nomeDisponivel(pastas, { paiId: "p1", nome: "Financeiro" })).toBe(true);
    // Editar a própria pasta sem trocar o nome continua permitido.
    expect(nomeDisponivel(pastas, { id: "p3", paiId: "", nome: "Financeiro" })).toBe(true);
  });

  it("problemaDaPasta explica em português o que impede gravar", () => {
    expect(problemaDaPasta(pastas, { nome: "" })).toMatch(/nome/);
    expect(problemaDaPasta(pastas, { id: "p1", paiId: "p2", nome: "Nova" })).toMatch(/dentro de si mesma/);
    expect(problemaDaPasta(pastas, { paiId: "", nome: "Financeiro" })).toMatch(/mesmo lugar/);
    expect(problemaDaPasta(pastas, { nome: "Sem área", visibilidade: "area" })).toMatch(/de qual área/);
    expect(problemaDaPasta(pastas, { nome: "Boa", visibilidade: "shared" })).toBe("");
    // Criar a PRIMEIRA pasta privada não pode ser barrado por falta de dono: o
    // dono é carimbado pelo servidor a partir da sessão.
    expect(problemaDaPasta(pastas, { nome: "Minha", visibilidade: "private" })).toBe("");
  });

  it("visibilidade inválida cai no mais restritivo", () => {
    expect(visibilidadeValida("qualquer")).toBe("private");
    expect(visibilidadeValida("")).toBe("private");
    expect(normalizarPasta({}).visibilidade).toBe("private");
  });
});
