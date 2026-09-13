import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import {
  TERMOS_GDELT,
  TERMOS_PNCP,
  handleTodoGreenMarketSignals,
  runTodoGreenMarketSignalsScheduled,
  sincronizarComprasGov,
  sincronizarGdelt,
  sincronizarPncp,
  urlBuscaPncp,
  urlContratacoesComprasGov,
  urlGdelt,
} from "../worker/services/todogreen-market-signals.js";

// P5 — sinais de mercado estruturados. Rede sempre injetada (fetcher).

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function createUser(id, email, role, permissions) {
  const token = `ms-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)").bind(id, id, email, now).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)").bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(`INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at) VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`)
    .bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token };
}
const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} },
);
const resp = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOW = new Date("2026-09-13T12:00:00.000Z");

const PNCP_ITEM = (extra = {}) => ({
  id: "a1", title: "Edital nº 10/2026", description: "Contratação de empresa para serviços de transporte de cargas e distribuição de mercadorias com veículos elétricos (VUC)",
  item_url: "/compras/01612441000107/2026/131", numero_controle_pncp: "01612441000107-1-000131/2026", orgao_nome: "MUNICIPIO X", uf: "SP", municipio_nome: "Campinas",
  modalidade_licitacao_nome: "Pregão - Eletrônico", situacao_nome: "Divulgada no PNCP", data_publicacao_pncp: "2026-09-12T10:00:00", data_fim_vigencia: "2026-09-30T08:00", valor_global: 250000, ...extra,
});
const COMPRAS_ITEM = {
  numeroControlePNCP: "00394544000185-1-001941/2026", modalidadeNome: "Pregão - Eletrônico", modalidadeIdPncp: 6, codigoModalidade: 5,
  objetoCompra: "Contratação de serviços de logística e frete para distribuição de materiais com caminhão baú", unidadeOrgaoUfSigla: "DF", unidadeOrgaoMunicipioNome: "BRASÍLIA",
  orgaoEntidadeRazaoSocial: "MINISTERIO Y", dataPublicacaoPncp: "2026-09-11T04:00:02", dataEncerramentoPropostaPncp: "2026-09-24T09:00:00", valorTotalEstimado: 0, situacaoCompraNomePncp: "Divulgada no PNCP",
};
const GDELT_ART = { url: "https://noticia.com.br/x?utm_source=a", title: "Transportadora adota caminhões elétricos na logística de São Paulo", seendate: "20260912T143000Z", domain: "noticia.com.br", language: "Portuguese", sourcecountry: "Brazil" };

const fetcher = (contador = {}) => async (url) => {
  const u = String(url);
  contador[u] = (contador[u] || 0) + 1;
  if (u.includes("pncp.gov.br/api/search")) {
    // Um termo devolve o mesmo edital repetido + um fora de escopo; outros termos, vazio.
    if (u.includes("q=transporte+de+cargas")) return resp({ items: [PNCP_ITEM(), PNCP_ITEM({ id: "a2", description: "Seguro da frota municipal", numero_controle_pncp: "01612441000107-1-000200/2026" })], total: 2 });
    if (u.includes("q=frete")) return resp({ items: [PNCP_ITEM({ id: "a3" })], total: 1 }); // duplicado do primeiro (mesmo número de controle)
    return resp({ items: [], total: 0 });
  }
  if (u.includes("compras.gov.br")) {
    if (u.includes("codigoModalidade=5") && u.includes("pagina=1")) return resp({ resultado: [COMPRAS_ITEM], totalRegistros: 1, totalPaginas: 1, paginasRestantes: 0 });
    return resp({ resultado: [], totalRegistros: 0, totalPaginas: 0, paginasRestantes: 0 });
  }
  if (u.includes("gdeltproject.org")) return resp({ articles: [GDELT_ART] });
  throw new Error(`URL inesperada: ${u}`);
};

let vendedor;
let leitor;
let outro;
beforeAll(async () => {
  vendedor = await createUser("ms-vend", "ms-vend@example.com", "vendedor", ["read", "market:read", "market:research"]);
  leitor = await createUser("ms-leitor", "ms-leitor@example.com", "operacoes", ["read", "market:read"]);
  outro = await createUser("ms-outro", "ms-outro@example.com", "operacoes", ["read"]);
});

describe("URLs das fontes", () => {
  it("PNCP, Compras.gov e GDELT com os parâmetros que as APIs exigem", () => {
    expect(urlBuscaPncp(env, "transporte de cargas")).toBe("https://pncp.gov.br/api/search/?q=transporte+de+cargas&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=20&status=recebendo_proposta");
    expect(urlContratacoesComprasGov(env, { inicio: "2026-09-10", fim: "2026-09-13", modalidade: 5 })).toContain("/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?dataPublicacaoPncpInicial=2026-09-10&dataPublicacaoPncpFinal=2026-09-13&codigoModalidade=5&pagina=1&tamanhoPagina=50");
    expect(urlGdelt(env, '"frota elétrica"')).toContain("api.gdeltproject.org/api/v2/doc/doc?query=%22frota%20el%C3%A9trica%22%20sourcecountry%3ABR&mode=artlist&maxrecords=75&format=json&timespan=7d");
    expect(TERMOS_PNCP.length).toBeGreaterThanOrEqual(5);
    expect(TERMOS_GDELT.length).toBeGreaterThanOrEqual(3);
  });
});

describe("sincronizações", () => {
  it("PNCP: normaliza, pontua, rejeita fora de escopo e deduplica entre termos", async () => {
    const r = await sincronizarPncp(env, { fetcher: fetcher(), now: NOW, ufsFoco: ["SP"] });
    expect(r.ok).toBe(true);
    expect(r.records).toBe(3);
    expect(r.aceitos).toBe(1);
    expect(r.rejeitados).toEqual({ fora_do_escopo: 1, duplicado: 1 });
    const row = await env.DB.prepare("SELECT source, score, uf, prazo_proposta, seen_count, url FROM todogreen_market_signals WHERE external_id = '01612441000107-1-000131/2026'").first();
    expect(row).toMatchObject({ source: "pncp", uf: "SP", prazo_proposta: "2026-09-30T08:00:00.000Z", seen_count: 1, url: "https://pncp.gov.br/app/editais/01612441000107/2026/131" });
    expect(row.score).toBeGreaterThanOrEqual(90);
    // Segunda rodada: mesmo sinal, contagem sobe, nada duplicado.
    await sincronizarPncp(env, { fetcher: fetcher(), now: new Date(NOW.getTime() + 3600_000) });
    const again = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(seen_count) AS vistos FROM todogreen_market_signals WHERE source = 'pncp'").first();
    expect(again).toMatchObject({ n: 1, vistos: 2 });
  });

  it("Compras.gov: contratações normalizadas junto ao PNCP", async () => {
    const r = await sincronizarComprasGov(env, { fetcher: fetcher(), now: NOW });
    expect(r).toMatchObject({ ok: true, records: 1, aceitos: 1 });
    const row = await env.DB.prepare("SELECT source, modalidade, prazo_proposta, orgao FROM todogreen_market_signals WHERE external_id = '00394544000185-1-001941/2026'").first();
    expect(row).toMatchObject({ source: "compras-gov", modalidade: "Pregão - Eletrônico", prazo_proposta: "2026-09-24T09:00:00.000Z", orgao: "MINISTERIO Y" });
  });

  it("GDELT: notícia vira sinal 'noticia' com URL canônica; limite de taxa vira erro honesto", async () => {
    const r = await sincronizarGdelt(env, { fetcher: fetcher(), now: NOW, termo: TERMOS_GDELT[0] });
    expect(r).toMatchObject({ ok: true, records: 1, aceitos: 1 });
    const row = await env.DB.prepare("SELECT kind, url, dominio, score FROM todogreen_market_signals WHERE source = 'gdelt'").first();
    expect(row).toMatchObject({ kind: "noticia", url: "https://noticia.com.br/x", dominio: "noticia.com.br" });
    expect(row.score).toBeGreaterThan(0);
    const limitado = await sincronizarGdelt(env, { fetcher: async () => new Response("Please limit requests to one every 5 seconds", { status: 429 }), now: NOW, termo: TERMOS_GDELT[1] });
    expect(limitado.ok).toBe(false);
    expect(limitado.error).toContain("HTTP 429");
  });

  it("fonte fora do ar não apaga o último sucesso", async () => {
    await sincronizarComprasGov(env, { fetcher: fetcher(), now: NOW });
    const r = await sincronizarComprasGov(env, { fetcher: async () => new Response("erro", { status: 503 }), now: new Date(NOW.getTime() + 60_000) });
    expect(r.ok).toBe(false);
    const sync = await env.DB.prepare("SELECT status, last_success_at, records FROM todogreen_reference_sync WHERE source = 'compras-gov:contratacoes'").first();
    expect(sync).toMatchObject({ status: "error", last_success_at: NOW.toISOString(), records: 1 });
  });
});

describe("endpoints e triagem por espaço", () => {
  beforeAll(async () => {
    await sincronizarPncp(env, { fetcher: fetcher(), now: NOW });
    await sincronizarComprasGov(env, { fetcher: fetcher(), now: NOW });
    await sincronizarGdelt(env, { fetcher: fetcher(), now: NOW });
  });

  it("GET lista por score com estado das fontes; sem market:read → 403", async () => {
    const r = await call("/api/todogreen/market-signals?minScore=40", { token: vendedor.token });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.signals.length).toBeGreaterThanOrEqual(2);
    expect(body.signals[0].source).toBe("pncp");
    expect(body.signals[0].scoreReasons.length).toBeGreaterThan(2);
    expect(body.signals.every((s, i, a) => i === 0 || a[i - 1].score >= s.score)).toBe(true);
    expect(body.fontes.pncp.status).toBe("ok");
    expect(body.fontes.sinais.total).toBeGreaterThanOrEqual(3);
    expect(body.access.canResearch).toBe(true);
    expect((await call("/api/todogreen/market-signals", { token: outro.token })).status).toBe(403);
    const filtrado = await (await call("/api/todogreen/market-signals?source=gdelt", { token: leitor.token })).json();
    expect(filtrado.signals.map((s) => s.source)).toEqual(["gdelt"]);
    expect(filtrado.access.canResearch).toBe(false);
  });

  it("PATCH tria por espaço (leitor não pode; outro espaço não vê a triagem)", async () => {
    const lista = await (await call("/api/todogreen/market-signals?source=pncp", { token: vendedor.token })).json();
    const id = lista.signals[0].id;
    expect((await call(`/api/todogreen/market-signals/${id}`, { method: "PATCH", token: leitor.token, body: { status: "dismissed" } })).status).toBe(403);
    expect((await call(`/api/todogreen/market-signals/${id}`, { method: "PATCH", token: vendedor.token, body: { status: "errado" } })).status).toBe(400);
    const r = await call(`/api/todogreen/market-signals/${id}`, { method: "PATCH", token: vendedor.token, body: { status: "triaged", note: "avaliar edital" } });
    expect(r.status).toBe(200);
    expect((await r.json()).signal.triage).toMatchObject({ status: "triaged", note: "avaliar edital" });
    const doVendedor = await (await call("/api/todogreen/market-signals?status=triaged", { token: vendedor.token })).json();
    expect(doVendedor.signals.map((s) => s.id)).toContain(id);
    // Restaura para não vazar estado entre testes (o pool não desfaz escritas).
    await call(`/api/todogreen/market-signals/${id}`, { method: "PATCH", token: vendedor.token, body: { status: "new" } });
    expect((await call(`/api/todogreen/market-signals/nao-existe`, { method: "PATCH", token: vendedor.token, body: { status: "triaged" } })).status).toBe(404);
  });

  it("POST /sync exige market:research e conhece as três fontes", async () => {
    const req = (body) => new Request("https://app.test/api/todogreen/market-signals/sync", { method: "POST", body: JSON.stringify(body) });
    const acessoLeitor = { ownerId: leitor.id, role: "operacoes", permissions: ["read", "market:read"] };
    const acessoVend = { ownerId: vendedor.id, role: "vendedor", permissions: ["read", "market:read", "market:research"] };
    expect((await handleTodoGreenMarketSignals(req({ source: "pncp" }), env, acessoLeitor, { id: leitor.id }, undefined, { fetcher: fetcher(), now: NOW })).status).toBe(403);
    const ok = await handleTodoGreenMarketSignals(req({ source: "gdelt", termo: '"frota elétrica"' }), env, acessoVend, { id: vendedor.id }, undefined, { fetcher: fetcher(), now: NOW });
    expect(ok.status).toBe(200);
    expect((await ok.json()).resultado).toMatchObject({ ok: true, records: 1 });
    expect((await handleTodoGreenMarketSignals(req({ source: "x" }), env, acessoVend, { id: vendedor.id }, undefined, { fetcher: fetcher(), now: NOW })).status).toBe(400);
    const desligado = await handleTodoGreenMarketSignals(req({ source: "pncp" }), { ...env, TDG_MARKET_SIGNALS_DISABLED: "1" }, acessoVend, { id: vendedor.id }, undefined, { fetcher: fetcher(), now: NOW });
    expect(desligado.status).toBe(409);
  });

  it("cron: PNCP/Compras quando vencem, GDELT um termo por vez; nada roda de novo logo depois", async () => {
    await env.DB.prepare("DELETE FROM todogreen_reference_sync WHERE source LIKE 'pncp:%' OR source LIKE 'compras-gov:%' OR source LIKE 'gdelt:%'").run();
    const contador = {};
    const comRede = { ...env, TDG_CRON_EXTERNAL_DISABLED: "" };
    const primeira = await runTodoGreenMarketSignalsScheduled(comRede, NOW, { fetcher: fetcher(contador) });
    expect(primeira.pncp.ok).toBe(true);
    expect(primeira.comprasGov.ok).toBe(true);
    expect(primeira.gdelt.ok).toBe(true);
    const chamadasGdelt = Object.keys(contador).filter((u) => u.includes("gdeltproject")).length;
    expect(chamadasGdelt).toBe(1);
    // Disparos seguintes: PNCP/Compras não vencem; o GDELT roda UM termo novo por
    // disparo (rotação) até esgotar a lista — e então nada roda.
    const vistos = new Set([primeira.gdelt.source]);
    for (let i = 1; i < TERMOS_GDELT.length; i += 1) {
      const rodada = await runTodoGreenMarketSignalsScheduled(comRede, new Date(NOW.getTime() + i * 5 * 60_000), { fetcher: fetcher() });
      expect(rodada.pncp).toBeNull();
      expect(rodada.comprasGov).toBeNull();
      expect(rodada.gdelt.ok).toBe(true);
      expect(vistos.has(rodada.gdelt.source)).toBe(false);
      vistos.add(rodada.gdelt.source);
    }
    const segunda = await runTodoGreenMarketSignalsScheduled(comRede, new Date(NOW.getTime() + TERMOS_GDELT.length * 5 * 60_000), { fetcher: async () => { throw new Error("não devia chamar"); } });
    expect(segunda).toEqual({ pncp: null, comprasGov: null, gdelt: null });
    expect(await runTodoGreenMarketSignalsScheduled({ ...env, TDG_MARKET_SIGNALS_DISABLED: "1" }, NOW, { fetcher: fetcher() })).toEqual({ skipped: "TDG_MARKET_SIGNALS_DISABLED" });
    expect(await runTodoGreenMarketSignalsScheduled(env, NOW, { fetcher: fetcher() })).toEqual({ skipped: "TDG_CRON_EXTERNAL_DISABLED" });
  });

  it("o radar por busca web está roteado (regressão: a tela chamava um endpoint sem rota)", async () => {
    const r = await call("/api/todogreen/market-radar?q=teste", { token: vendedor.token });
    // Sem provedor de busca configurado o radar responde 200 com configuração/avisos, nunca 404.
    expect([200, 500]).toContain(r.status);
    expect(r.status).not.toBe(404);
    expect((await call("/api/todogreen/market-radar", { token: outro.token })).status).toBe(403);
  });
});
