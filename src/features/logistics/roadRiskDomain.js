// ===== Risco viário (Risk Map) — PRF e ANTT como CUSTO, não bloqueio =====
// Camada PURA e DETERMINÍSTICA. Sem rede, sem banco, sem DOM, sem IA.
//
// Seções 14–15 e 71–74 da consolidação. Duas fontes públicas:
//   • PRF (dados abertos de acidentes por ocorrência, com latitude/longitude,
//     mortos e feridos) → índice por CÉLULA geográfica (~1,1 km) com UPS;
//   • ANTT (demonstrativo de acidentes por quilômetro das concessionárias:
//     Concessionaria;Data;Km;Trecho) → índice por RODOVIA/KM (sem severidade).
// A gravidade usa a UPS (Unidade Padrão de Severidade, DENATRAN): acidente sem
// vítima 1, com feridos 5, com mortos 13 — pesos declarados e editáveis.
// A rota recebe um RISK SCORE (0–100) a partir da UPS por km das células que
// atravessa; sem dado ingerido o score é null (RISK_DATA_NOT_AVAILABLE) — nunca
// zero fingindo segurança. O score entra como custo em routeAlternativesDomain.

export const ROAD_RISK_VERSION = "road-risk@1.0.0";
export const UPS = Object.freeze({ semVitimas: 1, comFeridos: 5, comMortos: 13 });
export const TAMANHO_CELULA_GRAUS = 0.01; // ≈ 1,1 km em latitude
export const ESCALA_RISCO_UPS_KM = 60;    // UPS/km em que o score chega a ~63; editável

const clean = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const fold = (v) => clean(v, 400).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^"|"$/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
const inteiro = (v) => { const n = num(v); return n === null ? 0 : Math.max(0, Math.trunc(n)); };
const dataIso = (v) => {
  const s = clean(v, 30).replace(/^"|"$/g, "");
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};
const splitCsv = (linha, sep) => {
  // Campos entre aspas podem conter o separador.
  const out = [];
  let atual = "";
  let aspas = false;
  for (const ch of linha) {
    if (ch === '"') { aspas = !aspas; continue; }
    if (ch === sep && !aspas) { out.push(atual); atual = ""; continue; }
    atual += ch;
  }
  out.push(atual);
  return out;
};
const detectarSeparador = (linha) => (linha.split(";").length >= linha.split(",").length ? ";" : ",");

/** Chave e centro da célula (~1,1 km) que contém o ponto. */
export function celulaDe(lat, lon, tamanho = TAMANHO_CELULA_GRAUS) {
  if (lat === null || lat === undefined || lon === null || lon === undefined || lat === "" || lon === "") return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  const i = Math.floor(la / tamanho);
  const j = Math.floor(lo / tamanho);
  return { chave: `${i}_${j}`, lat: Math.round((i + 0.5) * tamanho * 1e5) / 1e5, lon: Math.round((j + 0.5) * tamanho * 1e5) / 1e5 };
}

/** UPS de uma ocorrência pela classificação (PRF) ou pelas vítimas. */
export function upsDaOcorrencia({ classificacao = "", mortos = 0, feridosGraves = 0, feridosLeves = 0 } = {}) {
  const c = fold(classificacao);
  if (mortos > 0 || /fata|mort/.test(c)) return UPS.comMortos;
  if (feridosGraves > 0 || feridosLeves > 0 || c.includes("ferid")) return UPS.comFeridos;
  return UPS.semVitimas;
}

/**
 * CSV da PRF (acidentes por ocorrência, 2017+): cabeçalho tolerante a
 * acentos/caixa; `;` ou `,`; decimal com vírgula; datas dd/mm/aaaa ou ISO.
 */
