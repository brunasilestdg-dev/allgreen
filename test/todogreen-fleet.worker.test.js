import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Frota. O que estes testes protegem:
//   • operações consegue CADASTRAR e EDITAR veículo — antes levava 403 silencioso
//     porque `fleet:manage` não constava de papel nenhum;
//   • auditor (só leitura) não escreve;
//   • ordem de manutenção pode ser FECHADA e editada (buraco de CRUD: só criava);
//   • concorrência na manutenção (revision) devolve 409.

let n = 0;
const nextIp = () => `198.31.0.${(++n % 240) + 1}`;

async function sha256(v) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, 'h', 's', ?)")
    .bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)")
    .bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}
async function vincular(usuario, papel, permissoes, donoDoEspaco) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role,
       workspace_owner_id = excluded.workspace_owner_id,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), donoDoEspaco, usuario.id, papel, JSON.stringify(permissoes), agora, agora).run();
}
const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
    env, { waitUntil() {}, passThroughOnException() {} },
  );
};

let operacoes;
let auditor;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();
  operacoes = await criarUsuario("frota-op", "op@frota.test");
  auditor = await criarUsuario("frota-aud", "aud@frota.test");
  // A permissão fleet:manage agora existe no papel operacoes.
  await vincular(operacoes, "operacoes", ["read", "fleet:manage"], operacoes.id);
  await vincular(auditor, "auditor", ["read"], operacoes.id);
});

describe("cadastro de veículo", () => {
  let veiculoId;

  it("operações cadastra um veículo (fleet:manage já concede)", async () => {
    const r = await pedir("/api/todogreen/fleet", {
      metodo: "POST", token: operacoes.token,
      corpo: { prefix: "TG-01", plate: "abc1d23", vehicleClass: "van", energyType: "electric" },
    });
    expect(r.status).toBe(201);
    const { vehicle } = await r.json();
    veiculoId = vehicle.id;
    expect(vehicle.plate).toBe("ABC1D23");
    expect(vehicle.vehicleClass).toBe("van");
  });

  it("auditor (só leitura) não cadastra: 403", async () => {
    const r = await pedir("/api/todogreen/fleet", {
      metodo: "POST", token: auditor.token, corpo: { prefix: "X" },
    });
    expect(r.status).toBe(403);
  });

  it("operações edita o veículo", async () => {
    const lista = await (await pedir("/api/todogreen/fleet", { token: operacoes.token })).json();
    const atual = lista.vehicles.find((v) => v.id === veiculoId);
    const r = await pedir(`/api/todogreen/fleet/${veiculoId}`, {
      metodo: "PATCH", token: operacoes.token, corpo: { status: "maintenance", revision: atual.revision },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).vehicle.status).toBe("maintenance");
  });

  it("ordem de manutenção: cria, fecha e não fecha em cima de revision velha", async () => {
    const criar = await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance`, {
      metodo: "POST", token: operacoes.token, corpo: { title: "Troca de óleo", maintenanceType: "preventive" },
    });
    expect(criar.status).toBe(201);
    const { id: ordemId } = await criar.json();

    const fechar = await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance/${ordemId}`, {
      metodo: "PATCH", token: operacoes.token, corpo: { status: "done", partsCost: 120, laborCost: 80, revision: 1 },
    });
    expect(fechar.status).toBe(200);
    const { order } = await fechar.json();
    expect(order.status).toBe("done");
    expect(order.completed_at).toBeTruthy();
    expect(order.parts_cost).toBe(120);

    // Revisão velha (1) agora é 409.
    const conflito = await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance/${ordemId}`, {
      metodo: "PATCH", token: operacoes.token, corpo: { status: "canceled", revision: 1 },
    });
    expect(conflito.status).toBe(409);

    // Arquivar a ordem.
    const arquivar = await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance/${ordemId}`, {
      metodo: "DELETE", token: operacoes.token,
    });
    expect(arquivar.status).toBe(200);
    const restantes = await (await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance`, { token: operacoes.token })).json();
    expect(restantes.orders.some((o) => o.id === ordemId)).toBe(false);
  });
});
