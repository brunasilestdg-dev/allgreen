// ===== Energia · BESS + Solar + Peak Shaving (bloco 15 · aprimoramento) =====
// Camada pura. Complementa `energyDomain`, `energyTariffDomain`,
// `energyEstimationDomain`, `smartChargingDomain` e `gridWindowDomain` — não
// substitui nenhum deles.
//
// O que resolve:
// 1. Peak shaving — quanto de BESS/solar é usado para não estourar a demanda
//    contratada num intervalo. A rede pesada COBRA multa por ultrapassagem;
//    saber o pico e o corte é o primeiro dado que impede a conta doer.
// 2. Mix da energia entregue à recarga — rede vs. solar vs. BESS. É esse
//    número que alimenta o cálculo ESG de "energia renovável" e de emissão
//    do escopo 2 (ISO 14083). Sem separar, a plataforma teria que assumir
//    "tudo da rede" e a projeção ficaria pior do que a realidade.
// 3. Ciclo do BESS — cada carga/descarga desgasta a bateria; sem contar,
//    o operador não sabe quando trocar. `bessCycleCount` conta ciclos
//    equivalentes (100% em um sentido = 1 ciclo).
//
// Princípio herdado do ESG: se não há dado, o campo sai como null em vez de
// 0. Zero renovável e ausência de medição são coisas diferentes.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arredondarKwh = (v) => Math.round(num(v) * 1000) / 1000;
const arredondarKw = (v) => Math.round(num(v) * 100) / 100;
const arredondarPct = (v) => Math.round(num(v) * 10) / 10;

// Fontes reconhecidas de energia entregue ao carregador.
export const FONTES_ENERGIA = Object.freeze(["rede", "solar", "bess", "outra"]);

// Peak shaving por INTERVALO. `janelas` = [{ inicioMs, fimMs, kwGrid, kwSolar,
// kwBess }]. `demandaContratadaKw` = teto contratado. Devolve o pico da REDE,
// o pico do local (grid+solar+bess), o quanto o BESS/solar aliviou e se houve
// ultrapassagem — o número que faz a fatura da distribuidora doer.
export const peakShavingSummary = (janelas = [], demandaContratadaKw = 0) => {
  const teto = Math.max(0, num(demandaContratadaKw));
  let picoRede = 0, picoLocal = 0, alivio = 0, ultrapassagens = 0, janelasCount = 0;
  for (const j of janelas) {
    if (!j) continue;
    const kwRede = Math.max(0, num(j.kwGrid));
    const kwSolar = Math.max(0, num(j.kwSolar));
    const kwBess = Math.max(0, num(j.kwBess));
    const totalLocal = kwRede + kwSolar + kwBess;
    janelasCount += 1;
    if (kwRede > picoRede) picoRede = kwRede;
    if (totalLocal > picoLocal) picoLocal = totalLocal;
    alivio += kwSolar + kwBess;
    if (teto > 0 && kwRede > teto) ultrapassagens += 1;
  }
  return {
    janelas: janelasCount,
    demandaContratadaKw: teto || null,
    picoRedeKw: arredondarKw(picoRede),
    picoLocalKw: arredondarKw(picoLocal),
    alivioBessSolarKwh: arredondarKwh(alivio),
    ultrapassagens,
    excedenteRedeKw: teto > 0 ? Math.max(0, arredondarKw(picoRede - teto)) : null,
  };
};

// Mix da energia entregue à recarga a partir dos totais por fonte. Devolve
// participação em % e a energia total. Se todo mundo é zero, devolve null
// nos percentuais — o número não é 0/0/0/0, é "sem medição".
export const energyMixKwh = ({ redeKwh = 0, solarKwh = 0, bessKwh = 0, outraKwh = 0 } = {}) => {
  const r = Math.max(0, num(redeKwh));
  const s = Math.max(0, num(solarKwh));
  const b = Math.max(0, num(bessKwh));
  const o = Math.max(0, num(outraKwh));
  const total = arredondarKwh(r + s + b + o);
  if (total <= 0) {
    return {
      totalKwh: 0,
      redeKwh: 0, solarKwh: 0, bessKwh: 0, outraKwh: 0,
      redePct: null, solarPct: null, bessPct: null, outraPct: null,
      renovavelPct: null,
    };
  }
  const pct = (v) => arredondarPct((v / total) * 100);
  const renovavel = pct(s + b); // BESS aqui é presumido carregado por solar/renovável (o CPO
  // decide o quanto é limpo pela origem contratada; ver renewableShareBess abaixo se precisar
  // considerar só uma fração como renovável).
  return {
    totalKwh: total,
    redeKwh: arredondarKwh(r), solarKwh: arredondarKwh(s),
    bessKwh: arredondarKwh(b), outraKwh: arredondarKwh(o),
    redePct: pct(r), solarPct: pct(s), bessPct: pct(b), outraPct: pct(o),
    renovavelPct: renovavel,
  };
};

