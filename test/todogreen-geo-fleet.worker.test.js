import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { climaNaRota, elevacaoDaRota, enriquecerRotaComGeo } from "../worker/services/geo-providers.js";

// P3-B/C: elevação e clima honestos (com cache) e o perfil físico/energético
// do veículo + observações que formam o baseline do digital twin.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function createUser(id, email, role, permissions) {
  const token = `geo-${id}`;
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

const GEO = [[-46.63, -23.55], [-46.64, -23.555], [-46.65, -23.56]];
const jsonResp = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

describe("ElevationProvider (Valhalla /height) com cache", () => {
  it("sem Valhalla é ELEVATION_NOT_AVAILABLE — nunca perfil inventado", async () => {
    const r = await elevacaoDaRota(env, GEO);
    expect(r).toMatchObject({ ok: false, reason: "ELEVATION_NOT_AVAILABLE" });
    expect(r.detail).toContain("TDG_VALHALLA_BASE_URL");
  });

  it("com Geoapify calcula ganho/perda online e cacheia por 30 dias", async () => {
    let chamadas = 0;
    const fetcher = async (url, options) => {
      chamadas += 1;
      expect(String(url)).toContain("api.geoapify.com/v1/geodata/elevation");
      const body = JSON.parse(options.body);
      expect(body.locations).toHaveLength(3);
      expect(body.locations[0]).toEqual([-46.63, -23.55]);
      return jsonResp({ results: [
        { location: { lon: -46.63, lat: -23.55 }, elevation: 700, units: "m" },
        { location: { lon: -46.64, lat: -23.555 }, elevation: 760, units: "m" },
        { location: { lon: -46.65, lat: -23.56 }, elevation: 720, units: "m" },
      ] });
    };
    const cfg = { ...env, GEOAPIFY_API_KEY: "geo-test-key" };
    const primeira = await elevacaoDaRota(cfg, GEO, { fetcher });
    expect(primeira).toMatchObject({ ok: true, elevationGainM: 60, elevationLossM: 40, source: "geoapify-elevation", cached: false, measurementType: "DERIVED" });
    const segunda = await elevacaoDaRota(cfg, GEO, { fetcher });
    expect(segunda).toMatchObject({ ok: true, elevationGainM: 60, cached: true });
    expect(chamadas).toBe(1);
  });

  it("com Valhalla calcula ganho/perda e a segunda chamada vem do cache", async () => {
    let chamadas = 0;
    const fetcher = async (url, options) => {
      chamadas += 1;
      expect(String(url)).toBe("https://v.test/height");
      expect(JSON.parse(options.body).shape).toHaveLength(3);
      return jsonResp({ height: [700, 760, 720] });
    };
    const cfg = { ...env, TDG_VALHALLA_BASE_URL: "https://v.test" };
    const primeira = await elevacaoDaRota(cfg, GEO, { fetcher });
    expect(primeira).toMatchObject({ ok: true, elevationGainM: 60, elevationLossM: 40, source: "valhalla-height", cached: false, measurementType: "DERIVED" });
    const segunda = await elevacaoDaRota(cfg, GEO, { fetcher });
    expect(segunda).toMatchObject({ ok: true, elevationGainM: 60, cached: true });
    expect(chamadas).toBe(1);
  });
});

describe("WeatherProvider (MET Norway) com cache", () => {
  it("lê a temperatura da hora de saída e cacheia por hora", async () => {
    let chamadas = 0;
    const fetcher = async (url, init) => {
      chamadas += 1;
      // Open-Meteo gratuito é só para uso não comercial; a MET permite uso
      // comercial, mas recusa quem não se identifica e coordenada com 5+ casas.
      expect(String(url)).toContain("api.met.no/weatherapi/locationforecast/2.0/compact");
      expect(init?.headers?.["user-agent"]).toMatch(/AllGreen/);
      const { searchParams } = new URL(String(url));
      expect(searchParams.get("lat")).toMatch(/^-?\d+(\.\d{1,4})?$/);
      expect(searchParams.get("lon")).toMatch(/^-?\d+(\.\d{1,4})?$/);
      // Horário da MET é UTC: 09:00Z = 06:00 em Brasília.
      return jsonResp({
        properties: {
          meta: { updated_at: "2026-09-13T08:30:00Z" },
          timeseries: [
            { time: "2026-09-13T09:00:00Z", data: { instant: { details: { air_temperature: 13.5 } } } },
            { time: "2026-09-13T10:00:00Z", data: { instant: { details: { air_temperature: 15 } } } },
          ],
        },
      });
    };
    const a = await climaNaRota(env, { geometry: GEO, departureIso: "2026-09-13T06:10:00" }, { fetcher });
    expect(a).toMatchObject({
      ok: true,
      temperatureC: 13.5,
      source: "met-norway",
      attribution: "Dados de clima: MET Norway (CC BY 4.0)",
      measurementType: "EXTERNAL",
      cached: false,
      sourceUpdatedAt: "2026-09-13T08:30:00Z",
    });
    const b = await climaNaRota(env, { geometry: GEO, departureIso: "2026-09-13T06:40:00" }, { fetcher });
    expect(b).toMatchObject({ ok: true, cached: true });
    expect(chamadas).toBe(1);
  });

  it("fonte fora do ar é WEATHER_NOT_AVAILABLE, não temperatura inventada", async () => {
    const r = await climaNaRota(env, { latitude: -10.1234, longitude: -50.4321, departureIso: "2026-09-14T06:00:00" }, { fetcher: async () => new Response("erro", { status: 500 }) });
    expect(r).toMatchObject({ ok: false, reason: "WEATHER_NOT_AVAILABLE" });
  });
});

