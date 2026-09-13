// ===== Sinais de mercado estruturados: PNCP · Compras.gov.br · GDELT =====
// Seções 66–70. Complementa o radar por busca web (todogreen-market-radar.js)
// com FONTES ESTRUTURADAS públicas, sem chave:
//   • PNCP — API de busca do portal (editais recebendo proposta) por termos de
//     transporte/logística/eletrificação;
//   • Compras.gov.br — contratações da Lei 14.133 publicadas no PNCP (pregão e
//     concorrência), últimos dias;
//   • GDELT — notícias (DOC 2.0, artlist) com termos do setor, país BR; limite
//     da fonte: 1 consulta a cada 5 s → UMA consulta por disparo do cron.
// Cada item vira um market_signal (marketSignalDomain): fingerprint estável
// (dedupe entre fontes/execuções), score explicável e motivo de rejeição. Os
// sinais são públicos (tenant); a triagem (novo/triado/descartado/convertido) é
// por espaço. Toda a regra é pura; aqui só há D1, rede e permissão.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { REFERENCE_SYNC_TABLE, baixarTexto, estadoDaFonte, gravarSyncDeReferencia, lerSyncsDeReferencia } from "./reference-sync.js";
import {
  SIGNAL_STATUS,
  classificarSinais,
  normalizarArtigoGdelt,
  normalizarBuscaPncp,
  normalizarContratacaoPncp,
} from "../../src/features/logistics/marketSignalDomain.js";

export const MARKET_ENV_KEYS = Object.freeze({
  pncpBase: "TDG_PNCP_BASE_URL",
  comprasBase: "TDG_COMPRAS_GOV_BASE_URL",
  comprasModalidades: "TDG_COMPRAS_GOV_MODALIDADES",
  gdeltBase: "TDG_GDELT_BASE_URL",
  disabled: "TDG_MARKET_SIGNALS_DISABLED",
});
const PNCP_BASE_PADRAO = "https://pncp.gov.br";
const COMPRAS_BASE_PADRAO = "https://dadosabertos.compras.gov.br";
const GDELT_BASE_PADRAO = "https://api.gdeltproject.org";

// Termos de busca (PNCP) e de notícia (GDELT). Curtos e concretos: a busca do
// PNCP é textual; o GDELT aceita frases entre aspas.
export const TERMOS_PNCP = Object.freeze(["transporte de cargas", "serviços de transporte", "frete", "logística", "distribuição de mercadorias", "veículos elétricos"]);
export const TERMOS_GDELT = Object.freeze(['"caminhão elétrico"', '"frota elétrica"', '"transporte de cargas" elétrico', '"logística" descarbonização', '"veículos elétricos" logística']);
// Compras.gov: códigos próprios de modalidade (5 = pregão, 3 = concorrência).
const MODALIDADES_COMPRAS_PADRAO = [5, 3];

export const MARKET_LIMITS = Object.freeze({
  pncpPagina: 20,
  comprasPagina: 50,
  comprasDias: 3,
  gdeltMaxRecords: 75,
  gdeltTimespan: "7d",
  maxBytes: 6 * 1024 * 1024,
  cronPncpMs: 6 * 60 * 60 * 1000,
  cronComprasMs: 24 * 60 * 60 * 1000,
  cronGdeltMs: 60 * 60 * 1000,
  frescorPncpMs: 2 * 24 * 60 * 60 * 1000,
  frescorComprasMs: 3 * 24 * 60 * 60 * 1000,
  frescorGdeltMs: 3 * 24 * 60 * 60 * 1000,
  retencaoDias: 120,
});

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const agora = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
const desligado = (env) => String(env?.[MARKET_ENV_KEYS.disabled] || "") === "1";
const parseJson = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const podeLer = (access) => podeNaVertical(access, "market:read") || podeNaVertical(access, "market:research");
const podePesquisar = (access) => podeNaVertical(access, "market:research");
const base = (env, key, padrao) => (texto(env?.[key], 200) || padrao).replace(/\/$/, "");

