// ===== Motor ambiental auditável =====
// Camada pura.
//
// O que separa um número ambiental que serve de um que não serve não é a
// fórmula — é conseguir refazer o cálculo daqui a dois anos, com o mesmo
// resultado, sabendo qual fator foi usado, de onde ele veio, quem respondeu
// por ele e o que era premissa em vez de medição.
//
// Por isso todo cálculo daqui devolve, junto do resultado, a memória: entradas,
// fatores com fonte e versão, passos na ordem em que aconteceram, e o que foi
// assumido. Sem isso, o relatório é opinião com casas decimais.

// Fatores de emissão. Cada um carrega fonte, unidade, vigência e responsável.
// Mudar um fator nunca reescreve o passado: entra uma versão nova.
export const FATOR_PADRAO_VERSAO = "2026.2";

import { consumoReferencia, vehicleClass } from "./vehicleClassDomain.js";

export const FATORES_PADRAO = {
  versao: FATOR_PADRAO_VERSAO,
  vigenciaInicio: "2026-01-01",
  responsavel: "Sustentabilidade To Do Green",
  fatores: {
    diesel_b14_kgco2e_por_litro: {
      valor: 2.68,
      unidade: "kgCO2e/L",
      fonte: "Fator de combustão de diesel B14 — inventário nacional GHG Protocol Brasil",
      tipo: "combustao",
    },
    gasolina_e27_kgco2e_por_litro: {
      valor: 2.12,
      unidade: "kgCO2e/L",
      fonte: "Fator de combustão de gasolina E27 — GHG Protocol Brasil (fração fóssil + upstream)",
      tipo: "combustao",
    },
    rede_eletrica_kgco2e_por_kwh: {
      valor: 0.0385,
      unidade: "kgCO2e/kWh",
      fonte: "Fator médio anual do SIN 2023 — MCTI (0,0385 tCO2/MWh)",
      tipo: "eletricidade",
    },
    arvore_kgco2_ano: {
      valor: 22,
      unidade: "kgCO2/ano",
      fonte: "Equivalência ilustrativa de sequestro por árvore adulta",
      tipo: "equivalencia",
    },
  },
};

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const arredondar = (valor, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

export const fatorEmUso = (conjunto, chave) => {
  const fator = conjunto?.fatores?.[chave];
  if (!fator) throw new Error(`Fator ambiental ausente: ${chave}`);
  return fator;
};

// Qualidade do dado. Um cálculo feito com distância estimada e ocupação
// chutada não vale o mesmo que um feito com telemetria — e quem lê o relatório
// precisa saber disso antes de assinar embaixo.
export const QUALIDADE = {
  medido: 100,
  documentado: 85,
  estimado: 60,
  presumido: 35,
};

export const qualidadeDoCalculo = (origens = {}) => {
  const valores = Object.values(origens)
    .map((origem) => QUALIDADE[origem])
    .filter((v) => Number.isFinite(v));
  if (!valores.length) return QUALIDADE.presumido;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
};

// Resolve os fatores de consumo e emissão para a classe do veículo. Quando a
// classe é informada, usa os dados reais de CONSUMO_REFERENCIA — que variam de
// 0.04 kWh/km (moto) a null (carreta, que não tem versão elétrica). Quando a
// classe não é informada, usa médias genéricas com qualidade menor.
const resolverFatoresDeClasse = (classeId, conjunto) => {
  const ref = classeId ? consumoReferencia(classeId) : null;
  const classe = classeId ? vehicleClass(classeId) : null;

  if (ref) {
    return {
      consumoConvencionalKmPorL: ref.convencionalKmPorL,
      emissaoConvencionalKgCO2ePorL: ref.convencionalKgCO2ePorL,
      combustivelConvencional: ref.convencionalCombustivel,
      consumoEletricoKwhPorKm: ref.eletricoKwhPorKm,
      fonteConvencional: ref.fonteConvencional,
      fonteEletrico: ref.fonteEletrico,
      nomeClasse: classe?.name || classeId,
      porClasse: true,
    };
  }

  const fatorCO2 = fatorEmUso(conjunto, "diesel_b14_kgco2e_por_litro");
  return {
    consumoConvencionalKmPorL: 4.2,
    emissaoConvencionalKgCO2ePorL: fatorCO2.valor,
    combustivelConvencional: "diesel_b14",
    consumoEletricoKwhPorKm: 0.30,
    fonteConvencional: "Média genérica de frota diesel de carga urbana",
    fonteEletrico: "Média genérica de veículo elétrico de carga leve (van)",
    nomeClasse: null,
    porClasse: false,
  };
};

// O cálculo. Compara o cenário executado com um cenário de referência (o que
// teria acontecido com frota convencional) e devolve a diferença.
//
// A referência é premissa, não medição — e o resultado diz isso em voz alta.
//
// Quando `classeVeiculo` é informada, os fatores de consumo vêm de
// CONSUMO_REFERENCIA por classe, e a comparação é justa: moto elétrica contra
// moto a gasolina, van elétrica contra van diesel. Sem a classe, usa médias
// genéricas e o relatório diz que a qualidade é menor.
export const calcularImpactoAmbiental = (entradas = {}, conjunto = FATORES_PADRAO) => {
  const distanciaKm = num(entradas.distanciaKm);
  const viagens = Math.max(1, num(entradas.viagens) || 1);
  const distanciaTotal = distanciaKm * viagens;

  if (distanciaTotal <= 0)
    throw new Error("Informe a distância para calcular o impacto ambiental.");

  const tipoVeiculo = String(entradas.tipoVeiculo || "eletrico").toLowerCase();
  const eletrico = /eletric|elétric|ev\b/.test(tipoVeiculo);
  const classeId = String(entradas.classeVeiculo || "").toLowerCase().trim() || null;

  const fc = resolverFatoresDeClasse(classeId, conjunto);
  const fatorRede = fatorEmUso(conjunto, "rede_eletrica_kgco2e_por_kwh");

  const passos = [];

  if (classeId && fc.porClasse) {
    passos.push({
      ordem: 1,
      descricao: `Fatores de referência para ${fc.nomeClasse}`,
      formula: "dados de CONSUMO_REFERENCIA por classe",
      entradas: {
        classe: classeId,
        consumoConvencional: `${fc.consumoConvencionalKmPorL} km/L (${fc.combustivelConvencional})`,
        consumoEletrico: fc.consumoEletricoKwhPorKm != null
          ? `${fc.consumoEletricoKwhPorKm} kWh/km`
          : "não disponível para esta classe",
      },
      resultado: null,
      unidade: null,
      fator: null,
    });
  }

  const litrosReferencia = distanciaTotal / fc.consumoConvencionalKmPorL;
  passos.push({
    ordem: passos.length + 1,
    descricao: `Litros de ${fc.combustivelConvencional} que a operação de referência consumiria`,
    formula: "distância total / consumo (km/L)",
    entradas: { distanciaTotal, consumoKmPorL: fc.consumoConvencionalKmPorL },
    resultado: arredondar(litrosReferencia, 2),
    unidade: "L",
    fator: fc.combustivelConvencional,
  });

  const co2Referencia = litrosReferencia * fc.emissaoConvencionalKgCO2ePorL;
  passos.push({
    ordem: passos.length + 1,
    descricao: "Emissão do cenário de referência",
    formula: "litros x fator de combustão",
    entradas: { litros: arredondar(litrosReferencia, 2), fator: fc.emissaoConvencionalKgCO2ePorL },
    resultado: arredondar(co2Referencia, 2),
    unidade: "kgCO2e",
    fator: `${fc.combustivelConvencional}_kgco2e_por_litro`,
  });

  let co2Executado;
  let energia = null;
  if (eletrico) {
    const consumoKwhPorKm = fc.consumoEletricoKwhPorKm ?? 0.30;
    const kwh = distanciaTotal * consumoKwhPorKm;
    co2Executado = kwh * fatorRede.valor;
    energia = arredondar(kwh, 2);
    passos.push({
      ordem: passos.length + 1,
      descricao: "Energia consumida pela operação executada",
      formula: "distância total x consumo (kWh/km)",
      entradas: { distanciaTotal, consumoKwhPorKm },
      resultado: energia,
      unidade: "kWh",
      fator: classeId ? `consumo_eletrico_${classeId}` : "eletrico_kwh_por_km_generico",
    });
    passos.push({
      ordem: passos.length + 1,
      descricao: "Emissão da operação executada",
      formula: "energia x fator da rede elétrica",
      entradas: { kwh: energia, fator: fatorRede.valor },
      resultado: arredondar(co2Executado, 2),
      unidade: "kgCO2e",
      fator: "rede_eletrica_kgco2e_por_kwh",
    });
  } else {
    co2Executado = co2Referencia;
    passos.push({
      ordem: passos.length + 1,
      descricao: "Operação executada com convencional: igual à referência",
      formula: "emissão de referência",
      entradas: {},
      resultado: arredondar(co2Executado, 2),
      unidade: "kgCO2e",
      fator: `${fc.combustivelConvencional}_kgco2e_por_litro`,
    });
  }

  const evitadoKg = Math.max(0, co2Referencia - co2Executado);
  const reducaoPercent = co2Referencia > 0 ? (evitadoKg / co2Referencia) * 100 : 0;
  const litrosEvitados = eletrico ? litrosReferencia : 0;

  passos.push({
    ordem: passos.length + 1,
    descricao: "CO2 evitado",
    formula: "emissão de referência - emissão executada",
    entradas: {
      referencia: arredondar(co2Referencia, 2),
      executada: arredondar(co2Executado, 2),
    },
    resultado: arredondar(evitadoKg, 2),
    unidade: "kgCO2e",
    fator: null,
  });

  const qualidade = qualidadeDoCalculo(entradas.origens);

  const premissas = [
    "O cenário de referência assume a mesma operação executada por frota diesel/gasolina convencional.",
  ];
  if (fc.porClasse) {
    premissas.push(
      `Referência: ${fc.nomeClasse} a ${fc.combustivelConvencional}, ${fc.consumoConvencionalKmPorL} km/L.`,
    );
    premissas.push(`Fonte do consumo convencional: ${fc.fonteConvencional}.`);
    if (eletrico && fc.fonteEletrico) {
      premissas.push(`Fonte do consumo elétrico: ${fc.fonteEletrico}.`);
    }
  } else {
    premissas.push(
      `Consumo de referência genérico (diesel urbano): ${fc.consumoConvencionalKmPorL} km/L — informe a classe do veículo para usar dados específicos.`,
    );
  }
  premissas.push(
    eletrico
      ? "A emissão da eletricidade usa o fator médio anual do SIN (MCTI), não contrato de energia renovável específico."
      : "A operação executada é diesel; não há redução sobre a própria referência.",
  );

  const fatoresUsados = [];
  if (fc.porClasse) {
    fatoresUsados.push({
      chave: `consumo_convencional_${classeId}`,
      valor: fc.consumoConvencionalKmPorL,
      unidade: "km/L",
      fonte: fc.fonteConvencional,
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
    if (eletrico && fc.consumoEletricoKwhPorKm != null) {
      fatoresUsados.push({
        chave: `consumo_eletrico_${classeId}`,
        valor: fc.consumoEletricoKwhPorKm,
        unidade: "kWh/km",
        fonte: fc.fonteEletrico,
        versao: conjunto.versao,
        responsavel: conjunto.responsavel,
      });
    }
    fatoresUsados.push({
      chave: `emissao_${fc.combustivelConvencional}`,
      valor: fc.emissaoConvencionalKgCO2ePorL,
      unidade: "kgCO2e/L",
      fonte: `Fator de combustão de ${fc.combustivelConvencional}`,
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
  } else {
    fatoresUsados.push({
      chave: "consumo_convencional_generico",
      valor: fc.consumoConvencionalKmPorL,
      unidade: "km/L",
      fonte: fc.fonteConvencional,
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
    fatoresUsados.push({
      chave: "emissao_diesel_b14",
      valor: fc.emissaoConvencionalKgCO2ePorL,
      unidade: "kgCO2e/L",
      fonte: "Fator de combustão de diesel B14 — inventário nacional GHG Protocol Brasil",
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
    if (eletrico) {
      fatoresUsados.push({
        chave: "consumo_eletrico_generico",
        valor: fc.consumoEletricoKwhPorKm,
        unidade: "kWh/km",
        fonte: fc.fonteEletrico,
        versao: conjunto.versao,
        responsavel: conjunto.responsavel,
      });
    }
  }
  if (eletrico) {
    fatoresUsados.push({
      chave: "rede_eletrica_kgco2e_por_kwh",
      ...fatorRede,
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
  }

  return {
    versaoFatores: conjunto.versao,
    calculadoEm: entradas.calculadoEm || new Date().toISOString(),
    classeVeiculo: classeId,
    impacto: {
      co2ReferenciaKg: arredondar(co2Referencia, 2),
      co2ExecutadoKg: arredondar(co2Executado, 2),
      co2AvoidedKg: arredondar(evitadoKg, 2),
      reductionPercent: arredondar(reducaoPercent, 1),
      dieselAvoidedLiters: arredondar(litrosEvitados, 2),
      energiaKwh: energia,
    },
    qualidadeDados: qualidade,
    memoria: {
      entradas: {
        distanciaKm,
        viagens,
        distanciaTotal: arredondar(distanciaTotal, 2),
        tipoVeiculo,
        classeVeiculo: classeId,
      },
      fatoresUsados,
      passos,
      premissas,
      ressalva:
        "Estimativa própria da To Do Green, reproduzível pela memória de cálculo acima. Não constitui certificação, verificação por terceira parte nem inventário auditado.",
    },
  };
};

// Tradutor ESG: transforma o número em texto que vai para proposta e relatório,
// sem prometer mais do que o cálculo sustenta.
export const traduzirParaProposta = (resultado, conjunto = FATORES_PADRAO) => {
  const kg = num(resultado?.impacto?.co2AvoidedKg);
  const arvore = fatorEmUso(conjunto, "arvore_kgco2_ano");
  const toneladas = kg / 1000;
  return {
    titulo: `${arredondar(toneladas, 2)} t de CO2e evitadas`,
    texto:
      kg > 0
        ? `A operação evitou aproximadamente ${arredondar(toneladas, 2)} toneladas de CO2e em relação ao cenário de referência com frota diesel, uma redução de ${resultado.impacto.reductionPercent}%.`
        : "A operação executada não apresentou redução sobre o cenário de referência.",
    equivalencias:
      kg > 0
        ? [
            {
              rotulo: "árvores em um ano",
              valor: Math.round(kg / arvore.valor),
              ressalva: "Equivalência ilustrativa, não compensação.",
            },
          ]
        : [],
    qualidadeDados: resultado?.qualidadeDados ?? 0,
    versaoFatores: resultado?.versaoFatores,
    ressalva: resultado?.memoria?.ressalva,
  };
};
