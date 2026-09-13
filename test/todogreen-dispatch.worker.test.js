import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { handleTodoGreenDispatch, paradasDaTour, maxTimeDoSolver, MAX_SEGUNDOS_SOLVER_CONTINGENCIA, fatorDeDesvio, DETOUR_FACTOR_PADRAO } from "../worker/services/todogreen-dispatch.js";
import { handleTodoGreenDriverPortal } from "../worker/services/todogreen-driver-portal.js";
import { aplicarEventoOperacional } from "../worker/services/todogreen-vertical-records.js";

const ownerId = "dispatch-owner";
const user = { id: ownerId, name: "Gestora do Despacho", email: "despacho@teste.local" };
const access = { ownerId, role: "admin", permissions: ["*"] };
const planId = "00000000-0000-4000-8000-000000000106";

const aplicar = (body) => handleTodoGreenDispatch(new Request("https://app.test/api/todogreen/dispatch/aplicar", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}), env, access, user);

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(ownerId, user.name, user.email, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('dispatch-client','todogreen',?,'Cliente Despacho','ativo',0,'{}',1,?,?,?,?)`,
  ).bind(ownerId, ownerId, ownerId, agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_drivers
       (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,
        availability_status,status,user_email,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('dispatch-driver','todogreen',?,'DRV-D','João Despacho','123','employee',
        'available','active',?,'{}',1,?,?,?,?)`,
  ).bind(ownerId, user.email, ownerId, ownerId, agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_fleet_vehicles
       (id,tenant_id,workspace_owner_id,prefix,plate,status,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('dispatch-vehicle','todogreen',?,'V-01','ABC1D23','available','{}',1,?,?,?,?)`,
  ).bind(ownerId, ownerId, ownerId, agora, agora).run();
  for (const [id, referencia, origem, destino, pickupLat, pickupLng, deliveryLat, deliveryLng] of [
    ["dispatch-op-1", "OS-101", "CD Osasco", "Loja Centro", -23.52, -46.78, -23.55, -46.63],
    ["dispatch-op-2", "OS-102", "CD Osasco", "Loja Norte", null, null, -23.47, -46.62],
  ]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          pickup_lat,pickup_lng,delivery_lat,delivery_lng,driver_id,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','dispatch-client',?,?,'active','2026-09-11',?,?,?,?,?,?, '',
          '{"packages":2}',?,?,?,?)`,
    ).bind(id, ownerId, referencia, origem, destino, pickupLat, pickupLng, deliveryLat, deliveryLng,
      ownerId, ownerId, agora, agora).run();
  }
});