describe("enriquecimento da rota para o modelo de energia", () => {
  it("o informado vence (INFORMED); o que falta é buscado; o indisponível vira aviso", async () => {
    const r = await enriquecerRotaComGeo(env, { distanceKm: 120, elevationGainM: 300 }, { geometry: GEO, departureIso: "2026-09-14T06:00:00", fetcher: async () => new Response("erro", { status: 500 }) });
    expect(r.route.elevationGainM).toBe(300);
    expect(r.route.temperatureC).toBeUndefined();
    expect(r.provenance.find((p) => p.id === "elevation")).toMatchObject({ measurementType: "INFORMED" });
    expect(r.warnings.map((w) => w.code)).toEqual(["WEATHER_NOT_AVAILABLE"]);
  });
});

describe("perfil físico/energético e observações de energia do veículo", () => {
  let op;
  let veiculo;
  beforeAll(async () => {
    op = await createUser("geo-op", "geo-op@example.com", "operacoes", ["read", "fleet:manage", "operations:manage"]);
    const r = await call("/api/todogreen/fleet", { method: "POST", token: op.token, body: { prefix: "TG-900", plate: "GEO9A00", category: "truck", vehicleClass: "truck", energyType: "electric", batteryCapacityKwh: 300, energyConsumptionKwhPerKm: 1.1, heightM: 4.1, widthM: 2.6, lengthM: 12, tareKg: 9000, grossWeightKg: 23000, axles: 3, connectorType: "CCS2", maxChargingPowerKw: 150 } });
    expect(r.status).toBe(201);
    veiculo = (await r.json()).vehicle;
  });

  it("o perfil físico é gravado na criação e devolvido no mapeamento", () => {
    expect(veiculo).toMatchObject({ heightM: 4.1, widthM: 2.6, lengthM: 12, tareKg: 9000, grossWeightKg: 23000, axles: 3, connectorType: "CCS2", maxChargingPowerKw: 150 });
  });

  it("PATCH atualiza o perfil junto do cadastro", async () => {
    const r = await call(`/api/todogreen/fleet/${veiculo.id}`, { method: "PATCH", token: op.token, body: { revision: veiculo.revision, heightM: 4.3, referenceConsumptionKwhKm: 1.05 } });
    expect(r.status).toBe(200);
    const v = (await r.json()).vehicle;
    expect(v.heightM).toBe(4.3);
    expect(v.referenceConsumptionKwhKm).toBe(1.05);
    veiculo = v;
  });

  it("observações de energia formam o baseline (insuficiente → ok), nunca com zero", async () => {
    const semDados = await call(`/api/todogreen/fleet/${veiculo.id}/energy-observations`, { token: op.token });
    expect(semDados.status).toBe(200);
    expect((await semDados.json()).baseline.status).toBe("insufficient");

    const invalida = await call(`/api/todogreen/fleet/${veiculo.id}/energy-observations`, { method: "POST", token: op.token, body: { distanceKm: 0, energyKwh: 30 } });
    expect(invalida.status).toBe(400);

    for (const [kwh, km, tipo] of [[110, 100, "MEASURED"], [120, 100, "MEASURED"], [115, 100, "INFORMED"], [125, 100, "MEASURED"]]) {
      const r = await call(`/api/todogreen/fleet/${veiculo.id}/energy-observations`, { method: "POST", token: op.token, body: { distanceKm: km, energyKwh: kwh, measurementType: tipo, observedAt: "2026-09-10T08:00:00.000Z", payloadKg: 8000, temperatureC: 24 } });
      expect(r.status).toBe(201);
    }
    const lista = await (await call(`/api/todogreen/fleet/${veiculo.id}/energy-observations`, { token: op.token })).json();
    expect(lista.observations).toHaveLength(4);
    expect(lista.baseline).toMatchObject({ status: "ok", samples: 4, measurementType: "MEASURED" });
    expect(lista.baseline.p50KwhPerKm).toBeCloseTo(1.175, 3);
    expect(lista.baseline.correctionFactor).toBeCloseTo(1.068, 2);
  });

  it("outro espaço não vê as observações", async () => {
    const outro = await createUser("geo-outro", "geo-outro@example.com", "operacoes", ["read", "fleet:manage"]);
    expect((await call(`/api/todogreen/fleet/${veiculo.id}/energy-observations`, { token: outro.token })).status).toBe(404);
  });
});
