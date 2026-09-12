import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handlePublicTodoGreenRoutingApi,
  optimizeTodoGreenRouting,
} from "../worker/services/todogreen-public-routing-api.js";

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedKey(suffix, scopes) {
  const ownerId = `routing-owner-${suffix}`;
  const token = `tdg_live_${suffix}_0123456789abcdef0123456789`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id,name,email,password_hash,password_salt,created_at)
     VALUES (?,?,?,'hash','salt',?)`,
  ).bind(ownerId, `Routing ${suffix}`, `${suffix}@routing.test`, now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_tms_api_keys
      (id,tenant_id,workspace_owner_id,client_id,name,key_hash,key_prefix,scopes_json,
       rate_limit_per_minute,created_by,created_at)
     VALUES (?,'todogreen',?,'',?,?,?,?,120,?,?)`,
  ).bind(
    `routing-key-${suffix}`,
    ownerId,
    `Routing ${suffix}`,
    await hash(token),
    token.slice(0, 17),
    JSON.stringify(scopes),
    ownerId,
    now,
  ).run();
  return token;
}

function request(token, body) {
  return new Request("https://tms.test/api/tms/v1/routes/optimize", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("To Do Green routing API", () => {
  it("exige o escopo routing:write", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const token = await seedKey(suffix, ["shipments:read"]);
    const response = await handlePublicTodoGreenRoutingApi(
      request(token, { vehicles: [{ id: 1 }], jobs: [{ id: 1 }] }),
      { DB: env.DB, TDG_ROUTING_URL: "https://routing.test/" },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden");
  });

  it("retorna 503 quando o motor gratuito ainda não foi conectado", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const token = await seedKey(suffix, ["routing:write"]);
    const response = await handlePublicTodoGreenRoutingApi(
      request(token, { vehicles: [{ id: 1 }], jobs: [{ id: 1 }] }),
      { DB: env.DB },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("routing_not_configured");
  });

  it("reaproveita o mesmo VROOM na rota interna sem exigir chave TMS", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      summary: { cost: 4321, routes: 1, unassigned: 0 },
      routes: [{ vehicle: 1, cost: 4321, steps: [{ type: "start" }, { type: "job", job: 1 }, { type: "end" }] }],
      unassigned: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await optimizeTodoGreenRouting({
      vehicles: [{ id: 1, start: [-46.8, -23.5], end: [-46.3, -23.9] }],
      jobs: [{ id: 1, location: [-46.63, -23.55] }],
      geometry: true,
    }, {
      TDG_ROUTING_URL: "https://routing.test/optimize",
      TDG_ROUTING_TOKEN: "segredo-interno",
    });

    expect(response.status).toBe(200);
    expect((await response.json()).engine).toBe("vroom");
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe("https://routing.test/optimize");
    expect(options.headers.authorization).toBe("Bearer segredo-interno");
    expect(JSON.parse(options.body).options).toEqual({ g: true });
  });

  it("encaminha o problema ao VROOM auto-hospedado e preserva o resultado", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const token = await seedKey(suffix, ["routing:write"]);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      summary: { cost: 1234, routes: 1, unassigned: 0 },
      routes: [{ vehicle: 1, cost: 1234, steps: [{ type: "start" }, { type: "job", job: 101 }, { type: "end" }] }],
      unassigned: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const payload = {
      vehicles: [{ id: 1, start: [-46.8764, -23.5035], capacity: [20] }],
      jobs: [{ id: 101, location: [-46.6333, -23.5505], delivery: [5] }],
      geometry: true,
    };
    const response = await handlePublicTodoGreenRoutingApi(
      request(token, payload),
      { DB: env.DB, TDG_ROUTING_URL: "https://routing.test/" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tdg-routing-engine")).toBe("vroom");
    expect(body.engine).toBe("vroom");
    expect(body.provider).toBe("self_hosted");
    expect(body.routes).toHaveLength(1);
    expect(upstream).toHaveBeenCalledTimes(1);

    const [, options] = upstream.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      vehicles: payload.vehicles,
      jobs: payload.jobs,
      shipments: [],
      options: { g: true },
    });
  });

  it("planeja rota elétrica e anexa a estimativa de energia estruturada e versionada", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const token = await seedKey(suffix, ["routing:write"]);
    const request = new Request("https://tms.test/api/tms/v1/routes/electric-plan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        vehicle: {
          id: "VAN-082",
          category: "van",
          consumptionKwhPerKm: 0.42,
          batteryCapacityKwh: 100,
          socPercent: 80,
          reservePercent: 15,
          connectors: ["CCS2"],
          maxDcKw: 100,
        },
        route: { distanceKm: 120, elevationGainM: 300, elevationLossM: 300, temperatureC: 18 },
        chargingStations: [],
      }),
    });
    const response = await handlePublicTodoGreenRoutingApi(request, { DB: env.DB });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.engine).toBe("tdg-electric-routing-v1");
    expect(body.plan).toBeTruthy();
    // A estimativa estruturada acompanha o plano, sem substituí-lo.
    expect(body.energyEstimate.status).toBe("ok");
    expect(body.energyEstimate.calculationVersion).toBe("energy-model@1.0.0");
    expect(body.energyEstimate.measurementType).toBe("ESTIMATED");
    expect(typeof body.energyEstimate.estimatedArrivalSoc).toBe("number");
    expect(typeof body.energyEstimate.chargingRequired).toBe("boolean");
    // van sem restrição declarada -> OSRM é o motor preferido.
    expect(body.routingEngineSelection.engine).toBe("osrm");
    expect(body.routingEngineSelection.vehicleClass).toBe("van");
  });

  it("seleciona Valhalla (truck) para veículo pesado no electric-plan", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const token = await seedKey(suffix, ["routing:write"]);
    const request = new Request("https://tms.test/api/tms/v1/routes/electric-plan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        vehicle: {
          category: "carreta",
          consumptionKwhPerKm: 1.3,
          batteryCapacityKwh: 540,
          socPercent: 90,
          reservePercent: 15,
          connectors: ["CCS2"],
          maxDcKw: 350,
        },
        route: { distanceKm: 200 },
        chargingStations: [],
      }),
    });
    const response = await handlePublicTodoGreenRoutingApi(request, { DB: env.DB });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.routingEngineSelection.engine).toBe("valhalla");
    expect(body.routingEngineSelection.profile).toBe("truck");
    expect(body.routingEngineSelection.restrictionAware).toBe(true);
  });
});
