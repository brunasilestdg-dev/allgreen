// ===== Risk Map: risco viário histórico (PRF · ANTT) como custo da rota =====
// Seções 14–15 e 71–74. Índice público (tenant) em D1:
//   • células de ~1,1 km com UPS (PRF, acidentes por ocorrência com lat/lon),
//     ingeridas por IMPORTAÇÃO do CSV oficial (os arquivos da PRF ficam em
//     links de armazenamento sem API estável — sem arquivo, o risco é
//     RISK_DATA_NOT_AVAILABLE, nunca zero);
//   • segmentos rodovia/km (ANTT, demonstrativo de acidentes por km das
//     concessionárias — descoberto pelo CKAN, um recurso por disparo do cron).
// `POST /api/todogreen/risk/route` recebe o traçado e devolve o risk score
// (0–100), trechos críticos e avisos por rodovia; o motor de rotas usa o mesmo
// cálculo para ranquear alternativas (routeAlternativesDomain). Regra pura em
// roadRiskDomain; aqui só D1, rede e permissão.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { CRON_EXTERNAL_DISABLED_KEY, REFERENCE_SYNC_TABLE, baixarTexto, cronExternoDesligado, estadoDaFonte, gravarSyncDeReferencia, lerSyncsDeReferencia } from "./reference-sync.js";
import {
  agregarRiscoPrf,
  agregarSegmentosAntt,
  avisosPorRodovia,
  celulaDe,
  normalizarTracado,
  parseAcidentesAnttPorKm,
  parseAcidentesPrf,
  riscoDaRota,
} from "../../src/features/logistics/roadRiskDomain.js";

export const RISK_ENV_KEYS = Object.freeze({
  anttBase: "TDG_ANTT_BASE_URL",
  anttPackage: "TDG_ANTT_ACIDENTES_PACKAGE",
  disabled: "TDG_ROAD_RISK_DISABLED",
});
const ANTT_BASE_PADRAO = "https://dados.antt.gov.br";
const ANTT_PACKAGE_PADRAO = "acidentes-quilometro-rodovias";