// ---- URLs das fontes ----
export function urlBuscaPncp(env, termo, { pagina = 1, tamanho = MARKET_LIMITS.pncpPagina } = {}) {
  const params = new URLSearchParams({ q: termo, tipos_documento: "edital", ordenacao: "-data", pagina: String(pagina), tam_pagina: String(tamanho), status: "recebendo_proposta" });
  return `${base(env, MARKET_ENV_KEYS.pncpBase, PNCP_BASE_PADRAO)}/api/search/?${params}`;
}
export function urlContratacoesComprasGov(env, { inicio, fim, modalidade, pagina = 1, tamanho = MARKET_LIMITS.comprasPagina, uf = "" } = {}) {
  const params = new URLSearchParams({ dataPublicacaoPncpInicial: inicio, dataPublicacaoPncpFinal: fim, codigoModalidade: String(modalidade), pagina: String(pagina), tamanhoPagina: String(tamanho) });
  if (uf) params.set("unidadeOrgaoUfSigla", uf);
  return `${base(env, MARKET_ENV_KEYS.comprasBase, COMPRAS_BASE_PADRAO)}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?${params}`;
}
export function urlGdelt(env, termo, { maxrecords = MARKET_LIMITS.gdeltMaxRecords, timespan = MARKET_LIMITS.gdeltTimespan } = {}) {
  const params = new URLSearchParams({ query: `${termo} sourcecountry:BR`, mode: "artlist", maxrecords: String(maxrecords), format: "json", timespan });
  return `${base(env, MARKET_ENV_KEYS.gdeltBase, GDELT_BASE_PADRAO)}/api/v2/doc/doc?${params}`;
}
const modalidadesCompras = (env) => {
  const lista = texto(env?.[MARKET_ENV_KEYS.comprasModalidades], 60).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return lista.length ? lista : MODALIDADES_COMPRAS_PADRAO;
};

// ---- Persistência dos sinais ----
async function gravarSinais(env, sinais, { now, queryText = "" } = {}) {
  if (!env?.DB || !sinais.length) return 0;
  const ts = agora(now);
  const stmts = sinais.map((s) => env.DB.prepare(
    `INSERT INTO todogreen_market_signals (id, tenant_id, fingerprint, source, sources_json, kind, external_id, title, summary, url, orgao, uf, municipio, esfera, modalidade, situacao, valor_estimado, publicado_em, prazo_proposta, dominio, idioma, score, score_reasons_json, query_text, seen_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(tenant_id, fingerprint) DO UPDATE SET
       sources_json = excluded.sources_json, title = excluded.title, summary = excluded.summary, url = CASE WHEN excluded.url <> '' THEN excluded.url ELSE todogreen_market_signals.url END,
       orgao = excluded.orgao, uf = excluded.uf, municipio = excluded.municipio, modalidade = excluded.modalidade, situacao = excluded.situacao,
       valor_estimado = COALESCE(excluded.valor_estimado, todogreen_market_signals.valor_estimado), publicado_em = excluded.publicado_em, prazo_proposta = excluded.prazo_proposta,
       score = excluded.score, score_reasons_json = excluded.score_reasons_json, query_text = excluded.query_text,
       seen_count = todogreen_market_signals.seen_count + 1, last_seen_at = excluded.last_seen_at`,
  ).bind(
    `ms-${s.fingerprint}`, TENANT_ID, s.fingerprint, s.source, JSON.stringify(s.sources || [s.source]), s.kind, s.externalId || "", texto(s.title, 200) || "(sem título)", texto(s.summary, 900), s.url || "",
    s.orgao || "", s.uf || "", s.municipio || "", s.esfera || "", s.modalidade || "", s.situacao || "", s.valorEstimado ?? null, s.publicadoEm || "", s.prazoProposta || "", s.dominio || "", s.idioma || "",
    Math.trunc(s.score) || 0, JSON.stringify(s.scoreReasons || []), texto(queryText, 120), ts, ts,
  ));
  for (const parte of chunk(stmts, 50)) await env.DB.batch(parte);
  return sinais.length;
}

