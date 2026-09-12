import { describe, expect, it } from "vitest";
import {
  classificarNPS,
  precisaOcorrencia,
  calcularNPS,
  npsPorDimensao,
  causasDeInsatisfacao,
  faixaNPS,
} from "./npsDomain.js";

describe("classificação NPS", () => {
  it("9-10 promotor, 7-8 neutro, 0-6 detrator; inválido null", () => {
    expect(classificarNPS(10)).toBe("promotor");
    expect(classificarNPS(9)).toBe("promotor");
    expect(classificarNPS(8)).toBe("neutro");
    expect(classificarNPS(7)).toBe("neutro");
    expect(classificarNPS(6)).toBe("detrator");
    expect(classificarNPS(0)).toBe("detrator");
    expect(classificarNPS(11)).toBeNull();
    expect(classificarNPS(-1)).toBeNull();
    expect(classificarNPS(7.5)).toBeNull();
    expect(classificarNPS("abc")).toBeNull();
  });

  it("detrator precisa abrir ocorrência", () => {
    expect(precisaOcorrencia(6)).toBe(true);
    expect(precisaOcorrencia(0)).toBe(true);
    expect(precisaOcorrencia(7)).toBe(false);
    expect(precisaOcorrencia(10)).toBe(false);
  });
});

describe("cálculo do NPS", () => {
  it("NPS = %promotor − %detrator sobre respostas válidas", () => {
    const r = calcularNPS([
      { nota: 10 }, { nota: 9 }, // 2 promotores
      { nota: 8 }, // 1 neutro
      { nota: 3 }, // 1 detrator
      { nota: 99 }, // inválido, ignorado
    ]);
    expect(r.respondidos).toBe(4);
    expect(r.promotores).toBe(2);
    expect(r.neutros).toBe(1);
    expect(r.detratores).toBe(1);
    // (2/4 − 1/4) × 100 = 25
    expect(r.nps).toBe(25);
  });

  it("sem resposta válida: nps null, nunca 0", () => {
    expect(calcularNPS([]).nps).toBeNull();
    expect(calcularNPS([{ nota: 99 }]).nps).toBeNull();
  });
});

describe("NPS por dimensão e causas", () => {
  const respostas = [
    { nota: 10, regiao: "SP", motivo: "" },
    { nota: 3, regiao: "SP", motivo: "Atraso" },
    { nota: 2, regiao: "RJ", motivo: "Atraso" },
    { nota: 1, regiao: "RJ", motivo: "Avaria" },
  ];

  it("agrupa por dimensão, do pior NPS para o melhor", () => {
    const porRegiao = npsPorDimensao(respostas, "regiao");
    expect(porRegiao[0].rotulo).toBe("RJ"); // −100 (2 detratores)
    expect(porRegiao[0].nps).toBe(-100);
    expect(porRegiao[1].rotulo).toBe("SP"); // 0 (1 promotor, 1 detrator)
    expect(porRegiao[1].nps).toBe(0);
  });

  it("ranqueia causas de insatisfação (só detratores)", () => {
    const causas = causasDeInsatisfacao(respostas);
    expect(causas[0]).toEqual({ causa: "Atraso", total: 2 });
    expect(causas[1]).toEqual({ causa: "Avaria", total: 1 });
  });
});

describe("faixa do NPS", () => {
  it("classifica a leitura", () => {
    expect(faixaNPS(null)).toBe("sem-dados");
    expect(faixaNPS(80)).toBe("excelente");
    expect(faixaNPS(60)).toBe("muito-bom");
    expect(faixaNPS(10)).toBe("razoavel");
    expect(faixaNPS(-30)).toBe("critico");
  });
});
