import { describe, expect, it } from "vitest";
import { modoGeoapify, normalizarRotaGeoapify } from "../worker/services/geoapify-provider.js";

describe("Geoapify cloud provider", () => {
  it("mapeia classes da frota para perfis de rota seguros", () => {
    expect(modoGeoapify({ vehicleClass: "moto" })).toBe("motorcycle");
    expect(modoGeoapify({ vehicleClass: "van" })).toBe("light_truck");
    expect(modoGeoapify({ vehicleClass: "vuc" })).toBe("light_truck");
    expect(modoGeoapify({ vehicleClass: "tres_quartos" })).toBe("medium_truck");
    expect(modoGeoapify({ vehicleClass: "toco" })).toBe("truck");
    expect(modoGeoapify({ vehicleClass: "truck" })).toBe("heavy_truck");
    expect(modoGeoapify({ vehicleClass: "carreta" })).toBe("heavy_truck");
  });

  it("normaliza GeoJSON da Geoapify para o contrato OSRM da tela", () => {
    const result = normalizarRotaGeoapify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {
          distance: 12345,
          time: 900,
          legs: [{ distance: 12345, time: 900 }],
        },
        geometry: {
          type: "MultiLineString",
          coordinates: [[[-46.63, -23.55], [-46.62, -23.56]]],
        },
      }],
    }, { mode: "heavy_truck" });

    expect(result.code).toBe("Ok");
    expect(result.engine).toBe("geoapify");
    expect(result.profile).toBe("heavy_truck");
    expect(result.restrictionAware).toBe(true);
    expect(result.routes[0].distance).toBe(12345);
    expect(result.routes[0].duration).toBe(900);
    expect(result.routes[0].geometry).toEqual({
      type: "LineString",
      coordinates: [[-46.63, -23.55], [-46.62, -23.56]],
    });
  });
});
