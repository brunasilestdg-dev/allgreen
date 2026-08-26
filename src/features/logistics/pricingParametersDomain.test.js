import { describe, expect, it } from "vitest";
import { centralPricingEngine } from "./logisticsVerticalDomain.js";
import {
  CHAVES_PARAMETROS,
  LIMITE_MARGEM_MAIS_COMISSAO,
  PARAMETROS,
  explicarMudanca,
  resolverParametros,
  simularEfeito,
  validarParametros,
} from "./pricingParametersDomain.js";

const regua = (extra = {}) => ({
  minimumMarginPercent: 18,
  targetMarginPercent: 26,
  opexPercent: 7,
  adminPercent: 4,
  taxPercent: 8.65,
  riskPercent: 3,
  commissionPercent: 2.5,
  // Custo de veículo e motorista são obrigatórios na régua global: sem eles o
  // motor cairia em silêncio nos padrões do código.
  vehicleDailyCost: 430,
  driverDailyCost: 280,
  ...extra,
});

describe("a régua só entra se fizer sentido", () => {
  it("a régua padrão do produto é válida", () => {
    expect(validarParametros(regua()).valido).toBe(true);
  });

  it("cada parâmetro tem rótulo, descrição e faixa", () => {
    for (const chave of CHAVES_PARAMETROS) {
      const d = PARAMETROS[chave];
      expect(d.rotulo).toBeTruthy();
      expect(d.descricao).toBeTruthy();
      expect(d.max).toBeGreaterThan(d.min);
    }
  });

  it("valor faltando ou não numérico é recusado", () => {
    const r = validarParametros({ ...regua(), opexPercent: "abc" });
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatch(/OPEX/);
  });

  it("valor fora da faixa é recusado com a faixa no aviso", () => {
    const r = validarParametros(regua({ commissionPercent: 90 }));
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatch(/Comissão.*entre 0% e 30%/);
  });

  it("margem alvo abaixo da mínima é recusada", () => {
    // Se o recomendado nasce abaixo do piso, toda proposta cai em aprovação e
    // o "recomendado" deixa de recomendar.
    const r = validarParametros(regua({ targetMarginPercent: 10 }));
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatch(/menor que a margem mínima/i);
  });

  it("régua global sem custo de veículo ou de motorista é recusada", () => {
    // Este era o furo: os custos eram opcionais e o motor caía em silêncio nos
    // padrões do código (430/280) — preço calculado sobre custo que ninguém
    // confirmou. Mensal no lugar da diária também satisfaz.
    const semVeiculo = validarParametros(regua({ vehicleDailyCost: 0 }));
    expect(semVeiculo.valido).toBe(false);
    expect(semVeiculo.erros.join(" ")).toMatch(/custo do veículo/i);

    const semMotorista = validarParametros(regua({ driverDailyCost: 0 }));
    expect(semMotorista.valido).toBe(false);
    expect(semMotorista.erros.join(" ")).toMatch(/custo do motorista/i);

    expect(validarParametros(regua({ vehicleDailyCost: 0, vehicleMonthlyCost: 1850 })).valido).toBe(true);
    expect(validarParametros(regua({ driverDailyCost: 0, driverDailyCost8h: 220 })).valido).toBe(true);

    // Escopo parcial (produto, cliente…) herda da global e não repete custos.
    expect(validarParametros({ opexPercent: 10 }, { parcial: true }).valido).toBe(true);
  });
});

