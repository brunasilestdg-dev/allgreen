import { describe, expect, it } from "vitest";
import {
  alternarPonto,
  normalizarPontos,
  outroLado,
  pontosDeTexto,
  resumoDosPontos,
  rotuloDoLado,
} from "./contratoNegociacaoDomain.js";

describe("pontos de discordância do contrato", () => {
  it("um ponto por linha; linha vazia e espaço sobrando não viram ponto", () => {
    const pontos = pontosDeTexto("Multa por rescisão antecipada\n\n  Prazo de pagamento 60 dias  \n");
    expect(pontos).toHaveLength(2);
    expect(pontos[0].texto).toBe("Multa por rescisão antecipada");
    expect(pontos[1].texto).toBe("Prazo de pagamento 60 dias");
    expect(pontos.every((p) => p.status === "aberto" && p.id)).toBe(true);
  });

  it("JSON malformado do banco não derruba a tela: normaliza e descarta o que não tem texto", () => {
    const pontos = normalizarPontos([
      { id: "a", texto: "Foro da comarca", status: "acordado" },
      { texto: "   " },
      null,
      { texto: "Reajuste anual", status: "qualquer-coisa" },
    ]);
    expect(pontos).toHaveLength(2);
    expect(pontos[0]).toMatchObject({ id: "a", status: "acordado" });
    expect(pontos[1].status).toBe("aberto");
  });

  it("alternar marca como acordado e desmarcar reabre — nada é apagado", () => {
    const [ponto] = pontosDeTexto("Garantia de frota reserva");
    const acordado = alternarPonto([ponto], ponto.id);
    expect(acordado[0].status).toBe("acordado");
    const reaberto = alternarPonto(acordado, ponto.id);
    expect(reaberto[0].status).toBe("aberto");
    expect(reaberto).toHaveLength(1);
  });

  it("o resumo conta abertos e acordados e só dá resolvido com todos acordados", () => {
    const pontos = pontosDeTexto("A\nB\nC");
    expect(resumoDosPontos(pontos)).toMatchObject({ total: 3, abertos: 3, acordados: 0, resolvido: false });
    const umAcordado = alternarPonto(pontos, pontos[0].id);
    expect(resumoDosPontos(umAcordado).texto).toBe("1 de 3 ponto(s) acordado(s)");
    const todos = umAcordado.map((p) => ({ ...p, status: "acordado" }));
    expect(resumoDosPontos(todos).resolvido).toBe(true);
    expect(resumoDosPontos([])).toMatchObject({ total: 0, texto: "", resolvido: false });
  });

  it("a bola só troca entre os dois lados do vaivém", () => {
    expect(outroLado("juridico")).toBe("comercial");
    expect(outroLado("comercial")).toBe("juridico");
    // Valor desconhecido cai no par seguro em vez de inventar um terceiro lado.
    expect(outroLado("")).toBe("juridico");
    expect(rotuloDoLado("juridico")).toBe("Jurídico");
    expect(rotuloDoLado("comercial")).toBe("Comercial");
  });
});
