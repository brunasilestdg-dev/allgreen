import { describe, expect, it } from "vitest";
import {
  ROUTING_ERRORS,
  costingValhalla,
  descreverMotor,
  motoresDisponiveis,
  normalizarRespostaOsrm,
  normalizarRespostaValhalla,
  requisicaoValhalla,
  respostaCompativelOsrm,
  selecaoSegura,
} from "./routingProvidersDomain.js";

const TRUCK = { category: "truck", heightM: 4.2, widthM: 2.6, lengthM: 14, grossWeightKg: 23000, axles: 3 };

describe("motores disponíveis a partir do ambiente", () => {
  it("sem nada configurado: só OSRM, pelo endpoint público (contingência declarada)", () => {
    const m = motoresDisponiveis({});
    expect(m.available).toEqual(["osrm"]);
    expect(m.osrm).toMatchObject({ configured: false, publicFallback: true });
    expect(m.valhalla.configured).toBe(false);
  });

  it("aceita os dois prefixos de variável (TODOGREEN_* e TDG_*) e recusa URL inválida", () => {
    expect(motoresDisponiveis({ TDG_OSRM_BASE_URL: "https://rotas.example.com" }).osrm).toMatchObject({ configured: true, envKey: "TDG_OSRM_BASE_URL" });
    expect(motoresDisponiveis({ TODOGREEN_VALHALLA_BASE_URL: "https://valhalla.example.com/api" }).valhalla.base).toBe("https://valhalla.example.com/api/");
    expect(motoresDisponiveis({ TDG_VALHALLA_BASE_URL: "file:///etc/passwd" }).valhalla.configured).toBe(false);
    expect(motoresDisponiveis({ TDG_VALHALLA_BASE_URL: "https://v.example.com" }).available).toEqual(["osrm", "valhalla"]);
  });
});

describe("seleção segura do motor (seção 33)", () => {
  it("carro e van sem restrição vão para OSRM mesmo sem Valhalla", () => {
    expect(selecaoSegura({ category: "carro" }, {}).engine).toBe("osrm");
    expect(selecaoSegura({ category: "van" }, {}).engine).toBe("osrm");
  });

  it("pesado sem Valhalla NUNCA cai em OSRM: NO_SAFE_ROUTING_ENGINE nomeando o que falta", () => {
    const s = selecaoSegura(TRUCK, {});
    expect(s.engine).toBeNull();
    expect(s.error).toMatchObject({ code: ROUTING_ERRORS.NO_SAFE_ROUTING_ENGINE, requiredEngine: "valhalla", requiredEnv: "TDG_VALHALLA_BASE_URL", restrictionAware: true });
    expect(s.error.message).toContain("Valhalla");
  });

  it("van com restrição física também exige Valhalla", () => {
    expect(selecaoSegura({ category: "van", heightM: 3.9 }, {}).error?.code).toBe(ROUTING_ERRORS.NO_SAFE_ROUTING_ENGINE);
  });

  it("com Valhalla configurado o pesado roteia por truck costing", () => {
    const s = selecaoSegura(TRUCK, { TDG_VALHALLA_BASE_URL: "https://v.example.com" });
    expect(s).toMatchObject({ engine: "valhalla", profile: "truck", error: null });
  });
});

describe("costing do Valhalla a partir do perfil físico", () => {
  it("converte kg para toneladas e informa eixos/carga por eixo", () => {
    const c = costingValhalla(TRUCK);
    expect(c.costing).toBe("truck");
    expect(c.costing_options.truck).toMatchObject({ height: 4.2, width: 2.6, length: 14, weight: 23, axle_count: 3, axle_load: 7.67 });
    expect(c.assumptions).toEqual([]);
  });

  it("deriva peso bruto de tara + carga e registra o que ficou no padrão do motor", () => {
    const c = costingValhalla({ category: "vuc", tareKg: 3500, payloadKg: 3000 });
    expect(c.costing_options.truck.weight).toBe(6.5);
    expect(c.assumptions).toEqual(expect.arrayContaining(["altura_nao_informada_padrao_valhalla", "comprimento_nao_informado_padrao_valhalla"]));
  });

  it("moto usa motorcycle; carro usa auto; hazmat propaga", () => {
    expect(costingValhalla({ category: "moto" }).costing).toBe("motorcycle");
    expect(costingValhalla({ category: "carro" }).costing).toBe("auto");
    expect(costingValhalla({ ...TRUCK, hazmat: true }).costing_options.truck.hazmat).toBe(true);
  });

  it("monta o POST /route com locations em lat/lon e polyline6", () => {
    const { body } = requisicaoValhalla([[-46.63, -23.55], [-46.65, -23.56]], TRUCK);
    expect(body.locations).toEqual([{ lat: -23.55, lon: -46.63, type: "break" }, { lat: -23.56, lon: -46.65, type: "break" }]);
    expect(body).toMatchObject({ costing: "truck", units: "kilometers", shape_format: "polyline6", alternates: 0 });
  });
});

describe("normalização das respostas", () => {
  // polyline6 de dois pontos: (-23.55,-46.63) → (-23.56,-46.65)
  const shape6 = (() => {
    const enc = (v) => { let s = ""; let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } return s + String.fromCharCode(n + 63); };
    return enc(-23550000) + enc(-46630000) + enc(-10000) + enc(-20000);
  })();

  it("Valhalla: km/segundos do summary e shape polyline6 → GeoJSON [lon, lat]", () => {
    const r = normalizarRespostaValhalla({ trip: { summary: { length: 3.456, time: 600 }, legs: [{ summary: { length: 3.456, time: 600 }, shape: shape6 }] } });
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ engine: "valhalla", distanceKm: 3.456, durationMinutes: 10, durationSeconds: 600 });
    expect(r.geometry[0][0]).toBeCloseTo(-46.63, 5);
    expect(r.geometry[0][1]).toBeCloseTo(-23.55, 5);
    expect(r.geometry[1][0]).toBeCloseTo(-46.65, 5);
    expect(r.geometry[1][1]).toBeCloseTo(-23.56, 5);
  });

  it("Valhalla sem trip é falha explícita", () => {
    expect(normalizarRespostaValhalla({ error: "No path could be found" })).toMatchObject({ ok: false, reason: "No path could be found" });
  });

  it("OSRM: metros/segundos e geometria GeoJSON preservada", () => {
    const r = normalizarRespostaOsrm({ code: "Ok", routes: [{ distance: 12345, duration: 900, geometry: { type: "LineString", coordinates: [[-46.63, -23.55], [-46.65, -23.56]] }, legs: [{ distance: 12345, duration: 900 }] }] });
    expect(r).toMatchObject({ ok: true, engine: "osrm", distanceKm: 12.345, durationMinutes: 15 });
    expect(r.geometry).toHaveLength(2);
  });

  it("resposta compatível com o que a tela lê + metadado do motor", () => {
    const n = normalizarRespostaValhalla({ trip: { summary: { length: 10, time: 1200 }, legs: [] } });
    const c = respostaCompativelOsrm(n, { engine: "valhalla", profile: "truck", requested: "valhalla", restrictionAware: true, fallback: false, reason: "", vehicleClass: "heavy" });
    expect(c.routes[0]).toMatchObject({ distance: 10000, duration: 1200 });
    expect(c).toMatchObject({ engine: "valhalla", profile: "truck", restrictionAware: true });
    expect(descreverMotor(c)).toBe("Valhalla · caminhão (restrições viárias)");
    expect(descreverMotor({ engine: "osrm", profile: "driving", fallback: true })).toBe("OSRM · veículo leve · contingência");
  });
});
