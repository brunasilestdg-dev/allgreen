import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Viabilidade operacional persistida (seções 47–50): snapshot imutável e
// versionado por CONTEÚDO, energia estimada no servidor pelo mesmo modelo do
// electric-plan, e o gate server-side da proposta — rascunho é livre; liberar
// (sent/approved/accepted) uma proposta ligada a oportunidade exige snapshot
// sem faltas.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createUser(id, email, role, permissions) {
  const token = `viab-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)")
    .bind(id, id, email, now).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)")
    .bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
      (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`,
  ).bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token };
}

const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} },
);

const ENERGIA = {
  vehicle: { id: "VAN-082", vehicleClass: "van", batteryCapacityKwh: 80, consumptionKwhPerKm: 0.32, socPercent: 95, reservePercent: 15, maxPayloadKg: 1200, payloadKg: 800, loadPenaltyPercent: 10 },
  route: { distanceKm: 120, elevationGainM: 350, elevationLossM: 300, temperatureC: 24 },
};

let admin;
let auditor;
let vendedor;

beforeAll(async () => {
  admin = await createUser("viab-admin", "viab-admin@example.com", "admin", ["*"]);
  auditor = await createUser("viab-auditor", "viab-auditor@example.com", "auditor", ["read", "audit:read"]);
  vendedor = await createUser("viab-vendedor", "viab-vendedor@example.com", "vendedor", ["read", "crm:manage", "proposal:create", "proposal:manage", "pricing:simulate"]);
  // O vendedor tem espaço próprio (workspace_owner_id = ele mesmo, como nos
  // outros testes de records): o cliente precisa nascer NESSE espaço.
  const agora = new Date().toISOString();
  for (const dono of [vendedor, admin]) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, status, portal_enabled, created_by, updated_by, created_at, updated_at)
       VALUES ('cli-viab', 'todogreen', ?, 'Cliente Viabilidade', 'ativo', 1, ?, ?, ?, ?)`,
    ).bind(dono.id, dono.id, dono.id, agora, agora).run();
    for (const [id, oportunidadeId] of (dono === vendedor
      ? [["cen-gate", "opp-gate"], ["cen-livre", ""]]
      : [["cen-patch", "opp-patch"]])) {
      await env.DB.prepare(
        `INSERT INTO pricing_scenarios
         (id,tenant_id,workspace_owner_id,product_id,client_id,opportunity_id,created_by,
          rule_version,inputs_json,result_json,approvals_json,status,created_at)
         VALUES (?,'todogreen',?,'middle-mile','cli-viab',?,?,'test','{}','{}','{}','draft',?)`,
      ).bind(id, dono.id, oportunidadeId, dono.id, agora).run();
    }
  }
});

describe("snapshot de viabilidade — persistência imutável e versionada", () => {
  it("exige sessão e permissão", async () => {
    expect((await call("/api/todogreen/viability-snapshots?opportunityId=opp-1")).status).toBe(401);
    expect((await call("/api/todogreen/viability-snapshots", { method: "POST", token: auditor.token, body: { opportunityId: "opp-1" } })).status).toBe(403);
    expect((await call("/api/todogreen/viability-snapshots?opportunityId=opp-1", { token: auditor.token })).status).toBe(200);
  });

  it("v1 nasce com energia ESTIMADA no servidor, proveniência e sem faltas quando o custo existe", async () => {
    const r = await call("/api/todogreen/viability-snapshots", {
      method: "POST", token: vendedor.token,
      body: { opportunityId: "opp-1", scenarioId: "cen-1", origin: "São Paulo", destination: "Campinas", cost: 1850, costPerDelivery: 92.5, co2: 0, avoidedCo2: 31.2, energy: ENERGIA },
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.changed).toBe(true);
    expect(body.snapshot.version).toBe(1);
    expect(body.blockers).toEqual([]);
    const s = body.snapshot.snapshot;
    expect(s.distanceKm).toBe(120);
    expect(s.energyKwh).toBeGreaterThan(30);
    expect(s.initialSoc).toBe(95);
    expect(s.arrivalSoc).toBeLessThan(95);
    expect(s.referenceVehicle).toBe("VAN-082");
    expect(s.energyModelVersion).toMatch(/^energy-model@/);
    expect(s.dataSources.map((d) => d.measurementType)).toEqual(expect.arrayContaining(["ESTIMATED", "INFORMED", "DERIVED"]));
    expect(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).toContain(s.confidence);
    expect(body.snapshot.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("conteúdo idêntico NÃO cria versão nova (o hash decide)", async () => {
    const r = await call("/api/todogreen/viability-snapshots", {
      method: "POST", token: vendedor.token,
      body: { opportunityId: "opp-1", scenarioId: "cen-1", origin: "São Paulo", destination: "Campinas", cost: 1850, costPerDelivery: 92.5, co2: 0, avoidedCo2: 31.2, energy: ENERGIA },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.changed).toBe(false);
    expect(body.snapshot.version).toBe(1);
  });

  it("mudança real de premissa cria v2 encadeada ao hash anterior — v1 permanece", async () => {
    const r = await call("/api/todogreen/viability-snapshots", {
      method: "POST", token: vendedor.token,
      body: { opportunityId: "opp-1", scenarioId: "cen-1", origin: "São Paulo", destination: "Campinas", cost: 1990, costPerDelivery: 99.5, co2: 0, avoidedCo2: 31.2, energy: { ...ENERGIA, route: { ...ENERGIA.route, distanceKm: 135 } } },
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.snapshot.version).toBe(2);
    expect(body.snapshot.previousContentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(body.snapshot.snapshot.distanceKm).toBe(135);

    const lista = await (await call("/api/todogreen/viability-snapshots?opportunityId=opp-1&scenarioId=cen-1", { token: vendedor.token })).json();
    expect(lista.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(lista.latest.version).toBe(2);
    expect(lista.liberada).toBe(true);
  });

  it("sem custo o snapshot é gravado, mas com falta declarada — e a leitura diz que não libera", async () => {
    const r = await call("/api/todogreen/viability-snapshots", {
      method: "POST", token: vendedor.token,
      body: { opportunityId: "opp-2", scenarioId: "cen-2", energy: ENERGIA },
    });
    expect(r.status).toBe(201);
    expect((await r.json()).blockers).toEqual(["cost"]);
    const lista = await (await call("/api/todogreen/viability-snapshots?opportunityId=opp-2&scenarioId=cen-2", { token: vendedor.token })).json();
    expect(lista.liberada).toBe(false);
    expect(lista.motivo).toContain("cost");
  });

  it("energia impossível de estimar é recusada com o motivo, não gravada com zero", async () => {
    const r = await call("/api/todogreen/viability-snapshots", {
      method: "POST", token: vendedor.token,
      body: { opportunityId: "opp-3", energy: { vehicle: { batteryCapacityKwh: 80 }, route: { distanceKm: 50 } } },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("consumo");
  });

  it("não existe caminho de alteração ou exclusão", async () => {
    expect((await call("/api/todogreen/viability-snapshots", { method: "PUT", token: admin.token, body: {} })).status).toBe(405);
    expect((await call("/api/todogreen/viability-snapshots", { method: "DELETE", token: admin.token })).status).toBe(405);
  });
});

describe("gate server-side da proposta", () => {
  const proposta = (extra) => ({ clientId: "cli-viab", cliente: "Cliente Viabilidade", titulo: "Proposta gate", cenarioId: "cen-gate", ...extra });

  it("rascunho ligado a oportunidade sem viabilidade é aceito (ainda não foi liberado)", async () => {
    const r = await call("/api/todogreen/records/proposals", { method: "POST", token: vendedor.token, body: proposta({ oportunidadeId: "opp-gate", situacao: "draft" }) });
    expect(r.status).toBe(201);
  });

  it("liberar (sent) sem snapshot é recusado no servidor", async () => {
    const r = await call("/api/todogreen/records/proposals", { method: "POST", token: vendedor.token, body: proposta({ oportunidadeId: "opp-gate", situacao: "sent" }) });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("viability_required");
    expect(body.error).toContain("viabilidade");
  });

  it("snapshot com falta continua bloqueando e nomeia o que falta", async () => {
    await call("/api/todogreen/viability-snapshots", { method: "POST", token: vendedor.token, body: { opportunityId: "opp-gate", scenarioId: "cen-gate", energy: ENERGIA } });
    const r = await call("/api/todogreen/records/proposals", { method: "POST", token: vendedor.token, body: proposta({ oportunidadeId: "opp-gate", situacao: "sent" }) });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("cost");
  });

  it("snapshot completo libera e a proposta registra a versão usada", async () => {
    const snap = await (await call("/api/todogreen/viability-snapshots", { method: "POST", token: vendedor.token, body: { opportunityId: "opp-gate", scenarioId: "cen-gate", cost: 2400, energy: ENERGIA } })).json();
    expect(snap.blockers).toEqual([]);
    const r = await call("/api/todogreen/records/proposals", { method: "POST", token: vendedor.token, body: proposta({ oportunidadeId: "opp-gate", situacao: "sent" }) });
    expect(r.status).toBe(201);
    const registro = (await r.json()).registro;
    expect(registro.campos.viabilidade).toMatchObject({ snapshotId: snap.snapshot.id, version: snap.snapshot.version, contentHash: snap.snapshot.contentHash });
  });

  it("PATCH de rascunho para liberada passa pelo mesmo gate", async () => {
    // Editar exige alcance de carteira (o vendedor sem vínculo recebe 404 no
    // PATCH, regra já existente); o admin do espaço edita.
    const draft = (await (await call("/api/todogreen/records/proposals", { method: "POST", token: admin.token, body: proposta({ oportunidadeId: "opp-patch", cenarioId: "cen-patch", situacao: "draft" }) })).json()).registro;
    const bloqueado = await call(`/api/todogreen/records/proposals/${draft.id}`, { method: "PATCH", token: admin.token, body: { revision: draft.revision, situacao: "sent" } });
    expect(bloqueado.status).toBe(409);
    await call("/api/todogreen/viability-snapshots", { method: "POST", token: admin.token, body: { opportunityId: "opp-patch", cost: 900, distanceKm: 40, vehicleClass: "van", energyKwh: 14 } });
    const liberado = await call(`/api/todogreen/records/proposals/${draft.id}`, { method: "PATCH", token: admin.token, body: { revision: draft.revision, situacao: "sent" } });
    expect(liberado.status).toBe(200);
    expect((await liberado.json()).registro.campos.viabilidade.version).toBe(1);
  });

  it("proposta sem oportunidade continua só com o gate do Deal Desk", async () => {
    const r = await call("/api/todogreen/records/proposals", { method: "POST", token: vendedor.token, body: proposta({ situacao: "sent", cenarioId: "cen-livre" }) });
    expect(r.status).toBe(201);
  });
});