export function parseAcidentesPrf(csvText = "", { max = 400000 } = {}) {
  const linhas = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const primeira = linhas.findIndex((l) => l.trim());
  if (primeira < 0 || linhas.length - primeira < 2) return { ok: false, reason: "PRF_CSV_VAZIO", registros: [], total: 0, ignorados: 0 };
  const sep = detectarSeparador(linhas[primeira]);
  const cab = splitCsv(linhas[primeira], sep).map((c) => fold(c).replace(/\s+/g, "_"));
  const idx = (...nomes) => cab.findIndex((c) => nomes.includes(c));
  const iData = idx("data_inversa", "data");
  const iUf = idx("uf");
  const iBr = idx("br");
  const iKm = idx("km");
  const iMun = idx("municipio");
  const iTipo = idx("tipo_acidente");
  const iClass = idx("classificacao_acidente");
  const iMortos = idx("mortos");
  const iGraves = idx("feridos_graves");
  const iLeves = idx("feridos_leves");
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  if (iData < 0 || iUf < 0 || iBr < 0 || iKm < 0) return { ok: false, reason: "PRF_CSV_CABECALHO_DESCONHECIDO", registros: [], total: 0, ignorados: 0, cabecalho: cab };
  const registros = [];
  let ignorados = 0;
  let total = 0;
  for (let i = primeira + 1; i < linhas.length && registros.length < max; i += 1) {
    if (!linhas[i].trim()) continue;
    total += 1;
    const c = splitCsv(linhas[i], sep);
    const data = dataIso(c[iData]);
    const uf = clean(c[iUf], 2).toUpperCase();
    const br = clean(c[iBr], 6).replace(/\D/g, "");
    const km = num(c[iKm]);
    if (!data || uf.length !== 2 || !br) { ignorados += 1; continue; }
    const mortos = iMortos >= 0 ? inteiro(c[iMortos]) : 0;
    const feridosGraves = iGraves >= 0 ? inteiro(c[iGraves]) : 0;
    const feridosLeves = iLeves >= 0 ? inteiro(c[iLeves]) : 0;
    const lat = iLat >= 0 ? num(c[iLat]) : null;
    const lon = iLon >= 0 ? num(c[iLon]) : null;
    const classificacao = iClass >= 0 ? clean(c[iClass], 40) : "";
    registros.push({
      data, uf, rodovia: `BR-${br.padStart(3, "0")}/${uf}`, km, municipio: iMun >= 0 ? clean(c[iMun], 80) : "",
      tipo: iTipo >= 0 ? clean(c[iTipo], 60) : "", classificacao, mortos, feridosGraves, feridosLeves,
      latitude: lat !== null && Math.abs(lat) <= 90 ? lat : null, longitude: lon !== null && Math.abs(lon) <= 180 ? lon : null,
      ups: upsDaOcorrencia({ classificacao, mortos, feridosGraves, feridosLeves }),
    });
  }
  if (!registros.length) return { ok: false, reason: "PRF_SEM_REGISTROS", registros: [], total, ignorados };
  return { ok: true, registros, total, ignorados, cabecalho: cab };
}

/**
 * CSV da ANTT (Acidentes por quilômetro): `Concessionaria;Data;Km;Trecho`.
 */
export function parseAcidentesAnttPorKm(csvText = "", { concessionaria = "", max = 400000 } = {}) {
  const linhas = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const primeira = linhas.findIndex((l) => l.trim());
  if (primeira < 0 || linhas.length - primeira < 2) return { ok: false, reason: "ANTT_CSV_VAZIO", registros: [], total: 0, ignorados: 0 };
  const sep = detectarSeparador(linhas[primeira]);
  const cab = splitCsv(linhas[primeira], sep).map((c) => fold(c));
  const iConc = cab.indexOf("concessionaria");
  const iData = cab.indexOf("data");
  const iKm = cab.indexOf("km");
  const iTrecho = cab.indexOf("trecho");
  if (iData < 0 || iKm < 0 || iTrecho < 0) return { ok: false, reason: "ANTT_CSV_CABECALHO_DESCONHECIDO", registros: [], total: 0, ignorados: 0, cabecalho: cab };
  const registros = [];
  let ignorados = 0;
  let total = 0;
  for (let i = primeira + 1; i < linhas.length && registros.length < max; i += 1) {
    if (!linhas[i].trim()) continue;
    total += 1;
    const c = splitCsv(linhas[i], sep);
    const data = dataIso(c[iData]);
    const km = num(c[iKm]);
    const trecho = clean(c[iTrecho], 40).toUpperCase();
    if (!data || km === null || !trecho) { ignorados += 1; continue; }
    registros.push({ data, km, rodovia: trecho, concessionaria: clean(iConc >= 0 ? c[iConc] : concessionaria, 60) || clean(concessionaria, 60) });
  }
  if (!registros.length) return { ok: false, reason: "ANTT_SEM_REGISTROS", registros: [], total, ignorados };
  return { ok: true, registros, total, ignorados, cabecalho: cab };
}

