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
  // Consumo de referência do caminho GENÉRICO (sem classe de veículo). A régua
  // pode editá-los como edita os fatores de emissão; classe informada usa
  // sempre o dado por classe (CONSUMO_REFERENCIA), que é mais fiel.
  consumo: {
    dieselKmPerLiter: 4.2,
    electricKwhPerKm: 0.3,
  },
};

// Ponte da régua editável para o conjunto que este motor lê.
//
// A régua ESG do espaço (`reguaEsgEmVigor`) fala o formato plano `tdg-env`
// (electricKgCo2ePerKwh, dieselKgCo2ePerLiter…); este motor lê o formato nested
// (rede_eletrica_kgco2e_por_kwh.valor…). Sem esta tradução, editar o fator de
// emissão na tela não muda o número que vai gravado no relatório do cliente —
// o motor auditável ficava preso aos fatores de fábrica.
//
// Enquanto ninguém edita a régua (`deFabrica`), devolve FATORES_PADRAO como
// está: o resultado é byte-a-byte o de antes desta feature. Havendo régua,
// mescla os fatores conhecidos POR CIMA de uma CÓPIA PROFUNDA dos defaults —
// FATORES_PADRAO não é congelado, então copiar raso corromperia o default do
// módulo para as próximas requisições do mesmo isolate. Só sobrescreve o que
// veio como número positivo válido; nenhum fator fica ausente, então
// `fatorEmUso` nunca lança.
export const conjuntoDaRegua = (regua) => {
  if (!regua || regua.deFabrica) return FATORES_PADRAO;
  const f = regua.fatores && typeof regua.fatores === "object" ? regua.fatores : {};
  const base = JSON.parse(JSON.stringify(FATORES_PADRAO.fatores));
  const aplicar = (chave, valor) => {
    const n = Number(valor);
    if (Number.isFinite(n) && n > 0 && base[chave]) base[chave].valor = n;
  };
  aplicar("rede_eletrica_kgco2e_por_kwh", f.electricKgCo2ePerKwh);
  aplicar("diesel_b14_kgco2e_por_litro", f.dieselKgCo2ePerLiter);
  aplicar("gasolina_e27_kgco2e_por_litro", f.gasolineKgCo2ePerLiter);
  aplicar("arvore_kgco2_ano", f.treeKgCo2eYear);
  // Consumo de referência do caminho genérico também obedece à régua.
  const consumo = { ...FATORES_PADRAO.consumo };
  const consumoDiesel = Number(f.dieselKmPerLiter);
  const consumoEletrico = Number(f.electricKwhPerKm);
  if (Number.isFinite(consumoDiesel) && consumoDiesel > 0) consumo.dieselKmPerLiter = consumoDiesel;
  if (Number.isFinite(consumoEletrico) && consumoEletrico > 0) consumo.electricKwhPerKm = consumoEletrico;
  return {
    versao: regua.versao || FATOR_PADRAO_VERSAO,
    vigenciaInicio: regua.vigenciaInicio || FATORES_PADRAO.vigenciaInicio,
    responsavel: regua.responsavel || FATORES_PADRAO.responsavel,
    fatores: base,
    consumo,
  };
};

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const arredondar = (valor, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

// Núcleo da conta de CO₂ — a fórmula, uma vez só. Devolve tudo SEM arredondar;
// quem chama arredonda no seu próprio limite. Os dois motores (o auditável, aqui,
// e o do simulador em logisticsVerticalDomain) partem daqui, para não existirem
// duas cópias da mesma conta que possam divergir. `eletrico` decide se a
// execução é elétrica (emite pela rede) ou convencional (igual à referência).
export const nucleoImpactoCO2 = ({
  distanciaTotal,
  refKmPorL,
  refKgCO2ePorL,
  evKwhPorKm,
  energiaKwhMedida = null,
  fatorRedeValor,
  eletrico = true,
}) => {
  const referenceLiters = num(distanciaTotal) / Math.max(0.1, num(refKmPorL));
  const referenceKg = referenceLiters * num(refKgCO2ePorL);
  const electricKwh = energiaKwhMedida != null ? num(energiaKwhMedida) : num(distanciaTotal) * num(evKwhPorKm);
  const actualKg = eletrico ? electricKwh * num(fatorRedeValor) : referenceKg;
  const avoidedKg = Math.max(0, referenceKg - actualKg);
  return { referenceLiters, referenceKg, electricKwh, actualKg, avoidedKg };
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
export const resolverFatoresDeClasse = (classeId, conjunto) => {
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
  // Consumo genérico vem da régua (conjunto.consumo), não mais de constantes
  // fixas — assim o mesmo motor respeita o consumo editável. Default 4.2/0.30.
  const consumo = conjunto?.consumo || FATORES_PADRAO.consumo;
  return {
    consumoConvencionalKmPorL: consumo.dieselKmPerLiter ?? 4.2,
    emissaoConvencionalKgCO2ePorL: fatorCO2.valor,
    combustivelConvencional: "diesel_b14",
    consumoEletricoKwhPorKm: consumo.electricKwhPerKm ?? 0.3,
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

  // Energia MEDIDA da operação. N.2 deu lar à energia no ledger de eventos;
  // aqui o motor auditável a PREFERE à energia derivada (distância × consumo por
  // classe). Dado real vale mais que premissa. Ausente ou inválida — a maioria
  // dos casos —, o cálculo segue derivando exatamente como antes.
  const nKwhMedido = Number(entradas.energiaKwhMedida);
  const energiaMedidaKwh =
    entradas.energiaKwhMedida != null &&
    entradas.energiaKwhMedida !== "" &&
    Number.isFinite(nKwhMedido) &&
    nKwhMedido > 0
      ? nKwhMedido
      : null;
  const origemEnergiaMedida =
    QUALIDADE[String(entradas.energiaOrigem || "").toLowerCase()] != null
      ? String(entradas.energiaOrigem).toLowerCase()
      : "medido";

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

  // A conta em si vem do NÚCLEO comum (uma fórmula só, compartilhada com o motor
  // do simulador). `referenceKmPerLiter` sobrepõe o consumo de referência; sem
  // ele, usa o da classe (ou o genérico da régua).
  const refKmPorL = num(entradas.referenceKmPerLiter || fc.consumoConvencionalKmPorL);
  const consumoKwhPorKm = fc.consumoEletricoKwhPorKm ?? conjunto?.consumo?.electricKwhPerKm ?? 0.3;
  const bruto = nucleoImpactoCO2({
    distanciaTotal,
    refKmPorL,
    refKgCO2ePorL: fc.emissaoConvencionalKgCO2ePorL,
    evKwhPorKm: consumoKwhPorKm,
    energiaKwhMedida: eletrico ? energiaMedidaKwh : null,
    fatorRedeValor: fatorRede.valor,
    eletrico,
  });

  const litrosReferencia = bruto.referenceLiters;
  passos.push({
    ordem: passos.length + 1,
    descricao: `Litros de ${fc.combustivelConvencional} que a operação de referência consumiria`,
    formula: "distância total / consumo (km/L)",
    entradas: { distanciaTotal, consumoKmPorL: fc.consumoConvencionalKmPorL },
    resultado: arredondar(litrosReferencia, 2),
    unidade: "L",
    fator: fc.combustivelConvencional,
  });

  const co2Referencia = bruto.referenceKg;
  passos.push({
    ordem: passos.length + 1,
    descricao: "Emissão do cenário de referência",
    formula: "litros x fator de combustão",
    entradas: { litros: arredondar(litrosReferencia, 2), fator: fc.emissaoConvencionalKgCO2ePorL },
    resultado: arredondar(co2Referencia, 2),
    unidade: "kgCO2e",
    fator: `${fc.combustivelConvencional}_kgco2e_por_litro`,
  });

  const co2Executado = bruto.actualKg;
  let energia = null;
  if (eletrico) {
    energia = arredondar(bruto.electricKwh, 2);
    passos.push(
      energiaMedidaKwh != null
        ? {
            ordem: passos.length + 1,
            descricao: "Energia medida da operação executada",
            formula: "energia medida informada (kWh)",
            entradas: { energiaKwhMedida: energia, origem: origemEnergiaMedida },
            resultado: energia,
            unidade: "kWh",
            fator: "energia_medida",
          }
        : {
            ordem: passos.length + 1,
            descricao: "Energia consumida pela operação executada",
            formula: "distância total x consumo (kWh/km)",
            entradas: { distanciaTotal, consumoKwhPorKm },
            resultado: energia,
            unidade: "kWh",
            fator: classeId ? `consumo_eletrico_${classeId}` : "eletrico_kwh_por_km_generico",
          },
    );
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

  // Energia medida entra na qualidade: um cálculo com energia real vale mais
  // que um com energia chutada da distância.
  const origensParaQualidade =
    energiaMedidaKwh != null
      ? { ...(entradas.origens || {}), energia: origemEnergiaMedida }
      : entradas.origens;
  const qualidade = qualidadeDoCalculo(origensParaQualidade);

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
  if (eletrico) {
    premissas.push(
      energiaMedidaKwh != null
        ? `Energia da operação executada MEDIDA (${arredondar(energiaMedidaKwh, 2)} kWh, origem ${origemEnergiaMedida}), não derivada da distância.`
        : "Energia da operação executada DERIVADA da distância × consumo por classe — informe a energia medida para um número mais fiel.",
    );
  }

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
    if (eletrico && energiaMedidaKwh == null && fc.consumoEletricoKwhPorKm != null) {
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
    if (eletrico && energiaMedidaKwh == null) {
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
  if (eletrico && energiaMedidaKwh != null) {
    fatoresUsados.push({
      chave: "energia_medida",
      valor: arredondar(energiaMedidaKwh, 2),
      unidade: "kWh",
      fonte: `Energia medida da operação (origem ${origemEnergiaMedida})`,
      versao: conjunto.versao,
      responsavel: conjunto.responsavel,
    });
  }

  return {
    versaoFatores: conjunto.versao,
    calculadoEm: entradas.calculadoEm || new Date().toISOString(),
    classeVeiculo: classeId,
    // Núcleo SEM arredondar — o motor do simulador consome isto e arredonda no
    // próprio limite (roundMoney), preservando byte a byte o número dele.
    bruto,
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
        energiaKwhMedida: energiaMedidaKwh,
        energiaDerivada: energiaMedidaKwh == null,
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
