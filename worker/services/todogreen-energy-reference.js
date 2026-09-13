// ===== Energia: referências públicas (ANEEL · ANP · ONS) + perfil + plano =====
// Seções 61–65 da consolidação. Este serviço:
//   • guarda o PERFIL DE ENERGIA do espaço (distribuidora/subgrupo/modalidade,
//     UF/município, demanda contratada, tarifas e preços contratuais, horários
//     da frota) — é por espaço;
//   • ingere e cacheia REFERÊNCIAS PÚBLICAS compartilhadas pelo tenant:
//     tarifas homologadas da ANEEL (datastore de dados abertos), preço de
//     diesel da ANP (CSV do levantamento semanal → só agregados) e a curva de
//     carga horária do ONS (perfil médio das 24 h por subsistema);
//   • compõe o PLANO DE ENERGIA: tarifa resolvida pela hierarquia (contrato >
//     informada > ANEEL > fallback), melhor hora (financeira/energética/
//     recomendada), preço de diesel resolvido e o plano de recarga por veículo.
// Cada fonte diz quando a FONTE atualizou (sourceUpdatedAt) e quando NÓS
// ingerimos (ingestedAt). Sem dado, o resultado diz NOT_AVAILABLE/STALE — nunca
// um número inventado. Toda a regra é pura (src/features/logistics/*Domain.js);
// aqui só há D1, rede e permissão.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { CRON_EXTERNAL_DISABLED_KEY, cronExternoDesligado } from "./reference-sync.js";
import {
  ANP_PRODUTO_PADRAO,
  agregarPrecosAnp,
  niveisAnpParaResolver,
  parseAnpPrecosCsv,
  resolveDieselPrice,
} from "../../src/features/logistics/anpDieselPriceDomain.js";
import {
  MODALIDADES_ANEEL,
  SUBGRUPOS_ANEEL,
  normalizarTarifaAneel,
  resolverTarifaEnergia,
  selecionarTarifasVigentes,
} from "../../src/features/logistics/energyTariffDomain.js";
import {
  ONS_SUBSISTEMAS,
  janelasDeRecarga,
  parseCurvaCargaOns,
  perfilDeMedias,
  perfilHorarioCarga,
} from "../../src/features/logistics/gridWindowDomain.js";
import { planoDeRecargaPorVeiculo } from "../../src/features/logistics/smartChargingDomain.js";
import { FLEET_ENERGY_DEFAULTS } from "../../src/features/logistics/todoGreenFleetDomain.js";

// ---- Fontes (URLs públicas; qualquer uma pode ser trocada por variável) ----
export const ENERGY_ENV_KEYS = Object.freeze({
  aneelBase: "TDG_ANEEL_BASE_URL",
  aneelResource: "TDG_ANEEL_TARIFAS_RESOURCE_ID",
  onsUrl: "TDG_ONS_CURVA_CARGA_URL",
  anpUrl: "TDG_ANP_DIESEL_URL",
  disabled: "TDG_ENERGY_REFERENCE_DISABLED",
});
const ANEEL_BASE_PADRAO = "https://dadosabertos.aneel.gov.br";
// Recurso "Tarifas homologadas das distribuidoras de energia elétrica" (CKAN).
const ANEEL_RESOURCE_PADRAO = "fcf2906c-7c32-4b9b-a637-054e7a5234f4";
const ONS_URL_PADRAO = (ano) => `https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/curva-carga-ho/CURVA_CARGA_${ano}.csv`;
const ANP_URL_PADRAO = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv";

export const ENERGY_LIMITS = Object.freeze({
  onsMaxBytes: 8 * 1024 * 1024,
  anpMaxBytes: 16 * 1024 * 1024,
  aneelMaxBytes: 4 * 1024 * 1024,
  timeoutMs: 25_000,
  onsJanelaDias: 28,
  onsFrescorMs: 3 * 24 * 60 * 60 * 1000,      // perfil do SIN com mais de 3 dias = stale
  anpFrescorMs: 21 * 24 * 60 * 60 * 1000,     // levantamento semanal: 3 semanas sem coleta = stale
  anpRetencaoDias: 180,
  cronOnsMs: 20 * 60 * 60 * 1000,
  cronAnpMs: 6 * 24 * 60 * 60 * 1000,
  cronAneelMs: 6 * 24 * 60 * 60 * 1000,
  cronAneelPorRodada: 3,
});

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const numOuNulo = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const horaOuNula = (v) => {
  const n = numOuNulo(v);
  return n === null ? null : ((Math.trunc(n) % 24) + 24) % 24;
};
const agora = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
const desligado = (env) => String(env?.[ENERGY_ENV_KEYS.disabled] || "") === "1";
// Fuso da operação: America/Sao_Paulo (UTC−3, sem horário de verão desde 2019).
export const horaLocal = (now = new Date()) => (new Date(now).getUTCHours() + 21) % 24;
const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

const PODE_ESCREVER = ["operations:manage", "operation:manage", "fleet:manage", "integration:manage", "planning:manage"];
const canWrite = (access) => PODE_ESCREVER.some((p) => podeNaVertical(access, p));

