import { describe, expect, it } from "vitest";
import {
  FATORES_PADRAO,
  QUALIDADE,
  calcularImpactoAmbiental,
  fatorEmUso,
  qualidadeDoCalculo,
  traduzirParaProposta,
} from "./esgEngineDomain.js";

const entradaVan = {
  distanciaKm: 100,
  viagens: 10,
  tipoVeiculo: "Furgão elétrico",
  classeVeiculo: "van",
  origens: { distancia: "medido", ocupacao: "documentado" },
};

const entradaMoto = {
  distanciaKm: 50,
  viagens: 20,
  tipoVeiculo: "Moto elétrica",
  classeVeiculo: "moto",
  origens: { distancia: "medido", ocupacao: "medido" },
};

const entradaSemClasse = {
  distanciaKm: 100,
  viagens: 10,
  tipoVeiculo: "Furgão elétrico",
  origens: { distancia: "medido", ocupacao: "documentado" },
};

describe("o cálculo se refaz", () => {
  it("a mesma entrada dá o mesmo resultado", () => {
    const a = calcularImpactoAmbiental({ ...entradaVan, calculadoEm: "2026-01-01" });
    const b = calcularImpactoAmbiental({ ...entradaVan, calculadoEm: "2026-01-01" });
    expect(a).toEqual(b);
  });

  it("a memória traz os passos na ordem, com fórmula e entradas", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.memoria.passos.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < r.memoria.passos.length; i++) {
      expect(r.memoria.passos[i].ordem).toBe(i + 1);
      expect(r.memoria.passos[i].formula).toBeTruthy();
      expect(r.memoria.passos[i].descricao).toBeTruthy();
    }
  });

  it("dá para recalcular o CO2 evitado só com a memória", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    const passos = Object.fromEntries(r.memoria.passos.map((p) => [p.descricao, p]));
    const referencia = passos["Emissão do cenário de referência"].resultado;
    const executada = passos["Emissão da operação executada"].resultado;
    expect(Math.round(referencia - executada)).toBe(Math.round(r.impacto.co2AvoidedKg));
  });

  it("o resultado carrega a versão dos fatores", () => {
    expect(calcularImpactoAmbiental(entradaVan).versaoFatores).toBe(FATORES_PADRAO.versao);
  });
});

describe("dados reais por classe de veículo", () => {
  it("moto elétrica contra moto a gasolina — consumo muito menor que van", () => {
    const moto = calcularImpactoAmbiental(entradaMoto);
    const van = calcularImpactoAmbiental(entradaVan);
    expect(moto.classeVeiculo).toBe("moto");
    expect(van.classeVeiculo).toBe("van");
    expect(moto.impacto.energiaKwh).toBeLessThan(van.impacto.energiaKwh);
    expect(moto.memoria.premissas.some((p) => /Moto/i.test(p))).toBe(true);
    expect(moto.memoria.premissas.some((p) => /gasolina/i.test(p))).toBe(true);
  });

  it("van usa diesel como referência, moto usa gasolina", () => {
    const moto = calcularImpactoAmbiental(entradaMoto);
    const van = calcularImpactoAmbiental(entradaVan);
    const motoFuel = moto.memoria.passos.find((p) => /referência consumiria/.test(p.descricao));
    const vanFuel = van.memoria.passos.find((p) => /referência consumiria/.test(p.descricao));
    expect(motoFuel.descricao).toMatch(/gasolina/);
    expect(vanFuel.descricao).toMatch(/diesel/);
  });

  it("a memória registra fatores por classe com fonte documentada", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.memoria.fatoresUsados.length).toBeGreaterThan(0);
    for (const fator of r.memoria.fatoresUsados) {
      expect(fator.fonte).toBeTruthy();
      expect(fator.versao).toBe(FATORES_PADRAO.versao);
      expect(fator.responsavel).toBeTruthy();
    }
    const eletrico = r.memoria.fatoresUsados.find((f) => /eletrico_van/.test(f.chave));
    expect(eletrico).toBeTruthy();
    expect(eletrico.valor).toBe(0.30);
  });

  it("moto elétrica: 0.04 kWh/km, 50 km x 20 viagens = 40 kWh", () => {
    const r = calcularImpactoAmbiental(entradaMoto);
    expect(r.impacto.energiaKwh).toBe(40);
  });

  it("van elétrica: 0.30 kWh/km, 100 km x 10 viagens = 300 kWh", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.impacto.energiaKwh).toBe(300);
  });

  it("cada classe que tem consumo elétrico produz resultado diferente", () => {
    const classes = ["moto", "utilitario", "van", "vuc", "tres_quartos"];
    const resultados = classes.map((c) =>
      calcularImpactoAmbiental({
        distanciaKm: 100,
        viagens: 1,
        tipoVeiculo: "eletrico",
        classeVeiculo: c,
      }).impacto.energiaKwh,
    );
    const unicos = new Set(resultados);
    expect(unicos.size).toBe(classes.length);
    expect(resultados[0]).toBeLessThan(resultados[4]);
  });

  it("carreta diesel: sem redução e sem classe elétrica", () => {
    const r = calcularImpactoAmbiental({
      distanciaKm: 500,
      viagens: 1,
      tipoVeiculo: "diesel",
      classeVeiculo: "carreta",
    });
    expect(r.impacto.co2AvoidedKg).toBe(0);
    expect(r.classeVeiculo).toBe("carreta");
    expect(r.memoria.premissas.some((p) => /convencional/.test(p))).toBe(true);
  });
});

