import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Telemetria elétrica no app do motorista: a pergunta de honestidade é uma só —
// quando NÃO há leitura, a tela mostra "sem leitura", nunca 0%. Aqui isso é
// provado ponta a ponta (resolução da placa do dia + leitura da frota).

const sha256 = async (v) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
let n = 0;
const pedir = (caminho, { token } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    headers: { "cf-connecting-ip": `198.18.0.${(++n % 240) + 1}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }), env, { waitUntil() {}, passThroughOnException() {} });

const criarUsuario = async (id, email) => {
  const a = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)").bind(id, id, email, a).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)").bind(`s-${id}`, id, await sha256(`tok-${id}`), a).run();
  return { id, email, token: `tok-${id}` };
};
const autorizar = async (email, role, perms) => {
  const a = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at) VALUES (?,'todogreen',?,?,'active',?,'','tl-dono',?,?)`)
    .bind(crypto.randomUUID(), email, role, perms, a, a).run();
};

let comLeitura, semLeitura;

beforeAll(async () => {
  const a = new Date().toISOString();
  const hoje = a.slice(0, 10);
  const dona = await criarUsuario("tl-dono", "dona@tel.test");
  await autorizar(dona.email, "admin", '["*"]');
  comLeitura = await criarUsuario("tl-com", "com@tel.test");
  semLeitura = await criarUsuario("tl-sem", "sem@tel.test");
  for (const p of [comLeitura, semLeitura]) await autorizar(p.email, "motorista", '["driver:self","driver:event"]');

  await env.DB.prepare(`INSERT INTO todogreen_clients (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at) VALUES ('tl-cli','todogreen','tl-dono','C','ativo',0,'{}',1,'tl-dono','tl-dono',?,?)`).bind(a, a).run();

  for (const [id, email] of [["tld-com", comLeitura.email], ["tld-sem", semLeitura.email]]) {
    await env.DB.prepare(`INSERT INTO todogreen_drivers (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,availability_status,cnh_number,cnh_category,cnh_expires_at,status,user_email,fields_json,revision,created_by,updated_by,created_at,updated_at) VALUES (?,'todogreen','tl-dono',?,?,?,'employee','available','1','E','2030-01-01','active',?,'{}',1,'tl-dono','tl-dono',?,?)`)
      .bind(id, id, id, `doc-${id}`, email, a, a).run();
  }

  // Veículo COM leitura elétrica; veículo SEM leitura (colunas NULL).
  await env.DB.prepare(`INSERT INTO todogreen_fleet_vehicles (id,workspace_owner_id,prefix,plate,last_soc_percent,last_range_km,last_telemetry_at,last_telemetry_source,created_by,updated_by,created_at,updated_at) VALUES ('v-com','tl-dono','V-COM','TEL0001',73,155,?,'tracker','tl-dono','tl-dono',?,?)`).bind(a, a, a).run();
  await env.DB.prepare(`INSERT INTO todogreen_fleet_vehicles (id,workspace_owner_id,prefix,plate,created_by,updated_by,created_at,updated_at) VALUES ('v-sem','tl-dono','V-SEM','TEL0002','tl-dono','tl-dono',?,?)`).bind(a, a).run();

  // Cada motorista com uma viagem HOJE na sua placa.
  const op = async (id, driverId, placa) => env.DB.prepare(`INSERT INTO todogreen_client_operations (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,driver_id,vehicle_plate,fields_json,created_by,updated_by,created_at,updated_at) VALUES (?,'todogreen','tl-cli','tl-dono',?,'active',?,'A','B',?,?,'{}','tl-dono','tl-dono',?,?)`).bind(id, id, hoje, driverId, placa, a, a).run();
  await op("tlo-com", "tld-com", "TEL0001");
  await op("tlo-sem", "tld-sem", "TEL0002");
});

describe("telemetria do veículo (portal do motorista)", () => {
  it("veículo com leitura devolve SOC e autonomia ao vivo", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/veiculo", { token: comLeitura.token })).json();
    expect(r.temVeiculo).toBe(true);
    expect(r.placa).toBe("TEL0001");
    expect(r.temLeitura).toBe(true);
    expect(r.socPercent).toBe(73);
    expect(r.autonomiaKm).toBe(155);
  });

  it("veículo sem leitura é honesto: temLeitura=false, sem inventar 0%", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/veiculo", { token: semLeitura.token })).json();
    expect(r.placa).toBe("TEL0002");
    expect(r.temLeitura).toBe(false);
    expect(r.socPercent).toBeNull();
    expect(r.frescor).toBe("sem-leitura");
  });
});