const dentroDaJanela = (data, agora, meses) => {
  const t = Date.parse(`${data}T00:00:00Z`);
  return Number.isFinite(t) && agora - t <= meses * 30.44 * 24 * 60 * 60 * 1000 && t <= agora + 24 * 60 * 60 * 1000;
};
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Ocorrências da PRF → células geográficas (com UPS) e segmentos rodovia/km.
 * Só a janela pedida (padrão 24 meses) entra; o resto é ignorado e contado.
 */
export function agregarRiscoPrf(registros = [], { agora = Date.now(), janelaMeses = 24 } = {}) {
  const t0 = new Date(agora).getTime();
  const celulas = new Map();
  const segmentos = new Map();
  let foraDaJanela = 0;
  let semCoordenada = 0;
  for (const r of registros || []) {
    if (!r?.data || !dentroDaJanela(r.data, t0, janelaMeses)) { foraDaJanela += 1; continue; }
    const ups = r.ups ?? upsDaOcorrencia(r);
    if (Number.isFinite(r.km)) {
      const k = `${r.rodovia}|${Math.floor(r.km)}`;
      const seg = segmentos.get(k) || { rodovia: r.rodovia, km: Math.floor(r.km), acidentes: 0, mortos: 0, feridos: 0, ups: 0, primeiro: r.data, ultimo: r.data };
      seg.acidentes += 1; seg.mortos += r.mortos || 0; seg.feridos += (r.feridosGraves || 0) + (r.feridosLeves || 0); seg.ups += ups;
      if (r.data < seg.primeiro) seg.primeiro = r.data;
      if (r.data > seg.ultimo) seg.ultimo = r.data;
      segmentos.set(k, seg);
    }
    const cel = celulaDe(r.latitude, r.longitude);
    if (!cel) { semCoordenada += 1; continue; }
    const c = celulas.get(cel.chave) || { chave: cel.chave, lat: cel.lat, lon: cel.lon, acidentes: 0, mortos: 0, feridosGraves: 0, feridosLeves: 0, ups: 0, primeiro: r.data, ultimo: r.data, rodovias: new Set() };
    c.acidentes += 1; c.mortos += r.mortos || 0; c.feridosGraves += r.feridosGraves || 0; c.feridosLeves += r.feridosLeves || 0; c.ups += ups;
    if (r.data < c.primeiro) c.primeiro = r.data;
    if (r.data > c.ultimo) c.ultimo = r.data;
    if (r.rodovia) c.rodovias.add(r.rodovia);
    celulas.set(cel.chave, c);
  }
  return {
    version: ROAD_RISK_VERSION,
    janelaMeses,
    celulas: [...celulas.values()].map((c) => ({ ...c, rodovias: [...c.rodovias].sort().slice(0, 5) })).sort((a, b) => b.ups - a.ups),
    segmentos: [...segmentos.values()].sort((a, b) => b.ups - a.ups),
    foraDaJanela,
    semCoordenada,
  };
}

