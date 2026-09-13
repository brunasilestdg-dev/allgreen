import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { probeValhalla, rotearComProvider } from "../worker/services/routing-providers.js";
import { todoGreenExternalIntegrationCatalog } from "../worker/services/todogreen-integration-gateway.js";

// Seções 28–35: o backend escolhe o motor por veículo. Pesado sem Valhalla
// devolve NO_SAFE_ROUTING_ENGINE (409) — nunca uma rota de carro. Com Valhalla,
// roteia por truck costing e devolve o MESMO formato que a tela já lê.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createUser(id, email, role, permissions) {
  const token = `rp-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)").bind(id, id, email, now).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)").bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(`INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at) VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`)
    .bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token };
}

const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} },
);

const COORDS = [[-46.6333, -23.5505], [-46.65, -23.56]];
const TRUCK = { category: "truck", heightM: 4.2, grossWeightKg: 23000, axles: 3 };

// polyline6 de (-23.5505,-46.6333) → (-23.56,-46.65)
const enc = (v) => { let s = ""; let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } return s + String.fromCharCode(n + 63); };
const SHAPE6 = enc(-23550500) + enc(-46633300) + enc(-9500) + enc(-16700);

let operador;
beforeAll(async () => {
  operador = await createUser("rp-op", "rp-op@example.com", "operacoes", ["read", "operations:manage", "tms:manage"]);
});

describe("catálogo e probe do Valhalla", () => {
  it("o gateway lista o Valhalla como self-hosted a configurar", () => {
    const item = todoGreenExternalIntegrationCatalog({}).routing.find((i) => i.id === "valhalla");
    expect(item).toMatchObject({ configured: false, status: "requires_setup", mode: "self-hosted" });
    expect(item.requirement).toBe("TDG_VALHALLA_BASE_URL");
    expect(todoGreenExternalIntegrationCatalog({ TDG_VALHALLA_BASE_URL: "https://v.example.com" }).routing.find((i) => i.id === "valhalla").configured).toBe(true);
  });

  it("probe sem URL é pulado com honestidade; com URL lê /status", async () => {
    expect(await probeValhalla({})).toMatchObject({ ok: false, configured: false, skipped: true });
    const fetcher = async (url) => {
      expect(String(url)).toBe("https://v.example.com/status");
      return new Response(JSON.stringify({ version: "3.5.1", has_elevation: true }), { status: 200, headers: { "content-type": "application/json" } });
    };
    expect(await probeValhalla({ TDG_VALHALLA_BASE_URL: "https://v.example.com" }, { fetcher })).toMatchObject({ ok: true, version: "3.5.1", hasElevation: true });
  });
});

describe("rotearComProvider — o contrato único do backend", () => {
  it("pesado sem Valhalla → 409 NO_SAFE_ROUTING_ENGINE, sem chamar motor nenhum", async () => {
    let chamadas = 0;
    const r = await rotearComProvider({ coordinates: COORDS, vehicle: TRUCK }, {}, { fetcher: async () => { chamadas += 1; throw new Error("não deveria chamar"); } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "NO_SAFE_ROUTING_ENGINE", requiredEngine: "valhalla", requiredEnv: "TDG_VALHALLA_BASE_URL", availableEngines: ["osrm"] });
    expect(chamadas).toBe(0);
  });

  it("pesado com Valhalla → POST /route com truck costing e resposta no formato da tela", async () => {
    const vistos = [];
    const fetcher = async (url, options) => {
      vistos.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.authorization });
      return new Response(JSON.stringify({ trip: { summary: { length: 3.4, time: 540 }, legs: [{ summary: { length: 3.4, time: 540 }, shape: SHAPE6 }] } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await rotearComProvider({ coordinates: COORDS, vehicle: TRUCK }, { TDG_VALHALLA_BASE_URL: "https://v.example.com/", TDG_ROUTING_TOKEN: "segredo" }, { fetcher });
    expect(r.status).toBe(200);
    expect(vistos[0].url).toBe("https://v.example.com/route");
    expect(vistos[0].auth).toBe("Bearer segredo");
    expect(vistos[0].body.costing).toBe("truck");
    expect(vistos[0].body.costing_options.truck).toMatchObject({ height: 4.2, weight: 23, axle_count: 3 });
    expect(r.body.routes[0]).toMatchObject({ distance: 3400, duration: 540 });
    expect(r.body.routes[0].geometry.coordinates).toHaveLength(2);
    expect(r.body).toMatchObject({ engine: "valhalla", profile: "truck", restrictionAware: true, fallback: false, selfHosted: true });
    expect(r.body.costing.assumptions).toEqual(expect.arrayContaining(["largura_nao_informada_padrao_valhalla"]));
  });

  it("Valhalla configurado mas fora do ar: pesado NÃO cai em OSRM — falha explícita", async () => {
    let urls = [];
    const fetcher = async (url) => { urls.push(String(url)); return new Response("erro", { status: 503 }); };
    const r = await rotearComProvider({ coordinates: COORDS, vehicle: TRUCK }, { TDG_VALHALLA_BASE_URL: "https://v.example.com" }, { fetcher });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("ROUTING_UNAVAILABLE");
    expect(r.body.engine).toBe("valhalla");
    expect(urls.every((u) => u.startsWith("https://v.example.com/"))).toBe(true);
  });

  it("leve sem servidor próprio usa o OSRM público como contingência DECLARADA", async () => {
    const fetcher = async (url) => {
      expect(String(url)).toContain("router.project-osrm.org/route/v1/driving/");
      return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 2500, duration: 300, geometry: { type: "LineString", coordinates: COORDS }, legs: [] }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await rotearComProvider({ coordinates: COORDS, vehicle: { category: "van" } }, {}, { fetcher });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ engine: "osrm", publicFallback: true, selfHosted: false, fallback: false });
    expect(r.body.routes[0].distance).toBe(2500);
  });

  it("coordenadas inválidas são recusadas antes de escolher motor", async () => {
    const r = await rotearComProvider({ coordinates: [[1, 2]], vehicle: {} }, {});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_COORDINATES");
  });
});

describe("POST /api/todogreen/maps/route (o que a tela chama)", () => {
  it("exige sessão e, para pesado sem Valhalla, responde 409 NO_SAFE_ROUTING_ENGINE em vez de rota de carro", async () => {
    expect((await call("/api/todogreen/maps/route", { method: "POST", body: { coordinates: COORDS } })).status).toBe(401);
    const r = await call("/api/todogreen/maps/route", { method: "POST", token: operador.token, body: { coordinates: COORDS, vehicle: TRUCK } });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("NO_SAFE_ROUTING_ENGINE");
    expect(body.message).toContain("TDG_VALHALLA_BASE_URL");
  });
});
