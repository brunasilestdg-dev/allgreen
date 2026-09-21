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
  operacionalPorPraca,
  receitaDeSnapshot,
  montarPainelDoArtefato,
  montarPainelCanonicoMirror,
  montarKanbanDeOportunidades,
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

describe("receitaDeSnapshot (ponte temporária do artefato)", () => {
  const snapshot = {
    daily: [
      { data: "2026-07-05", mes_num: 7, receita: 1000 },
      { data: "2026-08-01", mes_num: 8, receita: 2000 },
    ],
    monthly: [
      { mes_num: 7, mes: "Julho", receita: 1000, clientes: [{ nome: "MAERSK", valor: 1000, pedidos: 40 }] },
      { mes_num: 8, mes: "Agosto", receita: 3000, clientes: [{ nome: "MAERSK", valor: 2000, pedidos: 60 }, { nome: "Flowserve", valor: 1000, pedidos: 5 }] },
    ],
  };

  it("devolve a mesma forma da aba Receita, com número real do retrato", () => {
    const r = receitaDeSnapshot(snapshot, new Date(Date.UTC(2026, 7, 2)));
    expect(r.porPeriodo.disponivel).toBe(true);
    expect(r.porPeriodo.meses).toEqual([
      { mes: "2026-07", receita: 1000 },
      { mes: "2026-08", receita: 3000 },
    ]);
    expect(r.concentracao.clientes[0].tomador).toBe("MAERSK");
    expect(r.concentracao.clientes[0].total).toBe(3000);
    const ago = r.resumoMensal.meses.find((m) => m.mes === "2026-08");
    expect(ago.principal).toBe(2000); // MAERSK
    expect(ago.outros).toBe(1000); // Flowserve
    expect(ago.varMoM).toBeCloseTo(2, 5); // 1000 -> 3000 = +200%
    const maersk = r.ticketMedio.clientes.find((c) => c.cliente === "MAERSK");
    expect(maersk.pedidos).toBe(100);
    expect(maersk.ticketMedio).toBe(30); // 3000 / 100
  });
});

describe("montarPainelDoArtefato (espelho do artefato)", () => {
  const artefato = {
    DATA: {
      daily: [{ data: "2026-08-01", mes_num: 8, receita: 2000 }],
      monthly: [{ mes_num: 8, mes: "Ago/26", receita: 2000, clientes: [{ nome: "MAERSK", valor: 2000, pedidos: 60 }] }],
    },
    KANBAN: { atualizado: "17/09/2026", stages: [{ label: "Prospecção", items: [{ nome: "Boticario", valor: 200000 }, { nome: "WE PINK", valor: 500000 }] }] },
    UPDATES: {
      weekly_updates: [{ nome: "CH Robinson", etapa: "Homologação", valor: 250000, data_ultima_atualizacao: "14/09/2026", texto: "avançou" }],
      fup_list: [{ nome: "Petz", etapa: "Prospecção", valor: 100000, data_ultima_atualizacao: "15/08/2026", texto: "agendar", dias_sem_atualizacao: 33 }],
    },
    OPS: {
      atualizado: "18/09/2026", periodo: "19/02 a 16/09", meta_otd: 98,
      otd: { monthly: [{ mes: "Ago/26", total: 100, noPrazo: 96, foraPrazo: 4, pct: 96 }], daily: [{ data: "2026-08-01", pct: 95 }], acumulado_pct: 95.83 },
      efetividade: { monthly: [{ mes: "Ago/26", total: 100, finalizadas: 93, insucessos: 7, pctEfetividade: 93, pctInsucesso: 7 }], acumulado_pct: 93.46 },
      waterfall: { defaultKey: "2026-08", monthly: [{ key: "2026-08", label: "Ago", mes: "Ago/26", totalProcessadas: 100, totalInsucessos: 7, pctInsucesso: 7, motivos: [{ motivo: "Destinatario Ausente", count: 5, pct: 71.4, pctOfTotal: 5 }] }] },
      leadtime: { nota: "n", monthly: [{ mes: "Ago/26", medianaH: 31.1, mediaH: 45.2, count: 60 }] },
      slaRota: { top_n: 20, rotas_totais: 49, pct_volume_coberto: 84.3, nota: "s", rows: [{ rota: "ZS-BRK", total: 6271, foraPrazo: 47, pctForaPrazo: 0.7 }] },
      reentrega: { pct_geral: 5.48, nota: "r", distribuicao_tentativas: [{ tentativas: 1, count: 40917 }], rows_por_rota: [{ rota: "ZS-BRK", total: 6271, multiTentativa: 142, pctMultiTentativa: 2.3 }] },
    },
  };

  it("espelha receita, kanban e operacional na forma da tela", () => {
    const p = montarPainelDoArtefato(artefato, new Date(Date.UTC(2026, 7, 2)));
    expect(p.receita.concentracao.clientes[0].tomador).toBe("MAERSK");
    expect(p.kanban.pipeline.etapas[0].etapa).toBe("Prospecção");
    expect(p.kanban.pipeline.etapas[0].valor).toBe(700000);
    expect(p.kanban.fup.clientes[0].semFupDias).toBe(33);
    expect(p.kanban.updatesSemana.itens[0].cliente).toBe("CH Robinson");
    expect(p.operacional.otd.acumuladoPct).toBe(95.83);
    expect(p.operacional.otd.meta).toBe(98);
    expect(p.operacional.efetividade.acumuladoPct).toBe(93.46);
    expect(p.operacional.ocorrencias.meses[0].motivos[0].motivo).toBe("Destinatario Ausente");
    expect(p.operacional.leadtime.meses[0].medianaH).toBe(31.1);
    expect(p.operacional.slaRota.rows[0].rota).toBe("ZS-BRK");
    expect(p.operacional.reentrega.pctGeral).toBe(5.48);
  });

  it("canônico devolve a MESMA forma mirror (vazio honesto quando sem fatos)", () => {
    const p = montarPainelCanonicoMirror({ faturas: [], encomendas: [], oportunidades: [] });
    expect(p.operacional.otd.disponivel).toBe(false);
    expect(p.kanban.pipeline.disponivel).toBe(false);
    expect(p.operacional.otd).toHaveProperty("acumuladoPct");
    expect(p.operacional.slaRota).toHaveProperty("rows");
  });
});

