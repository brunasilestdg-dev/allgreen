// ===== Recarga inteligente (bloco 06 Energy · bloco 05 Charging/GreenOn) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A energia mais barata é a que se recarrega na hora certa. A tarifa de energia
// no Brasil não é plana: a "tarifa branca" (ANEEL) tem PONTA cara (fim de
// tarde), INTERMEDIÁRIO em volta e FORA DE PONTA barata (madrugada). Uma frota
// que recarrega de madrugada paga menos pela MESMA energia. Este módulo deriva
// a curva tarifária, a janela ideal de recarga, a economia de deslocar a
// recarga para fora da ponta e o respeito à demanda contratada (peak shaving).
//
// Honestidade (regra da vertical): os fatores e as faixas são a régua PADRÃO,
// editável — não uma leitura da conta de luz. A energia vem estimada
// (energyDomain), e a tela diz isso. Sem potência instalada, a janela é
// indisponível, não um chute. Nada de serviço pago: é aritmética de tarifa.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

// Régua padrão da tarifa branca. Fatores sobre a tarifa base (fora de ponta =
// 1). Faixas horárias típicas de dia útil: ponta 18h–20h; intermediário 17h e
// 21h; o resto, fora de ponta. Tudo editável — é assumption, não medição.
export const TARIFA_BRANCA_PADRAO = Object.freeze({
  fatorPonta: 1.8,
  fatorIntermediario: 1.3,
  fatorForaPonta: 1,
  horasPonta: Object.freeze([18, 19, 20]),
  horasIntermediario: Object.freeze([17, 21]),
});

// A qual faixa uma hora (0–23) pertence.
export const faixaHoraria = (hora, tarifa = TARIFA_BRANCA_PADRAO) => {
  const h = ((Math.trunc(num(hora)) % 24) + 24) % 24;
  if ((tarifa.horasPonta || []).includes(h)) return "ponta";
  if ((tarifa.horasIntermediario || []).includes(h)) return "intermediario";
  return "fora-ponta";
};

const FATOR = {
  ponta: "fatorPonta",
  intermediario: "fatorIntermediario",
  "fora-ponta": "fatorForaPonta",
};

// Tarifa em R$/kWh numa hora, dada a base.
export const tarifaNaHora = (base, hora, tarifa = TARIFA_BRANCA_PADRAO) => {
  const faixa = faixaHoraria(hora, tarifa);
  return round(num(base) * num(tarifa[FATOR[faixa]] ?? 1), 4);
};

// Curva de 24 horas para a tela desenhar sem duplicar a regra.
export const curvaTarifaria = (base, tarifa = TARIFA_BRANCA_PADRAO) =>
  Array.from({ length: 24 }, (_, hora) => ({
    hora,
    faixa: faixaHoraria(hora, tarifa),
    tarifa: tarifaNaHora(base, hora, tarifa),
  }));

// A maior janela contígua fora de ponta (considerando a virada da meia-noite).
// É onde a frota deve concentrar a recarga. Sem nenhuma hora fora de ponta
// (régua degenerada), devolve null.
export const janelaForaPonta = (tarifa = TARIFA_BRANCA_PADRAO) => {
  const forade = (h) => faixaHoraria(h, tarifa) === "fora-ponta";
  let melhorInicio = null;
  let melhorTam = 0;
  // Varre 48h para capturar o bloco que cruza a meia-noite (ex.: 22h→16h).
  let inicio = null;
  let tam = 0;
  for (let i = 0; i < 48; i += 1) {
    if (forade(i)) {
      if (inicio === null) { inicio = i; tam = 0; }
      tam += 1;
      if (tam > melhorTam) { melhorTam = tam; melhorInicio = inicio; }
    } else {
      inicio = null; tam = 0;
    }
  }
  if (melhorInicio === null) return null;
  const horas = Math.min(melhorTam, 24); // não conta a mesma hora duas vezes
  return {
    inicio: melhorInicio % 24,
    fim: (melhorInicio + horas) % 24,
    horas,
  };
};

// Horas de recarga para a rede repor uma energia, à potência instalada. Sem
// potência, indisponível — não se divide por zero nem se finge.
export const horasParaRecarregar = (energiaKwh, potenciaKw) => {
  const p = num(potenciaKw);
  if (p <= 0) return null;
  return round(num(energiaKwh) / p, 1);
};

// Economia de recarregar fora da ponta em vez de na ponta, para uma energia.
export const economiaRecarga = (energiaKwh, base, tarifa = TARIFA_BRANCA_PADRAO) => {
  const e = num(energiaKwh);
  const tarifaForaPonta = num(base) * num(tarifa.fatorForaPonta ?? 1);
  const tarifaPonta = num(base) * num(tarifa.fatorPonta ?? 1);
  const custoForaPonta = round(e * tarifaForaPonta);
  const custoPonta = round(e * tarifaPonta);
  const economia = round(custoPonta - custoForaPonta);
  const economiaPercent = tarifaPonta > 0
    ? round((1 - tarifaForaPonta / tarifaPonta) * 100, 1)
    : 0;
  return {
    custoPonta,
    custoForaPonta,
    economia,
    economiaPercent,
    porKwh: round(tarifaPonta - tarifaForaPonta, 4),
  };
};

// Respeito à demanda contratada (peak shaving). Se todos os pontos puxam ao
// mesmo tempo, a demanda instantânea é a potência instalada; passar da
// contratada gera multa. Sem demanda informada, devolve honesto (informada:
// false) — não inventa um teto.
export const avaliarDemanda = (potenciaInstaladaKw, demandaContratadaKw) => {
  const instalada = num(potenciaInstaladaKw);
  const contratada = num(demandaContratadaKw);
  if (contratada <= 0) {
    return { informada: false, potenciaInstaladaKw: round(instalada, 1) };
  }
  const excede = instalada > contratada;
  return {
    informada: true,
    potenciaInstaladaKw: round(instalada, 1),
    demandaContratadaKw: round(contratada, 1),
    excede,
    folgaKw: round(contratada - instalada, 1),
    // Fração da rede que pode recarregar simultânea sem estourar o contrato.
    fracaoSimultanea: instalada > 0 ? round(Math.min(1, contratada / instalada), 2) : 1,
  };
};

// O plano completo: junta janela, horas, economia e demanda para a tela. Sem
// potência instalada, a recarga inteligente fica indisponível (é sobre QUANDO
// puxar energia da rede própria).
export const planoRecargaInteligente = ({
  energiaKwh = 0,
  potenciaKw = 0,
  base,
  demandaContratadaKw = 0,
  tarifa = TARIFA_BRANCA_PADRAO,
} = {}) => {
  const tarifaBase = num(base) > 0 ? num(base) : 0.92;
  const potencia = num(potenciaKw);
  const disponivel = potencia > 0;

  return {
    disponivel,
    tarifaBase,
    curva: curvaTarifaria(tarifaBase, tarifa),
    janela: janelaForaPonta(tarifa),
    horasParaRecarregar: horasParaRecarregar(energiaKwh, potencia),
    economia: economiaRecarga(energiaKwh, tarifaBase, tarifa),
    demanda: avaliarDemanda(potencia, demandaContratadaKw),
    aviso: disponivel
      ? null
      : "Cadastre a potência dos pontos de recarga para calcular a janela e a economia.",
  };
};