async function expurgarSinaisVelhos(env, now) {
  const corte = new Date(new Date(agora(now)).getTime() - MARKET_LIMITS.retencaoDias * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM todogreen_market_signals WHERE tenant_id = ? AND last_seen_at < ? AND (prazo_proposta = '' OR prazo_proposta < ?)`).bind(TENANT_ID, corte, corte).run().catch(() => {});
}

// ---- Sincronizações (rede injetável) ----
export async function sincronizarPncp(env, { fetcher = fetch, now = new Date(), termos = TERMOS_PNCP, ufsFoco = [] } = {}) {
  const source = "pncp:busca";
  const inicio = Date.now();
  const brutos = [];
  const falhas = [];
  for (const termo of termos) {
    try {
      const { text } = await baixarTexto(fetcher, urlBuscaPncp(env, termo), { maxBytes: MARKET_LIMITS.maxBytes, accept: "application/json" });
      const payload = parseJson(text, null);
      if (!payload || !Array.isArray(payload.items)) throw new Error("resposta sem `items`");
      for (const item of payload.items) brutos.push({ ...normalizarBuscaPncp(item), queryText: termo });
    } catch (error) {
      falhas.push({ termo, error: texto(error?.message || error, 200) });
    }
  }
  if (!brutos.length && falhas.length) {
    const msg = `PNCP indisponível: ${falhas.map((f) => `${f.termo}: ${f.error}`).join("; ")}`.slice(0, 300);
    await gravarSyncDeReferencia(env, source, { ok: false, error: msg, latencyMs: Date.now() - inicio, now });
    return { ok: false, source, error: msg, falhas };
  }
  const { aceitos, rejeitados } = classificarSinais(brutos, { agora: new Date(now).getTime(), ufsFoco });
  const gravados = await gravarSinais(env, aceitos, { now, queryText: termos.join(" | ") });
  const sourceUpdatedAt = brutos.reduce((m, s) => (s.publicadoEm > m ? s.publicadoEm : m), "");
  await gravarSyncDeReferencia(env, source, { ok: true, records: brutos.length, sourceUpdatedAt, latencyMs: Date.now() - inicio, detail: { aceitos: aceitos.length, rejeitados, falhas, termos: termos.length }, now });
  return { ok: true, source, records: brutos.length, aceitos: gravados, rejeitados, falhas, sourceUpdatedAt };
}

export async function sincronizarComprasGov(env, { fetcher = fetch, now = new Date(), dias = MARKET_LIMITS.comprasDias, ufsFoco = [], maxPaginas = 4 } = {}) {
  const source = "compras-gov:contratacoes";
  const inicio = Date.now();
  const fim = new Date(now).toISOString().slice(0, 10);
  const ini = new Date(new Date(now).getTime() - Math.max(1, dias) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const brutos = [];
  const falhas = [];
  for (const modalidade of modalidadesCompras(env)) {
    for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
      try {
        const { text } = await baixarTexto(fetcher, urlContratacoesComprasGov(env, { inicio: ini, fim, modalidade, pagina }), { maxBytes: MARKET_LIMITS.maxBytes, accept: "application/json" });
        const payload = parseJson(text, null);
        const lista = payload?.resultado;
        if (!Array.isArray(lista)) throw new Error("resposta sem `resultado`");
        for (const item of lista) brutos.push({ ...normalizarContratacaoPncp(item, { source: "compras-gov" }), queryText: `modalidade ${modalidade}` });
        if (!(Number(payload.paginasRestantes) > 0)) break;
      } catch (error) {
        falhas.push({ modalidade, pagina, error: texto(error?.message || error, 200) });
        break;
      }
    }
  }
  if (!brutos.length && falhas.length) {
    const msg = `Compras.gov indisponível: ${falhas.map((f) => f.error).join("; ")}`.slice(0, 300);
    await gravarSyncDeReferencia(env, source, { ok: false, error: msg, latencyMs: Date.now() - inicio, now });
    return { ok: false, source, error: msg, falhas };
  }
  const { aceitos, rejeitados } = classificarSinais(brutos, { agora: new Date(now).getTime(), ufsFoco });
  const gravados = await gravarSinais(env, aceitos, { now, queryText: `Compras.gov ${ini}..${fim}` });
  const sourceUpdatedAt = brutos.reduce((m, s) => (s.publicadoEm > m ? s.publicadoEm : m), "");
  await gravarSyncDeReferencia(env, source, { ok: true, records: brutos.length, sourceUpdatedAt, latencyMs: Date.now() - inicio, detail: { aceitos: aceitos.length, rejeitados, falhas, periodo: `${ini}..${fim}` }, now });
  return { ok: true, source, records: brutos.length, aceitos: gravados, rejeitados, falhas, sourceUpdatedAt };
}

export async function sincronizarGdelt(env, { fetcher = fetch, now = new Date(), termo = TERMOS_GDELT[0] } = {}) {
  const source = `gdelt:${texto(termo, 60)}`;
  const inicio = Date.now();
  try {
    const { text } = await baixarTexto(fetcher, urlGdelt(env, termo), { maxBytes: MARKET_LIMITS.maxBytes, accept: "application/json" });
    if (/limit requests to one every 5 seconds/i.test(text)) throw new Error("GDELT limitou a taxa (1 consulta a cada 5 s)");
    const payload = parseJson(text, null);
    if (payload === null && text.trim()) throw new Error("resposta do GDELT não é JSON");
    const artigos = Array.isArray(payload?.articles) ? payload.articles : [];
    const brutos = artigos.map((a) => ({ ...normalizarArtigoGdelt(a), queryText: termo }));
    const { aceitos, rejeitados } = classificarSinais(brutos, { agora: new Date(now).getTime() });
    const gravados = await gravarSinais(env, aceitos, { now, queryText: termo });
    const sourceUpdatedAt = brutos.reduce((m, s) => (s.publicadoEm > m ? s.publicadoEm : m), "");
    await gravarSyncDeReferencia(env, source, { ok: true, records: artigos.length, sourceUpdatedAt, latencyMs: Date.now() - inicio, detail: { aceitos: aceitos.length, rejeitados }, now });
    return { ok: true, source, records: artigos.length, aceitos: gravados, rejeitados, sourceUpdatedAt };
  } catch (error) {
    const msg = texto(error?.message || error, 300);
    await gravarSyncDeReferencia(env, source, { ok: false, error: msg, latencyMs: Date.now() - inicio, now }).catch(() => {});
    return { ok: false, source, error: msg };
  }
}

// ---- Leitura ----
const sinalDaLinha = (row, triagem) => ({
  id: row.id,
  fingerprint: row.fingerprint,
  source: row.source,
  sources: parseJson(row.sources_json, [row.source]),
  kind: row.kind,
  externalId: row.external_id,
  title: row.title,
  summary: row.summary,
  url: row.url,
  orgao: row.orgao,
  uf: row.uf,
  municipio: row.municipio,
  esfera: row.esfera,
  modalidade: row.modalidade,
  situacao: row.situacao,
  valorEstimado: row.valor_estimado,
  publicadoEm: row.publicado_em,
  prazoProposta: row.prazo_proposta,
  dominio: row.dominio,
  idioma: row.idioma,
  score: row.score,
  scoreReasons: parseJson(row.score_reasons_json, []),
  queryText: row.query_text,
  seenCount: row.seen_count,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  triage: triagem ? { status: triagem.status, note: triagem.note, opportunityId: triagem.opportunity_id, updatedAt: triagem.updated_at } : { status: "new", note: "", opportunityId: "", updatedAt: "" },
});

export async function listarSinais(env, ownerId, { source = "", kind = "", uf = "", minScore = 0, status = "", q = "", limit = 100, now = new Date() } = {}) {
  if (!env?.DB) return [];
  const cond = ["s.tenant_id = ?"];
  const args = [TENANT_ID];
  if (source) { cond.push("(s.source = ? OR s.sources_json LIKE ?)"); args.push(source, `%"${source}"%`); }
  if (kind) { cond.push("s.kind = ?"); args.push(kind); }
  if (uf) { cond.push("s.uf = ?"); args.push(texto(uf, 2).toUpperCase()); }
  if (minScore > 0) { cond.push("s.score >= ?"); args.push(Math.trunc(minScore)); }
  if (q) { cond.push("(s.title LIKE ? OR s.summary LIKE ? OR s.orgao LIKE ?)"); const like = `%${texto(q, 80)}%`; args.push(like, like, like); }
  // Licitação com prazo vencido sai da lista padrão (fica no banco para histórico).
  cond.push("(s.kind <> 'licitacao' OR s.prazo_proposta = '' OR s.prazo_proposta >= ?)");
  args.push(agora(now));
  const rows = await env.DB.prepare(
    `SELECT s.*, t.status AS t_status, t.note AS t_note, t.opportunity_id AS t_opportunity_id, t.updated_at AS t_updated_at
       FROM todogreen_market_signals s
       LEFT JOIN todogreen_market_signal_triage t ON t.signal_id = s.id AND t.workspace_owner_id = ?
      WHERE ${cond.join(" AND ")}
      ORDER BY s.score DESC, s.last_seen_at DESC
      LIMIT ?`,
  ).bind(ownerId, ...args, Math.min(500, Math.max(1, Math.trunc(limit) || 100))).all().then((r) => r.results || []).catch(() => []);
  const lista = rows.map((row) => sinalDaLinha(row, row.t_status ? { status: row.t_status, note: row.t_note, opportunity_id: row.t_opportunity_id, updated_at: row.t_updated_at } : null));
  return status ? lista.filter((s) => s.triage.status === status) : lista;
}

/** Estado das fontes para a Saúde do sistema. */
export async function estadoDosSinaisDeMercado(env, { now = new Date() } = {}) {
  const syncs = await lerSyncsDeReferencia(env, ["pncp:", "compras-gov:", "gdelt:"], { table: REFERENCE_SYNC_TABLE });
  const por = (prefixo) => syncs.filter((s) => s.source.startsWith(prefixo)).sort((a, b) => String(b.lastAttemptAt).localeCompare(String(a.lastAttemptAt)))[0] || null;
  const gdelt = syncs.filter((s) => s.source.startsWith("gdelt:"));
  const gdeltUltimoOk = gdelt.filter((s) => s.lastSuccessAt).sort((a, b) => b.lastSuccessAt.localeCompare(a.lastSuccessAt))[0] || null;
  const gdeltUltimo = gdelt.sort((a, b) => String(b.lastAttemptAt).localeCompare(String(a.lastAttemptAt)))[0] || null;
  const configured = !desligado(env);
  const total = env?.DB ? await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(last_seen_at) AS ultimo FROM todogreen_market_signals WHERE tenant_id = ?`).bind(TENANT_ID).first().catch(() => null) : null;
  return {
    disabled: !configured,
    pncp: estadoDaFonte(por("pncp:"), { now, frescorMs: MARKET_LIMITS.frescorPncpMs, configured }),
    comprasGov: estadoDaFonte(por("compras-gov:"), { now, frescorMs: MARKET_LIMITS.frescorComprasMs, configured }),
    gdelt: estadoDaFonte(gdeltUltimoOk ? { ...gdeltUltimoOk, lastAttemptAt: gdeltUltimo?.lastAttemptAt || gdeltUltimoOk.lastAttemptAt, error: gdeltUltimo?.error || "", status: gdeltUltimo?.status || gdeltUltimoOk.status } : gdeltUltimo, { now, frescorMs: MARKET_LIMITS.frescorGdeltMs, configured }),
    sinais: { total: Number(total?.n) || 0, ultimoVistoEm: total?.ultimo || "" },
  };
}

