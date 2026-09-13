import { describe, it, expect } from "vitest";
import {
  padronizarEndereco,
  parsearLinhaColada,
  parsearParadasColadas,
  parsearParadasDePlanilha,
  csvParaMatriz,
  classificarGeocodificacao,
  precisaConferencia,
  resumoImportacao,
  pareceCodigoSeco,
  interpretarBipagem,
} from "./roteirizadorImportDomain.js";

describe("padronizarEndereco", () => {
  it("colapsa espaços e apara", () => {
    expect(padronizarEndereco("  Rua   A,   100  ")).toBe("Rua A, 100");
  });
  it("formata CEP de 8 dígitos como NNNNN-NNN", () => {
    expect(padronizarEndereco("Rua A 01310100")).toBe("Rua A 01310-100");
    expect(padronizarEndereco("Rua A 01310-100")).toBe("Rua A 01310-100");
  });
  it("coloca a UF final em maiúsculo", () => {
    expect(padronizarEndereco("Av Brasil, Campinas sp")).toBe("Av Brasil, Campinas SP");
  });
  it("texto vazio vira string vazia", () => {
    expect(padronizarEndereco("   ")).toBe("");
    expect(padronizarEndereco(null)).toBe("");
  });
});

describe("parsearLinhaColada", () => {
  it("sem separador, a linha é o endereço", () => {
    expect(parsearLinhaColada("Rua A, 100, Santos SP")).toEqual({ referencia: "", endereco: "Rua A, 100, Santos SP" });
  });
  it("com ; o primeiro campo é a referência", () => {
    expect(parsearLinhaColada("PED-1; Rua A, 100")).toEqual({ referencia: "PED-1", endereco: "Rua A, 100" });
  });
  it("com TAB idem", () => {
    expect(parsearLinhaColada("NF999\tAv Brasil 500")).toEqual({ referencia: "NF999", endereco: "Av Brasil 500" });
  });
});

describe("parsearParadasColadas", () => {
  it("uma parada por linha, padronizada, sem vazias", () => {
    const itens = parsearParadasColadas("Rua A 01310100\n\n  \nAv B, campinas sp");
    expect(itens).toEqual([
      { referencia: "", endereco: "Rua A 01310-100" },
      { referencia: "", endereco: "Av B, campinas SP" },
    ]);
  });
  it("descarta duplicata exata (referência+endereço)", () => {
    const itens = parsearParadasColadas("PED-1; Rua A\nPED-1; Rua A\nPED-2; Rua A");
    expect(itens).toHaveLength(2);
  });
  it("ignora linha curta demais (< 3 chars)", () => {
    expect(parsearParadasColadas("ab\nRua Longa 10")).toEqual([{ referencia: "", endereco: "Rua Longa 10" }]);
  });
});

describe("parsearParadasDePlanilha", () => {
  it("detecta cabeçalho e usa colunas endereço/referência", () => {
    const matriz = [
      ["Pedido", "Endereço", "Cliente"],
      ["PED-1", "Rua A, 100, Santos SP", "Alfa"],
      ["PED-2", "Av B, 200, Campinas SP", "Beta"],
    ];
    expect(parsearParadasDePlanilha(matriz)).toEqual([
      { referencia: "PED-1", endereco: "Rua A, 100, Santos SP" },
      { referencia: "PED-2", endereco: "Av B, 200, Campinas SP" },
    ]);
  });
  it("sem cabeçalho: 1ª coluna referência, resto endereço", () => {
    const matriz = [
      ["R1", "Rua A", "Santos SP"],
      ["R2", "Av B", "Campinas SP"],
    ];
    expect(parsearParadasDePlanilha(matriz)).toEqual([
      { referencia: "R1", endereco: "Rua A, Santos SP" },
      { referencia: "R2", endereco: "Av B, Campinas SP" },
    ]);
  });
  it("coluna única vira endereço", () => {
    expect(parsearParadasDePlanilha([["Rua A, Santos SP"], ["Av B, Campinas SP"]])).toEqual([
      { referencia: "", endereco: "Rua A, Santos SP" },
      { referencia: "", endereco: "Av B, Campinas SP" },
    ]);
  });
  it("matriz vazia devolve lista vazia", () => {
    expect(parsearParadasDePlanilha([])).toEqual([]);
    expect(parsearParadasDePlanilha(null)).toEqual([]);
  });
});