export const RISK_LIMITS = Object.freeze({
  prfMaxBytes: 40 * 1024 * 1024,
  anttMaxBytes: 12 * 1024 * 1024,
  prfJanelaMeses: 24,
  anttJanelaMeses: 12,
  anttRefreshMs: 30 * 24 * 60 * 60 * 1000,
  cronAnttPorRodada: 1,
  frescorPrfMs: 400 * 24 * 60 * 60 * 1000,
  frescorAnttMs: 45 * 24 * 60 * 60 * 1000,
});

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const agora = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
const desligado = (env) => String(env?.[RISK_ENV_KEYS.disabled] || "") === "1";
const parseJson = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const PODE_INGERIR = ["operations:manage", "operation:manage", "planning:manage", "tms:manage", "integration:manage"];
const canIngest = (access) => PODE_INGERIR.some((p) => podeNaVertical(access, p));
const slug = (v) => texto(v, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- PRF: importação do CSV oficial → células + segmentos ----
export async function importarAcidentesPrf(env, csvText, { now = new Date(), janelaMeses = RISK_LIMITS.prfJanelaMeses, origem = "prf-import" } = {}) {
  const source = "prf:import";
  const inicio = Date.now();
  try {
    if (String(csvText || "").length > RISK_LIMITS.prfMaxBytes) throw new Error("arquivo maior que o teto");
    const parsed = parseAcidentesPrf(csvText);
    if (!parsed.ok) throw new Error(parsed.reason);
    const ag = agregarRiscoPrf(parsed.registros, { agora: new Date(now).getTime(), janelaMeses });
    const ts = agora(now);
    // Células: a importação de um arquivo (ano) SOMA à célula existente quando
    // vem de outro período; o mesmo arquivo reimportado substitui (id por célula
    // + primeiro/último iguais). Para manter simples e honesto: substitui a
    // célula inteira — o operador importa a série completa da janela.
    const stCel = ag.celulas.map((c) => env.DB.prepare(
      `INSERT INTO todogreen_road_risk_cells (id, tenant_id, source, lat, lon, acidentes, mortos, feridos_graves, feridos_leves, ups, rodovias_json, primeiro, ultimo, janela_meses, ingested_at)
       VALUES (?, ?, 'prf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET acidentes = excluded.acidentes, mortos = excluded.mortos, feridos_graves = excluded.feridos_graves, feridos_leves = excluded.feridos_leves, ups = excluded.ups,
         rodovias_json = excluded.rodovias_json, primeiro = excluded.primeiro, ultimo = excluded.ultimo, janela_meses = excluded.janela_meses, ingested_at = excluded.ingested_at`,
    ).bind(`prf|${c.chave}`, TENANT_ID, c.lat, c.lon, c.acidentes, c.mortos, c.feridosGraves, c.feridosLeves, c.ups, JSON.stringify(c.rodovias), c.primeiro, c.ultimo, janelaMeses, ts));
    const stSeg = ag.segmentos.map((sg) => env.DB.prepare(
      `INSERT INTO todogreen_road_risk_segments (id, tenant_id, source, rodovia, km, concessionaria, acidentes, mortos, feridos, ups, primeiro, ultimo, janela_meses, ingested_at)
       VALUES (?, ?, 'prf', ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET acidentes = excluded.acidentes, mortos = excluded.mortos, feridos = excluded.feridos, ups = excluded.ups, primeiro = excluded.primeiro, ultimo = excluded.ultimo, janela_meses = excluded.janela_meses, ingested_at = excluded.ingested_at`,
    ).bind(`prf|${sg.rodovia}|${sg.km}`, TENANT_ID, sg.rodovia, sg.km, sg.acidentes, sg.mortos, sg.feridos, sg.ups, sg.primeiro, sg.ultimo, janelaMeses, ts));
    for (const parte of chunk([...stCel, ...stSeg], 50)) await env.DB.batch(parte);
    const sourceUpdatedAt = parsed.registros.reduce((m, r) => (r.data > m ? r.data : m), "");
    await gravarSyncDeReferencia(env, source, { ok: true, records: parsed.registros.length, sourceUpdatedAt, latencyMs: Date.now() - inicio, detail: { celulas: ag.celulas.length, segmentos: ag.segmentos.length, foraDaJanela: ag.foraDaJanela, semCoordenada: ag.semCoordenada, ignorados: parsed.ignorados, origem }, now });
    return { ok: true, source, records: parsed.registros.length, celulas: ag.celulas.length, segmentos: ag.segmentos.length, foraDaJanela: ag.foraDaJanela, semCoordenada: ag.semCoordenada, ignorados: parsed.ignorados, sourceUpdatedAt };
  } catch (error) {
    const msg = texto(error?.message || error, 300);
    await gravarSyncDeReferencia(env, source, { ok: false, error: msg, latencyMs: Date.now() - inicio, now }).catch(() => {});
    return { ok: false, source, error: msg };
  }
}

// ---- ANTT: recursos CSV do pacote no CKAN → segmentos por rodovia/km ----
export function urlPacoteAntt(env) {
  const b = (texto(env?.[RISK_ENV_KEYS.anttBase], 200) || ANTT_BASE_PADRAO).replace(/\/$/, "");
  const pkg = texto(env?.[RISK_ENV_KEYS.anttPackage], 120) || ANTT_PACKAGE_PADRAO;
  return `${b}/api/3/action/package_show?id=${encodeURIComponent(pkg)}`;
}

export async function listarRecursosAntt(env, { fetcher = fetch } = {}) {
  const { text } = await baixarTexto(fetcher, urlPacoteAntt(env), { maxBytes: 2 * 1024 * 1024, accept: "application/json" });
  const payload = parseJson(text, null);
  const recursos = payload?.result?.resources;
  if (!Array.isArray(recursos)) throw new Error("pacote da ANTT sem `resources`");
  return recursos
    .filter((r) => String(r.format || "").toUpperCase() === "CSV" && r.url)
    .map((r) => ({ id: texto(r.id, 80), nome: texto(r.name, 120), url: texto(r.url, 400), size: Number(r.size) || null, lastModified: texto(r.last_modified || r.metadata_modified, 40), concessionaria: texto(r.name, 120).split(/[-–]/).pop().trim() }));
}

export async function sincronizarRecursoAntt(env, recurso, { fetcher = fetch, now = new Date(), janelaMeses = RISK_LIMITS.anttJanelaMeses } = {}) {
  const source = `antt:${slug(recurso?.nome || recurso?.id || "recurso")}`;
  const inicio = Date.now();
  try {
    if (recurso?.size && recurso.size > RISK_LIMITS.anttMaxBytes) throw new Error(`recurso maior que o teto (${recurso.size} bytes)`);
    const { text } = await baixarTexto(fetcher, recurso.url, { maxBytes: RISK_LIMITS.anttMaxBytes });
    const parsed = parseAcidentesAnttPorKm(text, { concessionaria: recurso.concessionaria || "" });
    if (!parsed.ok) throw new Error(parsed.reason);
    const ag = agregarSegmentosAntt(parsed.registros, { agora: new Date(now).getTime(), janelaMeses });
    const ts = agora(now);
    const stmts = ag.segmentos.map((sg) => env.DB.prepare(
      `INSERT INTO todogreen_road_risk_segments (id, tenant_id, source, rodovia, km, concessionaria, acidentes, mortos, feridos, ups, primeiro, ultimo, janela_meses, ingested_at)
       VALUES (?, ?, 'antt', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET concessionaria = excluded.concessionaria, acidentes = excluded.acidentes, ups = excluded.ups, primeiro = excluded.primeiro, ultimo = excluded.ultimo, janela_meses = excluded.janela_meses, ingested_at = excluded.ingested_at`,
    ).bind(`antt|${sg.rodovia}|${sg.km}|${slug(sg.concessionaria)}`, TENANT_ID, sg.rodovia, sg.km, sg.concessionaria, sg.acidentes, sg.ups, sg.primeiro, sg.ultimo, janelaMeses, ts));
    for (const parte of chunk(stmts, 50)) await env.DB.batch(parte);
    const sourceUpdatedAt = parsed.registros.reduce((m, r) => (r.data > m ? r.data : m), "");
    await gravarSyncDeReferencia(env, source, { ok: true, records: parsed.registros.length, sourceUpdatedAt, latencyMs: Date.now() - inicio, detail: { segmentos: ag.segmentos.length, foraDaJanela: ag.foraDaJanela, recurso: recurso.nome, url: recurso.url }, now });
    return { ok: true, source, records: parsed.registros.length, segmentos: ag.segmentos.length, foraDaJanela: ag.foraDaJanela, sourceUpdatedAt };
  } catch (error) {
    const msg = texto(error?.message || error, 300);
    await gravarSyncDeReferencia(env, source, { ok: false, error: msg, latencyMs: Date.now() - inicio, detail: { recurso: recurso?.nome || "", url: recurso?.url || "" }, now }).catch(() => {});
    return { ok: false, source, error: msg };
  }
}

/** Um disparo: descobre os recursos e sincroniza os `porRodada` mais vencidos. */
export async function sincronizarAntt(env, { fetcher = fetch, now = new Date(), porRodada = RISK_LIMITS.cronAnttPorRodada, refreshMs = RISK_LIMITS.anttRefreshMs } = {}) {
  const t = new Date(now).getTime();
  let recursos;
  try {
    recursos = await listarRecursosAntt(env, { fetcher });
  } catch (error) {
    const msg = texto(error?.message || error, 300);
    await gravarSyncDeReferencia(env, "antt:catalogo", { ok: false, error: msg, now }).catch(() => {});
    return { ok: false, error: msg, recursos: 0, sincronizados: [] };
  }
  await gravarSyncDeReferencia(env, "antt:catalogo", { ok: true, records: recursos.length, sourceUpdatedAt: recursos.reduce((m, r) => (r.lastModified > m ? r.lastModified : m), ""), now });
  const syncs = await lerSyncsDeReferencia(env, ["antt:"]);
  const porFonte = new Map(syncs.map((s) => [s.source, s]));
  const vencidos = recursos
    .map((r) => ({ r, s: porFonte.get(`antt:${slug(r.nome || r.id)}`) }))
    .filter(({ s }) => {
      const ok = s?.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
      const tentativa = s?.lastAttemptAt ? Date.parse(s.lastAttemptAt) : NaN;
      if (Number.isFinite(ok) && t - ok < refreshMs) return false;
      if (Number.isFinite(tentativa) && t - tentativa < 55 * 60 * 1000) return false;
      return true;
    })
    .sort((a, b) => String(a.s?.lastSuccessAt || "").localeCompare(String(b.s?.lastSuccessAt || "")))
    .slice(0, Math.max(1, porRodada));
  const sincronizados = [];
  for (const { r } of vencidos) sincronizados.push(await sincronizarRecursoAntt(env, r, { fetcher, now }));
  return { ok: true, recursos: recursos.length, pendentes: Math.max(0, vencidos.length - sincronizados.length), sincronizados };
}

// ---- Índice em memória para uma consulta ----
async function celulasDoTracado(env, pontos) {
  // Só as células que a rota toca (e as vizinhas) saem do banco: o índice
  // nacional pode ter dezenas de milhares de células.
  const linha = normalizarTracado(pontos);
  const chaves = new Set();
  for (const p of linha) {
    const c = celulaDe(p.lat, p.lon);
    if (!c) continue;
    const [i, j] = c.chave.split("_").map(Number);
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) chaves.add(`prf|${i + di}_${j + dj}`);
  }
  // Amostras intermediárias ficam a cargo de riscoDaRota; aqui garantimos as
  // células dos vértices + vizinhas; para trechos longos entre vértices,
  // acrescentamos pontos interpolados a cada ~0,5 km.
  for (let k = 1; k < linha.length; k += 1) {
    const a = linha[k - 1];
    const b = linha[k];
    const passos = Math.min(400, Math.ceil(Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lon - a.lon)) / 0.005));
    for (let s = 1; s < passos; s += 1) {
      const c = celulaDe(a.lat + (b.lat - a.lat) * (s / passos), a.lon + (b.lon - a.lon) * (s / passos));
      if (c) chaves.add(`prf|${c.chave}`);
    }
  }
  const lista = [...chaves];
  const indice = new Map();
  for (const parte of chunk(lista, 90)) {
    const rows = await env.DB.prepare(`SELECT id, lat, lon, acidentes, mortos, feridos_graves, feridos_leves, ups, rodovias_json, primeiro, ultimo FROM todogreen_road_risk_cells WHERE tenant_id = ? AND id IN (${parte.map(() => "?").join(",")})`)
      .bind(TENANT_ID, ...parte).all().then((r) => r.results || []).catch(() => []);
    for (const row of rows) indice.set(row.id.replace(/^prf\|/, ""), { chave: row.id.replace(/^prf\|/, ""), lat: row.lat, lon: row.lon, acidentes: row.acidentes, mortos: row.mortos, feridosGraves: row.feridos_graves, feridosLeves: row.feridos_leves, ups: row.ups, rodovias: parseJson(row.rodovias_json, []), primeiro: row.primeiro, ultimo: row.ultimo });
  }
  return indice;
}

