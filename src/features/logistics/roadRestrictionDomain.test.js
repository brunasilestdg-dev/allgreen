import { describe, expect, it } from "vitest";
import {
  parseOsmMeasure, checkSegment, checkRoute, chooseCompatibleRoute, vehiclePhysical, describeReason,
} from "./roadRestrictionDomain.js";

const caminhao = { category: "truck", heightM: 4.2, widthM: 2.6, lengthM: 12, pbtKg: 23000 };
const van = { category: "van", heightM: 2.6, widthM: 2.0, lengthM: 5.5, pbtKg: 3500 };

describe("parse de tags OSM", () => {
  it("lê metros/toneladas numéricos, com ou sem unidade textual", () => {
    expect(parseOsmMeasure("3.5")).toBe(3.5);
    expect(parseOsmMeasure("3,5 m")).toBe(3.5);
    expect(parseOsmMeasure("7.5 t")).toBe(7.5);
  });
  it("não chuta conversão de unidade imperial", () => {
    expect(parseOsmMeasure("12'6\"")).toBeNull();
    expect(parseOsmMeasure("")).toBeNull();
    expect(parseOsmMeasure(null)).toBeNull();
  });
});

describe("compatibilidade de segmento", () => {
  it("altura: caminhão de 4,2 m barrado em ponte de 3,5 m", () => {
    const r = checkSegment(caminhao, { tags: { maxheight: "3.5" } });
    expect(r.compatible).toBe(false);
    expect(r.reasons[0].code).toBe("height_exceeded");
    expect(r.reasons[0].limit).toBe(3.5);
  });
  it("peso: PBT 23 t barrado em limite de 10 t (convertido para kg)", () => {
    const r = checkSegment(caminhao, { tags: { maxweight: "10" } });
    expect(r.compatible).toBe(false);
    expect(r.reasons.find((x) => x.code === "weight_exceeded").limit).toBe(10000);
  });
  it("hgv=no barra caminhão, mas não barra van (não-HGV)", () => {
    expect(checkSegment(caminhao, { tags: { hgv: "no" } }).compatible).toBe(false);
    expect(checkSegment(van, { tags: { hgv: "no" } }).compatible).toBe(true);
  });
  it("access=no barra qualquer veículo", () => {
    expect(checkSegment(van, { tags: { access: "no" } }).compatible).toBe(false);
  });
  it("segmento sem restrição relevante é compatível", () => {
    expect(checkSegment(caminhao, { tags: { maxspeed: "60" } }).compatible).toBe(true);
  });
  it("van baixa passa numa ponte que barra o caminhão", () => {
    expect(checkSegment(van, { tags: { maxheight: "3.5" } }).compatible).toBe(true);
  });
});

describe("compatibilidade de rota e escolha da alternativa", () => {
  it("rota com um segmento incompatível é incompatível, com o motivo e o segmento", () => {
    const r = checkRoute(caminhao, [{ id: "s1", tags: {} }, { id: "s2", tags: { maxheight: "3.0" } }]);
    expect(r.compatible).toBe(false);
    expect(r.violations[0].segmentId).toBe("s2");
    expect(r.violations[0].reasons[0].code).toBe("height_exceeded");
  });

  it("escolhe a rota mais curta COMPATÍVEL e registra por que a mais curta foi rejeitada", () => {
    const routes = [
      { id: "curta", distanceKm: 10, segments: [{ id: "ponte", tags: { maxheight: "3.5" } }] },
      { id: "media", distanceKm: 14, segments: [{ id: "ok", tags: {} }] },
    ];
    const r = chooseCompatibleRoute(caminhao, routes);
    expect(r.chosen.id).toBe("media");
    expect(r.chosen.distanceKm).toBe(14);
    expect(r.rejected[0].id).toBe("curta");
    expect(r.rejected[0].reasons).toContain("height_exceeded");
  });

  it("sem rota compatível, chosen é null e todas as rejeições têm motivo", () => {
    const routes = [{ id: "a", distanceKm: 5, segments: [{ tags: { access: "no" } }] }];
    const r = chooseCompatibleRoute(caminhao, routes);
    expect(r.chosen).toBeNull();
    expect(r.rejected).toHaveLength(1);
  });
});

describe("perfil e rótulos", () => {
  it("vehiclePhysical marca HGV por categoria", () => {
    expect(vehiclePhysical(caminhao).isHgv).toBe(true);
    expect(vehiclePhysical(van).isHgv).toBe(false);
  });
  it("describeReason traduz o código", () => {
    expect(describeReason("weight_exceeded")).toBe("peso acima do limite");
  });
});
