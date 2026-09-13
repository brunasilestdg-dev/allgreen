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

import { DISPONIBILIDADE_PADRAO_HORAS, horasDisponiveis } from "./gridWindowDomain.js";

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

// ===== Plano de recarga por veículo (seção 65) =====
// veículos × pontos × janela × demanda contratada → agenda determinística:
// quem recarrega onde, quando, a que potência, quanto (kWh), a que custo e
// POR QUÊ. Slots de 1 h a partir da hora de início do planejamento; cada
// veículo recebe primeiro as horas mais baratas em que está parado (retorno→
// saída, ou as N horas antes da saída como assumption), sem ultrapassar a
// potência do ponto, a do veículo e a demanda contratada do espaço. Um ponto
// atende um veículo por vez. Quem não fecha a energia diz o motivo — não fica
// "planejado" no papel.

export const PLANO_RECARGA_VERSION = "smart-charging-plan@1.0.0";

const texto = (v, max = 80) => String(v ?? "").trim().slice(0, max);
const hhmm = (horaDecimal) => {
  const total = Math.round((((horaDecimal % 24) + 24) % 24) * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const conectoresDoPonto = (p) => {
  const lista = Array.isArray(p.conectores) ? p.conectores : [p.conector, p.tipoConector].filter(Boolean);
  return lista.map((c) => texto(c, 30).toUpperCase()).filter(Boolean);
};
const compativel = (veiculo, ponto) => !veiculo.conector || !ponto.conectores.length || ponto.conectores.includes(veiculo.conector);

const normalizarVeiculo = (v, i) => ({
  id: texto(v.id, 80) || `veiculo-${i + 1}`,
  rotulo: texto(v.rotulo || v.prefixo || v.prefix || v.placa || v.plate || v.id, 40) || `Veículo ${i + 1}`,
  energiaKwh: Math.max(0, num(v.energiaNecessariaKwh ?? v.energiaKwh)),
  potenciaMaxKw: Math.max(0, num(v.potenciaMaxKw ?? v.maxChargingPowerKw)),
  conector: texto(v.conector || v.connectorType, 30).toUpperCase(),
  saidaHora: v.saidaHora === null || v.saidaHora === undefined || v.saidaHora === "" ? null : Number(v.saidaHora),
  chegadaHora: v.chegadaHora === null || v.chegadaHora === undefined || v.chegadaHora === "" ? null : Number(v.chegadaHora),
});
const normalizarPonto = (p, i) => ({
  id: texto(p.id, 80) || `ponto-${i + 1}`,
  nome: texto(p.nome || p.name || p.id, 60) || `Ponto ${i + 1}`,
  potenciaKw: Math.max(0, num(p.potenciaKw)),
  conectores: conectoresDoPonto(p),
  ativo: !p.status || String(p.status) === "ativo",
});

export const planoDeRecargaPorVeiculo = ({
  veiculos = [],
  pontos = [],
  curvaTarifa = [],
  demandaContratadaKw = 0,
  horaInicio = 0,
  horizonteHoras = 24,
  disponivelHoras = DISPONIBILIDADE_PADRAO_HORAS,
} = {}) => {
  const H = Math.max(1, Math.min(48, Math.trunc(num(horizonteHoras) || 24)));
  const h0 = ((Math.trunc(num(horaInicio)) % 24) + 24) % 24;
  const tarifa24 = Array.from({ length: 24 }, (_, h) => Number((curvaTarifa || []).find((p) => Number(p.hora) === h)?.tarifa));
  const temTarifa = tarifa24.every((t) => Number.isFinite(t));
  const tarifaMax = temTarifa ? Math.max(...tarifa24) : null;
  const demanda = Math.max(0, num(demandaContratadaKw));
  const avisos = new Set();
  const assumptions = new Set(["slots_de_1h", "potencia_constante_na_sessao", "sem_curva_de_carga_da_bateria"]);
  if (!temTarifa) avisos.add("TARIFA_INDISPONIVEL");

  const pontosAtivos = (pontos || []).map(normalizarPonto).filter((p) => p.ativo && p.potenciaKw > 0)
    .sort((a, b) => b.potenciaKw - a.potenciaKw || a.id.localeCompare(b.id));
  if (!pontosAtivos.length) avisos.add("SEM_PONTOS_ATIVOS");

  const slots = Array.from({ length: H }, (_, t) => ({ t, hora: (h0 + t) % 24, tarifa: temTarifa ? tarifa24[(h0 + t) % 24] : null, usoKw: 0, ocupados: new Set() }));

  const todos = (veiculos || []).map(normalizarVeiculo);
  const naoPlanejados = todos.filter((v) => v.energiaKwh <= 0).map((v) => ({ id: v.id, rotulo: v.rotulo, motivo: "sem energia necessária informada (bateria/SOC)" }));
  const planejaveis = todos.filter((v) => v.energiaKwh > 0).map((v) => {
    const prazoT = v.saidaHora === null || !Number.isFinite(v.saidaHora) ? H : (((Math.trunc(v.saidaHora) - h0) % 24) + 24) % 24 || 24;
    const disp = horasDisponiveis({ saidaHora: v.saidaHora, chegadaHora: v.chegadaHora, disponivelHoras });
    disp.assumptions.forEach((a) => assumptions.add(a));
    return { ...v, prazoT: Math.min(prazoT, H), permitidas: disp.permitidas };
  }).sort((a, b) => a.prazoT - b.prazoT || b.energiaKwh - a.energiaKwh || a.id.localeCompare(b.id));

  const resultados = [];
  for (const v of planejaveis) {
    const candidatos = slots
      .filter((s) => s.t < v.prazoT && (!v.permitidas || v.permitidas.has(s.hora)))
      .sort((a, b) => (temTarifa ? a.tarifa - b.tarifa : 0) || a.t - b.t);
    const compatíveis = pontosAtivos.filter((p) => compativel(v, p));
    let restante = v.energiaKwh;
    let limitadoPorDemanda = false;
    const alocacoes = [];
    for (const s of candidatos) {
      if (restante <= 1e-9) break;
      const ponto = compatíveis.find((p) => !s.ocupados.has(p.id));
      if (!ponto) continue;
      const tetoDemanda = demanda > 0 ? demanda - s.usoKw : Infinity;
      const potencia = Math.min(ponto.potenciaKw, v.potenciaMaxKw > 0 ? v.potenciaMaxKw : Infinity, tetoDemanda);
      if (!(potencia > 0.01)) { if (tetoDemanda < ponto.potenciaKw) limitadoPorDemanda = true; continue; }
      if (tetoDemanda < ponto.potenciaKw && tetoDemanda < (v.potenciaMaxKw || Infinity)) limitadoPorDemanda = true;
      const kwh = Math.min(potencia, restante);
      alocacoes.push({ t: s.t, hora: s.hora, pontoId: ponto.id, pontoNome: ponto.nome, potenciaKw: round(potencia, 1), kwh: round(kwh, 2), horas: round(kwh / potencia, 3), tarifa: s.tarifa, custo: temTarifa ? round(kwh * s.tarifa) : null });
      s.usoKw += potencia;
      s.ocupados.add(ponto.id);
      restante -= kwh;
    }
    alocacoes.sort((a, b) => a.t - b.t);
    // Sessões: slots consecutivos no mesmo ponto viram uma sessão só.
    const sessoes = [];
    for (const a of alocacoes) {
      const ultima = sessoes[sessoes.length - 1];
      if (ultima && ultima.pontoId === a.pontoId && ultima.tFim === a.t && ultima.horasUltimo >= 0.999) {
        ultima.tFim = a.t + 1; ultima.kwh = round(ultima.kwh + a.kwh, 2); ultima.custo = temTarifa ? round((ultima.custo || 0) + (a.custo || 0)) : null;
        ultima.fimDecimal = a.hora + a.horas; ultima.horasUltimo = a.horas; ultima.potencias.push(a.potenciaKw);
      } else {
        sessoes.push({ pontoId: a.pontoId, pontoNome: a.pontoNome, tInicio: a.t, tFim: a.t + 1, inicioDecimal: a.hora, fimDecimal: a.hora + a.horas, horasUltimo: a.horas, kwh: a.kwh, custo: a.custo, potencias: [a.potenciaKw] });
      }
    }
    const alocada = round(v.energiaKwh - Math.max(0, restante), 2);
    const custo = temTarifa ? round(alocacoes.reduce((s, a) => s + (a.custo || 0), 0)) : null;
    const completo = restante <= 1e-6;
    let motivo = "recarga completa nas horas mais baratas em que o veículo está parado";
    if (!completo) {
      if (!pontosAtivos.length) motivo = "sem ponto de recarga ativo cadastrado";
      else if (!compatíveis.length) motivo = `sem ponto compatível com o conector ${v.conector}`;
      else if (limitadoPorDemanda) motivo = "limitado pela demanda contratada — não fecha a energia antes da saída";
      else motivo = "disponibilidade insuficiente antes da saída (pontos ocupados ou poucas horas paradas)";
    } else if (limitadoPorDemanda) motivo = "recarga completa, com potência reduzida para respeitar a demanda contratada";
    if (limitadoPorDemanda) avisos.add("DEMANDA_LIMITANTE");
    if (!completo) avisos.add("VEICULOS_INCOMPLETOS");
    resultados.push({
      id: v.id,
      rotulo: v.rotulo,
      energiaKwh: round(v.energiaKwh, 2),
      alocadaKwh: alocada,
      faltanteKwh: round(Math.max(0, restante), 2),
      completo,
      saidaHora: v.saidaHora === null || !Number.isFinite(v.saidaHora) ? null : ((Math.trunc(v.saidaHora) % 24) + 24) % 24,
      custo,
      custoMedioKwh: temTarifa && alocada > 0 ? round(custo / alocada, 4) : null,
      sessoes: sessoes.map((se) => ({
        pontoId: se.pontoId,
        pontoNome: se.pontoNome,
        inicio: hhmm(se.inicioDecimal),
        fim: hhmm(se.fimDecimal),
        horas: round(se.fimDecimal - se.inicioDecimal + (se.fimDecimal < se.inicioDecimal ? 24 : 0), 2),
        potenciaKw: round(se.potencias.reduce((s, p) => s + p, 0) / se.potencias.length, 1),
        kwh: se.kwh,
        custo: se.custo,
      })),
      motivo,
    });
  }

  const alocadaTotal = round(resultados.reduce((s, r) => s + r.alocadaKwh, 0), 2);
  const custoTotal = temTarifa ? round(resultados.reduce((s, r) => s + (r.custo || 0), 0)) : null;
  const custoSeNaPonta = temTarifa ? round(alocadaTotal * tarifaMax) : null;
  return {
    version: PLANO_RECARGA_VERSION,
    horaInicio: h0,
    horizonteHoras: H,
    demandaContratadaKw: demanda || null,
    veiculos: resultados,
    naoPlanejados,
    totais: {
      veiculos: resultados.length,
      completos: resultados.filter((r) => r.completo).length,
      energiaKwh: round(resultados.reduce((s, r) => s + r.energiaKwh, 0), 2),
      alocadaKwh: alocadaTotal,
      custo: custoTotal,
      custoSeNaPonta,
      economia: temTarifa ? round(custoSeNaPonta - custoTotal) : null,
      picoKw: round(Math.max(0, ...slots.map((s) => s.usoKw)), 1),
      pontosAtivos: pontosAtivos.length,
    },
    cargaPorHora: slots.map((s) => ({ t: s.t, hora: s.hora, kw: round(s.usoKw, 1), tarifa: s.tarifa, veiculos: s.ocupados.size })),
    avisos: [...avisos].sort(),
    assumptions: [...assumptions].sort(),
    metodologia: [
      "Ordem: veículos com saída mais cedo primeiro; empate, quem precisa de mais energia.",
      "Cada veículo recebe as horas mais baratas em que está parado (retorno→saída informados, ou as horas antes da saída como assumption), até fechar a energia.",
      "Potência do slot = mínimo entre ponto, veículo e folga da demanda contratada; um ponto atende um veículo por vez.",
      "Custo = kWh × tarifa da hora; economia = custo se tudo fosse recarregado na hora mais cara.",
    ],
  };
};
