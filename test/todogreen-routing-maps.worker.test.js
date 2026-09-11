import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodeTodoGreen,
  routeTodoGreen,
} from "../worker/services/todogreen-routing-maps.js";

afterEach(() => vi.restoreAllMocks());

describe("To Do Green routing maps gateway", () => {
  it("prefere Nominatim próprio e preserva a busca no Brasil", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ lat: "-23.5", lon: "-46.6", display_name: "Osasco" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await geocodeTodoGreen({ q: "Osasco", limit: 5 }, {
      TODOGREEN_NOMINATIM_BASE_URL: "https://geo.tdg.test/",
      TDG_ROUTING_TOKEN: "segredo",
    });
    expect(response.status).toBe(200);
    const [url, options] = upstream.mock.calls[0];
    expect(String(url)).toContain("https://geo.tdg.test/search");
    expect(new URL(url).searchParams.get("countrycodes")).toBe("br");
    expect(options.headers.authorization).toBe("Bearer segredo");
  });

  it("prefere OSRM próprio e valida coordenadas", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ routes: [{ distance: 1000, duration: 100 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await routeTodoGreen({
      coordinates: [[-46.8, -23.5], [-46.6, -23.55]],
      geometry: true,
    }, {
      TODOGREEN_OSRM_BASE_URL: "https://osrm.tdg.test/",
    });
    expect(response.status).toBe(200);
    const [url] = upstream.mock.calls[0];
    expect(String(url)).toContain("https://osrm.tdg.test/route/v1/driving/");
    expect(String(url)).toContain("geometries=geojson");
  });

  it("usa serviço público somente como fallback quando o host próprio cai", async () => {
    const upstream = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("private down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ routes: [{ distance: 1000, duration: 100 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    const response = await routeTodoGreen({
      coordinates: [[-46.8, -23.5], [-46.6, -23.55]],
      geometry: false,
    }, {
      TODOGREEN_OSRM_BASE_URL: "https://osrm.tdg.test/",
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toContain("router.project-osrm.org");
  });

  it("recusa lote de coordenadas inválido", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const response = await routeTodoGreen({ coordinates: [[999, 999], [-46.6, -23.55]] }, {});
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
