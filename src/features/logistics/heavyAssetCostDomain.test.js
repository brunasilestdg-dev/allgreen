import { describe, expect, it } from "vitest";
import {
  custoAtivoPesado,
  custoMotoristaMes,
  referenciaEngineAtivoPesado,
  PREMISSAS_ATIVO_PESADO,
} from "./heavyAssetCostDomain.js";

// A prova real: reproduzir, ao centavo, a aba "Custo Frota" da planilha da
// titular (Precificacao_Middle_Mile_XCMG). Se um número aqui divergir, o
// simulador está mentindo sobre uma proposta de R$1,3 MM.

describe("custo do cavalo elétrico XCMG bate com a planilha da titular", () => {
  it("motorista mensal com encargos, horas extras e reserva = 8.346,70", () => {
    expect(custoMotoristaMes()).toBe(8346.7);
  });

  it("CONJUNTO (cavalo + carreta) reproduz a planilha", () => {
    const c = custoAtivoPesado({}, { incluiCarreta: true });
    expect(c.custoFixoMes).toBe(45463.37);
    expect(c.custoFixoDia).toBe(2066.52);
    expect(c.custoVariavelKm).toBe(2.4562);
    // Componentes que a titular destacou como lacunas da planilha antiga.
    expect(c.detalhamento.depreciacaoCavalo).toBe(17333.33);
    expect(c.detalhamento.custoCapitalMes).toBe(6583.33);
    expect(c.detalhamento.infraMes).toBe(1875);
    expect(c.detalhamento.seguroMes).toBe(5925);
  });

  it("SOLO (cavalo mecânico, cliente fornece carreta) reproduz a planilha", () => {
    const c = custoAtivoPesado({}, { incluiCarreta: false });
    expect(c.custoFixoMes).toBe(40913.37);
    expect(c.custoFixoDia).toBe(1859.7);
    expect(c.custoVariavelKm).toBe(1.6042);
  });

  it("comprar um cavalo mais caro sobe o custo (depreciação + capital + seguro)", () => {
    const base = custoAtivoPesado({}, { incluiCarreta: true }).custoFixoMes;
    const maisCaro = custoAtivoPesado({ valorCavalo: 1600000 }, { incluiCarreta: true }).custoFixoMes;
    expect(maisCaro).toBeGreaterThan(base);
    // +300k no ativo mexe em depreciação, IPVA, seguro e custo de capital.
    expect(maisCaro - base).toBeGreaterThan(6000);
  });

  it("converte para as premissas que o motor de preço lê (motorista à parte)", () => {
    const ref = referenciaEngineAtivoPesado({}, { incluiCarreta: true });
    expect(ref.driverDailyCost).toBe(379.4); // 8.346,70 / 22
    expect(ref.vehicleDailyCost).toBe(1687.12); // 2.066,52 − 379,40
    expect(ref.energyCostPerKm).toBe(1.4175);
    expect(ref.maintenancePerKm).toBe(1.0387); // manutenção 0,54 + pneus 0,4987
  });

  it("as premissas de fábrica são a planilha XCMG", () => {
    expect(PREMISSAS_ATIVO_PESADO.valorCavalo).toBe(1300000);
    expect(PREMISSAS_ATIVO_PESADO.diasUteisMes).toBe(22);
  });
});