describe("despacho como cadeia transacional", () => {
  let routeId;

  it("preserva na prévia a ordem de coleta e entrega calculada pelo solver", () => {
    const paradas = paradasDaTour({ stops: [
      { activities: [{ jobId: "op-a", type: "pickup" }] },
      { activities: [{ jobId: "op-b", type: "delivery" }] },
      { activities: [{ jobId: "op-a", type: "delivery" }] },
    ] }, [
      { id: "op-a", reference: "A", origin: "CD", destination: "Loja A", pickup_lat: -1, pickup_lng: -2, delivery_lat: -3, delivery_lng: -4 },
      { id: "op-b", reference: "B", destination: "Loja B", delivery_lat: -5, delivery_lng: -6 },
    ]);
    expect(paradas.map((p) => `${p.operationId}:${p.tipo}`)).toEqual(["op-a:coleta", "op-b:entrega", "op-a:entrega"]);
    expect(paradas.map((p) => p.ordem)).toEqual([1, 2, 3]);
  });

  it("cria a rota, liga as operações e ocupa os recursos em um único plano", async () => {
    const response = await aplicar({
      planId,
      tours: [{
        veiculoId: "dispatch-vehicle",
        motoristaId: "dispatch-driver",
        operacoes: ["dispatch-op-1", "dispatch-op-2"],
        distanciaKm: 31.4,
        duracaoMin: 87,
        paradas: [
          { operationId: "dispatch-op-1", tipo: "coleta" },
          { operationId: "dispatch-op-1", tipo: "entrega" },
          { operationId: "dispatch-op-2", tipo: "entrega" },
        ],
      }],
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ aplicados: 2, rotasCriadas: 1 });
    routeId = result.rotas[0];

    const rota = await env.DB.prepare("SELECT * FROM todogreen_routes WHERE id = ?").bind(routeId).first();
    expect(rota.workspace_owner_id).toBe(ownerId);
    expect(rota.driver_id).toBe("dispatch-driver");
    expect(rota.vehicle_plate).toBe("ABC1D23");
    expect(JSON.parse(rota.stops_json).map((p) => `${p.operationId}:${p.tipo}`)).toEqual([
      "dispatch-op-1:coleta", "dispatch-op-1:entrega", "dispatch-op-2:entrega",
    ]);

    const operacoes = await env.DB.prepare(
      "SELECT id,route_id,route_stop_order,driver_id,vehicle_plate FROM todogreen_client_operations WHERE id LIKE 'dispatch-op-%' ORDER BY id",
    ).all();
    expect(operacoes.results.map((op) => op.route_id)).toEqual([routeId, routeId]);
    expect(operacoes.results.map((op) => op.route_stop_order)).toEqual([1, 3]);
    expect(operacoes.results.every((op) => op.driver_id === "dispatch-driver" && op.vehicle_plate === "ABC1D23")).toBe(true);
    expect((await env.DB.prepare("SELECT availability_status FROM todogreen_drivers WHERE id='dispatch-driver'").first()).availability_status).toBe("allocated");
    expect((await env.DB.prepare("SELECT status FROM todogreen_fleet_vehicles WHERE id='dispatch-vehicle'").first()).status).toBe("in-operation");
  });

  it("reaplicar o mesmo plano é idempotente", async () => {
    const response = await aplicar({
      planId,
      tours: [{
        veiculoId: "dispatch-vehicle", motoristaId: "dispatch-driver",
        operacoes: ["dispatch-op-1", "dispatch-op-2"],
      }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reaplicado: true, rotasCriadas: 0, aplicados: 2 });
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM todogreen_routes WHERE id = ?").bind(routeId).first();
    expect(total.n).toBe(1);
  });

  it("não deixa o checkbox da rota burlar o evento operacional", async () => {
    const response = await handleTodoGreenDriverPortal(new Request(
      `https://app.test/api/todogreen/driver-portal/rotas/${routeId}/parada`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ indice: 0, concluida: true }) },
    ), env, access, user);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/pela viagem/i);
  });

  it("eventos canônicos avançam a rota e liberam motorista + veículo no final", async () => {
    const op1 = await env.DB.prepare("SELECT * FROM todogreen_client_operations WHERE id='dispatch-op-1'").first();
    await aplicarEventoOperacional(env, {
      ownerId, operacao: op1, userId: ownerId,
      corpo: { tipo: "entrega", titulo: "Primeira entrega", recebedor: "Loja 1", idempotencyKey: "dispatch-event-1" },
    });
    let rota = await env.DB.prepare("SELECT status,stops_json FROM todogreen_routes WHERE id = ?").bind(routeId).first();
    expect(rota.status).toBe("em_rota");
    expect(JSON.parse(rota.stops_json).map((p) => p.concluida)).toEqual([true, true, false]);

    const op2 = await env.DB.prepare("SELECT * FROM todogreen_client_operations WHERE id='dispatch-op-2'").first();
    await aplicarEventoOperacional(env, {
      ownerId, operacao: op2, userId: ownerId,
      corpo: { tipo: "entrega", titulo: "Segunda entrega", recebedor: "Loja 2", idempotencyKey: "dispatch-event-2" },
    });
    rota = await env.DB.prepare("SELECT status,stops_json FROM todogreen_routes WHERE id = ?").bind(routeId).first();
    expect(rota.status).toBe("concluida");
    expect(JSON.parse(rota.stops_json).every((p) => p.concluida)).toBe(true);
    expect((await env.DB.prepare("SELECT availability_status FROM todogreen_drivers WHERE id='dispatch-driver'").first()).availability_status).toBe("available");
    expect((await env.DB.prepare("SELECT status FROM todogreen_fleet_vehicles WHERE id='dispatch-vehicle'").first()).status).toBe("available");
  });
});

describe("tempo do solver de contingência (maxTimeDoSolver)", () => {
  it("escala pelo tamanho do problema e nunca passa do teto", () => {
    expect(maxTimeDoSolver(3)).toBe(2); // piso: problema minúsculo
    expect(maxTimeDoSolver(40)).toBe(5); // ~1s por 8 jobs
    expect(maxTimeDoSolver(200)).toBe(MAX_SEGUNDOS_SOLVER_CONTINGENCIA); // teto (10s)
    expect(MAX_SEGUNDOS_SOLVER_CONTINGENCIA).toBe(10);
  });

  it("respeita um pedido explícito só dentro do teto", () => {
    expect(maxTimeDoSolver(3, 7)).toBe(7);
    expect(maxTimeDoSolver(3, 99)).toBe(10); // clampa ao teto — CPU do Worker é limitada
    expect(maxTimeDoSolver(3, 0)).toBe(2); // 0/inválido volta a escalar por tamanho
  });
});

describe("fator de desvio da contingência (fatorDeDesvio)", () => {
  it("usa 1,3 por padrão quando não há env válida", () => {
    expect(DETOUR_FACTOR_PADRAO).toBe(1.3);
    expect(fatorDeDesvio(undefined)).toBe(1.3);
    expect(fatorDeDesvio({})).toBe(1.3);
    expect(fatorDeDesvio({ TODOGREEN_DISPATCH_DETOUR_FACTOR: "abc" })).toBe(1.3);
  });

  it("respeita a env, travada entre 1 e 2 (nunca encurtar a distância nem exagerar)", () => {
    expect(fatorDeDesvio({ TODOGREEN_DISPATCH_DETOUR_FACTOR: "1.5" })).toBe(1.5);
    expect(fatorDeDesvio({ TODOGREEN_DISPATCH_DETOUR_FACTOR: "0.5" })).toBe(1); // piso
    expect(fatorDeDesvio({ TODOGREEN_DISPATCH_DETOUR_FACTOR: "9" })).toBe(2); // teto
  });
});
