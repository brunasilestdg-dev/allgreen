import { describe, expect, it } from "vitest";
import {
  TARIFA_BRANCA_PADRAO,
  avaliarDemanda,
  curvaTarifaria,
  economiaRecarga,
  faixaHoraria,
  horasParaRecarregar,
  janelaForaPonta,
  planoRecargaInteligente,
  tarifaNaHora,
} from "./smartChargingDomain.js";

describe("faixas horárias da tarifa branca", () => {
  it("classifica ponta, intermediário e fora de ponta", () => {
    expect(faixaHoraria(19)).toBe("ponta"); // 18-20
    expect(faixaHoraria(17)).toBe("intermediario");
    expect(faixaHoraria(21)).toBe("intermediario");
    expect(faixaHoraria(3)).toBe("fora-ponta");
    expect(faixaHoraria(23)).toBe("fora-ponta");
  });

  it("hora fora do intervalo normaliza (24 vira 0, negativa envolve)", () => {
    expect(faixaHoraria(24)).toBe(faixaHoraria(0));
    expect(faixaHoraria(-1)).toBe(faixaHoraria(23));
  });
});

describe("tarifa por hora e curva", () => {
  it("aplica o fator da faixa sobre a base", () => {
    expect(tarifaNaHora(1, 19)).toBe(1.8); // ponta
    expect(tarifaNaHora(1, 3)).toBe(1); // fora de ponta
    expect(tarifaNaHora(1, 17)).toBe(1.3); // intermediário
  });

  it("a curva tem 24 horas e a mais cara é na ponta", () => {
    const curva = curvaTarifaria(0.92);
    expect(curva).toHaveLength(24);
    const maisCara = curva.reduce((a, b) => (b.tarifa > a.tarifa ? b : a));
    expect(maisCara.faixa).toBe("ponta");
  });
});

describe("janela fora de ponta", () => {
  it("é o maior bloco contíguo, cruzando a meia-noite", () => {
    const j = janelaForaPonta();
    // Com ponta 18-20 e intermediário 17,21: fora de ponta é 22,23,0..16 = 19h,
    // começando às 22h e terminando às 17h.
    expect(j.inicio).toBe(22);
    expect(j.horas).toBe(19);
    expect(j.fim).toBe(17);
  });
});

describe("horas de recarga e economia", () => {
  it("horas = energia ÷ potência; sem potência, indisponível", () => {
    expect(horasParaRecarregar(300, 150)).toBe(2);
    expect(horasParaRecarregar(300, 0)).toBeNull();
  });

  it("economiza a diferença ponta × fora de ponta", () => {
    // base 1, energia 100: ponta 180, fora de ponta 100 → economia 80 (44,4%).
    const e = economiaRecarga(100, 1);
    expect(e.custoPonta).toBe(180);
    expect(e.custoForaPonta).toBe(100);
    expect(e.economia).toBe(80);
    expect(e.economiaPercent).toBe(44.4);
    expect(e.porKwh).toBe(0.8);
  });
});

describe("demanda contratada (peak shaving)", () => {
  it("sem demanda informada, é honesto", () => {
    const d = avaliarDemanda(200, 0);
    expect(d.informada).toBe(false);
  });

  it("acusa quando a potência instalada excede o contrato", () => {
    const d = avaliarDemanda(300, 200);
    expect(d.excede).toBe(true);
    expect(d.folgaKw).toBe(-100);
    // Só 2/3 da rede pode puxar ao mesmo tempo sem estourar 200 kW.
    expect(d.fracaoSimultanea).toBe(0.67);
  });

  it("dentro do contrato, não excede", () => {
    const d = avaliarDemanda(150, 200);
    expect(d.excede).toBe(false);
    expect(d.folgaKw).toBe(50);
    expect(d.fracaoSimultanea).toBe(1);
  });
});

describe("plano completo", () => {
  it("sem potência instalada, a recarga inteligente é indisponível", () => {
    const p = planoRecargaInteligente({ energiaKwh: 500, potenciaKw: 0, base: 0.92 });
    expect(p.disponivel).toBe(false);
    expect(p.aviso).toMatch(/potência/i);
  });

  it("com potência, entrega janela, horas, economia e demanda", () => {
    const p = planoRecargaInteligente({
      energiaKwh: 600,
      potenciaKw: 150,
      base: 0.92,
      demandaContratadaKw: 100,
    });
    expect(p.disponivel).toBe(true);
    expect(p.horasParaRecarregar).toBe(4);
    expect(p.janela.inicio).toBe(22);
    expect(p.economia.economiaPercent).toBe(44.4);
    expect(p.demanda.excede).toBe(true); // 150 instalada > 100 contratada
    expect(p.curva).toHaveLength(24);
  });

  it("usa a régua padrão exportada", () => {
    expect(TARIFA_BRANCA_PADRAO.fatorPonta).toBeGreaterThan(TARIFA_BRANCA_PADRAO.fatorForaPonta);
  });
});
