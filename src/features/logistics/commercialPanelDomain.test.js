import { describe, it, expect } from "vitest";
import {
  normalizarNome,
  receitaPorPeriodo,
  previsaoDeFechamento,
  concentracaoPorTomador,
  resumoMensalReceita,
  ticketMedioPorCliente,
  pipelinePorEtapa,
  clientesParaFup,
  volumeDiarioDePedidos,
  otdPorMes,
  efetividadeDeEntregas,
  decomposicaoDeOcorrencias,
  resumoMensalOperacional,
  rankingClientesPorVolume,
  leadTimeDeEntrega,
  slaPorRota,
  reentregaPorRota,
  montarPainelComercial,
} from "./commercialPanelDomain.js";

// Fatura de receita já normalizada pelo endpoint.
const fatura = (data, valor, tomador) => ({ data, valor, mes: data.slice(0, 7), tomador });

// Linha de encomenda/ocorrência do todogreen_tms_documents, já normalizada.
const enc = (over = {}) => ({
  orderRef: "E1",
  kind: "encomenda",
  status: "",
  occurrence: "",
  occurrenceCode: "",
  promisedAt: "",
  occurredAt: "",
  originUnit: "",
  currentUnit: "",
  cliente: "",
  ...over,
});

describe("commercialPanelDomain — estados vazios honestos", () => {
  it("tudo vazio: cada seção marca disponivel:false, sem número inventado", () => {
    const painel = montarPainelComercial({ faturas: [], encomendas: [], oportunidades: [] });
    expect(painel.receita.porPeriodo.disponivel).toBe(false);
    expect(painel.receita.previsao.disponivel).toBe(false);
    expect(painel.receita.concentracao.disponivel).toBe(false);
    expect(painel.operacional.otd.disponivel).toBe(false);
    expect(painel.operacional.slaPorRota.disponivel).toBe(false);
    expect(painel.kanban.pipeline.disponivel).toBe(false);
    expect(painel.receita.porPeriodo.meses).toEqual([]);
    expect(painel.operacional.otd.otdGeral).toBeNull();
  });
});

describe("normalizarNome", () => {
  it("casa mesmo com caixa, acento e espaço", () => {
    expect(normalizarNome(" ON RUNNING ")).toBe("on running");
    expect(normalizarNome("On Running")).toBe(normalizarNome("ON  RUNNING"));
  });
});

describe("Aba Receita", () => {
  const faturas = [
    fatura("2026-07-05", 1000, "On Running"),
    fatura("2026-07-20", 500, "Outro Cliente"),
    fatura("2026-08-10", 2000, "ON RUNNING"),
    fatura("2026-08-15", 1000, "Outro Cliente"),
  ];

  it("receita por período soma por mês e por dia", () => {
    const r = receitaPorPeriodo(faturas);
    expect(r.disponivel).toBe(true);
    expect(r.meses).toEqual([
      { mes: "2026-07", receita: 1500 },
      { mes: "2026-08", receita: 3000 },
    ]);
    expect(r.porDia["2026-07"]).toEqual([
      { dia: "2026-07-05", receita: 1000 },
      { dia: "2026-07-20", receita: 500 },
    ]);
  });

  it("concentração por tomador ordena por total e casa nomes equivalentes", () => {
    const c = concentracaoPorTomador(faturas);
    expect(c.clientes[0].tomador).toBe("On Running");
    expect(c.clientes[0].total).toBe(3000); // 1000 (jul) + 2000 (ago), mesmo cliente
    expect(c.totalGeral).toBe(4500);
    expect(c.clientes[0].participacao).toBeCloseTo(3000 / 4500, 5);
  });

  it("resumo mensal traz Var MoM e separa cliente principal de outros", () => {
    const r = resumoMensalReceita(faturas);
    expect(r.clientePrincipal).toBe("On Running");
    const ago = r.meses.find((m) => m.mes === "2026-08");
    expect(ago.receita).toBe(3000);
    expect(ago.principal).toBe(2000);
    expect(ago.outros).toBe(1000);
    expect(ago.varMoM).toBeCloseTo((3000 - 1500) / 1500, 5); // +100%
    const jul = r.meses.find((m) => m.mes === "2026-07");
    expect(jul.varMoM).toBeNull(); // sem mês anterior
  });

  it("previsão por ritmo comparado projeta o total do mês", () => {
    const hist = [
      fatura("2026-07-01", 100, "X"),
      fatura("2026-07-31", 300, "X"), // mês anterior fecha em 400; até o dia 1 = 100
      fatura("2026-08-01", 200, "X"), // mês atual acumulado até o dia 1 = 200
    ];
    const p = previsaoDeFechamento(hist, new Date(Date.UTC(2026, 7, 1)));
    expect(p.disponivel).toBe(true);
    expect(p.base).toBe("comparado");
    expect(p.acumulado).toBe(200);
    // 200 * (400 / 100) = 800
    expect(p.projecao).toBeCloseTo(800, 5);
  });

  it("ticket médio = receita ÷ pedidos, casando tomador com cliente da encomenda", () => {
    const t = ticketMedioPorCliente(
      [fatura("2026-08-01", 1000, "On Running")],
      [enc({ orderRef: "A", cliente: "ON RUNNING" }), enc({ orderRef: "B", cliente: "On Running" })],
    );
    expect(t.disponivel).toBe(true);
    expect(t.temVolume).toBe(true);
    expect(t.clientes[0].pedidos).toBe(2);
    expect(t.clientes[0].ticketMedio).toBe(500);
  });
});