async function temIndicePrf(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM todogreen_road_risk_cells WHERE tenant_id = ?`).bind(TENANT_ID).first().catch(() => null);
  return Number(row?.n) > 0;
}

async function segmentosDasRodovias(env, refs = []) {
  const chaves = [...new Set(refs.map((r) => texto(r, 20).toUpperCase().replace(/\s+/g, "")).filter(Boolean))].slice(0, 12);
  if (!chaves.length) return [];
  const cond = chaves.map(() => "UPPER(REPLACE(rodovia, ' ', '')) LIKE ?").join(" OR ");
  return env.DB.prepare(`SELECT source, rodovia, km, concessionaria, acidentes, mortos, feridos, ups, ultimo FROM todogreen_road_risk_segments WHERE tenant_id = ? AND (${cond}) LIMIT 4000`)
    .bind(TENANT_ID, ...chaves.map((c) => `${c}%`)).all().then((r) => r.results || []).catch(() => []);
}

/**
 * Risco de UM traçado: score pelas células PRF + avisos por rodovia (refs
 * vindas dos passos do motor de rota, ex.: ["BR-116", "BR-381"]).
 */
export async function riscoDoTracado(env, pontos, { refs = [], now = new Date() } = {}) {
  if (!env?.DB) return { riskScore: null, reason: "RISK_DATA_NOT_AVAILABLE" };
  const [indice, existe] = await Promise.all([celulasDoTracado(env, pontos), temIndicePrf(env)]);
  const risco = riscoDaRota(pontos, indice, { temIndice: existe, agora: new Date(now).getTime() });
  const segmentos = refs.length ? await segmentosDasRodovias(env, refs) : [];
  return { ...risco, avisosRodovias: avisosPorRodovia(refs, segmentos), fontes: { prf: existe, antt: segmentos.some((s) => s.source === "antt") } };
}

/** Estado das fontes para a Saúde do sistema. */
export async function estadoDoRiscoViario(env, { now = new Date() } = {}) {
  const syncs = await lerSyncsDeReferencia(env, ["prf:", "antt:"], { table: REFERENCE_SYNC_TABLE });
  const prf = syncs.find((s) => s.source === "prf:import") || null;
  const antt = syncs.filter((s) => s.source.startsWith("antt:") && s.source !== "antt:catalogo");
  const anttOk = antt.filter((s) => s.lastSuccessAt).sort((a, b) => b.lastSuccessAt.localeCompare(a.lastSuccessAt));
  const anttUltimo = antt.sort((a, b) => String(b.lastAttemptAt).localeCompare(String(a.lastAttemptAt)))[0] || syncs.find((s) => s.source === "antt:catalogo") || null;
  const configured = !desligado(env);
  const totais = env?.DB ? await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM todogreen_road_risk_cells WHERE tenant_id = ?) AS celulas, (SELECT COUNT(*) FROM todogreen_road_risk_segments WHERE tenant_id = ? AND source = 'antt') AS segmentosAntt, (SELECT COUNT(*) FROM todogreen_road_risk_segments WHERE tenant_id = ? AND source = 'prf') AS segmentosPrf`).bind(TENANT_ID, TENANT_ID, TENANT_ID).first().catch(() => null) : null;
  const anttAgregado = anttOk.length
    ? { ...anttOk[0], records: antt.reduce((s, x) => s + (x.records || 0), 0), lastAttemptAt: anttUltimo?.lastAttemptAt || anttOk[0].lastAttemptAt, error: anttUltimo?.status === "error" ? anttUltimo.error : "", status: anttUltimo?.status === "error" ? "error" : "ok", detail: { recursosSincronizados: anttOk.length } }
    : anttUltimo;
  return {
    disabled: !configured,
    prf: estadoDaFonte(prf, { now, frescorMs: RISK_LIMITS.frescorPrfMs, configured, requirement: prf?.lastSuccessAt ? "" : "Importar o CSV oficial de acidentes da PRF em POST /api/todogreen/risk/import/prf" }),
    antt: estadoDaFonte(anttAgregado, { now, frescorMs: RISK_LIMITS.frescorAnttMs, configured }),
    indice: { celulasPrf: Number(totais?.celulas) || 0, segmentosAntt: Number(totais?.segmentosAntt) || 0, segmentosPrf: Number(totais?.segmentosPrf) || 0 },
  };
}