describe("csvParaMatriz", () => {
  it("detecta ; e respeita aspas com separador dentro", () => {
    const csv = 'Pedido;Endereço\nPED-1;"Rua A, 100; fundos"\nPED-2;Av B';
    expect(csvParaMatriz(csv)).toEqual([
      ["Pedido", "Endereço"],
      ["PED-1", "Rua A, 100; fundos"],
      ["PED-2", "Av B"],
    ]);
  });
  it("usa vírgula quando predomina", () => {
    expect(csvParaMatriz("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("remove BOM e linhas vazias", () => {
    expect(csvParaMatriz("﻿a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("feeds parsearParadasDePlanilha ponta a ponta", () => {
    const csv = "Pedido,Endereço\nPED-9,\"Rua X, 10, Santos SP\"";
    expect(parsearParadasDePlanilha(csvParaMatriz(csv))).toEqual([
      { referencia: "PED-9", endereco: "Rua X, 10, Santos SP" },
    ]);
  });
});

describe("classificarGeocodificacao", () => {
  it("0 candidatos = falha, 1 = ok, vários = ambiguo", () => {
    expect(classificarGeocodificacao([])).toBe("falha");
    expect(classificarGeocodificacao([{}])).toBe("ok");
    expect(classificarGeocodificacao([{}, {}])).toBe("ambiguo");
    expect(classificarGeocodificacao(null)).toBe("falha");
  });
  it("precisaConferencia só para falha/ambiguo", () => {
    expect(precisaConferencia("ok")).toBe(false);
    expect(precisaConferencia("resolvido")).toBe(false);
    expect(precisaConferencia("falha")).toBe(true);
    expect(precisaConferencia("ambiguo")).toBe(true);
  });
});

describe("pareceCodigoSeco", () => {
  it("token único sem espaço é código; com espaço é endereço", () => {
    expect(pareceCodigoSeco("35240612345678901234567890123456789012345678")).toBe(true);
    expect(pareceCodigoSeco("PED-123")).toBe(true);
    expect(pareceCodigoSeco("NF/2024.55")).toBe(true);
    expect(pareceCodigoSeco("Rua X, 10")).toBe(false);
    expect(pareceCodigoSeco("Santos SP")).toBe(false);
    expect(pareceCodigoSeco("")).toBe(false);
  });
});

describe("interpretarBipagem", () => {
  it("código seco vira referência com endereço vazio (completa na conferência)", () => {
    expect(interpretarBipagem("PED-9988")).toEqual({ referencia: "PED-9988", endereco: "" });
  });
  it("etiqueta com referência e endereço separados por ; usa os dois", () => {
    expect(interpretarBipagem("PED-1; Rua A, 100 santos sp")).toEqual({
      referencia: "PED-1",
      endereco: "Rua A, 100 santos SP",
    });
  });
  it("etiqueta que embute o endereço inteiro vira endereço padronizado", () => {
    expect(interpretarBipagem("Rua da Estação, 100, campinas sp")).toEqual({
      referencia: "",
      endereco: "Rua da Estação, 100, campinas SP",
    });
  });
  it("texto vazio devolve null", () => {
    expect(interpretarBipagem("   ")).toBe(null);
    expect(interpretarBipagem(null)).toBe(null);
  });
});

describe("resumoImportacao", () => {
  it("conta prontas (ok/resolvido) x conferência", () => {
    const itens = [
      { status: "ok" }, { status: "resolvido" }, { status: "ambiguo" }, { status: "falha" },
    ];
    expect(resumoImportacao(itens)).toEqual({ total: 4, prontas: 2, conferencia: 2 });
  });
  it("lista vazia zera", () => {
    expect(resumoImportacao([])).toEqual({ total: 0, prontas: 0, conferencia: 0 });
  });
});
