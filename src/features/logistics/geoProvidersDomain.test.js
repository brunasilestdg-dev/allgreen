import { describe, expect, it } from "vitest";
import {
  GEO_ERRORS,
  alturasDaRespostaValhalla,
  amostrarGeometria,
  chaveGeo,
  perfilDeElevacao,
  pontoMedio,
  requisicaoAlturaValhalla,
  temperaturaNaSaida,
} from "./geoProvidersDomain.js";

describe("amostragem da geometria", () => {
  it("preserva extremos e limita o número de pontos", () => {
    const geo = Array.from({ length: 1000 }, (_, i) => [-46 - i / 1000, -23 - i / 1000]);
    const amostra = amostrarGeometria(geo, 50);
    expect(amostra).toHaveLength(50);
    expect(amostra[0]).toEqual(geo[0]);
    expect(amostra[49]).toEqual(geo[999]);
  });

  it("descarta pontos inválidos e não estoura com lista curta", () => {
    expect(amostrarGeometria([[-46, -23], ["x", 1], [-46.1, -23.1]], 10)).toEqual([[-46, -23], [-46.1, -23.1]]);
    expect(amostrarGeometria([], 10)).toEqual([]);
  });
});

describe("perfil de elevação (ganho/perda com filtro de ruído)", () => {
  it("soma subidas e descidas reais e ignora oscilação de DEM", () => {
    const r = perfilDeElevacao([700, 701, 700, 760, 758, 720, 721, 800]);
    expect(r.ok).toBe(true);
    // 700→760 (+60) → 720 (−40) → 800 (+80): ruído de ±1–2 m não conta.
    expect(r.elevationGainM).toBe(140);
    expect(r.elevationLossM).toBe(40);
    expect(r).toMatchObject({ minM: 700, maxM: 800, samples: 8, gaps: 0, confidence: "HIGH", measurementType: "DERIVED" });
  });

  it("lacunas rebaixam a confiança; sem dados é ELEVATION_NOT_AVAILABLE, nunca zero", () => {
    const comLacunas = perfilDeElevacao([700, null, null, 750, null, 760, null, null, null, 770]);
    expect(comLacunas.ok).toBe(true);
    expect(comLacunas.confidence).toBe("LOW");
    expect(comLacunas.gaps).toBe(6);
    expect(perfilDeElevacao([null, null])).toMatchObject({ ok: false, reason: GEO_ERRORS.ELEVATION_NOT_AVAILABLE });
    expect(perfilDeElevacao([])).toMatchObject({ ok: false });
  });
});

describe("Valhalla /height", () => {
  it("monta o corpo com shape lat/lon amostrado", () => {
    const req = requisicaoAlturaValhalla([[-46.63, -23.55], [-46.65, -23.56]]);
    expect(req.shape).toEqual([{ lat: -23.55, lon: -46.63 }, { lat: -23.56, lon: -46.65 }]);
    expect(req.range).toBe(false);
  });

  it("lê `height` e preserva nulos como lacuna", () => {
    expect(alturasDaRespostaValhalla({ height: [700, null, 720] })).toEqual([700, null, 720]);
    expect(alturasDaRespostaValhalla({})).toBeNull();
  });
});

describe("temperatura na hora de saída (Open-Meteo)", () => {
  const dados = {
    current: { time: "2026-09-13T09:00", temperature_2m: 21.4 },
    hourly: {
      time: ["2026-09-13T06:00", "2026-09-13T07:00", "2026-09-13T08:00", "2026-09-13T09:00"],
      temperature_2m: [14.2, 15.1, 17.8, 21.4],
    },
  };

  it("escolhe a hora mais próxima da saída (EXTERNAL, confiança alta até 1 h)", () => {
    expect(temperaturaNaSaida(dados, "2026-09-13T06:20")).toMatchObject({ ok: true, temperatureC: 14.2, at: "2026-09-13T06:00", method: "hourly_nearest", confidence: "HIGH", measurementType: "EXTERNAL" });
  });

  it("sem hora de saída usa a temperatura atual; saída longe demais também, com confiança baixa", () => {
    expect(temperaturaNaSaida(dados)).toMatchObject({ ok: true, temperatureC: 21.4, method: "current", confidence: "MEDIUM" });
    expect(temperaturaNaSaida(dados, "2026-09-15T06:00")).toMatchObject({ ok: true, method: "current", confidence: "LOW" });
  });

  it("sem dado nenhum é WEATHER_NOT_AVAILABLE — não inventa temperatura", () => {
    expect(temperaturaNaSaida({}, "2026-09-13T06:00")).toMatchObject({ ok: false, reason: GEO_ERRORS.WEATHER_NOT_AVAILABLE });
  });
});

describe("cache e ponto médio", () => {
  it("chave estável independe da ordem das propriedades", () => {
    expect(chaveGeo("elev", { a: 1, b: [1, 2] })).toBe(chaveGeo("elev", { b: [1, 2], a: 1 }));
    expect(chaveGeo("elev", { a: 1 })).not.toBe(chaveGeo("clima", { a: 1 }));
  });

  it("ponto médio de uma geometria", () => {
    expect(pontoMedio([[-46.6, -23.5], [-46.7, -23.6], [-46.8, -23.7]])).toEqual({ latitude: -23.6, longitude: -46.7 });
    expect(pontoMedio([])).toBeNull();
  });
});

describe("adaptador da MET Norway", () => {
  it("converte a série em UTC para a hora de Brasília que o modelo já lê", async () => {
    const { horarioDaMetNorway, temperaturaNaSaida } = await import("./geoProvidersDomain.js");
    const dados = {
      properties: {
        timeseries: [
          { time: "2026-09-24T12:00:00Z", data: { instant: { details: { air_temperature: 15.6 } } } },
          { time: "2026-09-24T13:00:00Z", data: { instant: { details: { air_temperature: 16.4 } } } },
          { time: "sem-data", data: { instant: { details: { air_temperature: 99 } } } },
          { time: "2026-09-24T14:00:00Z", data: { instant: { details: {} } } },
        ],
      },
    };
    const horario = horarioDaMetNorway(dados);
    expect(horario.hourly).toEqual({ time: ["2026-09-24T09:00", "2026-09-24T10:00"], temperature_2m: [15.6, 16.4] });
    expect(horario.current).toEqual({ time: "2026-09-24T09:00", temperature_2m: 15.6 });
    expect(temperaturaNaSaida(horario, "2026-09-24T10:05:00")).toMatchObject({ ok: true, temperatureC: 16.4 });
    expect(horarioDaMetNorway({}).hourly).toEqual({ time: [], temperature_2m: [] });
  });
});