describe("montarKanbanDeOportunidades (kanban editável do ERP)", () => {
  it("agrupa por etapa com id no card e ordena FUP pelo mais parado", () => {
    const k = montarKanbanDeOportunidades([
      { id: "o1", cliente: "Alfa", estagio: "Prospecção", valorMensal: 1000, ultimaInteracaoEm: "2026-09-01T00:00:00Z", texto: "ligar" },
      { id: "o2", cliente: "Beta", estagio: "Proposta / BID", valorMensal: 3000, ultimaInteracaoEm: "2026-09-18T00:00:00Z" },
    ], new Date(Date.UTC(2026, 8, 20)));
    expect(k.editavel).toBe(true);
    expect(k.pipeline.etapas[0].etapa).toBe("Proposta / BID");
    expect(k.pipeline.etapas[0].itens[0].id).toBe("o2");
    expect(k.pipeline.valorTotal).toBe(4000);
    expect(k.fup.clientes[0].cliente).toBe("Alfa"); // mais parado
    expect(k.fup.clientes[0].semFupDias).toBe(19);
    expect(k.fup.clientes[0].texto).toBe("ligar");
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

  it("por praça de embarque agrupa por origem e cruza cliente × praça", () => {
    const p = operacionalPorPraca(encomendas);
    expect(p.disponivel).toBe(true);
    // E1 origem SP (Alfa), E2 origem SP (Beta) -> praça "SP" com 2 pedidos
    const sp = p.pracas.find((x) => x.praca === "SP");
    expect(sp.pedidos).toBe(2);
    expect(p.matriz.some((m) => m.cliente === "Alfa" && m.praca === "SP" && m.pedidos === 1)).toBe(true);
    expect(p.matriz.some((m) => m.cliente === "Beta" && m.praca === "SP" && m.pedidos === 1)).toBe(true);
  });

  it("reentrega detecta pedido com mais de uma tentativa", () => {
    const r = reentregaPorRota(encomendas);
    expect(r.disponivel).toBe(true);
    const mg = r.rotas.find((x) => x.rota.includes("MG"));
    expect(mg.comReentrega).toBe(1); // E2 teve 2 tentativas
  });
});