describe("sem classe: funciona com médias genéricas", () => {
  it("calcula com fallback genérico quando classeVeiculo é ausente", () => {
    const r = calcularImpactoAmbiental(entradaSemClasse);
    expect(r.classeVeiculo).toBeNull();
    expect(r.impacto.co2AvoidedKg).toBeGreaterThan(0);
    expect(r.memoria.premissas.some((p) => /genéric/i.test(p))).toBe(true);
    expect(r.memoria.premissas.some((p) => /informe a classe/i.test(p))).toBe(true);
  });

  it("a qualidade reflete a origem do dado, não a presença da classe", () => {
    const comClasse = calcularImpactoAmbiental(entradaVan);
    const semClasse = calcularImpactoAmbiental(entradaSemClasse);
    expect(semClasse.qualidadeDados).toBe(comClasse.qualidadeDados);
  });
});

describe("mudar fator não reescreve o passado", () => {
  it("uma versão nova produz outro número, e o número diz de qual versão veio", () => {
    const versaoNova = {
      ...FATORES_PADRAO,
      versao: "2027.1",
      fatores: {
        ...FATORES_PADRAO.fatores,
        rede_eletrica_kgco2e_por_kwh: {
          ...FATORES_PADRAO.fatores.rede_eletrica_kgco2e_por_kwh,
          valor: 0.08,
        },
      },
    };
    const antigo = calcularImpactoAmbiental(entradaVan);
    const novo = calcularImpactoAmbiental(entradaVan, versaoNova);
    expect(novo.impacto.co2AvoidedKg).not.toBe(antigo.impacto.co2AvoidedKg);
    expect(antigo.versaoFatores).toBe(FATORES_PADRAO.versao);
    expect(novo.versaoFatores).toBe("2027.1");
  });

  it("fator ausente é erro, não silêncio", () => {
    expect(() => fatorEmUso({ fatores: {} }, "diesel_b14_kgco2e_por_litro")).toThrow(/ausente/i);
  });
});

describe("o número diz o que ele não é", () => {
  it("a ressalva acompanha todo cálculo", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.memoria.ressalva).toMatch(/não constitui certificação/i);
  });

  it("as premissas ficam explícitas e citam a fonte", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.memoria.premissas.some((p) => /referência/i.test(p))).toBe(true);
    expect(r.memoria.premissas.some((p) => /SIN|rede/i.test(p))).toBe(true);
    expect(r.memoria.premissas.some((p) => /Sprinter|fonte/i.test(p))).toBe(true);
  });

  it("a equivalência em árvores é ilustrativa, não compensação", () => {
    const t = traduzirParaProposta(calcularImpactoAmbiental(entradaVan));
    expect(t.equivalencias[0].ressalva).toMatch(/não compensação/i);
  });
});

describe("qualidade do dado", () => {
  it("medido vale mais que presumido", () => {
    expect(qualidadeDoCalculo({ a: "medido" })).toBe(QUALIDADE.medido);
    expect(qualidadeDoCalculo({ a: "presumido" })).toBe(QUALIDADE.presumido);
  });

  it("sem informar origem, assume o pior — não o melhor", () => {
    expect(qualidadeDoCalculo({})).toBe(QUALIDADE.presumido);
    expect(qualidadeDoCalculo()).toBe(QUALIDADE.presumido);
  });

  it("a qualidade entra no resultado", () => {
    const r = calcularImpactoAmbiental(entradaVan);
    expect(r.qualidadeDados).toBe(Math.round((QUALIDADE.medido + QUALIDADE.documentado) / 2));
  });
});

describe("operação diesel", () => {
  it("não inventa redução sobre a própria referência", () => {
    const r = calcularImpactoAmbiental({ ...entradaVan, tipoVeiculo: "Caminhão diesel" });
    expect(r.impacto.co2AvoidedKg).toBe(0);
    expect(r.impacto.reductionPercent).toBe(0);
    expect(r.impacto.dieselAvoidedLiters).toBe(0);
  });

  it("o texto da proposta também não promete o que não houve", () => {
    const t = traduzirParaProposta(
      calcularImpactoAmbiental({ ...entradaVan, tipoVeiculo: "diesel" }),
    );
    expect(t.texto).toMatch(/não apresentou redução/i);
    expect(t.equivalencias).toEqual([]);
  });
});

describe("entrada inválida", () => {
  it("sem distância, o cálculo recusa em vez de devolver zero", () => {
    expect(() => calcularImpactoAmbiental({ distanciaKm: 0 })).toThrow(/distância/i);
    expect(() => calcularImpactoAmbiental({})).toThrow(/distância/i);
  });

  it("viagem ausente conta como uma", () => {
    const r = calcularImpactoAmbiental({ distanciaKm: 100, tipoVeiculo: "eletrico" });
    expect(r.memoria.entradas.viagens).toBe(1);
    expect(r.memoria.entradas.distanciaTotal).toBe(100);
  });
});