describe("a armadilha da fórmula de preço", () => {
  it("margem mais comissão perto de 100% é barrada", () => {
    // preço = custo / max(0.01, 1 − margem − comissão). Chegando a 100%, o
    // divisor trava em 0,01 e o preço vira cem vezes o custo — sem erro,
    // só um número absurdo com cara de cálculo.
    const r = validarParametros(regua({ targetMarginPercent: 88, commissionPercent: 5 }));
    expect(r.valido).toBe(false);
    expect(r.erros.join(" ")).toMatch(/perde o sentido|valor irreal/i);
  });

  it("o limite existe e é bem abaixo de 100", () => {
    expect(LIMITE_MARGEM_MAIS_COMISSAO).toBeLessThan(100);
  });

  it("prova que sem a trava o motor devolveria número irreal", () => {
    // Este teste documenta POR QUE a trava existe: mostra o motor real
    // produzindo o absurdo quando a régua não é validada.
    //
    // Detalhe importante descoberto aqui: a margem alvo definida POR PRODUTO
    // tem precedência sobre a régua global, então o caminho que fura é a
    // comissão — ela vem sempre da régua, e entra direto no divisor.
    const absurda = { ...regua(), commissionPercent: 70 };
    expect(validarParametros(absurda).valido).toBe(false);

    const resultado = centralPricingEngine(
      "middle-mile",
      { distanceKm: 100, tripsPerMonth: 20, vehicleType: "diesel" },
      { assumptions: absurda },
    );
    // Preço recomendado dezenas de vezes acima do custo carregado.
    expect(resultado.recommendedPrice / resultado.loadedCost).toBeGreaterThan(10);
  });

  it("a régua válida produz preço numa proporção sã", () => {
    const r = centralPricingEngine(
      "middle-mile",
      { distanceKm: 100, tripsPerMonth: 20, vehicleType: "diesel" },
      { assumptions: regua() },
    );
    expect(r.recommendedPrice / r.loadedCost).toBeGreaterThan(1);
    expect(r.recommendedPrice / r.loadedCost).toBeLessThan(2);
  });
});

describe("simular antes de valer", () => {
  it("mostra o efeito no preço sobre um custo de referência", () => {
    const s = simularEfeito(regua(), 10000);
    expect(s.custoCarregado).toBeGreaterThan(s.custoDireto);
    expect(s.precoRecomendado).toBeGreaterThan(s.precoMinimo);
  });

  it("subir a margem alvo sobe o preço recomendado", () => {
    const antes = simularEfeito(regua(), 10000);
    const depois = simularEfeito(regua({ targetMarginPercent: 35 }), 10000);
    expect(depois.precoRecomendado).toBeGreaterThan(antes.precoRecomendado);
  });

  it("subir o OPEX sobe o custo carregado e o piso", () => {
    const antes = simularEfeito(regua(), 10000);
    const depois = simularEfeito(regua({ opexPercent: 20 }), 10000);
    expect(depois.custoCarregado).toBeGreaterThan(antes.custoCarregado);
    expect(depois.precoMinimo).toBeGreaterThan(antes.precoMinimo);
  });

  it("régua inválida não simula — não há o que mostrar", () => {
    expect(simularEfeito(regua({ targetMarginPercent: 5 }))).toBeNull();
  });
});

describe("o que mudou de uma régua para a outra", () => {
  it("descreve só o que mudou, em português", () => {
    const texto = explicarMudanca(
      regua({ targetMarginPercent: 30, opexPercent: 9 }),
      regua(),
    );
    expect(texto).toMatch(/Margem alvo: 26% → 30%/);
    expect(texto).toMatch(/OPEX: 7% → 9%/);
    expect(texto).not.toMatch(/Comissão/);
  });

  it("primeira régua diz isso", () => {
    expect(explicarMudanca(regua(), null)).toMatch(/primeira régua/i);
  });

  it("régua igual diz que nada mudou", () => {
    expect(explicarMudanca(regua(), regua())).toMatch(/nenhum parâmetro mudou/i);
  });
});

describe("herança por escopo", () => {
  it("aplica produto sobre global sem perder os demais parâmetros", () => {
    const resolvido = resolverParametros(regua(), [
      { id: "g", versao: "g1", scopeType: "global", scopeKey: "global", status: "active", parametros: { opexPercent: 8 } },
      { id: "p", versao: "spot1", scopeType: "product", scopeKey: "middle-mile-spot", status: "active", parametros: { opexPercent: 4, waitingCostPerHour: 120 } },
    ], { productId: "middle-mile-spot" });
    expect(resolvido.parametros.opexPercent).toBe(4);
    expect(resolvido.parametros.targetMarginPercent).toBe(26);
    expect(resolvido.parametros.waitingCostPerHour).toBe(120);
    expect(resolvido.aplicados.map((item) => item.versao)).toEqual(["g1", "spot1"]);
  });
});