// ---- Cron ----
export async function runTodoGreenMarketSignalsScheduled(env, now = new Date(), { fetcher = fetch } = {}) {
  if (!env?.DB) return { skipped: "sem D1" };
  if (desligado(env)) return { skipped: MARKET_ENV_KEYS.disabled };
  const t = new Date(now).getTime();
  const syncs = await lerSyncsDeReferencia(env, ["pncp:", "compras-gov:", "gdelt:"]);
  const porFonte = new Map(syncs.map((s) => [s.source, s]));
  const vencida = (source, janelaMs) => {
    const s = porFonte.get(source);
    const ok = s?.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
    const tentativa = s?.lastAttemptAt ? Date.parse(s.lastAttemptAt) : NaN;
    if (Number.isFinite(ok) && t - ok < janelaMs) return false;
    if (Number.isFinite(tentativa) && t - tentativa < 55 * 60 * 1000) return false;
    return true;
  };
  const resumo = { pncp: null, comprasGov: null, gdelt: null };
  if (vencida("pncp:busca", MARKET_LIMITS.cronPncpMs)) resumo.pncp = await sincronizarPncp(env, { fetcher, now });
  if (vencida("compras-gov:contratacoes", MARKET_LIMITS.cronComprasMs)) resumo.comprasGov = await sincronizarComprasGov(env, { fetcher, now });
  // GDELT: um termo por disparo, rodando a lista — respeita 1 consulta/5 s da fonte.
  const termo = TERMOS_GDELT.map((tm) => ({ tm, s: porFonte.get(`gdelt:${texto(tm, 60)}`) }))
    .sort((a, b) => String(a.s?.lastAttemptAt || "").localeCompare(String(b.s?.lastAttemptAt || "")))[0];
  if (termo && vencida(`gdelt:${texto(termo.tm, 60)}`, MARKET_LIMITS.cronGdeltMs * TERMOS_GDELT.length)) resumo.gdelt = await sincronizarGdelt(env, { fetcher, now, termo: termo.tm });
  await expurgarSinaisVelhos(env, now);
  return resumo;
}