/** Ocorrências da ANTT → segmentos rodovia/km (UPS = 1 por acidente: a fonte não traz gravidade). */
export function agregarSegmentosAntt(registros = [], { agora = Date.now(), janelaMeses = 12 } = {}) {
  const t0 = new Date(agora).getTime();
  const segmentos = new Map();
  let foraDaJanela = 0;
  for (const r of registros || []) {
    if (!r?.data || !dentroDaJanela(r.data, t0, janelaMeses)) { foraDaJanela += 1; continue; }
    const k = `${r.rodovia}|${Math.floor(r.km)}`;
    const seg = segmentos.get(k) || { rodovia: r.rodovia, km: Math.floor(r.km), concessionaria: r.concessionaria || "", acidentes: 0, ups: 0, primeiro: r.data, ultimo: r.data };
    seg.acidentes += 1; seg.ups += UPS.semVitimas;
    if (r.data < seg.primeiro) seg.primeiro = r.data;
    if (r.data > seg.ultimo) seg.ultimo = r.data;
    segmentos.set(k, seg);
  }
  return { version: ROAD_RISK_VERSION, janelaMeses, segmentos: [...segmentos.values()].sort((a, b) => b.acidentes - a.acidentes), foraDaJanela, semSeveridade: true };
}

// Distância haversine em km.
const R = 6371;
const haversineKm = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** Aceita [[lat,lon]] ou [[lon,lat]] (GeoJSON) ou [{lat,lon}] → [{lat,lon}]. */
export function normalizarTracado(pontos = [], { ordem = "auto" } = {}) {
  const lista = (Array.isArray(pontos) ? pontos : []).map((p) => (Array.isArray(p) ? { a: Number(p[0]), b: Number(p[1]) } : { a: Number(p?.lat ?? p?.latitude), b: Number(p?.lon ?? p?.lng ?? p?.longitude), obj: true }))
    .filter((p) => Number.isFinite(p.a) && Number.isFinite(p.b));
  if (!lista.length) return [];
  let lonlat = ordem === "lonlat";
  if (ordem === "auto") {
    // Brasil: latitude ∈ [-34, 6], longitude ∈ [-74, -34]. Se o primeiro valor
    // está fora da faixa de latitude, a ordem é [lon, lat].
    lonlat = lista.some((p) => !p.obj && Math.abs(p.a) > 90) || (lista.every((p) => !p.obj && p.a < -34.5 && p.b > -34.5));
  }
  return lista.map((p) => (p.obj ? { lat: p.a, lon: p.b } : lonlat ? { lat: p.b, lon: p.a } : { lat: p.a, lon: p.b }));
}

/** Amostra o traçado a cada `passoKm` (inclui o primeiro e o último ponto). */
export function amostrarTracado(pontos = [], { passoKm = 0.25 } = {}) {
  const linha = normalizarTracado(pontos);
  if (linha.length < 2) return { amostras: linha, distanciaKm: 0 };
  const amostras = [linha[0]];
  let acumulado = 0;
  let desdeUltima = 0;
  for (let i = 1; i < linha.length; i += 1) {
    const a = linha[i - 1];
    const b = linha[i];
    const d = haversineKm(a, b);
    if (!(d > 0)) continue;
    let restante = d;
    while (desdeUltima + restante >= passoKm) {
      const falta = passoKm - desdeUltima;
      const f = (d - restante + falta) / d;
      amostras.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      restante -= falta;
      desdeUltima = 0;
    }
    desdeUltima += restante;
    acumulado += d;
  }
  amostras.push(linha[linha.length - 1]);
  return { amostras, distanciaKm: r2(acumulado) };
}

/**
 * Risco da rota a partir das células ingeridas (Map chave → célula). Sem célula
 * alguma ingerida → riskScore null e RISK_DATA_NOT_AVAILABLE (não é zero).
 */
