import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { routeFingerprint } from "../src/features/logistics/preflightDomain.js";
import { acoesDoPreflight, gateDePreflightDaRota } from "../worker/services/todogreen-preflight.js";

// P2 — pré-flight PERSISTIDO como gate de publicação da rota + fila de ação.
// A pergunta de segurança: a operação consegue atribuir ao motorista uma rota
// que o pré-flight bloqueou, ou uma rota diferente da que foi checada? Não,
// por construção (guardaDeEscrita da coleção `rotas`).

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.100.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const OWNER = "pf-dono";
let dona;
let leitor;
const agora = new Date().toISOString();
const hoje = agora.slice(0, 10);
const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const criarUsuario = async (id, email, permissoes) => {
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)")
    .bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)")
    .bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`,
  ).bind(crypto.randomUUID(), email, permissoes === '["*"]' ? "admin" : "operacao", permissoes, id, agora, agora).run();
  return { id, email, token: `tok-${id}` };
};

const motorista = (id, nome, { disponibilidade = "available", cnh = "2030-01-01", status = "active" } = {}) =>
  env.DB.prepare(
    `INSERT INTO todogreen_drivers
       (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,availability_status,
        cnh_number,cnh_category,cnh_expires_at,status,user_email,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,?,'employee',?,'123','E',?,?,?,'{}',1,?,?,?,?)`,
  ).bind(id, OWNER, id.toUpperCase(), nome, `doc-${id}`, disponibilidade, cnh, status, `${id}@m.test`, OWNER, OWNER, agora, agora).run();

const veiculo = (id, plate, { status = "available", bateria = 100, consumo = 0.4, soc = 90, docs = null, manut = null, payload = 1500 } = {}) =>
  env.DB.prepare(
    `INSERT INTO todogreen_fleet_vehicles
       (id,tenant_id,workspace_owner_id,prefix,plate,category,vehicle_class,energy_type,status,payload_kg,volume_m3,pallet_capacity,
        battery_capacity_kwh,battery_soh_percent,energy_consumption_kwh_per_km,last_soc_percent,next_document_due_at,next_maintenance_at,
        fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'van','van','electric',?,?,9,8,?,100,?,?,?,?,'{}',1,?,?,?,?)`,
  ).bind(id, OWNER, id.toUpperCase(), plate, status, payload, bateria, consumo, soc, docs, manut, OWNER, OWNER, agora, agora).run();

const PARADAS = [
  { ordem: 1, rotulo: "CD Osasco, SP", lat: -23.5329, lng: -46.7918, recarga: false, concluida: false },
  { ordem: 2, rotulo: "Loja Centro, SP", lat: -23.5505, lng: -46.6333, recarga: false, concluida: false },
];
const ROTA_CURTA = { distanciaKm: 18, duracaoMin: 35 };
const ROTA_LONGA = { distanciaKm: 320, duracaoMin: 300 };

const rodarPreflight = (body, token = dona.token) => pedir("/api/todogreen/preflight", { method: "POST", token, body });
const salvarRota = (body, token = dona.token) => pedir("/api/todogreen/records/rotas", { method: "POST", token, body });
const corpoRota = (extra = {}) => ({
  nome: "Rota teste", motoristaId: "pf-joao", motorista: "João", dataServico: hoje,
  origem: PARADAS[0].rotulo, destino: PARADAS[1].rotulo, distanciaKm: 18, duracaoMin: 35, paradas: PARADAS, ...extra,
});

beforeAll(async () => {
  dona = await criarUsuario(OWNER, "pf-dona@todogreen.com.br", '["*"]');
  leitor = await criarUsuario("pf-leitor", "pf-leitor@todogreen.com.br", '["audit:read"]');
  await motorista("pf-joao", "João Preflight");
  await motorista("pf-alocado", "Maria Alocada", { disponibilidade: "allocated" });
  await motorista("pf-cnh", "Pedro CNH Vencida", { cnh: ontem });
  await motorista("pf-semcnh", "Ana Sem Validade", { cnh: null });
  await veiculo("pf-van1", "PFV1A11");
  await veiculo("pf-van2", "PFV2B22", { bateria: 60, soc: 80 });
  await veiculo("pf-oficina", "PFV3C33", { status: "maintenance" });
  await veiculo("pf-docvencido", "PFV4D44", { docs: ontem });
  await veiculo("pf-manut", "PFV5E55", { manut: ontem });
  await env.DB.prepare(
    `INSERT INTO todogreen_charging_points (id,tenant_id,workspace_owner_id,name,operator,current_type,connector,power_kw,status,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('pf-cp1','todogreen',?,'Pátio Osasco','proprio','DC','CCS2',150,'ativo','{}',1,?,?,?,?)`,
  ).bind(OWNER, OWNER, OWNER, agora, agora).run();
});

describe("POST /api/todogreen/preflight — entrada resolvida pelo cadastro", () => {
  it("motorista e veículo em dia, rota curta → PASS persistido, com energia e proveniência", async () => {
    const r = await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA });
    expect(r.status).toBe(201);
    const { preflight, decisao } = await r.json();
    expect(preflight.status).toBe("PASS");
    expect(preflight.blocked).toBe(false);
    expect(preflight.motorista).toBe("João Preflight");
    expect(preflight.placa).toBe("PFV1A11");
    expect(preflight.energyEstimate?.status).toBe("ok");
    expect(preflight.checks.find((c) => c.id === "energy")?.severity).toBe("PASS");
    expect(preflight.provenance.map((p) => p.id)).toEqual(expect.arrayContaining(["driver", "vehicle", "energy-model", "route"]));
    expect(preflight.fingerprint).toBe(routeFingerprint({ stops: PARADAS, driverId: "pf-joao", vehicleKey: "PFV1A11" }));
    expect(decisao.podeSalvar).toBe(true);
    const linha = await env.DB.prepare("SELECT status, driver_id, vehicle_id FROM todogreen_preflight_results WHERE id = ?").bind(preflight.id).first();
    expect(linha).toMatchObject({ status: "PASS", driver_id: "pf-joao", vehicle_id: "pf-van1" });
  });

  it("motorista alocado → BLOCK com o motivo do cadastro; CNH vencida → BLOCK", async () => {
    const alocado = await (await rodarPreflight({ motoristaId: "pf-alocado", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(alocado.preflight.status).toBe("BLOCK");
    expect(alocado.preflight.checks.find((c) => c.id === "driver_available").reason).toMatch(/allocated/);
    const cnh = await (await rodarPreflight({ motoristaId: "pf-cnh", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(cnh.preflight.checks.find((c) => c.id === "driver_license").severity).toBe("BLOCK");
  });

  it("motorista inexistente → BLOCK (não encontrado); veículo em manutenção → BLOCK; documento vencido → BLOCK; manutenção vencida → WARNING", async () => {
    const fantasma = await (await rodarPreflight({ motoristaId: "nao-existe", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(fantasma.preflight.checks.find((c) => c.id === "driver_available").reason).toMatch(/não encontrado/);
    const oficina = await (await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-oficina", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(oficina.preflight.checks.find((c) => c.id === "vehicle_available").reason).toMatch(/maintenance/);
    const doc = await (await rodarPreflight({ motoristaId: "pf-joao", placa: "pfv4d44", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(doc.preflight.checks.find((c) => c.id === "vehicle_docs").severity).toBe("BLOCK");
    const manut = await (await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-manut", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(manut.preflight.status).toBe("WARNING");
    expect(manut.preflight.checks.find((c) => c.id === "vehicle_maintenance").severity).toBe("WARNING");
  });

  it("sem veículo da frota → WARNING honesto; CNH sem validade → WARNING", async () => {
    const semVeiculo = await (await rodarPreflight({ motoristaId: "pf-joao", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(semVeiculo.preflight.status).toBe("WARNING");
    expect(semVeiculo.preflight.checks.find((c) => c.id === "vehicle_unknown").severity).toBe("WARNING");
    expect(semVeiculo.preflight.energyEstimate).toBeNull();
    const semCnh = await (await rodarPreflight({ motoristaId: "pf-semcnh", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(semCnh.preflight.checks.find((c) => c.id === "driver_license_unknown").severity).toBe("WARNING");
  });

  it("rota longa: sem carregador no caminho seria BLOCK; com o ponto próprio vira WARNING com sugestões calculadas", async () => {
    const r = await (await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-van2", paradas: PARADAS, rota: ROTA_LONGA })).json();
    // van2: 60 kWh × 80% SOC, 0,4 kWh/km → 320 km exige recarga; há carregador próprio de 150 kW → WARNING.
    expect(r.preflight.energyEstimate.chargingRequired).toBe(true);
    const energia = r.preflight.checks.find((c) => c.id === "energy");
    expect(energia.severity).toBe("WARNING");
    expect(r.preflight.suggestions.some((s) => s.type === "insert_charge" && s.powerKw === 150)).toBe(true);
    // Sugestão de troca: a van1 (100 kWh, 90%) também não fecha 320 km sem recarga → não aparece como troca viável.
    expect(r.preflight.input.alternatives.chargers.some((c) => c.source === "proprio")).toBe(true);
  });

  it("valida corpo e permissão", async () => {
    expect((await rodarPreflight({ motoristaId: "pf-joao", paradas: [PARADAS[0]], rota: ROTA_CURTA })).status).toBe(400);
    expect((await rodarPreflight({ motoristaId: "pf-joao", paradas: PARADAS, rota: ROTA_CURTA }, leitor.token)).status).toBe(403);
    expect((await pedir("/api/todogreen/preflight?motoristaId=pf-joao", { token: leitor.token })).status).toBe(200);
    expect((await pedir("/api/todogreen/preflight")).status).toBe(401);
  });
});

describe("gate da coleção rotas — BLOCK nunca vira rota atribuída", () => {
  it("sem pré-flight → 409 com orientação", async () => {
    const r = await salvarRota(corpoRota());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/pré-flight/i);
  });

  it("pré-flight BLOCK → 409; pré-flight de OUTRA rota (paradas diferentes) → 409", async () => {
    const block = await (await rodarPreflight({ motoristaId: "pf-alocado", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    const r1 = await salvarRota(corpoRota({ motoristaId: "pf-alocado", preflightId: block.preflight.id, placa: "PFV1A11" }));
    expect(r1.status).toBe(409);
    expect((await r1.json()).error).toMatch(/bloqueou/);

    const pass = await (await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    const outrasParadas = [PARADAS[0], { ...PARADAS[1], lat: -22.9, lng: -43.2, rotulo: "Rio de Janeiro" }];
    const r2 = await salvarRota(corpoRota({ preflightId: pass.preflight.id, placa: "PFV1A11", paradas: outrasParadas }));
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toMatch(/não corresponde/);
    // Pré-flight de outro espaço/inexistente:
    const r3 = await salvarRota(corpoRota({ preflightId: "nao-existe", placa: "PFV1A11" }));
    expect(r3.status).toBe(409);
  });

  it("PASS do mesmo par → 201 com preflightId/preflightStatus gravados; editar notas não reabre o gate; trocar motorista reabre", async () => {
    const pass = await (await rodarPreflight({ motoristaId: "pf-joao", veiculoId: "pf-van1", paradas: PARADAS, rota: ROTA_CURTA })).json();
    const criada = await salvarRota(corpoRota({ preflightId: pass.preflight.id, placa: "PFV1A11", preflightStatus: "FORJADO" }));
    expect(criada.status).toBe(201);
    const { registro } = await criada.json();
    expect(registro.preflightId).toBe(pass.preflight.id);
    expect(registro.preflightStatus).toBe("PASS");
    expect(registro.placa).toBe("PFV1A11");

    const notas = await pedir(`/api/todogreen/records/rotas/${registro.id}`, { method: "PATCH", token: dona.token, body: { notas: "Entregar até 10h", revision: registro.revision } });
    expect(notas.status).toBe(200);
    const depois = await notas.json();
    expect(depois.registro.preflightId).toBe(pass.preflight.id);
    expect(depois.registro.preflightStatus).toBe("PASS");

    const troca = await pedir(`/api/todogreen/records/rotas/${registro.id}`, { method: "PATCH", token: dona.token, body: { motoristaId: "pf-semcnh", motorista: "Ana", revision: depois.registro.revision } });
    expect(troca.status).toBe(409);
  });

  it("WARNING exige justificativa; com justificativa grava o override auditado e a rota nasce com status WARNING", async () => {
    const warn = await (await rodarPreflight({ motoristaId: "pf-joao", paradas: PARADAS, rota: ROTA_CURTA })).json(); // sem veículo → WARNING
    const semJust = await salvarRota(corpoRota({ preflightId: warn.preflight.id }));
    expect(semJust.status).toBe(409);
    expect((await semJust.json()).error).toMatch(/justificativa/);

    const comJust = await salvarRota(corpoRota({ preflightId: warn.preflight.id, justificativa: "Veículo será definido no pátio; rota curta, sem risco de autonomia." }));
    expect(comJust.status).toBe(201);
    const { registro } = await comJust.json();
    expect(registro.preflightStatus).toBe("WARNING");
    const linha = await env.DB.prepare("SELECT override_reason, overridden_by FROM todogreen_preflight_results WHERE id = ?").bind(warn.preflight.id).first();
    expect(linha.override_reason).toMatch(/pátio/);
    expect(linha.overridden_by).toBe(OWNER);
    const auditoria = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_audit_events WHERE resource_id = ? AND action = 'preflight.overridden'",
    ).bind(warn.preflight.id).first();
    expect(auditoria.total).toBe(1);
  });

  it("kill switch TDG_PREFLIGHT_GATE_DISABLED=1 deixa passar, mas sem carimbar status verificado", async () => {
    const corpo = corpoRota({ preflightId: "", nome: "Rota sem gate" });
    const erro = await gateDePreflightDaRota({ ...env, TDG_PREFLIGHT_GATE_DISABLED: "1" }, { access: { ownerId: OWNER }, user: { id: OWNER }, corpo });
    expect(erro).toBe("");
    expect(corpo.preflightStatusVerificado).toBe("");
    const bloqueado = await gateDePreflightDaRota(env, { access: { ownerId: OWNER }, user: { id: OWNER }, corpo: corpoRota() });
    expect(bloqueado).toMatch(/pré-flight/i);
  });
});

describe("fila de ação — Torre de Controle (P2.c)", () => {
  it("BLOCK/WARNING viram itens no quadro seed, sem duplicar na repetição do mesmo par", async () => {
    const r1 = await (await rodarPreflight({ motoristaId: "pf-alocado", veiculoId: "pf-oficina", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(r1.preflight.status).toBe("BLOCK");
    expect(r1.preflight.acoes.criados.length).toBeGreaterThanOrEqual(1);
    const r2 = await (await rodarPreflight({ motoristaId: "pf-alocado", veiculoId: "pf-oficina", paradas: PARADAS, rota: ROTA_CURTA })).json();
    expect(r2.preflight.acoes.criados).toEqual([]);
    expect(r2.preflight.acoes.existentes.length).toBe(r1.preflight.acoes.criados.length);
    const itens = await env.DB.prepare(
      `SELECT title, priority, fields_json FROM todogreen_work_items WHERE workspace_owner_id = ? AND board_id = ? AND json_extract(fields_json,'$.origem') = 'preflight'`,
    ).bind(OWNER, `${OWNER}:torre-controle`).all();
    expect(itens.results.length).toBeGreaterThanOrEqual(2);
    expect(itens.results.some((i) => /Bloqueio de pré-flight/.test(i.title) && i.priority === "alta")).toBe(true);
  });

  it("risco viário alto do traçado vira ação; PASS sem risco não gera nada", () => {
    const base = { resultado: { status: "PASS", checks: [{ id: "driver", severity: "PASS" }], suggestions: [] }, preflightId: "x", fingerprint: "pf1-abc-3" };
    expect(acoesDoPreflight(base)).toEqual([]);
    const comRisco = acoesDoPreflight({ ...base, risco: { riskScore: 72, acidentes: 40, mortos: 3, upsPorKm: 4.1, trechosCriticos: [{ chave: "c1", rodovias: ["BR-116"] }] } });
    expect(comRisco).toHaveLength(1);
    expect(comRisco[0]).toMatchObject({ sourceKey: "risco:pf1-abc-3", priority: "alta" });
    expect(comRisco[0].description).toMatch(/BR-116/);
    expect(acoesDoPreflight({ ...base, risco: { riskScore: 20 } })).toEqual([]);
  });
});
