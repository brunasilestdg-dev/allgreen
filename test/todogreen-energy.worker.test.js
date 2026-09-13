import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import {
  handleTodoGreenEnergy,
  runTodoGreenEnergyReferenceScheduled,
  sincronizarCurvaDeCargaOns,
  sincronizarPrecosAnp,
  sincronizarTarifasAneel,
  urlCurvaCargaOns,
  urlPrecosAnp,
  urlTarifasAneel,
} from "../worker/services/todogreen-energy-reference.js";

// P4 — Energia: perfil por espaço, referências públicas (ANEEL/ANP/ONS) em
// cache com data da fonte, plano composto (tarifa → melhor hora → recarga por
// veículo → diesel). Rede sempre injetada (fetcher): nenhum teste sai para a
// internet.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function createUser(id, email, role, permissions) {
  const token = `energy-${id}`;
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
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(raw ? { "content-type": "text/csv" } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} },
);
const resp = (body, { status = 200, type = "application/json" } = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

// Fixtures no formato real das fontes.
const registroAneel = (extra = {}) => ({
  SigAgente: "CPFL-PAULISTA", NumCNPJDistribuidora: "33050196000188", DscREH: "REH 3.456/2026",
  DatInicioVigencia: "2026-04-08", DatFimVigencia: "2027-04-07", DscBaseTarifaria: "Tarifa de Aplicação",
  DscSubGrupo: "A4", DscModalidadeTarifaria: "Verde", DscClasse: "Não se aplica", DscSubClasse: "Não se aplica", DscDetalhe: "Não se aplica",
  NomPostoTarifario: "Fora ponta", DscUnidadeTerciaria: "MWh", VlrTUSD: "164,16", VlrTE: "272,82", DatGeracaoConjuntoDados: "2026-09-12", ...extra,
});
const ANEEL_JSON = { success: true, result: { total: 3, records: [
  registroAneel(),
  registroAneel({ NomPostoTarifario: "Ponta", VlrTUSD: "1351,57" }),
  registroAneel({ NomPostoTarifario: "Não se aplica", DscUnidadeTerciaria: "kW", VlrTUSD: "16,53", VlrTE: ",00" }),
] } };
const cargaNaHora = (h) => 30000 - 12000 * Math.cos(((h - 3) / 24) * 2 * Math.PI);
const csvOns = (dias) => {
  const linhas = ["id_subsistema;nom_subsistema;din_instante;val_cargaenergiahomwmed"];
  for (let d = 0; d < dias; d += 1) for (let h = 0; h < 24; h += 1) for (const s of ["N", "NE", "S", "SE"]) {
    linhas.push(`${s};${s};2026-09-${String(1 + d).padStart(2, "0")} ${String(h).padStart(2, "0")}:00:00;${(cargaNaHora(h) * (s === "SE" ? 1 : 0.3)).toFixed(3).replace(".", ",")}`);
  }
  return linhas.join("\r\n");
};
const CAB_ANP = "Regiao - Sigla;Estado - Sigla;Municipio;Revenda;CNPJ da Revenda;Nome da Rua;Numero Rua;Complemento;Bairro;Cep;Produto;Data da Coleta;Valor de Venda;Valor de Compra;Unidade de Medida;Bandeira";
const linhaAnp = (regiao, uf, mun, produto, data, valor) => `${regiao};${uf};${mun};POSTO;00.000.000/0001-00;RUA;1;;B;00000-000;${produto};${data};${valor};;R$ / litro;BRANCA`;
const CSV_ANP = `${String.fromCharCode(0xfeff)}${[CAB_ANP,
  linhaAnp("SE", "SP", "CAMPINAS", "DIESEL S10", "02/09/2026", "6,19"),
  linhaAnp("SE", "SP", "CAMPINAS", "DIESEL S10", "02/09/2026", "6,39"),
  linhaAnp("SE", "SP", "SAO PAULO", "DIESEL S10", "02/09/2026", "6,79"),
  linhaAnp("SE", "MG", "BELO HORIZONTE", "DIESEL S10", "03/09/2026", "6,49"),
  linhaAnp("N", "AC", "RIO BRANCO", "DIESEL", "02/09/2026", "7,59"),
].join("\r\n")}`;

const fetcherDasFontes = (contador = {}) => async (url, options = {}) => {
  const u = String(url);
  contador[u] = (contador[u] || 0) + 1;
  if (u.includes("datastore_search")) return resp(ANEEL_JSON);
  if (u.includes("CURVA_CARGA_")) return u.includes("CURVA_CARGA_2026") ? resp(csvOns(16), { type: "text/csv" }) : new Response("nada", { status: 404 });
  if (u.includes("diesel-gnv")) return resp(CSV_ANP, { type: "text/csv" });
  throw new Error(`URL inesperada: ${u} ${options.method || "GET"}`);
};
const NOW = new Date("2026-09-13T12:30:00.000Z"); // 09:30 em São Paulo

let op;
let leitor;
let outro;
beforeAll(async () => {
  op = await createUser("energy-op", "energy-op@example.com", "operacoes", ["read", "fleet:manage", "operations:manage"]);
  leitor = await createUser("energy-leitor", "energy-leitor@example.com", "operacoes", ["read"]);
  outro = await createUser("energy-outro", "energy-outro@example.com", "operacoes", ["read", "operations:manage"]);
  // Frota elétrica + um diesel + dois pontos, para o plano ter o que planejar.
  for (const body of [
    { prefix: "EV-1", plate: "ENE1A11", category: "van", vehicleClass: "van", energyType: "electric", batteryCapacityKwh: 100, energyConsumptionKwhPerKm: 0.3, connectorType: "CCS2", maxChargingPowerKw: 60 },
    { prefix: "EV-2", plate: "ENE2A22", category: "truck", vehicleClass: "truck", energyType: "electric", batteryCapacityKwh: 300, energyConsumptionKwhPerKm: 1.1, connectorType: "CCS2", maxChargingPowerKw: 150 },
    { prefix: "EV-3", plate: "ENE3A33", category: "van", vehicleClass: "van", energyType: "electric", energyConsumptionKwhPerKm: 0.3 },
  ]) expect((await call("/api/todogreen/fleet", { method: "POST", token: op.token, body })).status).toBe(201);
  for (const body of [
    { nome: "Carregador DC 1", tipoCorrente: "DC", conector: "CCS2", potenciaKw: 120, status: "ativo", latitude: -23.5, longitude: -46.6 },
    { nome: "Carregador AC", tipoCorrente: "AC", conector: "Type2", potenciaKw: 22, status: "ativo", latitude: -23.5, longitude: -46.6 },
  ]) expect((await call("/api/todogreen/records/pontosRecarga", { method: "POST", token: op.token, body })).status).toBe(201);
  // O perfil do espaço fica no beforeAll: o pool isola o storage por teste e
  // desfaz o que cada `it` escreve; o que os blocos seguintes precisam vem daqui.
  const r = await call("/api/todogreen/energy/profile", { method: "PUT", token: op.token, body: {
    distribuidora: "CPFL-PAULISTA", subgrupo: "a4", modalidade: "verde", uf: "sp", municipio: "Campinas", regiao: "SE", subsistemaOns: "SE",
    demandaContratadaKw: 150, saidaHora: 6, chegadaHora: 20, socChegadaPercent: 30, dieselProduto: "diesel_s10", tarifaFallbackKwh: "0,80",
  } });
  expect(r.status).toBe(200);
});

describe("perfil de energia do espaço", () => {
  it("espaço sem perfil começa vazio e honesto; leitor não edita", async () => {
    const vazio = await (await call("/api/todogreen/energy/profile", { token: outro.token })).json();
    expect(vazio.perfil).toMatchObject({ configurado: false, distribuidora: "", subsistemaOns: "SE" });
    expect(vazio.opcoes.subgrupos).toContain("A4");
    expect(vazio.access.canWrite).toBe(true);
    expect((await (await call("/api/todogreen/energy/profile", { token: leitor.token })).json()).access.canWrite).toBe(false);
    expect((await call("/api/todogreen/energy/profile", { method: "PUT", token: leitor.token, body: { distribuidora: "X" } })).status).toBe(403);
  });

  it("valores gravados ficam normalizados (subgrupo/modalidade canônicos, UF maiúscula, vírgula decimal)", async () => {
    const { perfil } = await (await call("/api/todogreen/energy/profile", { token: op.token })).json();
    expect(perfil).toMatchObject({ configurado: true, distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde", uf: "SP", municipio: "Campinas", regiao: "SE", demandaContratadaKw: 150, saidaHora: 6, chegadaHora: 20, socChegadaPercent: 30, tarifaFallbackKwh: 0.8 });
    // PATCH parcial só mexe no que veio; valor inválido cai para o padrão, não quebra.
    const r = await call("/api/todogreen/energy/profile", { method: "PATCH", token: op.token, body: { subgrupo: "Z9", socChegadaPercent: 140, saidaHora: 27 } });
    expect(r.status).toBe(200);
    const alterado = (await r.json()).perfil;
    expect(alterado).toMatchObject({ subgrupo: "", configurado: false, socChegadaPercent: 100, saidaHora: 3, distribuidora: "CPFL-PAULISTA" });
    // Outro espaço não vê o perfil deste.
    expect((await (await call("/api/todogreen/energy/profile", { token: outro.token })).json()).perfil.configurado).toBe(false);
    // Restaura o perfil que os blocos seguintes usam (o storage do pool não é
    // desfeito por teste neste projeto).
    const restaurado = await call("/api/todogreen/energy/profile", { method: "PATCH", token: op.token, body: { subgrupo: "A4", socChegadaPercent: 30, saidaHora: 6 } });
    expect((await restaurado.json()).perfil.configurado).toBe(true);
  });
});

describe("plano sem referências ingeridas", () => {
  it("tarifa cai no fallback declarado, ONS indisponível vira aviso, diesel sem preço — nada inventado", async () => {
    const r = await call("/api/todogreen/energy/plan?horaInicio=20", { token: op.token });
    expect(r.status).toBe(200);
    const plano = await r.json();
    expect(plano.tarifa).toMatchObject({ tier: "fallback", tarifaKwhBase: 0.8, fallbackDoMotor: false, aneelDisponivel: false });
    expect(plano.tarifa.provenance.measurementType).toBe("DERIVED");
    expect(plano.janelas.energetica).toBeNull();
    expect(plano.janelas.avisos).toContain("ONS_NOT_AVAILABLE");
    expect(plano.janelas.avisos).toContain("TARIFA_PLANA_SEM_GANHO_HORARIO");
    expect(plano.diesel).toMatchObject({ resolved: false, anpDisponivel: false });
    expect(plano.referencias.aneel.status).toBe("never");
    expect(plano.referencias.ons.status).toBe("never");
    // O plano de recarga já roda com a curva plana: 2 EVs com bateria, 1 sem.
    expect(plano.plano.veiculosEletricos).toBe(3);
    expect(plano.plano.veiculos).toHaveLength(2);
    expect(plano.plano.naoPlanejados).toHaveLength(1);
    expect(plano.rede).toMatchObject({ pontos: 2, ativos: 2, potenciaInstaladaKw: 142 });
  });
});

describe("ingestão das referências (rede injetada)", () => {
  it("ANEEL: só linhas de energia (MWh) entram, com data da fonte e vigência", async () => {
    const contador = {};
    const perfil = (await (await call("/api/todogreen/energy/profile", { token: op.token })).json()).perfil;
    const r = await sincronizarTarifasAneel(env, perfil, { fetcher: fetcherDasFontes(contador), now: NOW });
    expect(r).toMatchObject({ ok: true, records: 3, sourceUpdatedAt: "2026-09-12", vigenciaInicio: "2026-04-08" });
    const url = Object.keys(contador)[0];
    expect(url).toBe(urlTarifasAneel(env, perfil));
    expect(decodeURIComponent(url)).toContain('"SigAgente":"CPFL-PAULISTA"');
    expect(decodeURIComponent(url)).toContain('"DscBaseTarifaria":"Tarifa de Aplicação"');
    const linhas = await env.DB.prepare("SELECT posto, unidade, tarifa_kwh FROM todogreen_energy_tariff_reference WHERE distribuidora = 'CPFL-PAULISTA' ORDER BY posto").all();
    expect(linhas.results).toHaveLength(3);
  });

  it("ONS: perfil de 24 h por subsistema com último instante da fonte", async () => {
    const r = await sincronizarCurvaDeCargaOns(env, { fetcher: fetcherDasFontes(), now: NOW });
    expect(r.ok).toBe(true);
    expect(r.subsistemas.SE).toMatchObject({ ok: true, records: 16 * 24, dias: 16, sourceUpdatedAt: "2026-09-16T23:00:00.000Z" });
    const linhas = await env.DB.prepare("SELECT COUNT(*) AS n FROM todogreen_grid_load_profiles WHERE subsistema = 'SE'").first();
    expect(linhas.n).toBe(24);
    expect(urlCurvaCargaOns(env, 2026)).toContain("CURVA_CARGA_2026.csv");
  });

  it("ANP: agregados por semana/nível, sem posto nem CNPJ", async () => {
    const r = await sincronizarPrecosAnp(env, { fetcher: fetcherDasFontes(), now: NOW });
    expect(r).toMatchObject({ ok: true, records: 5, sourceUpdatedAt: "2026-09-03" });
    expect(r.semanas).toEqual(["2026-08-31"]);
    expect(urlPrecosAnp(env)).toContain("ultimas-4-semanas-diesel-gnv.csv");
    const campinas = await env.DB.prepare("SELECT mediana, amostras FROM todogreen_fuel_price_reference WHERE produto = 'diesel_s10' AND nivel = 'municipal' AND chave = 'SP/CAMPINAS'").first();
    expect(campinas).toMatchObject({ mediana: 6.29, amostras: 2 });
    const bruto = await env.DB.prepare("SELECT COUNT(*) AS n FROM todogreen_fuel_price_reference WHERE chave LIKE '%POSTO%' OR chave LIKE '%0001-00%'").first();
    expect(bruto.n).toBe(0);
  });

  it("fonte fora do ar registra erro sem apagar o último sucesso", async () => {
    expect((await sincronizarPrecosAnp(env, { fetcher: fetcherDasFontes(), now: NOW })).ok).toBe(true);
    const r = await sincronizarPrecosAnp(env, { fetcher: async () => new Response("erro", { status: 503 }), now: new Date(NOW.getTime() + 60_000) });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain("HTTP 503");
    const sync = await env.DB.prepare("SELECT status, last_success_at, records, error_message FROM todogreen_energy_reference_sync WHERE source = 'anp:diesel'").first();
    expect(sync.status).toBe("error");
    expect(sync.last_success_at).toBe(NOW.toISOString());
    expect(sync.records).toBe(5);
    expect(sync.error_message).toContain("503");
  });
});

describe("plano com as referências ingeridas", () => {
  beforeAll(async () => {
    const perfil = (await (await call("/api/todogreen/energy/profile", { token: op.token })).json()).perfil;
    expect((await sincronizarTarifasAneel(env, perfil, { fetcher: fetcherDasFontes(), now: NOW })).ok).toBe(true);
    expect((await sincronizarCurvaDeCargaOns(env, { fetcher: fetcherDasFontes(), now: NOW })).ok).toBe(true);
    expect((await sincronizarPrecosAnp(env, { fetcher: fetcherDasFontes(), now: NOW })).ok).toBe(true);
  });

  it("tarifa ANEEL vigente com curva por posto, janela energética do ONS, diesel municipal da ANP e plano por veículo dentro de 20h→6h", async () => {
    const plano = await (await call("/api/todogreen/energy/plan?horaInicio=20", { token: op.token })).json();
    expect(plano.tarifa).toMatchObject({ tier: "aneel", aneelDisponivel: true, aneelVigente: true, stale: false });
    expect(plano.tarifa.tarifaKwhBase).toBeCloseTo(0.43698, 5);
    expect(plano.tarifa.curva[19].tarifa).toBeCloseTo(1.62439, 5);
    expect(plano.tarifa.provenance).toMatchObject({ measurementType: "EXTERNAL", provider: "ANEEL", capturedAt: "2026-09-12", effectiveAt: "2026-04-08" });
    expect(plano.tarifa.detalhe).toMatchObject({ distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde", vigenciaFim: "2027-04-07" });

    expect(plano.janelas.energetica).toMatchObject({ confidence: "HIGH", dias: 16 });
    expect(plano.janelas.ons).toMatchObject({ subsistema: "SE", horaMaisLeve: 3, sourceLastInstant: "2026-09-16T23:00:00.000Z" });
    expect(plano.janelas.recomendada.pesos).toEqual({ financeiro: 0.6, energetico: 0.4 });
    expect(plano.janelas.avisos).toEqual([]);
    for (const j of [plano.janelas.financeira, plano.janelas.energetica, plano.janelas.recomendada]) {
      const horas = Array.from({ length: j.horas }, (_, k) => (j.inicio + k) % 24);
      expect(horas.every((h) => h >= 20 || h < 6)).toBe(true);
    }

    expect(plano.diesel).toMatchObject({ resolved: true, tier: "anp_municipal", priceRs: 6.29, produto: "diesel_s10", anpDisponivel: true });
    expect(plano.diesel.provenance).toMatchObject({ measurementType: "EXTERNAL", provider: "ANP", capturedAt: "2026-09-02" });

    // Recarga por veículo: EV-2 (300 kWh × 70% = 210) primeiro (mais energia, mesma saída), EV-1 (70 kWh).
    expect(plano.plano.veiculos.map((v) => v.rotulo)).toEqual(["EV-2", "EV-1"]);
    const ev2 = plano.plano.veiculos[0];
    expect(ev2).toMatchObject({ energiaKwh: 210, completo: true });
    expect(ev2.sessoes[0].pontoNome).toBe("Carregador DC 1");
    expect(ev2.sessoes.every((s) => s.potenciaKw <= 120)).toBe(true);
    expect(plano.plano.totais.picoKw).toBeLessThanOrEqual(150); // demanda contratada
    expect(plano.plano.totais.custo).toBeGreaterThan(0);
    expect(plano.plano.totais.economia).toBeGreaterThan(0);
    expect(plano.plano.assumptions).toContain("energia_necessaria_de_30%_para_100%_da_bateria");
    expect(plano.plano.naoPlanejados[0]).toMatchObject({ rotulo: "EV-3" });

    expect(plano.referencias.aneel).toMatchObject({ status: "ok", records: 3, sourceUpdatedAt: "2026-09-12" });
    expect(plano.referencias.ons).toMatchObject({ status: "ok" });
    expect(plano.referencias.anp).toMatchObject({ status: "ok", records: 5 });
  });

  it("tarifa contratual informada vence a ANEEL e diz que é INFORMED", async () => {
    expect((await call("/api/todogreen/energy/profile", { method: "PUT", token: op.token, body: { tarifaContratualKwh: 0.55, tarifaContratualData: "2026-08-01" } })).status).toBe(200);
    const plano = await (await call("/api/todogreen/energy/plan", { token: op.token })).json();
    expect(plano.tarifa).toMatchObject({ tier: "contractual", tarifaKwhBase: 0.55 });
    expect(plano.tarifa.provenance.measurementType).toBe("INFORMED");
    expect(plano.tarifa.skipped).toEqual([]);
    expect((await call("/api/todogreen/energy/profile", { method: "PATCH", token: op.token, body: { tarifaContratualKwh: null } })).status).toBe(200);
  });

  it("outro espaço vê as referências públicas, mas não o perfil nem a frota deste", async () => {
    const plano = await (await call("/api/todogreen/energy/plan", { token: outro.token })).json();
    expect(plano.perfil.configurado).toBe(false);
    expect(plano.tarifa.tier).toBe("fallback");
    expect(plano.tarifa.fallbackDoMotor).toBe(true);
    expect(plano.diesel.tier).toBe("anp_national"); // referência pública compartilhada
    expect(plano.plano.veiculos).toEqual([]);
    expect(plano.referencias.aneel.status).toBe("not_configured");
  });
});

describe("sincronização por endpoint, importação e cron", () => {
  const access = (u, permissions) => ({ ownerId: u.id, role: "operacoes", permissions });
  const req = (path, init) => new Request(`https://app.test${path}`, init);

  it("POST /energy/sync exige permissão de escrita e perfil completo para a ANEEL", async () => {
    const semPerm = await handleTodoGreenEnergy(req("/api/todogreen/energy/sync", { method: "POST", body: JSON.stringify({ source: "ons" }) }), env, access(leitor, ["read"]), { id: leitor.id }, undefined, { fetcher: fetcherDasFontes(), now: NOW });
    expect(semPerm.status).toBe(403);
    const semPerfil = await handleTodoGreenEnergy(req("/api/todogreen/energy/sync", { method: "POST", body: JSON.stringify({ source: "aneel" }) }), env, access(outro, ["read", "operations:manage"]), { id: outro.id }, undefined, { fetcher: fetcherDasFontes(), now: NOW });
    expect(semPerfil.status).toBe(409);
    expect((await semPerfil.json()).code).toBe("ENERGY_PROFILE_INCOMPLETE");
    const ok = await handleTodoGreenEnergy(req("/api/todogreen/energy/sync", { method: "POST", body: JSON.stringify({ source: "aneel" }) }), env, access(op, ["read", "operations:manage"]), { id: op.id }, undefined, { fetcher: fetcherDasFontes(), now: NOW });
    expect(ok.status).toBe(200);
    const corpo = await ok.json();
    expect(corpo.resultado.ok).toBe(true);
    expect(corpo.referencias.aneel.status).toBe("ok");
    const desconhecida = await handleTodoGreenEnergy(req("/api/todogreen/energy/sync", { method: "POST", body: JSON.stringify({ source: "x" }) }), env, access(op, ["read", "operations:manage"]), { id: op.id }, undefined, { fetcher: fetcherDasFontes(), now: NOW });
    expect(desconhecida.status).toBe(400);
  });

  it("importação manual do CSV da ANP pelo endpoint", async () => {
    const r = await call("/api/todogreen/energy/anp/import", { method: "POST", token: op.token, raw: CSV_ANP });
    expect(r.status).toBe(201);
    const { resultado } = await r.json();
    expect(resultado).toMatchObject({ ok: true, records: 5 });
    expect((await call("/api/todogreen/energy/anp/import", { method: "POST", token: op.token, raw: "" })).status).toBe(400);
    expect((await call("/api/todogreen/energy/anp/import", { method: "POST", token: leitor.token, raw: CSV_ANP })).status).toBe(403);
  });

  it("cron: só o que venceu roda; segunda rodada logo depois não chama nada", async () => {
    await env.DB.prepare("DELETE FROM todogreen_energy_reference_sync").run();
    const contador = {};
    const comRede = { ...env, TDG_CRON_EXTERNAL_DISABLED: "" };
    const primeira = await runTodoGreenEnergyReferenceScheduled(comRede, NOW, { fetcher: fetcherDasFontes(contador) });
    expect(primeira.ons.ok).toBe(true);
    expect(primeira.anp.ok).toBe(true);
    expect(primeira.aneel).toHaveLength(1);
    expect(primeira.aneel[0]).toMatchObject({ ok: true, source: "aneel:CPFL-PAULISTA|A4|VERDE" });
    const chamadas = Object.values(contador).reduce((s, n) => s + n, 0);
    expect(chamadas).toBe(3);

    const segunda = await runTodoGreenEnergyReferenceScheduled(comRede, new Date(NOW.getTime() + 10 * 60_000), { fetcher: async () => { throw new Error("não devia chamar"); } });
    expect(segunda).toEqual({ ons: null, anp: null, aneel: [] });

    // Desligado por variável: honesto, não silencioso — o interruptor específico e o geral.
    expect(await runTodoGreenEnergyReferenceScheduled({ ...env, TDG_ENERGY_REFERENCE_DISABLED: "1" }, NOW, { fetcher: fetcherDasFontes() })).toEqual({ skipped: "TDG_ENERGY_REFERENCE_DISABLED" });
    expect(await runTodoGreenEnergyReferenceScheduled(env, NOW, { fetcher: fetcherDasFontes() })).toEqual({ skipped: "TDG_CRON_EXTERNAL_DISABLED" });
  });

  it("rota desconhecida e método errado", async () => {
    expect((await call("/api/todogreen/energy/nada", { token: op.token })).status).toBe(404);
    expect((await call("/api/todogreen/energy/plan", { method: "POST", token: op.token, body: {} })).status).toBe(404);
  });
});