export function riscoDaRota(pontos = [], celulasIndex = new Map(), { passoKm = 0.25, escalaUpsKm = ESCALA_RISCO_UPS_KM, temIndice = null, agora = Date.now() } = {}) {
  const { amostras, distanciaKm } = amostrarTracado(pontos, { passoKm });
  const indice = celulasIndex instanceof Map ? celulasIndex : new Map((celulasIndex || []).map((c) => [c.chave, c]));
  const existeIndice = temIndice === null ? indice.size > 0 : Boolean(temIndice);
  if (amostras.length < 2 || distanciaKm <= 0) return { version: ROAD_RISK_VERSION, riskScore: null, reason: "ROUTE_TOO_SHORT", distanciaKm, celulasTocadas: 0, celulasComRisco: 0 };
  if (!existeIndice) return { version: ROAD_RISK_VERSION, riskScore: null, reason: "RISK_DATA_NOT_AVAILABLE", distanciaKm, celulasTocadas: 0, celulasComRisco: 0, confidence: "UNKNOWN" };
  const tocadas = new Map();
  for (const p of amostras) {
    const cel = celulaDe(p.lat, p.lon);
    if (cel && !tocadas.has(cel.chave)) tocadas.set(cel.chave, cel);
  }
  let ups = 0; let acidentes = 0; let mortos = 0; let feridos = 0; let ultimo = "";
  const comRisco = [];
  for (const chave of tocadas.keys()) {
    const c = indice.get(chave);
    if (!c) continue;
    ups += c.ups || 0; acidentes += c.acidentes || 0; mortos += c.mortos || 0; feridos += (c.feridosGraves || 0) + (c.feridosLeves || 0);
    if (c.ultimo && c.ultimo > ultimo) ultimo = c.ultimo;
    comRisco.push({ chave, lat: c.lat, lon: c.lon, acidentes: c.acidentes || 0, mortos: c.mortos || 0, ups: c.ups || 0, rodovias: c.rodovias || [] });
  }
  comRisco.sort((a, b) => b.ups - a.ups);
  const upsPorKm = ups / distanciaKm;
  const riskScore = Math.round(100 * (1 - Math.exp(-upsPorKm / Math.max(1e-6, escalaUpsKm))));
  const idadeDias = ultimo ? (new Date(agora).getTime() - Date.parse(`${ultimo}T00:00:00Z`)) / (24 * 60 * 60 * 1000) : null;
  const confidence = !comRisco.length ? "MEDIUM" : idadeDias !== null && idadeDias <= 400 ? "HIGH" : "LOW";
  return {
    version: ROAD_RISK_VERSION,
    riskScore,
    upsTotal: r2(ups),
    upsPorKm: r2(upsPorKm),
    distanciaKm,
    celulasTocadas: tocadas.size,
    celulasComRisco: comRisco.length,
    acidentes,
    mortos,
    feridos,
    ultimoRegistro: ultimo || null,
    trechosCriticos: comRisco.slice(0, 5),
    confidence,
    escalaUpsKm,
    metodologia: [
      "Ocorrências da PRF agregadas em células de ~1,1 km com UPS (sem vítima 1, feridos 5, mortos 13).",
      `Score = 100 × (1 − e^(−UPS/km ÷ ${escalaUpsKm})) sobre as células que a rota atravessa; 0 significa nenhuma ocorrência registrada na janela, não ausência de risco.`,
      "O score entra como custo na comparação de alternativas (routeAlternativesDomain); não bloqueia rota.",
    ],
  };
}

/** Rodovias da rota (refs tipo "BR-381") × segmentos ANTT/PRF → avisos por rodovia. */
export function avisosPorRodovia(refs = [], segmentos = []) {
  const avisos = [];
  for (const ref of [...new Set((refs || []).map((r) => clean(r, 20).toUpperCase()).filter(Boolean))]) {
    const chave = ref.replace(/\s+/g, "");
    const doRef = (segmentos || []).filter((s) => String(s.rodovia || "").toUpperCase().replace(/\s+/g, "").startsWith(chave));
    if (!doRef.length) continue;
    const acidentes = doRef.reduce((s, x) => s + (x.acidentes || 0), 0);
    const critico = [...doRef].sort((a, b) => (b.ups || b.acidentes) - (a.ups || a.acidentes))[0];
    avisos.push({ rodovia: ref, segmentos: doRef.length, acidentes, kmCritico: critico?.km ?? null, acidentesKmCritico: critico?.acidentes ?? null, fonte: critico?.concessionaria ? "antt" : "prf" });
  }
  return avisos.sort((a, b) => b.acidentes - a.acidentes);
}
