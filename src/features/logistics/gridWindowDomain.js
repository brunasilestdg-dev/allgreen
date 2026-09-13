// ===== Janela de recarga: melhor hora FINANCEIRA, ENERGÉTICA e RECOMENDADA =====
// Camada PURA e DETERMINÍSTICA. Sem rede, sem banco, sem DOM, sem IA.
//
// Seções 63–64 da consolidação. Cruzamos:
//   • a CURVA TARIFÁRIA (R$/kWh por hora — ANEEL/contrato/informada);
//   • a CURVA DE CARGA do SIN (ONS, dados abertos: carga horária média por
//     subsistema) → o perfil médio das 24 h nos últimos dias diz quando o
//     sistema está mais leve (recarregar aí alivia o sistema; é um proxy
//     honesto de "hora energética" — NÃO é medição de carbono);
//   • a hora de saída da frota, a hora de retorno e as horas necessárias.
// Metodologia auditável: cada janela traz o critério, os dados usados e a
// confiança. Sem ONS, a energética é indisponível (ONS_NOT_AVAILABLE) e a
// recomendada vira a financeira — nunca uma "hora verde" inventada.

import { CONFIDENCE_LEVELS } from "./dataProvenanceDomain.js";

export const GRID_METHOD_VERSION = "grid-window@1.1.0";
export const ONS_SUBSISTEMAS = Object.freeze({ N: "Norte", NE: "Nordeste", S: "Sul", SE: "Sudeste/Centro-Oeste" });
// Sem hora de retorno informada, assumimos a frota parada nas N horas antes da
// saída. É assumption declarada na saída — não uma disponibilidade medida.
export const DISPONIBILIDADE_PADRAO_HORAS = 12;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const round = (v, c = 3) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** c;
  return Math.round(n * f) / f;
};
const hora24 = (h) => ((Math.trunc(Number(h)) % 24) + 24) % 24;
const hh = (h) => `${String(hora24(h)).padStart(2, "0")}:00`;
const horaInformada = (h) => h !== null && h !== undefined && h !== "" && Number.isFinite(Number(h));

/**
 * CSV da curva de carga horária do ONS (`id_subsistema;nom_subsistema;
 * din_instante;val_cargaenergiahomwmed`) → registros do subsistema pedido,
 * só dos últimos `dias` (relativo à data mais recente do arquivo).
 */
export function parseCurvaCargaOns(csvText = "", { subsistema = "SE", dias = 28 } = {}) {
  const linhas = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (linhas.length < 2) return { ok: false, reason: "ONS_CSV_VAZIO", registros: [] };
  const cabecalho = linhas[0].split(";").map((c) => c.trim().toLowerCase());
  const iSub = cabecalho.indexOf("id_subsistema");
  const iInst = cabecalho.indexOf("din_instante");
  const iVal = cabecalho.findIndex((c) => c.startsWith("val_cargaenergia"));
  if (iSub < 0 || iInst < 0 || iVal < 0) return { ok: false, reason: "ONS_CSV_CABECALHO_DESCONHECIDO", registros: [] };
  const alvo = String(subsistema || "SE").toUpperCase();
  const registros = [];
  let maxT = -Infinity;
  for (let i = 1; i < linhas.length; i += 1) {
    const cols = linhas[i].split(";");
    if ((cols[iSub] || "").trim().toUpperCase() !== alvo) continue;
    const t = Date.parse(String(cols[iInst]).trim().replace(" ", "T") + "Z");
    const carga = num(cols[iVal]);
    if (!Number.isFinite(t) || carga === null) continue;
    registros.push({ t, hora: new Date(t).getUTCHours(), cargaMw: carga });
    if (t > maxT) maxT = t;
  }
  if (!registros.length) return { ok: false, reason: "ONS_SEM_REGISTROS_DO_SUBSISTEMA", registros: [] };
  const limite = maxT - Math.max(1, dias) * 24 * 60 * 60 * 1000;
  const recentes = registros.filter((r) => r.t >= limite);
  return { ok: true, subsistema: alvo, registros: recentes, ultimoInstante: new Date(maxT).toISOString(), total: registros.length };
}

/**
 * Perfil médio de 24 h (MW) e normalizado (0 = hora mais leve, 1 = mais pesada).
 * Menos de 7 dias de dados → confiança baixa; hora sem amostra → inválido.
 */
export function perfilHorarioCarga(registros = []) {
  const soma = Array(24).fill(0);
  const cont = Array(24).fill(0);
  for (const r of registros || []) {
    const h = Number(r?.hora);
    const c = num(r?.cargaMw);
    if (!Number.isInteger(h) || h < 0 || h > 23 || c === null) continue;
    soma[h] += c;
    cont[h] += 1;
  }
  if (cont.some((n) => n === 0)) return { ok: false, reason: "PERFIL_INCOMPLETO", horasCobertas: cont.filter((n) => n > 0).length };
  const media = soma.map((s, h) => s / cont[h]);
  const min = Math.min(...media);
  const max = Math.max(...media);
  const dias = Math.min(...cont);
  return {
    ok: true,
    mediaMw: media.map((m) => round(m, 1)),
    normalizado: media.map((m) => (max > min ? round((m - min) / (max - min), 4) : 0)),
    horaMaisLeve: media.indexOf(min),
    horaMaisPesada: media.indexOf(max),
    dias,
    confidence: dias >= 14 ? CONFIDENCE_LEVELS.HIGH : dias >= 7 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
  };
}