// ---- Cron: ANTT um recurso por hora (40 concessionárias ≈ 2 dias; refresh 30 d) ----
export async function runTodoGreenRoadRiskScheduled(env, now = new Date(), { fetcher = fetch } = {}) {
  if (!env?.DB) return { skipped: "sem D1" };
  if (desligado(env)) return { skipped: RISK_ENV_KEYS.disabled };
  if (cronExternoDesligado(env)) return { skipped: CRON_EXTERNAL_DISABLED_KEY };
  return { antt: await sincronizarAntt(env, { fetcher, now }) };
}

// ---- HTTP ----
export async function handleTodoGreenRoadRisk(request, env, access, user, url = new URL(request.url), { fetcher = fetch, now = new Date() } = {}) {
  if (!url.pathname.startsWith("/api/todogreen/risk")) return null;
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  const parts = url.pathname.split("/").filter(Boolean); // api, todogreen, risk, <sub>, <sub2>
  const sub = parts[3] || "";
  const sub2 = parts[4] || "";

  if (sub === "status" && request.method === "GET") return json(await estadoDoRiscoViario(env, { now }));
  if (sub === "route" && request.method === "POST") {
    const corpo = await request.json().catch(() => null);
    const pontos = corpo?.polyline || corpo?.geometry || corpo?.coordinates || corpo?.pontos;
    if (!Array.isArray(pontos) || pontos.length < 2) return json({ error: "Envie o traçado da rota (polyline com pelo menos dois pontos)." }, 400);
    const refs = Array.isArray(corpo?.refs) ? corpo.refs.map((r) => texto(r, 20)).filter(Boolean).slice(0, 12) : [];
    return json(await riscoDoTracado(env, pontos.slice(0, 5000), { refs, now }));
  }
  if (sub === "import" && sub2 === "prf" && request.method === "POST") {
    if (!canIngest(access)) return json({ error: "Sem permissão para importar dados de risco." }, 403);
    if (desligado(env)) return json({ error: `Risk Map desligado por ${RISK_ENV_KEYS.disabled}.`, code: "ROAD_RISK_DISABLED" }, 409);
    const declarado = Number(request.headers.get("content-length") || 0);
    if (declarado > RISK_LIMITS.prfMaxBytes) return json({ error: "Arquivo maior que o limite." }, 413);
    const csvText = await request.text();
    if (!csvText.trim()) return json({ error: "Envie o CSV de acidentes da PRF no corpo da requisição." }, 400);
    const resultado = await importarAcidentesPrf(env, csvText, { now });
    await registrarAuditoriaTodoGreen(env, { access, user, action: "risk.import.prf", resourceType: "road_risk", resourceId: "prf", after: resultado, details: resultado.ok ? `PRF: ${resultado.records} ocorrências → ${resultado.celulas} células` : `Falhou: ${resultado.error || ""}` });
    return json({ resultado, estado: await estadoDoRiscoViario(env, { now }) }, resultado.ok ? 201 : 400);
  }
  if (sub === "sync" && sub2 === "antt" && request.method === "POST") {
    if (!canIngest(access)) return json({ error: "Sem permissão para sincronizar dados de risco." }, 403);
    if (desligado(env)) return json({ error: `Risk Map desligado por ${RISK_ENV_KEYS.disabled}.`, code: "ROAD_RISK_DISABLED" }, 409);
    const corpo = await request.json().catch(() => ({}));
    const resultado = await sincronizarAntt(env, { fetcher, now, porRodada: Math.min(5, Math.max(1, Number(corpo?.porRodada) || 1)) });
    await registrarAuditoriaTodoGreen(env, { access, user, action: "risk.sync.antt", resourceType: "road_risk", resourceId: "antt", after: resultado, details: resultado.ok ? `ANTT: ${resultado.sincronizados.length} recurso(s) sincronizado(s)` : `Falhou: ${resultado.error || ""}` });
    return json({ resultado, estado: await estadoDoRiscoViario(env, { now }) }, resultado.ok ? 200 : 502);
  }
  return json({ error: "Rota de risco viário desconhecida." }, 404);
}
