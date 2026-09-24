import { describe, expect, it } from "vitest";
import {
  accountAcceptsPosting,
  buildCodeTree,
  defaultPrefixFor,
  documentKind,
  formatDocument,
  formatDocumentNumber,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  normalizeDocument,
  normalizePartyRoles,
  normalizeSku,
  normalizeUnit,
  partyHasRole,
  validateAccount,
  validateItem,
  validateParty,
  validateWarehouse,
} from "./erpCoreDomain.js";

describe("SKU", () => {
  it("normaliza grafias que deveriam ser o mesmo item", () => {
    expect(normalizeSku(" pn-100 ")).toBe("PN-100");
    expect(normalizeSku("pn 100")).toBe("PN100");
    expect(normalizeSku("PN/100")).toBe("PN100");
    expect(normalizeSku("pn.100")).toBe("PN.100");
  });

  it("aceita vazio sem inventar código", () => {
    expect(normalizeSku("")).toBe("");
    expect(normalizeSku(null)).toBe("");
  });

  it("limita o tamanho para não estourar a coluna", () => {
    expect(normalizeSku("A".repeat(60))).toHaveLength(40);
  });
});

describe("unidade de medida", () => {
  it("aceita o código canônico em qualquer caixa", () => {
    expect(normalizeUnit("kg")).toBe("KG");
    expect(normalizeUnit("UN")).toBe("UN");
  });

  it("resolve os apelidos que aparecem em planilha de fornecedor", () => {
    expect(normalizeUnit("caixa")).toBe("CX");
    expect(normalizeUnit("unidade")).toBe("UN");
    expect(normalizeUnit("Litro")).toBe("L");
    expect(normalizeUnit("tonelada")).toBe("TON");
  });

  it("devolve vazio para unidade desconhecida em vez de palpitar UN", () => {
    // Palpitar somaria dúzia com quilo sem nenhum aviso.
    expect(normalizeUnit("dúzia")).toBe("");
    expect(normalizeUnit("xyz")).toBe("");
    expect(normalizeUnit("")).toBe("");
  });
});

