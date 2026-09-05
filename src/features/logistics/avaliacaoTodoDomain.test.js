import { describe, expect, it } from "vitest";
import { leituraDaAvaliacao } from "./avaliacaoTodoDomain.js";

describe("leitura da avaliação do Todô", () => {
  it("sem nenhuma resposta, convida a usar", () => {
    const { tom, frase } = leituraDaAvaliacao({ total: 0 });
    expect(tom).toBe("neutro");
    expect(frase).toMatch(/ainda não respondeu/i);
  });

  it("respostas sem voto pedem 👍/👎", () => {
    const { tom, frase } = leituraDaAvaliacao({ total: 12, avaliadas: 0, taxaUtil: null });
    expect(tom).toBe("neutro");
    expect(frase).toMatch(/nenhuma avaliada/i);
    expect(frase).toContain("12");
  });

  it("taxa alta é tom bom", () => {
    expect(leituraDaAvaliacao({ total: 20, avaliadas: 10, taxaUtil: 90 }).tom).toBe("bom");
  });

  it("taxa média pede atenção", () => {
    expect(leituraDaAvaliacao({ total: 20, avaliadas: 10, taxaUtil: 60 }).tom).toBe("atencao");
  });

  it("taxa baixa pede correção", () => {
    const { tom, frase } = leituraDaAvaliacao({ total: 20, avaliadas: 10, taxaUtil: 20 });
    expect(tom).toBe("atencao");
    expect(frase).toMatch(/corrigir/i);
  });

  it("nunca inventa qualidade sem voto (taxa null com total > 0)", () => {
    const { frase } = leituraDaAvaliacao({ total: 5, avaliadas: 0, taxaUtil: null });
    expect(frase).not.toMatch(/%/); // sem porcentagem quando não há voto
  });
});