/**
 * Perfil já agregado (ex.: lido do cache: 24 médias em MW + dias) → mesmo
 * formato de `perfilHorarioCarga`, para a janela não depender do CSV bruto.
 */
export function perfilDeMedias(mediaMw = [], { dias = 0 } = {}) {
  if (!Array.isArray(mediaMw) || mediaMw.length !== 24) return { ok: false, reason: "PERFIL_INCOMPLETO", horasCobertas: Array.isArray(mediaMw) ? mediaMw.length : 0 };
  const media = mediaMw.map((m) => num(m));
  if (media.some((m) => m === null)) return { ok: false, reason: "PERFIL_INCOMPLETO", horasCobertas: media.filter((m) => m !== null).length };
  const min = Math.min(...media);
  const max = Math.max(...media);
  const d = Math.max(0, Math.trunc(Number(dias) || 0));
  return {
    ok: true,
    mediaMw: media.map((m) => round(m, 1)),
    normalizado: media.map((m) => (max > min ? round((m - min) / (max - min), 4) : 0)),
    horaMaisLeve: media.indexOf(min),
    horaMaisPesada: media.indexOf(max),
    dias: d,
    confidence: d >= 14 ? CONFIDENCE_LEVELS.HIGH : d >= 7 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
  };
}

// Janela contígua (circular, cruzando meia-noite) de `horas` com a menor média
// de `custo[h]`. Devolve início/fim/média. `permitidas` filtra horas elegíveis.
function melhorJanela(custo24, horas, permitidas = null) {
  const n = Math.max(1, Math.min(24, Math.round(horas)));
  let melhor = null;
  for (let inicio = 0; inicio < 24; inicio += 1) {
    let soma = 0;
    let ok = true;
    for (let k = 0; k < n; k += 1) {
      const h = (inicio + k) % 24;
      if (permitidas && !permitidas.has(h)) { ok = false; break; }
      const c = Number(custo24[h]);
      if (!Number.isFinite(c)) { ok = false; break; }
      soma += c;
    }
    if (!ok) continue;
    const media = soma / n;
    if (!melhor || media < melhor.media - 1e-9) melhor = { inicio, fim: (inicio + n) % 24, horas: n, media: round(media, 5) };
  }
  return melhor;
}

/**
 * Horas em que a frota está parada e pode recarregar. Com retorno e saída,
 * é o intervalo [chegada, saída) circular. Só com saída, assume-se a frota
 * disponível nas `disponivelHoras` anteriores (assumption declarada). Sem
 * saída, todas as horas.
 */
export function horasDisponiveis({ saidaHora = null, chegadaHora = null, disponivelHoras = DISPONIBILIDADE_PADRAO_HORAS } = {}) {
  if (!horaInformada(saidaHora)) return { permitidas: null, saida: null, chegada: null, assumptions: [] };
  const s = hora24(saidaHora);
  const permitidas = new Set();
  if (horaInformada(chegadaHora)) {
    const c = hora24(chegadaHora);
    let h = c;
    let guard = 0;
    while (h !== s && guard < 24) { permitidas.add(h); h = (h + 1) % 24; guard += 1; }
    if (!permitidas.size) for (let k = 0; k < 24; k += 1) permitidas.add(k); // chegada = saída: dia inteiro
    return { permitidas, saida: s, chegada: c, assumptions: [] };
  }
  const n = Math.max(1, Math.min(24, Math.trunc(Number(disponivelHoras) || DISPONIBILIDADE_PADRAO_HORAS)));
  for (let k = 1; k <= n; k += 1) permitidas.add((s - k + 24) % 24);
  return { permitidas, saida: s, chegada: null, assumptions: [`disponibilidade_${n}h_antes_da_saida`] };
}

const mediaNaJanela = (serie, inicio, n) => {
  let soma = 0;
  for (let k = 0; k < n; k += 1) soma += Number(serie[(inicio + k) % 24]) || 0;
  return soma / n;
};

/**
 * As três janelas (seção 64). Entrada:
 *   curvaTarifa: [{hora, tarifa}] (24)        — obrigatória para a financeira
 *   perfilCarga: saída de perfilHorarioCarga  — opcional (sem ONS → null)
 *   horasNecessarias, saidaHora/chegadaHora (0–23), pesos {financeiro, energetico}
 */