// ---- HTTP ----
export async function handleTodoGreenMarketSignals(request, env, access, user, url = new URL(request.url), { fetcher = fetch, now = new Date() } = {}) {
  if (!url.pathname.startsWith("/api/todogreen/market-signals")) return null;
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeLer(access)) return json({ error: "Seu acesso não permite consultar sinais de mercado." }, 403);
  const ownerId = access?.ownerId || "";
  const parts = url.pathname.split("/").filter(Boolean); // api, todogreen, market-signals, <sub>
  const sub = parts[3] || "";

  if (!sub && request.method === "GET") {
    const sinais = await listarSinais(env, ownerId, {
      source: texto(url.searchParams.get("source"), 20), kind: texto(url.searchParams.get("kind"), 20), uf: texto(url.searchParams.get("uf"), 2),
      minScore: Number(url.searchParams.get("minScore")) || 0, status: texto(url.searchParams.get("status"), 20), q: texto(url.searchParams.get("q"), 80),
      limit: Number(url.searchParams.get("limit")) || 100, now,
    });
    return json({ signals: sinais, fontes: await estadoDosSinaisDeMercado(env, { now }), access: { canResearch: podePesquisar(access) } });
  }
  if (sub === "status" && request.method === "GET") return json(await estadoDosSinaisDeMercado(env, { now }));
  if (sub === "sync" && request.method === "POST") {
    if (!podePesquisar(access)) return json({ error: "Sem permissão para sincronizar fontes de mercado." }, 403);
    if (desligado(env)) return json({ error: `Sinais de mercado desligados por ${MARKET_ENV_KEYS.disabled}.`, code: "MARKET_SIGNALS_DISABLED" }, 409);
    const corpo = await request.json().catch(() => ({}));
    const fonte = texto(corpo?.source, 20).toLowerCase();
    let resultado;
    if (fonte === "pncp") resultado = await sincronizarPncp(env, { fetcher, now, termos: Array.isArray(corpo.termos) && corpo.termos.length ? corpo.termos.map((t) => texto(t, 60)).filter(Boolean).slice(0, 8) : TERMOS_PNCP });
    else if (fonte === "compras-gov") resultado = await sincronizarComprasGov(env, { fetcher, now });
    else if (fonte === "gdelt") resultado = await sincronizarGdelt(env, { fetcher, now, termo: texto(corpo?.termo, 60) || TERMOS_GDELT[0] });
    else return json({ error: "Fonte desconhecida. Use pncp, compras-gov ou gdelt." }, 400);
    await registrarAuditoriaTodoGreen(env, { access, user, action: `market.signals.sync.${fonte}`, resourceType: "market_signal", resourceId: fonte, after: resultado, details: resultado.ok ? `Sincronização ${fonte}: ${resultado.records} itens, ${resultado.aceitos} sinais` : `Falhou: ${resultado.error || ""}` });
    return json({ resultado, fontes: await estadoDosSinaisDeMercado(env, { now }) }, resultado.ok ? 200 : 502);
  }
  if (sub && request.method === "PATCH") {
    if (!podePesquisar(access)) return json({ error: "Sem permissão para triar sinais." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const status = texto(corpo?.status, 20);
    if (!SIGNAL_STATUS.includes(status)) return json({ error: `Status inválido. Use ${SIGNAL_STATUS.join(", ")}.` }, 400);
    const existe = await env.DB.prepare(`SELECT id FROM todogreen_market_signals WHERE id = ? AND tenant_id = ?`).bind(texto(sub, 80), TENANT_ID).first();
    if (!existe) return json({ error: "Sinal não encontrado." }, 404);
    await env.DB.prepare(
      `INSERT INTO todogreen_market_signal_triage (workspace_owner_id, signal_id, tenant_id, status, note, opportunity_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_owner_id, signal_id) DO UPDATE SET status = excluded.status, note = excluded.note, opportunity_id = excluded.opportunity_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(ownerId, existe.id, TENANT_ID, status, texto(corpo?.note, 500), texto(corpo?.opportunityId, 80), texto(user?.id, 120), agora(now)).run();
    await registrarAuditoriaTodoGreen(env, { access, user, action: "market.signal.triaged", resourceType: "market_signal", resourceId: existe.id, after: { status, note: texto(corpo?.note, 500) }, details: `Sinal ${status}` });
    const [sinal] = await listarSinais(env, ownerId, { limit: 500, now }).then((l) => l.filter((s) => s.id === existe.id));
    return json({ signal: sinal || { id: existe.id, triage: { status } } });
  }
  return json({ error: "Rota de sinais de mercado desconhecida." }, 404);
}