// ---- Rede com teto de tamanho e timeout (nunca engolir um arquivo sem fim) ----
async function baixarTexto(fetcher, url, { maxBytes, timeoutMs = ENERGY_LIMITS.timeoutMs, accept = "text/csv, text/plain, */*" } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetcher(url, { headers: { accept, "user-agent": "todogreen-energy-reference/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declarado = Number(response.headers?.get?.("content-length") || 0);
    if (maxBytes && declarado > maxBytes) throw new Error(`arquivo maior que o teto (${declarado} > ${maxBytes} bytes)`);
    const text = await response.text();
    if (maxBytes && text.length > maxBytes) throw new Error(`arquivo maior que o teto (${text.length} > ${maxBytes} bytes)`);
    return { text, latencyMs: Date.now() - startedAt, lastModified: response.headers?.get?.("last-modified") || "" };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Estado de sincronização por fonte ----
async function gravarSync(env, source, { ok, records = 0, sourceUpdatedAt = "", latencyMs = null, error = "", detail = {}, now }) {
  if (!env?.DB) return;
  const ts = agora(now);
  await env.DB.prepare(
    `INSERT INTO todogreen_energy_reference_sync (source, tenant_id, status, last_attempt_at, last_success_at, source_updated_at, records, latency_ms, error_message, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       status = excluded.status,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN excluded.status = 'ok' THEN excluded.last_success_at ELSE todogreen_energy_reference_sync.last_success_at END,
       source_updated_at = CASE WHEN excluded.status = 'ok' THEN excluded.source_updated_at ELSE todogreen_energy_reference_sync.source_updated_at END,
       records = CASE WHEN excluded.status = 'ok' THEN excluded.records ELSE todogreen_energy_reference_sync.records END,
       latency_ms = excluded.latency_ms,
       error_message = excluded.error_message,
       detail_json = CASE WHEN excluded.status = 'ok' THEN excluded.detail_json ELSE todogreen_energy_reference_sync.detail_json END`,
  ).bind(source, TENANT_ID, ok ? "ok" : "error", ts, ok ? ts : "", texto(sourceUpdatedAt, 40), Math.trunc(records) || 0, latencyMs === null ? null : Math.trunc(latencyMs), texto(error, 300), JSON.stringify(detail || {})).run();
}

async function lerSyncs(env, prefixos = []) {
  if (!env?.DB) return [];
  const rows = await env.DB.prepare(`SELECT * FROM todogreen_energy_reference_sync WHERE tenant_id = ?`).bind(TENANT_ID).all()
    .then((r) => r.results || []).catch(() => []);
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

const chaveAneel = (d, s, m) => `aneel:${texto(d, 40).toUpperCase()}|${texto(s, 10).toUpperCase()}|${texto(m, 40).toUpperCase()}`;

// ---- ANEEL: tarifas homologadas (datastore_search com filtros exatos) ----
export function urlTarifasAneel(env, { distribuidora, subgrupo, modalidade, limit = 500 } = {}) {
  const base = texto(env?.[ENERGY_ENV_KEYS.aneelBase], 200) || ANEEL_BASE_PADRAO;
  const resource = texto(env?.[ENERGY_ENV_KEYS.aneelResource], 80) || ANEEL_RESOURCE_PADRAO;
  const filters = { SigAgente: texto(distribuidora, 40), DscBaseTarifaria: "Tarifa de Aplicação" };
  if (texto(subgrupo, 10)) filters.DscSubGrupo = texto(subgrupo, 10);
  if (texto(modalidade, 40)) filters.DscModalidadeTarifaria = texto(modalidade, 40);
  const params = new URLSearchParams({ resource_id: resource, filters: JSON.stringify(filters), limit: String(limit) });
  // Espaço como %20 (não "+"): o filtro é JSON dentro da query e o CKAN o lê literal.
  return `${base.replace(/\/$/, "")}/api/3/action/datastore_search?${params.toString().replace(/\+/g, "%20")}`;
}

export async function sincronizarTarifasAneel(env, { distribuidora, subgrupo, modalidade } = {}, { fetcher = fetch, now = new Date() } = {}) {
  const source = chaveAneel(distribuidora, subgrupo, modalidade);
  if (!texto(distribuidora)) return { ok: false, source, error: "Perfil sem distribuidora." };
  try {
    const { text, latencyMs } = await baixarTexto(fetcher, urlTarifasAneel(env, { distribuidora, subgrupo, modalidade }), { maxBytes: ENERGY_LIMITS.aneelMaxBytes, accept: "application/json" });
    const payload = parseJson(text, null);
    if (!payload?.success || !Array.isArray(payload?.result?.records)) throw new Error("resposta da ANEEL sem `result.records`");
    const linhas = payload.result.records.map(normalizarTarifaAneel).filter(Boolean);
    const ingestedAt = agora(now);
    if (!linhas.length) {
      await gravarSync(env, source, { ok: false, latencyMs, error: "ANEEL_SEM_REGISTROS para distribuidora/subgrupo/modalidade informados", now });
      return { ok: false, source, records: 0, latencyMs, error: "ANEEL_SEM_REGISTROS" };
    }
    const stmts = linhas.map((l) => env.DB.prepare(
      `INSERT INTO todogreen_energy_tariff_reference (id, tenant_id, distribuidora, cnpj, resolucao, base_tarifaria, subgrupo, modalidade, classe, subclasse, detalhe, posto, faixa, unidade, tusd_mwh, te_mwh, tarifa_kwh, vigencia_inicio, vigencia_fim, source_updated_at, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cnpj = excluded.cnpj, resolucao = excluded.resolucao, tusd_mwh = excluded.tusd_mwh, te_mwh = excluded.te_mwh, tarifa_kwh = excluded.tarifa_kwh, vigencia_fim = excluded.vigencia_fim, source_updated_at = excluded.source_updated_at, ingested_at = excluded.ingested_at`,
    ).bind(
      [l.distribuidora, l.subgrupo, l.modalidade, l.classe, l.subclasse, l.detalhe, l.posto, l.unidade, l.vigenciaInicio].join("|").toUpperCase().slice(0, 400),
      TENANT_ID, l.distribuidora, l.cnpj, l.resolucao, l.baseTarifaria, l.subgrupo, l.modalidade, l.classe, l.subclasse, l.detalhe, l.posto, l.faixa, l.unidade,
      l.tusdMwh, l.teMwh, l.tarifaKwh, l.vigenciaInicio, l.vigenciaFim, l.fonteAtualizadaEm, ingestedAt,
    ));
    for (const parte of chunk(stmts, 60)) await env.DB.batch(parte);
    const sourceUpdatedAt = linhas.reduce((m, l) => (l.fonteAtualizadaEm > m ? l.fonteAtualizadaEm : m), "");
    const vigenciaMax = linhas.reduce((m, l) => (l.vigenciaInicio > m ? l.vigenciaInicio : m), "");
    await gravarSync(env, source, { ok: true, records: linhas.length, sourceUpdatedAt, latencyMs, detail: { vigenciaInicio: vigenciaMax, total: payload.result.total ?? linhas.length }, now });
    return { ok: true, source, records: linhas.length, sourceUpdatedAt, latencyMs, vigenciaInicio: vigenciaMax };
  } catch (error) {
    const msg = texto(error?.message || error, 300) || "falha desconhecida";
    await gravarSync(env, source, { ok: false, error: msg, now }).catch(() => {});
    return { ok: false, source, error: msg };
  }
}

/** Lista de distribuidoras (SigAgente) do datastore, com cache de 7 dias. */
export async function listarDistribuidorasAneel(env, { fetcher = fetch, now = new Date(), q = "" } = {}) {
  const cacheKey = "aneel:distribuidoras";
  let lista = null;
  if (env?.DB) {
    const row = await env.DB.prepare(`SELECT payload_json FROM todogreen_geo_cache WHERE cache_key = ? AND expires_at > ?`).bind(cacheKey, agora(now)).first().catch(() => null);
    if (row?.payload_json) lista = parseJson(row.payload_json, null);
  }
  if (!Array.isArray(lista)) {
    const base = texto(env?.[ENERGY_ENV_KEYS.aneelBase], 200) || ANEEL_BASE_PADRAO;
    const resource = texto(env?.[ENERGY_ENV_KEYS.aneelResource], 80) || ANEEL_RESOURCE_PADRAO;
    const params = new URLSearchParams({ resource_id: resource, distinct: "true", fields: "SigAgente", limit: "500" });
    const { text } = await baixarTexto(fetcher, `${base.replace(/\/$/, "")}/api/3/action/datastore_search?${params}`, { maxBytes: 512 * 1024, accept: "application/json" });
    const payload = parseJson(text, null);
    lista = [...new Set((payload?.result?.records || []).map((r) => texto(r.SigAgente, 40)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (env?.DB && lista.length) {
      const ts = agora(now);
      await env.DB.prepare(
        `INSERT INTO todogreen_geo_cache (cache_key, kind, payload_json, source, source_updated_at, ingested_at, expires_at) VALUES (?, 'aneel-distribuidoras', ?, 'aneel', ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, ingested_at = excluded.ingested_at, expires_at = excluded.expires_at`,
      ).bind(cacheKey, JSON.stringify(lista), ts, ts, new Date(new Date(ts).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()).run().catch(() => {});
    }
  }
  const filtro = texto(q, 40).toLowerCase();
  return filtro ? lista.filter((d) => d.toLowerCase().includes(filtro)) : lista;
}

// ---- ONS: curva de carga horária → perfil médio por subsistema ----
export function urlCurvaCargaOns(env, ano) {
  const custom = texto(env?.[ENERGY_ENV_KEYS.onsUrl], 300);
  return custom ? custom.replace("{ano}", String(ano)) : ONS_URL_PADRAO(ano);
}

export async function sincronizarCurvaDeCargaOns(env, { fetcher = fetch, now = new Date(), dias = ENERGY_LIMITS.onsJanelaDias } = {}) {
  const ano = new Date(now).getUTCFullYear();
  const resultados = {};
  try {
    let { text, latencyMs } = await baixarTexto(fetcher, urlCurvaCargaOns(env, ano), { maxBytes: ENERGY_LIMITS.onsMaxBytes });
    // Início de ano: o arquivo novo tem poucos dias — completa com o anterior.
    const teste = parseCurvaCargaOns(text, { subsistema: "SE", dias });
    if (!teste.ok || teste.registros.length < 7 * 24) {
      try {
        const anterior = await baixarTexto(fetcher, urlCurvaCargaOns(env, ano - 1), { maxBytes: ENERGY_LIMITS.onsMaxBytes });
        const corpoAtual = text.split(/\r?\n/).slice(1).join("\n");
        text = `${anterior.text.replace(/\s+$/, "")}\n${corpoAtual}`;
        latencyMs += anterior.latencyMs;
      } catch { /* sem o ano anterior segue com o que há */ }
    }
    const ingestedAt = agora(now);
    for (const sub of Object.keys(ONS_SUBSISTEMAS)) {
      const parsed = parseCurvaCargaOns(text, { subsistema: sub, dias });
      const perfil = parsed.ok ? perfilHorarioCarga(parsed.registros) : { ok: false, reason: parsed.reason };
      const source = `ons:${sub}`;
      if (!perfil.ok) {
        await gravarSync(env, source, { ok: false, latencyMs, error: perfil.reason || "PERFIL_INCOMPLETO", now });
        resultados[sub] = { ok: false, error: perfil.reason };
        continue;
      }
      const stmts = perfil.mediaMw.map((media, hora) => env.DB.prepare(
        `INSERT INTO todogreen_grid_load_profiles (id, tenant_id, subsistema, hora, media_mw, amostras, janela_dias, source_last_instant, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET media_mw = excluded.media_mw, amostras = excluded.amostras, janela_dias = excluded.janela_dias, source_last_instant = excluded.source_last_instant, ingested_at = excluded.ingested_at`,
      ).bind(`ons|${sub}|${hora}`, TENANT_ID, sub, hora, media, perfil.dias, Math.max(1, Math.trunc(dias)), parsed.ultimoInstante, ingestedAt));
      await env.DB.batch(stmts);
      await gravarSync(env, source, { ok: true, records: parsed.registros.length, sourceUpdatedAt: parsed.ultimoInstante, latencyMs, detail: { dias: perfil.dias, horaMaisLeve: perfil.horaMaisLeve, horaMaisPesada: perfil.horaMaisPesada }, now });
      resultados[sub] = { ok: true, records: parsed.registros.length, sourceUpdatedAt: parsed.ultimoInstante, dias: perfil.dias };
    }
    return { ok: Object.values(resultados).some((r) => r.ok), subsistemas: resultados, latencyMs };
  } catch (error) {
    const msg = texto(error?.message || error, 300) || "falha desconhecida";
    for (const sub of Object.keys(ONS_SUBSISTEMAS)) await gravarSync(env, `ons:${sub}`, { ok: false, error: msg, now }).catch(() => {});
    return { ok: false, error: msg, subsistemas: resultados };
  }
}

// ---- ANP: CSV do levantamento → agregados por semana/nível ----
export function urlPrecosAnp(env) {
  return texto(env?.[ENERGY_ENV_KEYS.anpUrl], 300) || ANP_URL_PADRAO;
}

export async function sincronizarPrecosAnp(env, { fetcher = fetch, now = new Date(), csvText = null, origem = "anp" } = {}) {
  const source = "anp:diesel";
  try {
    let text = csvText;
    let latencyMs = null;
    if (text === null || text === undefined) ({ text, latencyMs } = await baixarTexto(fetcher, urlPrecosAnp(env), { maxBytes: ENERGY_LIMITS.anpMaxBytes }));
    if (String(text).length > ENERGY_LIMITS.anpMaxBytes) throw new Error("arquivo maior que o teto");
    const parsed = parseAnpPrecosCsv(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    const agregados = agregarPrecosAnp(parsed.registros);
    const ingestedAt = agora(now);
    const stmts = agregados.map((a) => env.DB.prepare(
      `INSERT INTO todogreen_fuel_price_reference (id, tenant_id, produto, nivel, chave, semana, mediana, media, minimo, maximo, amostras, coleta_inicio, coleta_fim, source, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mediana = excluded.mediana, media = excluded.media, minimo = excluded.minimo, maximo = excluded.maximo, amostras = excluded.amostras, coleta_inicio = excluded.coleta_inicio, coleta_fim = excluded.coleta_fim, source = excluded.source, ingested_at = excluded.ingested_at`,
    ).bind(`anp|${a.produto}|${a.nivel}|${a.chave}|${a.semana}`.slice(0, 300), TENANT_ID, a.produto, a.nivel, a.chave, a.semana, a.mediana, a.media, a.minimo, a.maximo, a.amostras, a.coletaInicio, a.coletaFim, origem, ingestedAt));
    for (const parte of chunk(stmts, 60)) await env.DB.batch(parte);
    // Retenção do cache (é referência pública recalculável, não registro de negócio).
    const corte = new Date(new Date(ingestedAt).getTime() - ENERGY_LIMITS.anpRetencaoDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await env.DB.prepare(`DELETE FROM todogreen_fuel_price_reference WHERE tenant_id = ? AND semana < ?`).bind(TENANT_ID, corte).run().catch(() => {});
    const sourceUpdatedAt = agregados.reduce((m, a) => (a.coletaFim > m ? a.coletaFim : m), "");
    const semanas = [...new Set(agregados.map((a) => a.semana))].sort();
    await gravarSync(env, source, { ok: true, records: parsed.registros.length, sourceUpdatedAt, latencyMs, detail: { agregados: agregados.length, semanas, ignorados: parsed.ignorados, origem }, now });
    return { ok: true, source, records: parsed.registros.length, agregados: agregados.length, semanas, sourceUpdatedAt, latencyMs };
  } catch (error) {
    const msg = texto(error?.message || error, 300) || "falha desconhecida";
    await gravarSync(env, source, { ok: false, error: msg, now }).catch(() => {});
    return { ok: false, source, error: msg };
  }
}

// ---- Perfil de energia do espaço ----
const REGIOES_ANP = new Set(["N", "NE", "S", "SE", "CO"]);
export function perfilPadrao() {
  return {
    distribuidora: "", subgrupo: "", modalidade: "", uf: "", municipio: "", regiao: "", subsistemaOns: "SE",
    demandaContratadaKw: null,
    tarifaContratualKwh: null, tarifaContratualData: "", tarifaInformadaKwh: null, tarifaInformadaData: "", tarifaFallbackKwh: null,
    horasPonta: [], horasIntermediario: [],
    dieselProduto: ANP_PRODUTO_PADRAO, dieselContratualL: null, dieselContratualData: "", dieselFrotaL: null, dieselFrotaData: "", dieselFallbackL: null,
    saidaHora: null, chegadaHora: null, socChegadaPercent: null,
    updatedAt: "", updatedBy: "", configurado: false,
  };
}
const perfilDaLinha = (row) => (!row ? perfilPadrao() : {
  distribuidora: row.distribuidora || "", subgrupo: row.subgrupo || "", modalidade: row.modalidade || "",
  uf: row.uf || "", municipio: row.municipio || "", regiao: row.regiao || "", subsistemaOns: row.subsistema_ons || "SE",
  demandaContratadaKw: row.demanda_contratada_kw ?? null,
  tarifaContratualKwh: row.tarifa_contratual_kwh ?? null, tarifaContratualData: row.tarifa_contratual_data || "",
  tarifaInformadaKwh: row.tarifa_informada_kwh ?? null, tarifaInformadaData: row.tarifa_informada_data || "",
  tarifaFallbackKwh: row.tarifa_fallback_kwh ?? null,
  horasPonta: parseJson(row.horas_ponta_json, []), horasIntermediario: parseJson(row.horas_intermediario_json, []),
  dieselProduto: row.diesel_produto || ANP_PRODUTO_PADRAO,
  dieselContratualL: row.diesel_contratual_l ?? null, dieselContratualData: row.diesel_contratual_data || "",
  dieselFrotaL: row.diesel_frota_l ?? null, dieselFrotaData: row.diesel_frota_data || "", dieselFallbackL: row.diesel_fallback_l ?? null,
  saidaHora: row.saida_hora ?? null, chegadaHora: row.chegada_hora ?? null, socChegadaPercent: row.soc_chegada_percent ?? null,
  updatedAt: row.updated_at || "", updatedBy: row.updated_by || "",
  configurado: Boolean(row.distribuidora && row.subgrupo && row.modalidade),
});

export async function lerPerfilDeEnergia(env, ownerId) {
  if (!env?.DB || !ownerId) return perfilPadrao();
  const row = await env.DB.prepare(`SELECT * FROM todogreen_energy_profiles WHERE workspace_owner_id = ? AND tenant_id = ?`).bind(ownerId, TENANT_ID).first().catch(() => null);
  return perfilDaLinha(row);
}

const listaDeHoras = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((h) => horaOuNula(h)).filter((h) => h !== null).slice(0, 24);
export function normalizarPerfil(corpo = {}, atual = perfilPadrao()) {
  const p = { ...atual };
  const tem = (k) => corpo[k] !== undefined;
  if (tem("distribuidora")) p.distribuidora = texto(corpo.distribuidora, 40);
  if (tem("subgrupo")) { const s = texto(corpo.subgrupo, 10); p.subgrupo = SUBGRUPOS_ANEEL.find((x) => x.toLowerCase() === s.toLowerCase()) || ""; }
  if (tem("modalidade")) { const m = texto(corpo.modalidade, 40); p.modalidade = MODALIDADES_ANEEL.find((x) => x.toLowerCase() === m.toLowerCase()) || ""; }
  if (tem("uf")) p.uf = texto(corpo.uf, 2).toUpperCase();
  if (tem("municipio")) p.municipio = texto(corpo.municipio, 80);
  if (tem("regiao")) { const r = texto(corpo.regiao, 2).toUpperCase(); p.regiao = REGIOES_ANP.has(r) ? r : ""; }
  if (tem("subsistemaOns")) { const s = texto(corpo.subsistemaOns, 2).toUpperCase(); p.subsistemaOns = ONS_SUBSISTEMAS[s] ? s : "SE"; }
  for (const k of ["demandaContratadaKw", "tarifaContratualKwh", "tarifaInformadaKwh", "tarifaFallbackKwh", "dieselContratualL", "dieselFrotaL", "dieselFallbackL", "socChegadaPercent"]) {
    if (!tem(k)) continue;
    const n = numOuNulo(corpo[k]);
    p[k] = n === null || n < 0 ? null : n;
  }
  if (p.socChegadaPercent !== null && p.socChegadaPercent > 100) p.socChegadaPercent = 100;
  for (const k of ["tarifaContratualData", "tarifaInformadaData", "dieselContratualData", "dieselFrotaData"]) if (tem(k)) p[k] = texto(corpo[k], 10);
  if (tem("horasPonta")) p.horasPonta = listaDeHoras(corpo.horasPonta);
  if (tem("horasIntermediario")) p.horasIntermediario = listaDeHoras(corpo.horasIntermediario);
  if (tem("dieselProduto")) p.dieselProduto = ["diesel", "diesel_s10"].includes(texto(corpo.dieselProduto, 20)) ? texto(corpo.dieselProduto, 20) : ANP_PRODUTO_PADRAO;
  if (tem("saidaHora")) p.saidaHora = horaOuNula(corpo.saidaHora);
  if (tem("chegadaHora")) p.chegadaHora = horaOuNula(corpo.chegadaHora);
  p.configurado = Boolean(p.distribuidora && p.subgrupo && p.modalidade);
  return p;
}

async function gravarPerfil(env, ownerId, perfil, userId, now) {
  const ts = agora(now);
  await env.DB.prepare(
    `INSERT INTO todogreen_energy_profiles (workspace_owner_id, tenant_id, distribuidora, subgrupo, modalidade, uf, municipio, regiao, subsistema_ons, demanda_contratada_kw,
        tarifa_contratual_kwh, tarifa_contratual_data, tarifa_informada_kwh, tarifa_informada_data, tarifa_fallback_kwh, horas_ponta_json, horas_intermediario_json,
        diesel_produto, diesel_contratual_l, diesel_contratual_data, diesel_frota_l, diesel_frota_data, diesel_fallback_l, saida_hora, chegada_hora, soc_chegada_percent,
        updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_owner_id) DO UPDATE SET
       distribuidora = excluded.distribuidora, subgrupo = excluded.subgrupo, modalidade = excluded.modalidade, uf = excluded.uf, municipio = excluded.municipio, regiao = excluded.regiao,
       subsistema_ons = excluded.subsistema_ons, demanda_contratada_kw = excluded.demanda_contratada_kw,
       tarifa_contratual_kwh = excluded.tarifa_contratual_kwh, tarifa_contratual_data = excluded.tarifa_contratual_data,
       tarifa_informada_kwh = excluded.tarifa_informada_kwh, tarifa_informada_data = excluded.tarifa_informada_data, tarifa_fallback_kwh = excluded.tarifa_fallback_kwh,
       horas_ponta_json = excluded.horas_ponta_json, horas_intermediario_json = excluded.horas_intermediario_json,
       diesel_produto = excluded.diesel_produto, diesel_contratual_l = excluded.diesel_contratual_l, diesel_contratual_data = excluded.diesel_contratual_data,
       diesel_frota_l = excluded.diesel_frota_l, diesel_frota_data = excluded.diesel_frota_data, diesel_fallback_l = excluded.diesel_fallback_l,
       saida_hora = excluded.saida_hora, chegada_hora = excluded.chegada_hora, soc_chegada_percent = excluded.soc_chegada_percent,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(
    ownerId, TENANT_ID, perfil.distribuidora, perfil.subgrupo, perfil.modalidade, perfil.uf, perfil.municipio, perfil.regiao, perfil.subsistemaOns, perfil.demandaContratadaKw,
    perfil.tarifaContratualKwh, perfil.tarifaContratualData, perfil.tarifaInformadaKwh, perfil.tarifaInformadaData, perfil.tarifaFallbackKwh,
    JSON.stringify(perfil.horasPonta || []), JSON.stringify(perfil.horasIntermediario || []),
    perfil.dieselProduto, perfil.dieselContratualL, perfil.dieselContratualData, perfil.dieselFrotaL, perfil.dieselFrotaData, perfil.dieselFallbackL,
    perfil.saidaHora, perfil.chegadaHora, perfil.socChegadaPercent, texto(userId, 120), ts, ts,
  ).run();
}

// ---- Leitura das referências para um perfil ----
const linhaTarifaDoBanco = (r) => ({
  distribuidora: r.distribuidora, cnpj: r.cnpj, resolucao: r.resolucao, baseTarifaria: r.base_tarifaria, subgrupo: r.subgrupo, modalidade: r.modalidade,
  classe: r.classe, subclasse: r.subclasse, detalhe: r.detalhe, posto: r.posto, faixa: r.faixa, unidade: r.unidade,
  tusdMwh: r.tusd_mwh, teMwh: r.te_mwh, tarifaKwh: r.tarifa_kwh, vigenciaInicio: r.vigencia_inicio, vigenciaFim: r.vigencia_fim, fonteAtualizadaEm: r.source_updated_at, ingestedAt: r.ingested_at,
});

async function tarifaAneelDoPerfil(env, perfil, hoje) {
  if (!env?.DB || !perfil.configurado) return null;
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_energy_tariff_reference WHERE tenant_id = ? AND UPPER(distribuidora) = UPPER(?) AND UPPER(subgrupo) = UPPER(?) AND UPPER(modalidade) = UPPER(?) LIMIT 500`,
  ).bind(TENANT_ID, perfil.distribuidora, perfil.subgrupo, perfil.modalidade).all().then((r) => r.results || []).catch(() => []);
  if (!rows.length) return null;
  const linhas = rows.map(linhaTarifaDoBanco);
  const sel = selecionarTarifasVigentes(linhas, { subgrupo: perfil.subgrupo, modalidade: perfil.modalidade, referencia: hoje });
  if (!Object.keys(sel.vigentes).length) return null;
  return {
    porPosto: sel.vigentes, vigenciaInicio: sel.vigenciaInicio, vigenciaFim: sel.vigenciaFim, fonteAtualizadaEm: sel.fonteAtualizadaEm,
    distribuidora: perfil.distribuidora, subgrupo: perfil.subgrupo, modalidade: perfil.modalidade, vigente: sel.vigente,
    ingestedAt: linhas.reduce((m, l) => (l.ingestedAt > m ? l.ingestedAt : m), ""),
  };
}

async function perfilOnsDoBanco(env, subsistema) {
  if (!env?.DB) return null;
  const rows = await env.DB.prepare(`SELECT hora, media_mw, amostras, janela_dias, source_last_instant, ingested_at FROM todogreen_grid_load_profiles WHERE tenant_id = ? AND subsistema = ? ORDER BY hora`)
    .bind(TENANT_ID, subsistema).all().then((r) => r.results || []).catch(() => []);
  if (rows.length !== 24) return null;
  const medias = Array(24).fill(null);
  for (const r of rows) medias[Number(r.hora)] = r.media_mw;
  const perfil = perfilDeMedias(medias, { dias: Math.min(...rows.map((r) => Number(r.amostras) || 0)) });
  if (!perfil.ok) return null;
  return { ...perfil, sourceLastInstant: rows[0].source_last_instant || "", ingestedAt: rows[0].ingested_at || "", subsistema };
}

async function agregadosAnpDoBanco(env, produto) {
  if (!env?.DB) return [];
  return env.DB.prepare(`SELECT produto, nivel, chave, semana, mediana, media, minimo, maximo, amostras, coleta_inicio AS coletaInicio, coleta_fim AS coletaFim FROM todogreen_fuel_price_reference WHERE tenant_id = ? AND produto = ? ORDER BY semana DESC LIMIT 4000`)
    .bind(TENANT_ID, produto).all().then((r) => r.results || []).catch(() => []);
}

const estadoDaFonte = (sync, { now, frescorMs, configured = true, requirement = "" }) => {
  const t = Date.now.call(null) && new Date(now).getTime();
  const ultimoOk = sync?.lastSuccessAt ? Date.parse(sync.lastSuccessAt) : NaN;
  const fonteEm = sync?.sourceUpdatedAt ? Date.parse(sync.sourceUpdatedAt.length === 10 ? `${sync.sourceUpdatedAt}T00:00:00Z` : sync.sourceUpdatedAt) : NaN;
  const stale = Number.isFinite(fonteEm) ? t - fonteEm > frescorMs : (Number.isFinite(ultimoOk) ? t - ultimoOk > frescorMs : false);
  let status = "never";
  if (!configured) status = "not_configured";
  else if (sync?.status === "ok" && Number.isFinite(ultimoOk)) status = stale ? "stale" : "ok";
  else if (sync?.status === "error") status = Number.isFinite(ultimoOk) ? (stale ? "stale" : "ok") : "error";
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
};

/** Estado das três referências para o espaço (alimenta a Saúde do sistema). */
export async function estadoDasReferenciasDeEnergia(env, ownerId, { now = new Date() } = {}) {
  const perfil = await lerPerfilDeEnergia(env, ownerId);
  const syncs = await lerSyncs(env);
  const porFonte = new Map(syncs.map((s) => [s.source, s]));
  const chave = chaveAneel(perfil.distribuidora, perfil.subgrupo, perfil.modalidade);
  const aneel = estadoDaFonte(porFonte.get(chave), {
    now, frescorMs: 400 * 24 * 60 * 60 * 1000, configured: perfil.configurado,
    requirement: perfil.configurado ? "" : "Perfil de energia (Energia → Tarifa de referência): distribuidora, subgrupo e modalidade",
  });
  const ons = estadoDaFonte(porFonte.get(`ons:${perfil.subsistemaOns || "SE"}`), { now, frescorMs: ENERGY_LIMITS.onsFrescorMs, configured: !desligado(env) });
  const anp = estadoDaFonte(porFonte.get("anp:diesel"), { now, frescorMs: ENERGY_LIMITS.anpFrescorMs, configured: !desligado(env) });
  return { perfil: { configurado: perfil.configurado, distribuidora: perfil.distribuidora, subgrupo: perfil.subgrupo, modalidade: perfil.modalidade, subsistemaOns: perfil.subsistemaOns, uf: perfil.uf, municipio: perfil.municipio }, aneel: { ...aneel, source: chave }, ons: { ...ons, source: `ons:${perfil.subsistemaOns || "SE"}` }, anp: { ...anp, source: "anp:diesel" }, disabled: desligado(env) };
}

// ---- O plano de energia do espaço ----
export async function montarPlanoDeEnergia(env, ownerId, { now = new Date(), horaInicio = null, horizonteHoras = 24 } = {}) {
  const nowMs = new Date(now).getTime();
  const hoje = new Date(now).toISOString().slice(0, 10);
  const perfil = await lerPerfilDeEnergia(env, ownerId);
  const [aneel, ons, agregadosAnp, veiculosRows, pontosRows, referencias] = await Promise.all([
    tarifaAneelDoPerfil(env, perfil, hoje),
    perfilOnsDoBanco(env, perfil.subsistemaOns || "SE"),
    agregadosAnpDoBanco(env, perfil.dieselProduto || ANP_PRODUTO_PADRAO),
    env?.DB ? env.DB.prepare(`SELECT id, prefix, plate, energy_type, status, battery_capacity_kwh, energy_consumption_kwh_per_km, connector_type, max_charging_power_kw FROM todogreen_fleet_vehicles WHERE workspace_owner_id = ? AND archived_at IS NULL ORDER BY prefix LIMIT 300`).bind(ownerId).all().then((r) => r.results || []).catch(() => []) : [],
    env?.DB ? env.DB.prepare(`SELECT id, name, current_type, connector, power_kw, status FROM todogreen_charging_points WHERE workspace_owner_id = ? AND archived_at IS NULL ORDER BY name LIMIT 200`).bind(ownerId).all().then((r) => r.results || []).catch(() => []) : [],
    estadoDasReferenciasDeEnergia(env, ownerId, { now }),
  ]);

  // 1) Tarifa pela hierarquia.
  const tarifa = resolverTarifaEnergia({
    contractual: perfil.tarifaContratualKwh > 0 ? { tarifaKwh: perfil.tarifaContratualKwh, date: perfil.tarifaContratualData } : undefined,
    informed: perfil.tarifaInformadaKwh > 0 ? { tarifaKwh: perfil.tarifaInformadaKwh, date: perfil.tarifaInformadaData } : undefined,
    aneel: aneel || undefined,
    fallback: { tarifaKwh: perfil.tarifaFallbackKwh > 0 ? perfil.tarifaFallbackKwh : FLEET_ENERGY_DEFAULTS.energyCostPerKwh },
  }, { now: nowMs, horasPonta: perfil.horasPonta, horasIntermediario: perfil.horasIntermediario });
  const tarifaInfo = {
    ...tarifa,
    fallbackDoMotor: tarifa.tier === "fallback" && !(perfil.tarifaFallbackKwh > 0),
    aneelDisponivel: Boolean(aneel),
    aneelVigente: aneel?.vigente ?? null,
    aneelIngestedAt: aneel?.ingestedAt || "",
  };

  // 2) Frota elétrica e pontos.
  const soc = perfil.socChegadaPercent === null || perfil.socChegadaPercent === undefined ? 20 : perfil.socChegadaPercent;
  const veiculos = veiculosRows
    .filter((v) => String(v.energy_type || "").toLowerCase() === "electric" && String(v.status || "") !== "inativo")
    .map((v) => ({
      id: v.id,
      rotulo: v.prefix || v.plate || v.id,
      energiaNecessariaKwh: Number(v.battery_capacity_kwh) > 0 ? Number(v.battery_capacity_kwh) * (1 - soc / 100) : 0,
      potenciaMaxKw: Number(v.max_charging_power_kw) || 0,
      conector: v.connector_type || "",
      saidaHora: perfil.saidaHora,
      chegadaHora: perfil.chegadaHora,
    }));
  const pontos = pontosRows.map((p) => ({ id: p.id, nome: p.name, potenciaKw: Number(p.power_kw) || 0, tipoCorrente: p.current_type, conector: p.connector, status: p.status || "ativo" }));
  const potenciaInstalada = pontos.filter((p) => p.status === "ativo").reduce((s, p) => s + p.potenciaKw, 0);
  const energiaNecessaria = veiculos.reduce((s, v) => s + v.energiaNecessariaKwh, 0);
  const horasNecessarias = potenciaInstalada > 0 && energiaNecessaria > 0 ? Math.min(12, Math.max(1, Math.ceil(energiaNecessaria / potenciaInstalada))) : 4;

  // 3) Melhor hora (financeira/energética/recomendada).
  const janelas = janelasDeRecarga({ curvaTarifa: tarifa.curva, perfilCarga: ons, horasNecessarias, saidaHora: perfil.saidaHora, chegadaHora: perfil.chegadaHora });
  const janelasInfo = {
    ...janelas,
    ons: ons ? { subsistema: ons.subsistema, nome: ONS_SUBSISTEMAS[ons.subsistema] || ons.subsistema, dias: ons.dias, horaMaisLeve: ons.horaMaisLeve, horaMaisPesada: ons.horaMaisPesada, sourceLastInstant: ons.sourceLastInstant, ingestedAt: ons.ingestedAt, stale: referencias.ons.stale, confidence: ons.confidence } : null,
    horasNecessariasOrigem: potenciaInstalada > 0 && energiaNecessaria > 0 ? "energia_necessaria/potencia_instalada" : "padrao_4h",
  };

  // 4) Plano de recarga por veículo.
  const plano = planoDeRecargaPorVeiculo({
    veiculos, pontos, curvaTarifa: tarifa.curva, demandaContratadaKw: perfil.demandaContratadaKw || 0,
    horaInicio: horaInicio === null || horaInicio === undefined ? horaLocal(now) : horaInicio, horizonteHoras,
  });
  const planoInfo = { ...plano, assumptions: [...plano.assumptions, `energia_necessaria_de_${soc}%_para_100%_da_bateria`, "fuso_America/Sao_Paulo"], socChegadaPercent: soc, veiculosEletricos: veiculos.length, veiculosNaFrota: veiculosRows.length };

  // 5) Diesel pela hierarquia.
  const niveisAnp = niveisAnpParaResolver(agregadosAnp, { produto: perfil.dieselProduto || ANP_PRODUTO_PADRAO, uf: perfil.uf, municipio: perfil.municipio, regiao: perfil.regiao });
  const diesel = resolveDieselPrice({
    contractual: perfil.dieselContratualL > 0 ? { price: perfil.dieselContratualL, date: perfil.dieselContratualData } : undefined,
    fleet: perfil.dieselFrotaL > 0 ? { price: perfil.dieselFrotaL, date: perfil.dieselFrotaData } : undefined,
    ...niveisAnp,
    fallback: perfil.dieselFallbackL > 0 ? { price: perfil.dieselFallbackL } : undefined,
  }, { now: nowMs, staleMs: ENERGY_LIMITS.anpFrescorMs });
  const dieselInfo = { ...diesel, produto: perfil.dieselProduto || ANP_PRODUTO_PADRAO, niveisAnp, anpDisponivel: agregadosAnp.length > 0 };

  return {
    geradoEm: agora(now),
    horaLocal: horaLocal(now),
    perfil,
    tarifa: tarifaInfo,
    janelas: janelasInfo,
    plano: planoInfo,
    diesel: dieselInfo,
    referencias,
    rede: { pontos: pontos.length, ativos: pontos.filter((p) => p.status === "ativo").length, potenciaInstaladaKw: Math.round(potenciaInstalada * 10) / 10 },
  };
}

// ---- Cron: mantém as referências frescas, auto-limitado ----
export async function runTodoGreenEnergyReferenceScheduled(env, now = new Date(), { fetcher = fetch } = {}) {
  if (!env?.DB) return { skipped: "sem D1" };
  if (desligado(env)) return { skipped: ENERGY_ENV_KEYS.disabled };
  if (cronExternoDesligado(env)) return { skipped: CRON_EXTERNAL_DISABLED_KEY };
  const t = new Date(now).getTime();
  const syncs = await lerSyncs(env);
  const porFonte = new Map(syncs.map((s) => [s.source, s]));
  const vencida = (source, janelaMs) => {
    const s = porFonte.get(source);
    const ultimaTentativa = s?.lastAttemptAt ? Date.parse(s.lastAttemptAt) : NaN;
    const ultimoOk = s?.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
    if (Number.isFinite(ultimoOk) && t - ultimoOk < janelaMs) return false;
    // Falhou há pouco: espera 1 h antes de insistir (o cron é horário).
    if (Number.isFinite(ultimaTentativa) && t - ultimaTentativa < 55 * 60 * 1000) return false;
    return true;
  };
  const resumo = { ons: null, anp: null, aneel: [] };
  if (vencida("ons:SE", ENERGY_LIMITS.cronOnsMs)) resumo.ons = await sincronizarCurvaDeCargaOns(env, { fetcher, now });
  if (vencida("anp:diesel", ENERGY_LIMITS.cronAnpMs)) resumo.anp = await sincronizarPrecosAnp(env, { fetcher, now });
  const pares = await env.DB.prepare(
    `SELECT DISTINCT distribuidora, subgrupo, modalidade FROM todogreen_energy_profiles WHERE tenant_id = ? AND distribuidora <> '' AND subgrupo <> '' AND modalidade <> '' ORDER BY distribuidora, subgrupo, modalidade LIMIT 50`,
  ).bind(TENANT_ID).all().then((r) => r.results || []).catch(() => []);
  let rodadas = 0;
  for (const par of pares) {
    if (rodadas >= ENERGY_LIMITS.cronAneelPorRodada) break;
    if (!vencida(chaveAneel(par.distribuidora, par.subgrupo, par.modalidade), ENERGY_LIMITS.cronAneelMs)) continue;
    rodadas += 1;
    resumo.aneel.push(await sincronizarTarifasAneel(env, par, { fetcher, now }));
  }
  return resumo;
}

// ---- HTTP ----
export async function handleTodoGreenEnergy(request, env, access, user, url = new URL(request.url), { fetcher = fetch, now = new Date() } = {}) {
  if (!url.pathname.startsWith("/api/todogreen/energy")) return null;
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  const ownerId = access?.ownerId || "";
  if (!ownerId) return json({ error: "Espaço de trabalho não resolvido." }, 403);
  const parts = url.pathname.split("/").filter(Boolean); // api, todogreen, energy, <recurso>, <sub>
  const recurso = parts[3] || "";
  const sub = parts[4] || "";

  if (recurso === "profile" && request.method === "GET") {
    const perfil = await lerPerfilDeEnergia(env, ownerId);
    return json({ perfil, opcoes: { subgrupos: SUBGRUPOS_ANEEL, modalidades: MODALIDADES_ANEEL, subsistemas: ONS_SUBSISTEMAS, produtosDiesel: ["diesel_s10", "diesel"] }, access: { canWrite: canWrite(access) } });
  }
  if (recurso === "profile" && (request.method === "PUT" || request.method === "PATCH")) {
    if (!canWrite(access)) return json({ error: "Sem permissão para editar o perfil de energia." }, 403);
    const corpo = await request.json().catch(() => null);
    if (!corpo || typeof corpo !== "object") return json({ error: "Corpo inválido." }, 400);
    const atual = await lerPerfilDeEnergia(env, ownerId);
    const perfil = normalizarPerfil(corpo, atual);
    await gravarPerfil(env, ownerId, perfil, user?.id, now);
    await registrarAuditoriaTodoGreen(env, { access, user, action: "energy.profile.updated", resourceType: "energy_profile", resourceId: ownerId, before: atual, after: perfil, details: "Perfil de energia do espaço atualizado" });
    return json({ perfil: await lerPerfilDeEnergia(env, ownerId) });
  }
  if (recurso === "distribuidoras" && request.method === "GET") {
    try {
      const lista = await listarDistribuidorasAneel(env, { fetcher, now, q: url.searchParams.get("q") || "" });
      return json({ distribuidoras: lista, fonte: "ANEEL — datastore distinct SigAgente (cache 7 d)" });
    } catch (error) {
      return json({ distribuidoras: [], error: `ANEEL indisponível: ${texto(error?.message, 200)}` }, 502);
    }
  }
  if (recurso === "plan" && request.method === "GET") {
    const horaInicio = horaOuNula(url.searchParams.get("horaInicio"));
    const horizonte = Math.min(48, Math.max(1, Math.trunc(Number(url.searchParams.get("horas")) || 24)));
    return json(await montarPlanoDeEnergia(env, ownerId, { now, horaInicio, horizonteHoras: horizonte }));
  }
  if (recurso === "references" && request.method === "GET") {
    return json(await estadoDasReferenciasDeEnergia(env, ownerId, { now }));
  }
  if (recurso === "sync" && request.method === "POST") {
    if (!canWrite(access)) return json({ error: "Sem permissão para sincronizar referências." }, 403);
    if (desligado(env)) return json({ error: `Referências de energia desligadas por ${ENERGY_ENV_KEYS.disabled}.`, code: "ENERGY_REFERENCE_DISABLED" }, 409);
    const corpo = await request.json().catch(() => ({}));
    const fonte = texto(corpo?.source || sub, 20).toLowerCase();
    const perfil = await lerPerfilDeEnergia(env, ownerId);
    let resultado;
    if (fonte === "aneel") {
      if (!perfil.configurado) return json({ error: "Configure distribuidora, subgrupo e modalidade no perfil de energia antes de sincronizar a ANEEL.", code: "ENERGY_PROFILE_INCOMPLETE" }, 409);
      resultado = await sincronizarTarifasAneel(env, perfil, { fetcher, now });
    } else if (fonte === "ons") resultado = await sincronizarCurvaDeCargaOns(env, { fetcher, now });
    else if (fonte === "anp") resultado = await sincronizarPrecosAnp(env, { fetcher, now });
    else return json({ error: "Fonte desconhecida. Use aneel, anp ou ons." }, 400);
    await registrarAuditoriaTodoGreen(env, { access, user, action: `energy.reference.sync.${fonte}`, resourceType: "energy_reference", resourceId: fonte, after: resultado, details: resultado.ok ? "Sincronização concluída" : `Falhou: ${resultado.error || ""}` });
    return json({ resultado, referencias: await estadoDasReferenciasDeEnergia(env, ownerId, { now }) }, resultado.ok ? 200 : 502);
  }
  if (recurso === "anp" && sub === "import" && request.method === "POST") {
    if (!canWrite(access)) return json({ error: "Sem permissão para importar preços." }, 403);
    const declarado = Number(request.headers.get("content-length") || 0);
    if (declarado > ENERGY_LIMITS.anpMaxBytes) return json({ error: "Arquivo maior que o limite." }, 413);
    const csvText = await request.text();
    if (!csvText.trim()) return json({ error: "Envie o CSV da ANP no corpo da requisição." }, 400);
    const resultado = await sincronizarPrecosAnp(env, { now, csvText, origem: "anp-import" });
    await registrarAuditoriaTodoGreen(env, { access, user, action: "energy.reference.import.anp", resourceType: "energy_reference", resourceId: "anp", after: resultado, details: resultado.ok ? `Importação ANP: ${resultado.records} registros` : `Falhou: ${resultado.error || ""}` });
    return json({ resultado }, resultado.ok ? 201 : 400);
  }
  return json({ error: "Rota de energia desconhecida." }, 404);
}
