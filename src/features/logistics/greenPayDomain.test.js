import { describe, expect, it } from "vitest";
import {
  reguaConfigurada,
  normalizarRegua,
  derivarGanhosDaViagem,
  saldos,
  resumoCarteira,
  metaEProjecaoMes,
  arredondarReais,
  PARAMETROS_GREENPAY_PADRAO,
} from "./greenPayDomain.js";

describe("GreenPay — régua configurada", () => {
  it("padrão de fábrica não é régua configurada (evita mostrar R$ 0 como ganho)", () => {
    expect(reguaConfigurada(PARAMETROS_GREENPAY_PADRAO)).toBe(false);
    expect(reguaConfigurada(null)).toBe(false);
    expect(reguaConfigurada({ valorPorEntrega: 0, valorPorKm: 0 })).toBe(false);
  });
  it("paga por entrega OU por km já conta como configurada", () => {
    expect(reguaConfigurada({ valorPorEntrega: 8 })).toBe(true);
    expect(reguaConfigurada({ valorPorKm: 0.9 })).toBe(true);
  });
  it("normalizar não deixa valor negativo nem casas soltas", () => {
    expect(normalizarRegua({ valorPorEntrega: -5, valorPorKm: 0.905, bonusEntregaSemOcorrencia: 2.1 }))
      .toEqual({ valorPorEntrega: 0, valorPorKm: 0.91, bonusEntregaSemOcorrencia: 2.1, metaMensal: 0 });
  });
});

describe("GreenPay — derivar ganho da viagem (derivado, não digitado)", () => {
  const regra = { valorPorEntrega: 8, valorPorKm: 0.9, bonusEntregaSemOcorrencia: 3 };

  it("viagem sem entrega concluída não gera ganho", () => {
    expect(derivarGanhosDaViagem({ entregueEm: "", distanciaKm: 40 }, regra)).toEqual([]);
  });

  it("sem régua configurada, entrega concluída ainda não gera ganho", () => {
    expect(derivarGanhosDaViagem({ entregueEm: "2026-09-11T12:00:00Z", distanciaKm: 40 }, PARAMETROS_GREENPAY_PADRAO)).toEqual([]);
  });

  it("entrega concluída sem ocorrência gera entrega + km + bônus, com memória", () => {
    const l = derivarGanhosDaViagem(
      { entregueEm: "2026-09-11T12:00:00Z", distanciaKm: 30, ocorrencias: 0 },
      regra,
    );
    expect(l.map((x) => x.tipo)).toEqual(["entrega", "km", "bonus"]);
    expect(l[0].valor).toBe(8);
    expect(l[1].valor).toBe(27); // 0.9 * 30
    expect(l[1].memoria).toEqual({ base: "distância rodada na viagem", km: 30, valorPorKm: 0.9 });
    expect(l[2].valor).toBe(3);
  });

  it("entrega com ocorrência não recebe o bônus", () => {
    const l = derivarGanhosDaViagem(
      { entregueEm: "2026-09-11T12:00:00Z", distanciaKm: 10, ocorrencias: 1 },
      regra,
    );
    expect(l.map((x) => x.tipo)).toEqual(["entrega", "km"]);
  });

  it("km zero não cria lançamento de km", () => {
    const l = derivarGanhosDaViagem(
      { entregueEm: "2026-09-11T12:00:00Z", distanciaKm: 0, ocorrencias: 1 },
      { valorPorEntrega: 8, valorPorKm: 0.9 },
    );
    expect(l.map((x) => x.tipo)).toEqual(["entrega"]);
  });
});

describe("GreenPay — saldos por status", () => {
  it("separa pendente, aprovado e pago; a receber = pendente + aprovado", () => {
    const s = saldos([
      { valor: 8, status: "pendente" },
      { valor: 27, status: "aprovado" },
      { valor: 50, status: "pago" },
      { valor: -5, status: "pendente" }, // desconto
    ]);
    expect(s.pendente).toBe(3); // 8 - 5
    expect(s.aprovado).toBe(27);
    expect(s.pago).toBe(50);
    expect(s.total).toBe(80);
    expect(s.aReceber).toBe(30); // 3 + 27
  });
  it("status ausente conta como pendente", () => {
    expect(saldos([{ valor: 10 }]).pendente).toBe(10);
  });
});

describe("GreenPay — resumo por período", () => {
  const hoje = "2026-09-11";
  const lancamentos = [
    { valor: 8, dataServico: "2026-09-11", status: "pendente" },  // hoje
    { valor: 12, dataServico: "2026-09-08", status: "pendente" }, // dentro da semana
    { valor: 20, dataServico: "2026-09-01", status: "aprovado" }, // mês, fora da semana
    { valor: 99, dataServico: "2026-08-30", status: "pago" },     // mês passado
  ];

  it("dia soma só hoje; semana os últimos 7 dias; mês o mês corrente", () => {
    const r = resumoCarteira(lancamentos, hoje);
    expect(r.dia).toBe(8);
    expect(r.semana).toBe(20); // 8 (hoje) + 12 (dia 8)
    expect(r.mes).toBe(40);    // 8 + 12 + 20 (tudo de setembro)
  });

  it("traz os saldos junto", () => {
    const r = resumoCarteira(lancamentos, hoje);
    expect(r.saldos.total).toBe(139);
    expect(r.saldos.pago).toBe(99);
  });

  it("data de hoje inválida não quebra (semana vira 0, dia/mês seguem)", () => {
    const r = resumoCarteira([{ valor: 5, dataServico: "2026-09-11" }], "");
    expect(r.semana).toBe(0);
  });
});

describe("GreenPay — arredondamento", () => {
  it("arredonda para centavos", () => {
    expect(arredondarReais(0.905)).toBe(0.91);
    expect(arredondarReais(27.004)).toBe(27);
  });
});

describe("GreenPay — meta e projeção do mês", () => {
  it("sem meta, devolve null (não inventa alvo)", () => {
    expect(metaEProjecaoMes(500, 0, "2026-09-15")).toBeNull();
    expect(metaEProjecaoMes(500, undefined, "2026-09-15")).toBeNull();
  });

  it("meta na régua carrega na normalização", () => {
    expect(normalizarRegua({ valorPorEntrega: 5, metaMensal: 3000 }).metaMensal).toBe(3000);
    expect(normalizarRegua({ valorPorEntrega: 5 }).metaMensal).toBe(0);
  });

  it("progresso e projeção pelo ritmo do mês", () => {
    // Dia 15 de setembro (30 dias), R$ 1.500 no mês → 50% da meta 3.000.
    // Ritmo: 1500/15 = 100/dia → projeção 100×30 = 3.000 (100%).
    const r = metaEProjecaoMes(1500, 3000, "2026-09-15");
    expect(r.meta).toBe(3000);
    expect(r.atingido).toBe(1500);
    expect(r.faltam).toBe(1500);
    expect(r.percentual).toBe(50);
    expect(r.projecao).toBe(3000);
    expect(r.projecaoPercentual).toBe(100);
    expect(r.faixa).toBe("atras"); // 50% do atingido ainda é "atras" (<70)
  });

  it("meta batida é reconhecida", () => {
    const r = metaEProjecaoMes(3200, 3000, "2026-09-20");
    expect(r.faixa).toBe("batida");
    expect(r.faltam).toBe(0);
  });

  it("sem ganho no mês, não projeta (sem ritmo)", () => {
    const r = metaEProjecaoMes(0, 3000, "2026-09-10");
    expect(r.projecao).toBeNull();
    expect(r.projecaoPercentual).toBeNull();
    expect(r.percentual).toBe(0);
  });
});
