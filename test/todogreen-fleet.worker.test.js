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
     ON CONFLICT(tenant_id, workspace_owner_id, user_id) DO UPDATE SET role = excluded.role,
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

describe("economia real da frota", () => {
  it("soma a manutenção por veículo e o km das operações por placa", async () => {
    const agora = new Date().toISOString();
    // Veículo com placa ECO1A11.
    const veic = await (await pedir("/api/todogreen/fleet", {
      metodo: "POST", token: operacoes.token, corpo: { prefix: "TG-ECO", plate: "eco1a11", vehicleClass: "van", energyType: "electric" },
    })).json();
    const veiculoId = veic.vehicle.id;

    // Ordem de manutenção fechada com custo total 200 (120 peças + 80 mão de obra).
    const om = await (await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance`, {
      metodo: "POST", token: operacoes.token, corpo: { title: "Revisão" },
    })).json();
    await pedir(`/api/todogreen/fleet/${veiculoId}/maintenance/${om.id}`, {
      metodo: "PATCH", token: operacoes.token, corpo: { status: "done", partsCost: 120, laborCost: 80, revision: 1 },
    });

    // Cliente + duas operações na mesma placa: 500 km no total, 1 entregue.
    const clienteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients (id, tenant_id, workspace_owner_id, name, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Cliente Eco', ?, ?, ?, ?)`,
    ).bind(clienteId, operacoes.id, operacoes.id, operacoes.id, agora, agora).run();
    for (const [dist, entregue] of [[300, agora], [200, null]]) {
      await env.DB.prepare(
        `INSERT INTO todogreen_client_operations
           (id, tenant_id, client_id, workspace_owner_id, vehicle_plate, distance_km, delivered_at, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'todogreen', ?, ?, 'ECO1A11', ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), clienteId, operacoes.id, dist, entregue, operacoes.id, operacoes.id, agora, agora).run();
    }

    const res = await pedir("/api/todogreen/fleet/economics", { token: operacoes.token });
    expect(res.status).toBe(200);
    const { economics } = await res.json();
    const eco = economics.find((e) => e.vehicleId === veiculoId);
    expect(eco.manutencao.total).toBe(200);
    expect(eco.operacoes.kmTotal).toBe(500);
    expect(eco.operacoes.operacoes).toBe(2);
    expect(eco.operacoes.entregues).toBe(1);
    expect(eco.operacoes.ativas).toBe(1); // a operação sem delivered_at está em curso
    // 200 / 500 = 0,40 por km
    expect(eco.manutencaoPorKm).toBe(0.4);
    // Com OS aberta o veículo está available: sugere manutenção (a OS foi fechada
    // acima? não — esta é uma OS nova, aberta). Como a OS de manutenção deste
    // veículo foi criada e concluída, não há OS aberta; então a operação em curso
    // sugere "in-operation".
    expect(eco.statusSugerido.status).toBe("in-operation");
  });

  it("economics é leitura: o auditor (só read) enxerga", async () => {
    const res = await pedir("/api/todogreen/fleet/economics", { token: auditor.token });
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).economics)).toBe(true);
  });
});

describe("importar frota em massa (bloco 01)", () => {
  let dono;
  beforeAll(async () => {
    dono = await criarUsuario("frota-imp", "imp@frota.test");
    await vincular(dono, "operacoes", ["read", "fleet:manage"], dono.id);
  });

  it("cria os válidos, ignora inválido e placa repetida no mesmo lote", async () => {
    const r = await pedir("/api/todogreen/fleet/importar", {
      metodo: "POST", token: dono.token,
      corpo: {
        veiculos: [
          { prefix: "IMP-1", plate: "GHI4J56", vehicleClass: "van", energyType: "electric", nominalRangeKm: 200 },
          { prefix: "IMP-2", plate: "KLM7N89", vehicleClass: "vuc", energyType: "electric", payloadKg: 3000 },
          { prefix: "IMP-3", plate: "OPQ1R23", vehicleClass: "foguete" },
          { prefix: "IMP-4", plate: "GHI4J56", vehicleClass: "van" },
        ],
      },
    });
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.criados).toBe(2);
    expect(d.total).toBe(4);
    expect(d.ignorados).toHaveLength(2);
    expect(d.ignorados.find((i) => /R23/.test(i.placa)).motivo).toMatch(/classe/i);
    expect(d.ignorados.find((i) => /repetida/i.test(i.motivo))).toBeTruthy();

    const lista = await (await pedir("/api/todogreen/fleet", { token: dono.token })).json();
    const placas = lista.vehicles.map((v) => v.plate);
    expect(placas).toContain("GHI4J56");
    expect(placas).toContain("KLM7N89");
    // O que entrou é elétrico e classificado.
    const van = lista.vehicles.find((v) => v.plate === "GHI4J56");
    expect(van.energyType).toBe("electric");
    expect(van.vehicleClass).toBe("van");
  });

  it("reimportar uma placa já cadastrada não duplica", async () => {
    const r = await pedir("/api/todogreen/fleet/importar", {
      metodo: "POST", token: dono.token,
      corpo: { veiculos: [{ prefix: "IMP-1b", plate: "ghi4j56", vehicleClass: "van", energyType: "electric" }] },
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.criados).toBe(0);
    expect(d.ignorados[0].motivo).toMatch(/já cadastrada/i);
  });

  it("auditor (só leitura) não importa: 403", async () => {
    const r = await pedir("/api/todogreen/fleet/importar", {
      metodo: "POST", token: auditor.token,
      corpo: { veiculos: [{ prefix: "X", plate: "STU4V56", vehicleClass: "van" }] },
    });
    expect(r.status).toBe(403);
  });

  it("lote vazio é recusado com 400", async () => {
    const r = await pedir("/api/todogreen/fleet/importar", {
      metodo: "POST", token: dono.token, corpo: { veiculos: [] },
    });
    expect(r.status).toBe(400);
  });
});
