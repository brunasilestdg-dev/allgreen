// ===== Estado de sincronização de fontes públicas (referências) =====
// Uma linha por fonte: quando tentou, quando conseguiu, a data da FONTE
// (sourceUpdatedAt), quantos registros e o último erro. Falha nunca apaga o
// último sucesso — é o que permite à Saúde do sistema dizer "caiu agora" em vez
// de "nunca funcionou". Tabela parametrizada: energia usa a sua
// (todogreen_energy_reference_sync); mercado e risco usam todogreen_reference_sync.

import { TENANT_ID } from "./todogreen-access.js";

export const REFERENCE_SYNC_TABLE = "todogreen_reference_sync";

const TABELAS_PERMITIDAS = new Set(["todogreen_reference_sync", "todogreen_energy_reference_sync"]);
const tabela = (nome) => {
  if (!TABELAS_PERMITIDAS.has(nome)) throw new Error(`Tabela de sincronização desconhecida: ${nome}`);
  return nome;
};
const texto = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export async function gravarSyncDeReferencia(env, source, { ok, records = 0, sourceUpdatedAt = "", latencyMs = null, error = "", detail = {}, now = new Date() } = {}, { table = REFERENCE_SYNC_TABLE } = {}) {
  if (!env?.DB || !source) return;
  const t = tabela(table);
  const ts = (now instanceof Date ? now : new Date(now)).toISOString();
  await env.DB.prepare(
    `INSERT INTO ${t} (source, tenant_id, status, last_attempt_at, last_success_at, source_updated_at, records, latency_ms, error_message, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       status = excluded.status,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN excluded.status = 'ok' THEN excluded.last_success_at ELSE ${t}.last_success_at END,
       source_updated_at = CASE WHEN excluded.status = 'ok' THEN excluded.source_updated_at ELSE ${t}.source_updated_at END,
       records = CASE WHEN excluded.status = 'ok' THEN excluded.records ELSE ${t}.records END,
       latency_ms = excluded.latency_ms,
       error_message = excluded.error_message,
       detail_json = CASE WHEN excluded.status = 'ok' THEN excluded.detail_json ELSE ${t}.detail_json END`,
  ).bind(texto(source, 200), TENANT_ID, ok ? "ok" : "error", ts, ok ? ts : "", texto(sourceUpdatedAt, 40), Math.trunc(Number(records)) || 0, latencyMs === null || latencyMs === undefined ? null : Math.trunc(latencyMs), texto(error, 300), JSON.stringify(detail || {})).run();
}

export async function lerSyncsDeReferencia(env, prefixos = [], { table = REFERENCE_SYNC_TABLE } = {}) {
  if (!env?.DB) return [];
  const t = tabela(table);
  const rows = await env.DB.prepare(`SELECT * FROM ${t} WHERE tenant_id = ?`).bind(TENANT_ID).all().then((r) => r.results || []).catch(() => []);
  return rows
    .filter((r) => !prefixos.length || prefixos.some((p) => String(r.source).startsWith(p)))
    .map((r) => ({
      source: r.source,
      status: r.status,
      lastAttemptAt: r.last_attempt_at || "",
      lastSuccessAt: r.last_success_at || "",
      sourceUpdatedAt: r.source_updated_at || "",
      records: Number(r.records) || 0,
      latencyMs: r.latency_ms ?? null,
      error: r.error_message || "",
      detail: parseJson(r.detail_json, {}),
    }));
}

/**
 * Estado legível de uma fonte para a Saúde do sistema: ok | stale | error |
 * never | not_configured, com `stale` pela idade do dado da fonte (ou do
 * último sucesso quando a fonte não data o dado).
 */
export function estadoDaFonte(sync, { now = Date.now(), frescorMs, configured = true, requirement = "" } = {}) {
  const t = new Date(now).getTime();
  const ultimoOk = sync?.lastSuccessAt ? Date.parse(sync.lastSuccessAt) : NaN;
  const fonteEm = sync?.sourceUpdatedAt ? Date.parse(sync.sourceUpdatedAt.length === 10 ? `${sync.sourceUpdatedAt}T00:00:00Z` : sync.sourceUpdatedAt) : NaN;
  const referencia = Number.isFinite(fonteEm) ? fonteEm : ultimoOk;
  const stale = Number.isFinite(referencia) && Number.isFinite(Number(frescorMs)) ? t - referencia > Number(frescorMs) : false;
  let status = "never";
  if (!configured) status = "not_configured";
  else if (Number.isFinite(ultimoOk)) status = stale ? "stale" : "ok";
  else if (sync?.status === "error") status = "error";
  return {
    status,
    configured,
    lastAttemptAt: sync?.lastAttemptAt || "",
    lastSuccessAt: sync?.lastSuccessAt || "",
    sourceUpdatedAt: sync?.sourceUpdatedAt || "",
    records: sync?.records || 0,
    latencyMs: sync?.latencyMs ?? null,
    error: sync?.error || "",
    stale,
    requirement,
    detail: sync?.detail || {},
  };
}

/** Baixa texto com timeout e teto de bytes — nunca engole um arquivo sem fim. */
export async function baixarTexto(fetcher, url, { maxBytes, timeoutMs = 25_000, accept = "text/csv, text/plain, application/json, */*", headers = {}, method = "GET", body } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetcher(url, { method, body, headers: { accept, "user-agent": "todogreen-reference-sync/1.0", ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declarado = Number(response.headers?.get?.("content-length") || 0);
    if (maxBytes && declarado > maxBytes) throw new Error(`arquivo maior que o teto (${declarado} > ${maxBytes} bytes)`);
    const text = await response.text();
    if (maxBytes && text.length > maxBytes) throw new Error(`arquivo maior que o teto (${text.length} > ${maxBytes} bytes)`);
    return { text, latencyMs: Date.now() - startedAt, status: response.status, lastModified: response.headers?.get?.("last-modified") || "" };
  } finally {
    clearTimeout(timer);
  }
}