describe("Aba Kanban", () => {
  const oportunidades = [
    { estagio: "Mapeamento", valorMensal: 1000, cliente: "Alfa", atualizadoEm: "2026-09-01T00:00:00Z" },
    { estagio: "Proposta", valorMensal: 3000, cliente: "Beta", atualizadoEm: "2026-09-15T00:00:00Z" },
  ];

  it("pipeline agrupa por etapa e soma valor mensal", () => {
    const p = pipelinePorEtapa(oportunidades);
    expect(p.disponivel).toBe(true);
    expect(p.totalOportunidades).toBe(2);
    expect(p.valorMensalTotal).toBe(4000);
    expect(p.etapas[0].etapa).toBe("Proposta"); // maior valor primeiro
  });

  it("FUP calcula há quantos dias sem atualização, do mais parado ao menos", () => {
    const f = clientesParaFup(oportunidades, new Date(Date.UTC(2026, 8, 20)));
    expect(f.clientes[0].cliente).toBe("Alfa"); // parado desde 01/09
    expect(f.clientes[0].semFupDias).toBe(19);
    expect(f.clientes[1].semFupDias).toBe(5);
  });
});

describe("Aba Operacional", () => {
  // Uma encomenda entregue no prazo, outra entregue atrasada, uma com reentrega.
  const encomendas = [
    // E1: registrada 01/08, prometida 03/08, entregue 02/08 (no prazo)
    enc({ orderRef: "E1", kind: "encomenda", occurredAt: "2026-08-01T08:00:00Z", promisedAt: "2026-08-03T00:00:00Z", originUnit: "SP", currentUnit: "RJ", cliente: "Alfa" }),
    enc({ orderRef: "E1", kind: "ocorrencia", occurrenceCode: "03", status: "Entregue", occurredAt: "2026-08-02T15:00:00Z", originUnit: "SP", currentUnit: "RJ", cliente: "Alfa" }),
    // E2: registrada 01/08, prometida 02/08, entregue 05/08 (atrasada), 2 tentativas
    enc({ orderRef: "E2", kind: "encomenda", occurredAt: "2026-08-01T08:00:00Z", promisedAt: "2026-08-02T00:00:00Z", originUnit: "SP", currentUnit: "MG", cliente: "Beta" }),
    enc({ orderRef: "E2", kind: "ocorrencia", occurrence: "Cliente ausente", occurredAt: "2026-08-03T10:00:00Z", originUnit: "SP", currentUnit: "MG", cliente: "Beta" }),
    enc({ orderRef: "E2", kind: "ocorrencia", occurrenceCode: "03", status: "Entregue", occurredAt: "2026-08-05T11:00:00Z", originUnit: "SP", currentUnit: "MG", cliente: "Beta" }),
  ];

  it("volume conta pedidos distintos por mês", () => {
    const v = volumeDiarioDePedidos(encomendas);
    expect(v.totalPedidos).toBe(2);
    expect(v.meses).toEqual([{ mes: "2026-08", pedidos: 2 }]);
  });

  it("OTD: 1 de 2 no prazo = 50%", () => {
    const o = otdPorMes(encomendas);
    expect(o.disponivel).toBe(true);
    expect(o.entreguesTotal).toBe(2);
    expect(o.otdGeral).toBeCloseTo(0.5, 5);
    expect(o.meta).toBe(0.98);
  });

  it("efetividade: ambas entregues = 100%", () => {
    const e = efetividadeDeEntregas(encomendas);
    expect(e.efetividadeGeral).toBe(1);
    expect(e.entregues).toBe(2);
  });

  it("decomposição de ocorrências conta só insucessos", () => {
    const d = decomposicaoDeOcorrencias(encomendas);
    expect(d.total).toBe(1); // "Cliente ausente"; as de código 03 (entregue) são excluídas
    expect(d.tipos[0].tipo).toBe("Cliente ausente");
    expect(d.tipos[0].percentual).toBe(1);
  });

  it("resumo mensal operacional junta volume, OTD, efetividade e insucessos", () => {
    const r = resumoMensalOperacional(encomendas);
    const ago = r.meses[0];
    expect(ago.volume).toBe(2);
    expect(ago.otd).toBeCloseTo(0.5, 5);
    expect(ago.efetividade).toBe(1);
    expect(ago.insucessos).toBe(0);
  });

  it("ranking por volume ordena clientes", () => {
    const r = rankingClientesPorVolume(encomendas);
    expect(r.clientes).toHaveLength(2);
    expect(r.clientes.map((c) => c.total)).toEqual([1, 1]);
  });

  it("lead time médio em horas/dias entre registro e entrega", () => {
    const l = leadTimeDeEntrega(encomendas);
    expect(l.disponivel).toBe(true);
    // E1: 01/08 08:00 -> 02/08 15:00 = 31h; E2: 01/08 08:00 -> 05/08 11:00 = 99h; média 65h
    expect(l.horasMediasGeral).toBeCloseTo(65, 0);
  });

  it("SLA por rota conta fora do prazo", () => {
    const s = slaPorRota(encomendas);
    const mg = s.rotas.find((r) => r.rota.includes("MG"));
    expect(mg.pedidos).toBe(1);
    expect(mg.foraDoPrazo).toBe(1);
    expect(mg.percentualForaDoPrazo).toBe(1);
  });

  it("reentrega detecta pedido com mais de uma tentativa", () => {
    const r = reentregaPorRota(encomendas);
    expect(r.disponivel).toBe(true);
    const mg = r.rotas.find((x) => x.rota.includes("MG"));
    expect(mg.comReentrega).toBe(1); // E2 teve 2 tentativas
  });
});
