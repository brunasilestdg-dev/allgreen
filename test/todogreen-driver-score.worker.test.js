import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// A nota do motorista com comparação entre pares. O que precisa ser provado:
// (1) a régua compara com o time, mas NUNCA vaza nome, id ou nota de outro
// motorista — só o percentil e a mediana; (2) a nota de cada um é computada
// pelo mesmo domínio; (3) sem sessão, nada.

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

const criarUsuario = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return { id, email, token: `tok-${id}` };
};

const autorizar = async (email, role) => {
  const agora = new Date().toISOString();
  const permissoes = role === "admin" ? '["*"]' : '["driver:self","driver:event"]';
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'','ds-dono',?,?)`,
  ).bind(crypto.randomUUID(), email, role, permissoes, agora, agora).run();
};

let dona;
let joao;
let maria;

beforeAll(async () => {
  const agora = new Date().toISOString();
  dona = await criarUsuario("ds-dono", "dona-score@todogreen.com.br");
  await autorizar(dona.email, "admin");

  joao = await criarUsuario("ds-joao", "joao-score@motorista.com.br");
  maria = await criarUsuario("ds-maria", "maria-score@motorista.com.br");
  for (const p of [joao, maria]) await autorizar(p.email, "motorista");

  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('ds-cli','todogreen','ds-dono','Cliente Score','ativo',0,'{}',1,'ds-dono','ds-dono',?,?)`,
  ).bind(agora, agora).run();

  for (const [id, nome, email] of [
    ["drv-jscore", "João Nota Alta", joao.email],
    ["drv-mscore", "Maria Nota Baixa", maria.email],
  ]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_drivers
         (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,
          availability_status,cnh_number,cnh_category,cnh_expires_at,status,user_email,
          fields_json,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','ds-dono',?,?,?,'employee','available','123','E','2030-01-01','active',?,
          '{}',1,'ds-dono','ds-dono',?,?)`,
    ).bind(id, id.toUpperCase(), nome, `doc-${id}`, email, agora, agora).run();
  }

  // João: 2 entregas no prazo, com POD, sem ocorrência → nota 100.
  // Maria: 1 entrega atrasada, sem POD, 1 ocorrência → nota 0.
  const op = async (id, driverId, over) => {
    const base = {
      promised_at: "2026-08-26T14:00:00Z",
      delivered_at: "2026-08-26T12:00:00Z",
      proof_url: "https://x/pod.jpg",
      incident_count: 0,
    };
    const v = { ...base, ...over };
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          driver_id,promised_at,delivered_at,proof_url,incident_count,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','ds-cli','ds-dono',?,'concluida','2026-08-26','CD','Loja',?,?,?,?,?,'{}','ds-dono','ds-dono',?,?)`,
    ).bind(id, id.toUpperCase(), driverId, v.promised_at, v.delivered_at, v.proof_url, v.incident_count, agora, agora).run();
  };
  await op("ds-j1", "drv-jscore", {});
  await op("ds-j2", "drv-jscore", {});
  await op("ds-m1", "drv-mscore", {
    delivered_at: "2026-08-26T16:00:00Z", // depois do prometido → atrasada
    proof_url: "",
    incident_count: 1,
  });
});

describe("nota do motorista + comparação com o time", () => {
  it("João (nota alta) recebe seu score e a posição na régua", async () => {
    const r = await pedir("/api/todogreen/driver-portal/score", { token: joao.token });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.score.disponivel).toBe(true);
    expect(d.score.nota).toBe(100);
    expect(d.comparacao.total).toBe(1); // 1 par (Maria)
    expect(d.comparacao.melhores).toBe(0); // ninguém à frente
    expect(d.comparacao.posicao).toBe(100);
  });

  it("Maria (nota baixa) fica atrás na régua", async () => {
    const d = await (await pedir("/api/todogreen/driver-portal/score", { token: maria.token })).json();
    expect(d.score.nota).toBe(0);
    expect(d.comparacao.melhores).toBe(1); // João à frente
    expect(d.comparacao.posicao).toBe(0);
  });

  it("a comparação é ANÔNIMA: nunca vaza nome, id ou e-mail de outro motorista", async () => {
    const bruto = await (await pedir("/api/todogreen/driver-portal/score", { token: joao.token })).text();
    for (const segredo of ["Maria", "drv-mscore", "maria-score", "ds-m1"]) {
      expect(bruto, segredo).not.toContain(segredo);
    }
  });

  it("sem sessão, o score não responde", async () => {
    expect((await pedir("/api/todogreen/driver-portal/score")).status).toBe(401);
  });
});