export function janelasDeRecarga({ curvaTarifa = [], perfilCarga = null, horasNecessarias = 4, saidaHora = null, chegadaHora = null, disponivelHoras = DISPONIBILIDADE_PADRAO_HORAS, pesos = { financeiro: 0.6, energetico: 0.4 } } = {}) {
  const n = Math.max(1, Math.min(24, Math.round(Number(horasNecessarias) || 1)));
  const tarifa24 = Array.from({ length: 24 }, (_, h) => Number((curvaTarifa || []).find((p) => Number(p.hora) === h)?.tarifa));
  const temTarifa = tarifa24.every((t) => Number.isFinite(t));
  const disponibilidade = horasDisponiveis({ saidaHora, chegadaHora, disponivelHoras });
  const permitidas = disponibilidade.permitidas;
  const avisos = [];
  const assumptions = [...disponibilidade.assumptions];
  if (permitidas && permitidas.size < n) avisos.push("JANELA_MAIOR_QUE_DISPONIBILIDADE");

  const buscar = (serie) => {
    const restrita = melhorJanela(serie, n, permitidas);
    if (restrita) return { ...restrita, foraDaDisponibilidade: false };
    const livre = melhorJanela(serie, n);
    return livre ? { ...livre, foraDaDisponibilidade: Boolean(permitidas) } : null;
  };

  // Financeira: menor tarifa média.
  let financeira = null;
  if (temTarifa) {
    const j = buscar(tarifa24);
    if (j) {
      const min = Math.min(...tarifa24);
      const max = Math.max(...tarifa24);
      financeira = {
        ...j,
        criterio: "menor tarifa média (R$/kWh)",
        tarifaMedia: j.media,
        economiaVsPiorPercent: max > 0 ? round((1 - j.media / max) * 100, 1) : 0,
        rotulo: `${hh(j.inicio)}–${hh(j.fim)}`,
        plana: max - min < 1e-9,
      };
      if (financeira.plana) avisos.push("TARIFA_PLANA_SEM_GANHO_HORARIO");
    }
  } else {
    avisos.push("TARIFA_INDISPONIVEL");
  }

  // Energética: menor carga média do SIN (proxy de sistema mais leve).
  let energetica = null;
  if (perfilCarga && perfilCarga.ok) {
    const j = buscar(perfilCarga.normalizado);
    if (j) {
      energetica = {
        ...j,
        criterio: "menor carga média do SIN (ONS, perfil dos últimos dias)",
        cargaNormalizadaMedia: j.media,
        cargaMediaMw: round(mediaNaJanela(perfilCarga.mediaMw, j.inicio, n), 0),
        rotulo: `${hh(j.inicio)}–${hh(j.fim)}`,
        confidence: perfilCarga.confidence,
        dias: perfilCarga.dias,
      };
    }
  } else {
    avisos.push("ONS_NOT_AVAILABLE");
  }

  // Recomendada: soma ponderada dos dois custos normalizados; sem ONS, é a financeira.
  let recomendada = null;
  if (temTarifa && energetica) {
    const min = Math.min(...tarifa24);
    const max = Math.max(...tarifa24);
    const tarifaNorm = tarifa24.map((t) => (max > min ? (t - min) / (max - min) : 0));
    const wF = Number(pesos?.financeiro ?? 0.6);
    const wE = Number(pesos?.energetico ?? 0.4);
    const custo = tarifaNorm.map((tn, h) => wF * tn + wE * Number(perfilCarga.normalizado[h] ?? 0));
    const j = buscar(custo);
    if (j) {
      recomendada = {
        ...j,
        criterio: `${Math.round(wF * 100)}% tarifa + ${Math.round(wE * 100)}% carga do SIN (normalizados)`,
        rotulo: `${hh(j.inicio)}–${hh(j.fim)}`,
        tarifaMedia: round(mediaNaJanela(tarifa24, j.inicio, n), 5),
        pesos: { financeiro: wF, energetico: wE },
      };
    }
  } else if (financeira) {
    recomendada = { ...financeira, criterio: "financeira (sem dado do ONS para a energética)", derivadaDe: "financeira" };
  }

  return {
    version: GRID_METHOD_VERSION,
    horasNecessarias: n,
    saidaHora: disponibilidade.saida,
    chegadaHora: disponibilidade.chegada,
    horasDisponiveis: permitidas ? permitidas.size : 24,
    financeira,
    energetica,
    recomendada,
    avisos,
    assumptions,
    confidence: !financeira ? CONFIDENCE_LEVELS.UNKNOWN : !energetica ? CONFIDENCE_LEVELS.MEDIUM : perfilCarga.confidence,
    metodologia: [
      "Financeira: janela contígua de N horas com a menor tarifa média (R$/kWh) da curva horária vigente.",
      "Energética: janela contígua de N horas com a menor carga média do SIN no subsistema, a partir do perfil médio das 24 h dos últimos dias (ONS, dados abertos). É um proxy de sistema mais leve — não é medição de emissões.",
      "Recomendada: menor soma ponderada dos dois critérios normalizados (0–1), restrita às horas em que a frota está parada (retorno→saída informados, ou as horas anteriores à saída como assumption). Sem ONS, iguala a financeira e diz isso.",
    ],
  };
}
