import { describe, expect, it } from "vitest";
import {
  buildMarketRadarPlans,
  classifyMarketRadarResults,
} from "../../../worker/services/todogreen-market-radar.js";

const search = (items, source = "private-market") => [{
  plan: { id: source, source },
  providers: ["teste"],
  results: items.map((item) => ({ provider: "teste", ...item })),
}];

describe("Radar de mercado To Do Green", () => {
  it("busca RFQ, RFI, RFP e licitação fora da carteira", () => {
    const plans = buildMarketRadarPlans({ query: "São Paulo", year: 2026 });
    expect(plans.map((item) => item.id)).toEqual([
      "pncp",
      "compras-gov",
      "private-market",
      "private-market-en",
    ]);
    expect(plans.some((item) => item.query.includes("RFI"))).toBe(true);
    expect(plans.every((item) => item.query.includes("-bitrem"))).toBe(true);
  });

  it("aceita processo aberto de transporte e rejeita vaga", () => {
    const report = classifyMarketRadarResults(search([
      {
        title: "RFQ aberta para transportadoras de last mile",
        url: "https://empresa.example/rfq-last-mile",
        snippet: "Recebimento de propostas aberto. Acesse o portal e envie sua proposta para transporte e distribuição em São Paulo.",
      },
      {
        title: "Vaga comprador de fretes",
        url: "https://empresa.example/carreiras/comprador-fretes",
        snippet: "Vaga aberta para profissional de procurement, transporte e logística.",
      },
    ]));

    expect(report.opportunities).toHaveLength(1);
    expect(report.opportunities[0].kind).toBe("RFQ");
    expect(report.opportunities[0].fitScore).toBeGreaterThanOrEqual(65);
    expect(report.rejected.vacancies).toBe(1);
  });

  it("rejeita demanda explícita de bitrem ou rodotrem", () => {
    const report = classifyMarketRadarResults(search([
      {
        title: "RFP aberta para transporte com bitrem",
        url: "https://buyer.example/rfp-bitrem",
        snippet: "Envio de propostas aberto no portal para operação logística com bitrem.",
      },
      {
        title: "Licitação aberta para rodotrem",
        url: "https://gov.example/licitacao-rodotrem",
        snippet: "Edital de transporte e prazo para participação com rodotrem.",
      },
    ]));

    expect(report.opportunities).toHaveLength(0);
    expect(report.rejected.incompatibleFleet).toBe(2);
  });

  it("não transforma conteúdo educativo ou processo encerrado em oportunidade", () => {
    const report = classifyMarketRadarResults(search([
      {
        title: "O que é RFQ em logística",
        url: "https://blog.example/o-que-e-rfq",
        snippet: "Guia de RFQ para transporte e fretes.",
      },
      {
        title: "RFP logística encerrada",
        url: "https://buyer.example/rfp-2025",
        snippet: "Processo encerrado e resultado final publicado para transporte.",
      },
    ]));

    expect(report.opportunities).toHaveLength(0);
    expect(report.rejected.educational).toBe(1);
    expect(report.rejected.closed).toBe(1);
  });
});
