import { describe, expect, it } from "vitest";
import {
  selectRoutingEngine,
  preferredRoutingEngine,
  classifyVehicle,
  requiresRestrictionAware,
  ROUTING_ENGINES,
} from "./routingEngineSelectionDomain.js";

const OSRM = ROUTING_ENGINES.OSRM;
const VALHALLA = ROUTING_ENGINES.VALHALLA;

describe("classificação de veículo", () => {
  it("classifica leve, van, pesado e desconhecido", () => {
    expect(classifyVehicle({ category: "moto" })).toBe("light");
    expect(classifyVehicle({ category: "carro" })).toBe("light");
    expect(classifyVehicle({ category: "van" })).toBe("van");
    expect(classifyVehicle({ category: "carreta" })).toBe("heavy");
    expect(classifyVehicle({ category: "vuc" })).toBe("heavy");
    expect(classifyVehicle({ category: "nave-espacial" })).toBe("unknown");
  });
});

describe("necessidade de roteamento ciente de restrições", () => {
  it("pesado sempre precisa", () => {
    expect(requiresRestrictionAware({ category: "truck" })).toBe(true);
  });
  it("van com limite físico declarado precisa; sem limite, não", () => {
    expect(requiresRestrictionAware({ category: "van", heightM: 2.6 })).toBe(true);
    expect(requiresRestrictionAware({ category: "van" })).toBe(false);
  });
  it("leve sem restrição não precisa", () => {
    expect(requiresRestrictionAware({ category: "carro" })).toBe(false);
  });
});

describe("motor preferido", () => {
  it("moto/carro -> OSRM; VUC/pesado -> Valhalla; van depende da restrição", () => {
    expect(preferredRoutingEngine({ category: "moto" })).toBe(OSRM);
    expect(preferredRoutingEngine({ category: "carro" })).toBe(OSRM);
    expect(preferredRoutingEngine({ category: "vuc" })).toBe(VALHALLA);
    expect(preferredRoutingEngine({ category: "truck" })).toBe(VALHALLA);
    expect(preferredRoutingEngine({ category: "van" })).toBe(OSRM);
    expect(preferredRoutingEngine({ category: "van", pbtKg: 6000 })).toBe(VALHALLA);
  });
});

describe("seleção com disponibilidade e fallback seguro", () => {
  it("caminhão usa Valhalla com costing de truck", () => {
    const r = selectRoutingEngine({ category: "carreta" });
    expect(r.engine).toBe(VALHALLA);
    expect(r.profile).toBe("truck");
    expect(r.fallback).toBe(false);
  });

  it("carro usa OSRM driving; moto usa perfil motorcycle", () => {
    expect(selectRoutingEngine({ category: "carro" }).profile).toBe("driving");
    expect(selectRoutingEngine({ category: "moto" }).profile).toBe("motorcycle");
  });

  it("pesado com Valhalla FORA do ar NÃO cai para OSRM — sem motor seguro", () => {
    const r = selectRoutingEngine({ category: "truck" }, { available: [OSRM] });
    expect(r.engine).toBeNull();
    expect(r.reason).toBe("sem_motor_seguro_para_restricoes");
  });

  it("leve com OSRM fora do ar cai para Valhalla (seguro) marcando fallback", () => {
    const r = selectRoutingEngine({ category: "carro" }, { available: [VALHALLA] });
    expect(r.engine).toBe(VALHALLA);
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("osrm_indisponivel_valhalla_seguro");
  });

  it("van sem restrição com Valhalla fora do ar cai para OSRM (seguro)", () => {
    const r = selectRoutingEngine({ category: "van", pbtKg: 6000 }, { available: [OSRM] });
    // van com PBT alto vira restriction-aware -> preferido Valhalla -> sem OSRM seguro
    expect(r.engine).toBeNull();
    const semRestricao = selectRoutingEngine({ category: "van" }, { available: [VALHALLA] });
    expect(semRestricao.engine).toBe(VALHALLA);
    expect(semRestricao.fallback).toBe(true);
  });

  it("nenhum motor disponível é reportado explicitamente", () => {
    const r = selectRoutingEngine({ category: "carro" }, { available: [] });
    expect(r.engine).toBeNull();
    expect(r.reason).toBe("nenhum_motor_disponivel");
  });
});