// Fração renovável considerando origem do BESS. Se o BESS foi carregado 60%
// por solar e 40% por rede não certificada, a "renovável" da sessão é
// solar + (bess × 0,6). Sem informar, mantém 100% (comportamento do
// energyMixKwh acima).
export const renewableShareBess = (mix, bessRenovavelPct = 100) => {
  if (!mix || mix.totalKwh <= 0) return null;
  const pct = Math.max(0, Math.min(100, num(bessRenovavelPct)));
  const s = num(mix.solarKwh);
  const b = num(mix.bessKwh);
  const renKwh = s + b * (pct / 100);
  return arredondarPct((renKwh / num(mix.totalKwh)) * 100);
};

// Recomendação de recarga do BESS pelo horário: janela mais barata do dia
// enche o banco para descarregar no pico. `tarifas` = [{ horaInicio (0-23),
// horaFim, tarifaReais }]. Devolve o intervalo mais barato dentro do
// tempoMinHoras de duração pedida. Sem tarifas suficientes, devolve null.
export const bestBessChargeWindow = (tarifas = [], tempoMinHoras = 1) => {
  const t = (Array.isArray(tarifas) ? tarifas : [])
    .filter((x) => x && Number.isFinite(Number(x.tarifaReais)))
    .slice()
    .sort((a, b) => num(a.tarifaReais) - num(b.tarifaReais));
  if (!t.length) return null;
  const escolhida = t[0];
  const horas = Math.max(1, num(tempoMinHoras));
  return {
    horaInicio: num(escolhida.horaInicio),
    horaFim: Math.min(23, num(escolhida.horaInicio) + horas),
    tarifaReais: arredondarKwh(escolhida.tarifaReais),
    horas,
  };
};

// Ciclos equivalentes do BESS. `sessoes` = [{ kwhCarregado, kwhDescarregado }].
// 1 ciclo = capacidade nominal completa em um sentido (usa o maior dos dois).
export const bessCycleCount = (sessoes = [], capacidadeNominalKwh = 0) => {
  const cap = Math.max(0, num(capacidadeNominalKwh));
  if (cap <= 0) return null;
  let totalMovimentado = 0;
  for (const s of sessoes) {
    const c = Math.max(0, num(s?.kwhCarregado));
    const d = Math.max(0, num(s?.kwhDescarregado));
    totalMovimentado += Math.max(c, d);
  }
  // Um ciclo completo = 2 × capacidade movimentada (carga + descarga); usar
  // MAX evita contar duas vezes quando só um lado foi registrado.
  return Math.round((totalMovimentado / cap) * 100) / 100;
};

// Perda entre a tomada e a bateria do veículo (ineficiência do carregador +
// bateria). `entregueTomadaKwh` = o que o medidor da estação registrou;
// `carregadoBateriaKwh` = o que o veículo aceitou (BMS). Devolve a perda em
// kWh e a eficiência efetiva. Sem os dois, devolve null (não estimo).
export const chargingLoss = ({ entregueTomadaKwh, carregadoBateriaKwh } = {}) => {
  const t = num(entregueTomadaKwh);
  const b = num(carregadoBateriaKwh);
  if (!(t > 0) || !(b > 0)) return null;
  if (b >= t) return { perdaKwh: 0, eficienciaPct: 100 };
  return {
    perdaKwh: arredondarKwh(t - b),
    eficienciaPct: arredondarPct((b / t) * 100),
  };
};
