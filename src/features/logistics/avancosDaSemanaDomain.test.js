import { describe, expect, it } from "vitest";
import { avancosDaSemana } from "./avancosDaSemanaDomain.js";

const AGORA = Date.parse("2026-08-30T12:00:00.000Z");
const diasAtras = (dias) => new Date(AGORA - dias * 86_400_000).toISOString();

describe("avanços da semana", () => {
  it("só entra quem tem movimento registrado nos últimos sete dias, ordenado por valor", () => {
    const { avancos, totalMensal } = avancosDaSemana({
      agora: AGORA,
      oportunidades: [
        { id: "a", cliente: "Renner", estagio: "Prospecção", valorMensal: 750_000, lastInteractionAt: diasAtras(2) },
        { id: "b", cliente: "Mercado Livre", estagio: "Negociação", valorMensal: 1_000_000, lastInteractionAt: diasAtras(1) },
        { id: "c", cliente: "Parada", estagio: "Prospecção", valorMensal: 900_000, lastInteractionAt: diasAtras(20) },
        { id: "d", cliente: "Sem registro", estagio: "Prospecção", valorMensal: 500_000 },
      ],
    });
    expect(avancos.map((item) => item.cliente)).toEqual(["Mercado Livre", "Renner"]);
    expect(totalMensal).toBe(1_750_000);
  });

  it("comentário novo na oportunidade conta como movimento e vira a nota do cartão", () => {
    const { avancos } = avancosDaSemana({
      agora: AGORA,
      oportunidades: [
        { id: "a", cliente: "DHL", estagio: "Homologação", valorMensal: 300_000, lastInteractionAt: diasAtras(30), nextStep: "passo antigo" },
      ],
      comentarios: [
        { opportunityId: "a", comentario: "Dados de frota recebidos; reunião marcada para avançar.", criadoEm: diasAtras(1) },
        { opportunityId: "a", comentario: "nota velha", criadoEm: diasAtras(6) },
        { opportunityId: "outra", comentario: "de outra oportunidade", criadoEm: diasAtras(1) },
      ],
    });
    expect(avancos).toHaveLength(1);
    expect(avancos[0].nota).toBe("Dados de frota recebidos; reunião marcada para avançar.");
  });

  it("sem comentário, a nota é o próximo passo registrado", () => {
    const { avancos } = avancosDaSemana({
      agora: AGORA,
      oportunidades: [{ id: "a", cliente: "CHEP", valorMensal: 100_000, lastInteractionAt: diasAtras(3), nextStep: "Novos contatos para dar sequência." }],
    });
    expect(avancos[0].nota).toBe("Novos contatos para dar sequência.");
  });

  it("o rodapé de atenção lista as mais paradas — perdida sai do jogo, ganha não é follow-up", () => {
    const { frios } = avancosDaSemana({
      agora: AGORA,
      oportunidades: [
        { id: "a", cliente: "Track & Field", estagio: "Prospecção", valorMensal: 100_000, lastInteractionAt: diasAtras(21) },
        { id: "b", cliente: "Recente", estagio: "Prospecção", valorMensal: 100_000, lastInteractionAt: diasAtras(10) },
        { id: "c", cliente: "Ganha antiga", estagio: "Fechada ganha", valorMensal: 100_000, lastInteractionAt: diasAtras(90) },
        { id: "d", cliente: "Perdida", estagio: "Fechada perdida", valorMensal: 100_000, lastInteractionAt: diasAtras(90) },
        { id: "e", cliente: "Nunca tocada", estagio: "Prospecção", valorMensal: 50_000 },
      ],
    });
    // "Nunca tocada" (sem registro nenhum) vem antes da mais antiga com data.
    expect(frios.map((item) => item.cliente)).toEqual(["Nunca tocada", "Track & Field"]);
    expect(frios.find((item) => item.cliente === "Track & Field").diasParado).toBe(21);
  });

  it("valor do cartão prefere a mensalidade; sem ela, usa o contrato", () => {
    const { avancos } = avancosDaSemana({
      agora: AGORA,
      oportunidades: [
        { id: "a", cliente: "Mensal", valorMensal: 200_000, lastInteractionAt: diasAtras(1) },
        { id: "b", cliente: "Só contrato", valorContrato: 150_000, lastInteractionAt: diasAtras(1) },
      ],
    });
    expect(avancos.map((item) => item.valor)).toEqual([200_000, 150_000]);
    // O "somando R$ X/mês" do cabeçalho só soma o que é mensal de verdade.
    expect(avancosDaSemana({ agora: AGORA, oportunidades: [{ id: "b", cliente: "Só contrato", valorContrato: 150_000, lastInteractionAt: diasAtras(1) }] }).totalMensal).toBe(0);
  });
});