describe("CNPJ e CPF", () => {
  it("guarda só dígitos", () => {
    expect(normalizeDocument("12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizeDocument("529.982.247-25")).toBe("52998224725");
  });

  it("reconhece o tipo pelo tamanho", () => {
    expect(documentKind("12.345.678/0001-95")).toBe("cnpj");
    expect(documentKind("529.982.247-25")).toBe("cpf");
    expect(documentKind("123")).toBe("");
  });

  it("valida CNPJ pelos dígitos verificadores", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    // Último dígito trocado.
    expect(isValidCnpj("11222333000182")).toBe(false);
  });

  it("recusa CNPJ de dígito repetido, que passa no módulo 11", () => {
    // É o valor de teste que mais aparece em planilha real; sem esta guarda
    // ele entraria como fornecedor válido.
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it("valida CPF pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
  });

  it("isValidDocument decide pelo tamanho e recusa o que não é nenhum dos dois", () => {
    expect(isValidDocument("11222333000181")).toBe(true);
    expect(isValidDocument("52998224725")).toBe(true);
    expect(isValidDocument("123456")).toBe(false);
    expect(isValidDocument("")).toBe(false);
  });

  it("formata para exibir sem mudar o que é guardado", () => {
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("123")).toBe("123");
  });

  // IN RFB nº 2.229/2024: novas inscrições desde julho/2026 podem ter letras
  // nas 12 primeiras posições. Exemplo oficial da Receita: 12.ABC.345/01DE-35.
  it("aceita o CNPJ alfanumérico com o dígito verificador oficial (ASCII − 48)", () => {
    expect(normalizeDocument("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(normalizeDocument("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(documentKind("12.ABC.345/01DE-35")).toBe("cnpj");
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidDocument("12ABC34501DE35")).toBe(true);
    // Dígito verificador trocado continua sendo recusado.
    expect(isValidCnpj("12ABC34501DE36")).toBe(false);
    // Letra nos dígitos verificadores não é CNPJ.
    expect(isValidCnpj("12ABC34501DE3X")).toBe(false);
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    // Demais exemplos válidos do código oficial da Receita.
    expect(isValidCnpj("ABCDEFGHIJKL80")).toBe(true);
    expect(isValidCnpj("00000000000191")).toBe(true);
  });

  it("não deixa letra solta contaminar CPF, CNPJ numérico ou texto com prefixo", () => {
    expect(normalizeDocument("CPF 529.982.247-25")).toBe("52998224725");
    expect(normalizeDocument("CNPJ: 11.222.333/0001-81")).toBe("11222333000181");
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });
});

describe("papéis da parte", () => {
  it("aceita a mesma empresa como cliente e fornecedor", () => {
    expect(normalizePartyRoles(["cliente", "fornecedor"])).toEqual(["cliente", "fornecedor"]);
  });

  it("descarta papel desconhecido em vez de guardá-lo", () => {
    expect(normalizePartyRoles(["cliente", "inventado"])).toEqual(["cliente"]);
  });

  it("não repete papel e tolera valor solto", () => {
    expect(normalizePartyRoles(["Cliente", "cliente"])).toEqual(["cliente"]);
    expect(normalizePartyRoles("fornecedor")).toEqual(["fornecedor"]);
    expect(normalizePartyRoles(null)).toEqual([]);
  });

  it("partyHasRole responde sobre o registro inteiro", () => {
    const party = { roles: ["fornecedor", "transportador"] };
    expect(partyHasRole(party, "fornecedor")).toBe(true);
    expect(partyHasRole(party, "cliente")).toBe(false);
  });
});

describe("numeração de documentos", () => {
  it("monta o número com prefixo, série e zeros à esquerda", () => {
    expect(formatDocumentNumber({ prefix: "PC", series: "1", number: 42, padding: 6 }))
      .toBe("PC-1-000042");
  });

  it("omite as partes vazias em vez de deixar hífen solto", () => {
    expect(formatDocumentNumber({ number: 7, padding: 4 })).toBe("0007");
    expect(formatDocumentNumber({ prefix: "OS", number: 7, padding: 4 })).toBe("OS-0007");
  });

  it("não quebra com entrada inválida", () => {
    expect(formatDocumentNumber({})).toBe("000000");
    expect(formatDocumentNumber({ number: -5, padding: 3 })).toBe("000");
    expect(formatDocumentNumber({ number: 1, padding: 0 })).toBe("1");
  });

  it("dá o prefixo padrão de cada tipo", () => {
    expect(defaultPrefixFor("pedido_compra")).toBe("PC");
    expect(defaultPrefixFor("ordem_servico")).toBe("OS");
    expect(defaultPrefixFor("inexistente")).toBe("");
  });
});

describe("hierarquia de contas e centros de custo", () => {
  const contas = [
    { id: "b", code: "1.1", name: "Vendas", parentId: "a" },
    { id: "a", code: "1", name: "Receitas", parentId: "" },
    { id: "c", code: "1.2", name: "Serviços", parentId: "a" },
    { id: "d", code: "2", name: "Despesas", parentId: "" },
  ];

  it("ordena por código e marca o nível", () => {
    expect(buildCodeTree(contas).map((item) => [item.code, item.nivel])).toEqual([
      ["1", 0],
      ["1.1", 1],
      ["1.2", 1],
      ["2", 0],
    ]);
  });

  it("sobe órfão para a raiz em vez de escondê-lo", () => {
    const arvore = buildCodeTree([...contas, { id: "x", code: "9", name: "Perdida", parentId: "nao-existe" }]);
    expect(arvore.find((item) => item.id === "x")?.nivel).toBe(0);
  });

  it("não entra em laço quando o pai é o próprio nó", () => {
    const arvore = buildCodeTree([{ id: "a", code: "1", name: "Ciclo", parentId: "a" }]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].nivel).toBe(0);
  });

  it("ordena código numericamente, não como texto", () => {
    const arvore = buildCodeTree([
      { id: "a", code: "10", name: "Dez", parentId: "" },
      { id: "b", code: "2", name: "Dois", parentId: "" },
    ]);
    expect(arvore.map((item) => item.code)).toEqual(["2", "10"]);
  });

  it("aceita lançamento só em conta folha", () => {
    // Aceitar na conta que agrupa faria o total somar duas vezes.
    const pai = contas.find((item) => item.id === "a");
    const folha = contas.find((item) => item.id === "b");
    expect(accountAcceptsPosting(pai, contas)).toBe(false);
    expect(accountAcceptsPosting(folha, contas)).toBe(true);
  });

  it("respeita a marcação explícita de sintética", () => {
    expect(accountAcceptsPosting({ id: "z", analytical: false }, [])).toBe(false);
    expect(accountAcceptsPosting({ id: "z" }, [])).toBe(true);
  });

  it("conta cujo único filho está arquivado volta a aceitar lançamento", () => {
    const lista = [{ id: "p" }, { id: "f", parentId: "p", archivedAt: "2026-01-01" }];
    expect(accountAcceptsPosting({ id: "p" }, lista)).toBe(true);
  });
});

describe("validação de cadastro", () => {
  it("item exige nome e unidade reconhecida", () => {
    expect(validateItem({ name: "Pneu 295/80", unit: "UN" })).toBe("");
    expect(validateItem({ unit: "UN" })).toMatch(/nome/i);
    expect(validateItem({ name: "Pneu", unit: "dúzia" })).toMatch(/unidade/i);
  });

  it("item recusa NCM com tamanho errado e número negativo", () => {
    expect(validateItem({ name: "X", unit: "UN", ncm: "1234" })).toMatch(/NCM/);
    expect(validateItem({ name: "X", unit: "UN", ncm: "40111000" })).toBe("");
    expect(validateItem({ name: "X", unit: "UN", standardCost: -1 })).toMatch(/negativo/i);
    expect(validateItem({ name: "X", unit: "UN", minStock: -2 })).toMatch(/negativo/i);
  });

  it("parte exige razão social e ao menos um papel", () => {
    expect(validateParty({ legalName: "Transportes X", roles: ["fornecedor"] })).toBe("");
    expect(validateParty({ roles: ["fornecedor"] })).toMatch(/razão social/i);
    expect(validateParty({ legalName: "X", roles: [] })).toMatch(/papel/i);
  });

  it("parte aceita documento ausente, mas nunca documento inválido", () => {
    // Parte estrangeira e produtor rural sem inscrição existem; erro de
    // digitação quebraria o casamento por CNPJ da integração com o TMS.
    expect(validateParty({ legalName: "X", roles: ["cliente"], document: "" })).toBe("");
    expect(validateParty({ legalName: "X", roles: ["cliente"], document: "11222333000181" })).toBe("");
    expect(validateParty({ legalName: "X", roles: ["cliente"], document: "11222333000182" })).toMatch(/inválido/i);
  });

  it("depósito de veículo exige o veículo", () => {
    expect(validateWarehouse({ name: "Almoxarifado" })).toBe("");
    expect(validateWarehouse({ name: "Van 1", kind: "veiculo" })).toMatch(/veículo/i);
    expect(validateWarehouse({ name: "Van 1", kind: "veiculo", vehicleId: "v1" })).toBe("");
  });

  it("conta exige natureza válida", () => {
    expect(validateAccount({ name: "Fretes", kind: "despesa" })).toBe("");
    expect(validateAccount({ name: "Fretes", kind: "outra" })).toMatch(/natureza/i);
  });
});
