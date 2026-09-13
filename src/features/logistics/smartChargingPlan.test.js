import { describe, expect, it } from "vitest";
import { curvaTarifaria, planoDeRecargaPorVeiculo } from "./smartChargingDomain.js";

const tarifa = curvaTarifaria(0.6); // ponta 18–20 (1,08), intermediário 17/21 (0,78), fora 0,60
const PONTO = { id: "p1", nome: "Carregador 1", potenciaKw: 50, tipoCorrente: "DC", conector: "CCS2", status: "ativo" };

describe("planoDeRecargaPorVeiculo", () => {
  it("dois veículos num ponto: saída mais cedo/mais energia primeiro, horas mais baratas, sessões contíguas", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [
        { id: "b", prefixo: "TG-2", energiaNecessariaKwh: 75, conector: "CCS2", saidaHora: 6 },
        { id: "a", prefixo: "TG-1", energiaNecessariaKwh: 100, conector: "CCS2", saidaHora: 6 },
      ],
      pontos: [PONTO],
      curvaTarifa: tarifa,
      horaInicio: 18,
    });
    expect(plano.veiculos.map((v) => v.id)).toEqual(["a", "b"]);
    const [a, b] = plano.veiculos;
    expect(a).toMatchObject({ completo: true, alocadaKwh: 100, faltanteKwh: 0, custo: 60, custoMedioKwh: 0.6 });
    expect(a.sessoes).toEqual([{ pontoId: "p1", pontoNome: "Carregador 1", inicio: "22:00", fim: "00:00", horas: 2, potenciaKw: 50, kwh: 100, custo: 60 }]);
    expect(b).toMatchObject({ completo: true, alocadaKwh: 75, custo: 45 });
    expect(b.sessoes).toEqual([{ pontoId: "p1", pontoNome: "Carregador 1", inicio: "00:00", fim: "01:30", horas: 1.5, potenciaKw: 50, kwh: 75, custo: 45 }]);
    expect(plano.totais).toMatchObject({ veiculos: 2, completos: 2, energiaKwh: 175, alocadaKwh: 175, custo: 105, custoSeNaPonta: 189, economia: 84, picoKw: 50, pontosAtivos: 1 });
    expect(plano.avisos).toEqual([]);
    expect(plano.assumptions).toContain("disponibilidade_12h_antes_da_saida");
    expect(plano.cargaPorHora).toHaveLength(24);
    expect(plano.cargaPorHora.find((s) => s.hora === 22)).toMatchObject({ kw: 50, veiculos: 1, tarifa: 0.6 });
  });

  it("respeita a demanda contratada: reduz potência e avisa", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [
        { id: "a", energiaNecessariaKwh: 50, saidaHora: 6 },
        { id: "b", energiaNecessariaKwh: 50, saidaHora: 6 },
      ],
      pontos: [PONTO, { ...PONTO, id: "p2", nome: "Carregador 2" }],
      curvaTarifa: tarifa,
      demandaContratadaKw: 60,
      horaInicio: 20,
    });
    expect(plano.totais.picoKw).toBeLessThanOrEqual(60);
    expect(plano.avisos).toContain("DEMANDA_LIMITANTE");
    expect(plano.totais.completos).toBe(2);
    expect(plano.veiculos.find((v) => v.id === "b").motivo).toContain("demanda contratada");
  });

  it("conector incompatível não é alocado e diz por quê", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [{ id: "c", energiaNecessariaKwh: 40, conector: "CHAdeMO", saidaHora: 6 }],
      pontos: [PONTO],
      curvaTarifa: tarifa,
      horaInicio: 20,
    });
    expect(plano.veiculos[0]).toMatchObject({ completo: false, alocadaKwh: 0, faltanteKwh: 40, sessoes: [] });
    expect(plano.veiculos[0].motivo).toContain("CHADEMO");
    expect(plano.avisos).toContain("VEICULOS_INCOMPLETOS");
  });

  it("sem pontos ativos ninguém recarrega; veículo sem energia informada fica fora do plano com motivo", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [{ id: "a", energiaNecessariaKwh: 40 }, { id: "z", energiaNecessariaKwh: 0 }],
      pontos: [{ ...PONTO, status: "manutencao" }],
      curvaTarifa: tarifa,
    });
    expect(plano.avisos).toEqual(["SEM_PONTOS_ATIVOS", "VEICULOS_INCOMPLETOS"]);
    expect(plano.veiculos[0].motivo).toContain("sem ponto de recarga ativo");
    expect(plano.naoPlanejados).toEqual([{ id: "z", rotulo: "z", motivo: expect.stringContaining("sem energia") }]);
  });

  it("retorno→saída informados limitam as horas; potência do veículo limita o slot", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [{ id: "a", energiaNecessariaKwh: 60, maxChargingPowerKw: 20, saidaHora: 6, chegadaHora: 22 }],
      pontos: [PONTO],
      curvaTarifa: tarifa,
      horaInicio: 18,
    });
    const v = plano.veiculos[0];
    expect(v.completo).toBe(true);
    expect(v.sessoes).toEqual([{ pontoId: "p1", pontoNome: "Carregador 1", inicio: "22:00", fim: "01:00", horas: 3, potenciaKw: 20, kwh: 60, custo: 36 }]);
    expect(plano.assumptions).not.toContain("disponibilidade_12h_antes_da_saida");
  });

  it("horas insuficientes antes da saída: parcial, honesto", () => {
    const plano = planoDeRecargaPorVeiculo({
      veiculos: [{ id: "a", energiaNecessariaKwh: 300, saidaHora: 6 }],
      pontos: [PONTO],
      curvaTarifa: tarifa,
      horaInicio: 3,
    });
    const v = plano.veiculos[0];
    expect(v).toMatchObject({ completo: false, alocadaKwh: 150, faltanteKwh: 150 });
    expect(v.motivo).toContain("disponibilidade insuficiente");
  });

  it("sem tarifa planeja mesmo assim, sem custo e com aviso", () => {
    const plano = planoDeRecargaPorVeiculo({ veiculos: [{ id: "a", energiaNecessariaKwh: 50, saidaHora: 6 }], pontos: [PONTO], curvaTarifa: [], horaInicio: 20 });
    expect(plano.veiculos[0]).toMatchObject({ completo: true, custo: null, custoMedioKwh: null });
    expect(plano.totais.custo).toBeNull();
    expect(plano.avisos).toContain("TARIFA_INDISPONIVEL");
  });

  it("é determinístico", () => {
    const entrada = { veiculos: [{ id: "a", energiaNecessariaKwh: 80, saidaHora: 7 }, { id: "b", energiaNecessariaKwh: 30, saidaHora: 5 }], pontos: [PONTO], curvaTarifa: tarifa, horaInicio: 19 };
    expect(JSON.stringify(planoDeRecargaPorVeiculo(entrada))).toBe(JSON.stringify(planoDeRecargaPorVeiculo(entrada)));
    expect(planoDeRecargaPorVeiculo(entrada).veiculos.map((v) => v.id)).toEqual(["b", "a"]);
  });
});
