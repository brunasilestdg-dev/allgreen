import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import {
  estadoDoRiscoViario,
  importarAcidentesPrf,
  riscoDoTracado,
  runTodoGreenRoadRiskScheduled,
  sincronizarAntt,
  urlPacoteAntt,
} from "../worker/services/todogreen-road-risk.js";
import { rotearComProvider } from "../worker/services/routing-providers.js";
import { enriquecerComRisco } from "../worker/services/todogreen-routing-maps.js";

// P6 — Risk Map (PRF por célula, ANTT por km) e alternativas de rota com risco
// como custo. Rede sempre injetada.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function createUser(id, email, role, permissions) {
  const token = `rr-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)").bind(id, id, email, now).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)").bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(`INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at) VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`)
    .bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token };
}
const call = (path, { method = "GET", token, body, raw } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(raw !== undefined ? { "content-type": "text/csv" } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} },
);
const NOW = new Date("2026-09-13T12:00:00.000Z");

// Rota BR-116 (Dutra) saindo de Guarulhos: [lon, lat]
const ROTA = [[-46.5332, -23.4512], [-46.5300, -23.4490], [-46.5260, -23.4470], [-46.5200, -23.4440]];
const ROTA_LONGE = [[-40.0, -20.0], [-40.02, -20.02]];
const CAB_PRF = "id;data_inversa;dia_semana;horario;uf;br;km;municipio;causa_acidente;tipo_acidente;classificacao_acidente;fase_dia;sentido_via;condicao_metereologica;tipo_pista;tracado_via;uso_solo;pessoas;mortos;feridos_leves;feridos_graves;ilesos;ignorados;feridos;veiculos;latitude;longitude;regional;delegacia;uop";
const linha = (data, classif, mortos, graves, leves, lat, lon) => `1;${data};sexta-feira;08:00:00;SP;116;230,5;GUARULHOS;Falta;Colisão;${classif};Pleno dia;Crescente;Céu;Dupla;Reta;Não;3;${mortos};${leves};${graves};1;0;${graves + leves};2;${lat};${lon};SPRF;DEL;UOP`;
const CSV_PRF = [CAB_PRF,
  linha("2026-05-10", "Com Vítimas Feridas", 0, 1, 1, "-23,4512", "-46,5332"),
  linha("2026-06-02", "Com Vítimas Fatais", 1, 0, 0, "-23,4490", "-46,5300"),
  linha("2026-07-15", "Sem Vítimas", 0, 0, 0, "-23,4470", "-46,5260"),
  linha("2022-01-01", "Sem Vítimas", 0, 0, 0, "-23,4470", "-46,5260"), // fora da janela
].join("\r\n");
const CSV_ANTT = 'Concessionaria;Data;Km;Trecho\r\n"NOVADUTRA";"02/07/2026";230,000;"BR-116/SP"\r\n"NOVADUTRA";"03/08/2026";230,400;"BR-116/SP"\r\n"NOVADUTRA";"01/01/2024";300,000;"BR-116/SP"\r\n';
const PACOTE_ANTT = { success: true, result: { resources: [
  { id: "r1", name: "Acidentes por quilômetro - NOVADUTRA", format: "CSV", url: "https://dados.antt.gov.br/x/novadutra.csv", size: 5000, last_modified: "2026-09-01T00:00:00" },
  { id: "r2", name: "Acidentes por quilômetro - VIA 040", format: "CSV", url: "https://dados.antt.gov.br/x/via040.csv", size: 4000, last_modified: "2026-09-01T00:00:00" },
  { id: "p1", name: "Dicionário", format: "PDF", url: "https://dados.antt.gov.br/x/dic.pdf" },
] } };
const fetcherAntt = (contador = {}) => async (url) => {
  const u = String(url);
  contador[u] = (contador[u] || 0) + 1;
  if (u.includes("package_show")) return new Response(JSON.stringify(PACOTE_ANTT), { status: 200, headers: { "content-type": "application/json" } });
  if (u.endsWith("novadutra.csv")) return new Response(CSV_ANTT, { status: 200, headers: { "content-type": "text/csv" } });
  if (u.endsWith("via040.csv")) return new Response('Concessionaria;Data;Km;Trecho\r\n"VIA 040";"10/08/2026";500,000;"BR-040/MG"\r\n', { status: 200, headers: { "content-type": "text/csv" } });
  throw new Error(`URL inesperada: ${u}`);
};

let op;
let leitor;
beforeAll(async () => {
  op = await createUser("rr-op", "rr-op@example.com", "operacoes", ["read", "operations:manage", "planning:manage"]);
  leitor = await createUser("rr-leitor", "rr-leitor@example.com", "operacoes", ["read"]);
});

describe("sem índice", () => {
  it("o risco da rota é null com motivo, nunca zero; status diz o que falta", async () => {
    const r = await call("/api/todogreen/risk/route", { method: "POST", token: leitor.token, body: { polyline: ROTA } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ riskScore: null, reason: "RISK_DATA_NOT_AVAILABLE", fontes: { prf: false, antt: false } });
    const st = await (await call("/api/todogreen/risk/status", { token: leitor.token })).json();
    expect(st.prf.status).toBe("never");
    expect(st.prf.requirement).toContain("PRF");
    expect(st.indice).toEqual({ celulasPrf: 0, segmentosAntt: 0, segmentosPrf: 0 });
    expect((await call("/api/todogreen/risk/route", { method: "POST", token: leitor.token, body: { polyline: [[-46, -23]] } })).status).toBe(400);
  });
});

describe("PRF importado", () => {
  beforeAll(async () => {
    const r = await importarAcidentesPrf(env, CSV_PRF, { now: NOW });
    expect(r).toMatchObject({ ok: true, records: 4, foraDaJanela: 1, semCoordenada: 0, sourceUpdatedAt: "2026-07-15" });
    expect(r.celulas).toBeGreaterThanOrEqual(2);
  });

  it("a rota que atravessa as células recebe score, trechos críticos e confiança", async () => {
    const r = await (await call("/api/todogreen/risk/route", { method: "POST", token: leitor.token, body: { polyline: ROTA, refs: ["BR-116"] } })).json();
    expect(r.riskScore).toBeGreaterThan(0);
    expect(r.celulasComRisco).toBeGreaterThanOrEqual(2);
    expect(r.acidentes).toBe(3);
    expect(r.mortos).toBe(1);
    expect(r.confidence).toBe("HIGH");
    expect(r.trechosCriticos[0].ups).toBeGreaterThanOrEqual(13);
    expect(r.trechosCriticos[0].mortos).toBe(1);
    expect(r.fontes.prf).toBe(true);
    // Segmentos PRF por rodovia/km também alimentam o aviso por rodovia.
    expect(r.avisosRodovias).toEqual([{ rodovia: "BR-116", segmentos: 1, acidentes: 3, kmCritico: 230, acidentesKmCritico: 3, fonte: "prf" }]);
    // Longe de qualquer ocorrência: 0 com confiança MEDIUM (há índice, não há registro).
    const longe = await riscoDoTracado(env, ROTA_LONGE, { now: NOW });
    expect(longe).toMatchObject({ riskScore: 0, celulasComRisco: 0, confidence: "MEDIUM" });
  });

  it("importação pelo endpoint exige permissão e CSV válido", async () => {
    expect((await call("/api/todogreen/risk/import/prf", { method: "POST", token: leitor.token, raw: CSV_PRF })).status).toBe(403);
    expect((await call("/api/todogreen/risk/import/prf", { method: "POST", token: op.token, raw: "a;b\n1;2" })).status).toBe(400);
    const ok = await call("/api/todogreen/risk/import/prf", { method: "POST", token: op.token, raw: CSV_PRF });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.resultado.records).toBe(4);
    expect(body.estado.prf.status).toBe("ok");
    expect(body.estado.indice.celulasPrf).toBeGreaterThanOrEqual(2);
  });
});

describe("ANTT por km", () => {
  it("descobre os recursos CSV do pacote e sincroniza um por rodada; refresh de 30 dias", async () => {
    await env.DB.prepare("DELETE FROM todogreen_reference_sync WHERE source LIKE 'antt:%'").run();
    expect(urlPacoteAntt(env)).toBe("https://dados.antt.gov.br/api/3/action/package_show?id=acidentes-quilometro-rodovias");
    const contador = {};
    const primeira = await sincronizarAntt(env, { fetcher: fetcherAntt(contador), now: NOW });
    expect(primeira).toMatchObject({ ok: true, recursos: 2, pendentes: 0 });
    expect(primeira.sincronizados).toHaveLength(1);
    expect(primeira.sincronizados[0]).toMatchObject({ ok: true, records: 3, segmentos: 1, foraDaJanela: 1, sourceUpdatedAt: "2026-08-03" });
    const segunda = await sincronizarAntt(env, { fetcher: fetcherAntt(contador), now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(segunda.sincronizados).toHaveLength(1);
    expect(segunda.sincronizados[0].source).toBe("antt:acidentes-por-quilometro-via-040");
    const terceira = await sincronizarAntt(env, { fetcher: fetcherAntt(contador), now: new Date(NOW.getTime() + 2 * 60 * 60_000) });
    expect(terceira.sincronizados).toHaveLength(0);
    const seg = await env.DB.prepare("SELECT rodovia, km, concessionaria, acidentes FROM todogreen_road_risk_segments WHERE source = 'antt' ORDER BY rodovia").all();
    expect(seg.results).toEqual([
      { rodovia: "BR-040/MG", km: 500, concessionaria: "VIA 040", acidentes: 1 },
      { rodovia: "BR-116/SP", km: 230, concessionaria: "NOVADUTRA", acidentes: 2 },
    ]);
    const st = await estadoDoRiscoViario(env, { now: NOW });
    expect(st.antt.status).toBe("ok");
    expect(st.indice.segmentosAntt).toBe(2);
    // O aviso por rodovia passa a contar PRF + ANTT no mesmo km.
    const r = await riscoDoTracado(env, ROTA, { refs: ["BR-116"], now: NOW });
    expect(r.avisosRodovias[0]).toMatchObject({ rodovia: "BR-116", acidentes: 5, kmCritico: 230 });
    expect(r.fontes.antt).toBe(true);
  });

  it("cron: desligado por variável é honesto; POST /sync/antt exige permissão", async () => {
    expect(await runTodoGreenRoadRiskScheduled({ ...env, TDG_ROAD_RISK_DISABLED: "1" }, NOW, { fetcher: fetcherAntt() })).toEqual({ skipped: "TDG_ROAD_RISK_DISABLED" });
    expect((await call("/api/todogreen/risk/sync/antt", { method: "POST", token: leitor.token, body: {} })).status).toBe(403);
  });
});

describe("alternativas de rota com risco como custo", () => {
  const OSRM = { code: "Ok", routes: [
    { distance: 6200, duration: 600, geometry: { type: "LineString", coordinates: ROTA }, legs: [{ steps: [{ ref: "BR-116" }] }] },
    { distance: 7100, duration: 660, geometry: { type: "LineString", coordinates: ROTA_LONGE }, legs: [{ steps: [{ ref: "SP-070" }] }] },
  ] };

  it("OSRM com alternatives=true devolve as duas rotas com refs; o ranking usa o risco", async () => {
    let urlChamada = "";
    const fetcher = async (url) => { urlChamada = String(url); return new Response(JSON.stringify(OSRM), { status: 200, headers: { "content-type": "application/json" } }); };
    const r = await rotearComProvider({ coordinates: [ROTA[0], ROTA[3]], vehicle: { category: "van" }, alternatives: true }, env, { fetcher });
    expect(r.status).toBe(200);
    expect(urlChamada).toContain("alternatives=true");
    expect(urlChamada).toContain("steps=true");
    expect(r.body.routes).toHaveLength(2);
    expect(r.body.routes[0].roadRefs).toEqual(["BR-116"]);
    const enriquecido = await enriquecerComRisco(r.body, { vehicle: { category: "van", energyConsumptionKwhPerKm: 0.3 } }, env);
    expect(enriquecido.riskAvailable).toBe(true);
    expect(enriquecido.routes[0].risk.riskScore).toBeGreaterThan(0);
    expect(enriquecido.routes[1].risk.riskScore).toBe(0);
    expect(enriquecido.ranking).toBeTruthy();
    // A rota mais curta é a mais rápida e barata; a alternativa longe das
    // ocorrências vence em risco — o risco não bloqueia, ranqueia.
    const rec = enriquecido.ranking.recommendations || enriquecido.ranking;
    const porObjetivo = JSON.stringify(rec);
    expect(porObjetivo).toContain("alternativa-1");
    expect(porObjetivo).toContain("principal");
  });

  it("sem alternatives o formato antigo continua: uma rota, sem ranking", async () => {
    const fetcher = async () => new Response(JSON.stringify({ code: "Ok", routes: [OSRM.routes[0]] }), { status: 200, headers: { "content-type": "application/json" } });
    const r = await rotearComProvider({ coordinates: [ROTA[0], ROTA[3]], vehicle: { category: "van" } }, env, { fetcher });
    const enriquecido = await enriquecerComRisco(r.body, {}, env);
    expect(enriquecido.routes).toHaveLength(1);
    expect(enriquecido.ranking).toBeNull();
    expect(enriquecido.routes[0].risk.riskScore).toBeGreaterThan(0);
  });
});
