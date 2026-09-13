import { describe, expect, it } from "vitest";
import {
  excedenteDeParadas,
  parseParadasEmMassa,
  resumoDaImportacao,
} from "./operationsImportDomain.js";

describe("parseParadasEmMassa", () => {
  it("separa referência do endereço por ; | ou tab e ignora linhas em branco", () => {
    const texto = [
      "NF 1001; Rua das Flores, 100, São Paulo SP",
      "NF 1002 | Av. Brasil, 200, Santos SP",
      "NF 1003\tRua A, 30, Osasco SP",
      "   ",
      "",
    ].join("\n");
    expect(parseParadasEmMassa(texto)).toEqual([
      { referencia: "NF 1001", destino: "Rua das Flores, 100, São Paulo SP" },
      { referencia: "NF 1002", destino: "Av. Brasil, 200, Santos SP" },
      { referencia: "NF 1003", destino: "Rua A, 30, Osasco SP" },
    ]);
  });

  it("linha com um só campo vira endereço E referência", () => {
    expect(parseParadasEmMassa("Rua Única, 5, Barueri SP")).toEqual([
      { referencia: "Rua Única, 5, Barueri SP", destino: "Rua Única, 5, Barueri SP" },
    ]);
  });

  it("junta o resto como endereço quando há vírgulas dentro dele", () => {
    expect(parseParadasEmMassa("PED-9; Rua X; 42; Centro; Jundiaí SP")).toEqual([
      { referencia: "PED-9", destino: "Rua X, 42, Centro, Jundiaí SP" },
    ]);
  });

  it("respeita o limite e reporta o excedente", () => {
    const texto = Array.from({ length: 5 }, (_, i) => `NF ${i}; Rua ${i}`).join("\n");
    expect(parseParadasEmMassa(texto, { limite: 3 })).toHaveLength(3);
    expect(excedenteDeParadas(texto, { limite: 3 })).toBe(2);
    expect(excedenteDeParadas(texto, { limite: 10 })).toBe(0);
  });

  it("entrada vazia devolve lista vazia", () => {
    expect(parseParadasEmMassa("")).toEqual([]);
    expect(parseParadasEmMassa(undefined)).toEqual([]);
  });
});

describe("resumoDaImportacao", () => {
  it("conta criadas, sem coordenada e falhas", () => {
    expect(resumoDaImportacao({ criadas: 10 })).toBe("10 parada(s) criada(s).");
    expect(resumoDaImportacao({ criadas: 8, semCoordenada: 2 }))
      .toBe("8 parada(s) criada(s) · 2 sem coordenada (não entra(m) no roteirizador até localizar o endereço).");
    expect(resumoDaImportacao({ criadas: 7, semCoordenada: 1, falhas: 2 }))
      .toBe("7 parada(s) criada(s) · 1 sem coordenada (não entra(m) no roteirizador até localizar o endereço) · 2 falha(s).");
  });
});
