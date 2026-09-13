import { describe, expect, it } from "vitest";
import {
  ESCALA_RISCO_UPS_KM,
  UPS,
  agregarRiscoPrf,
  agregarSegmentosAntt,
  amostrarTracado,
  avisosPorRodovia,
  celulaDe,
  normalizarTracado,
  parseAcidentesAnttPorKm,
  parseAcidentesPrf,
  riscoDaRota,
  upsDaOcorrencia,
} from "./roadRiskDomain.js";

const AGORA = Date.parse("2026-09-13T12:00:00Z");

// Layout real dos dados abertos da PRF (acidentes por ocorrência, 2017+).
const CAB_PRF = "id;data_inversa;dia_semana;horario;uf;br;km;municipio;causa_acidente;tipo_acidente;classificacao_acidente;fase_dia;sentido_via;condicao_metereologica;tipo_pista;tracado_via;uso_solo;pessoas;mortos;feridos_leves;feridos_graves;ilesos;ignorados;feridos;veiculos;latitude;longitude;regional;delegacia;uop";
const linhaPrf = (data, br, km, mun, classif, mortos, graves, leves, lat, lon) => `1;${data};sexta-feira;08:00:00;SP;${br};${km};${mun};Falta de atenção;Colisão traseira;${classif};Pleno dia;Crescente;Céu Claro;Dupla;Reta;Não;3;${mortos};${leves};${graves};1;0;${graves + leves};2;${lat};${lon};SPRF-SP;DEL01;UOP01`;
const CSV_PRF = `${String.fromCharCode(0xfeff)}${[CAB_PRF,
  linhaPrf("2026-05-10", 116, "230,5", "GUARULHOS", "Com Vítimas Feridas", 0, 1, 1, "-23,45123", "-46,53321"),
  linhaPrf("2026-06-02", 116, "230,9", "GUARULHOS", "Com Vítimas Fatais", 1, 0, 0, "-23,45210", "-46,53400"),
  linhaPrf("2026-07-15", 116, "231,2", "GUARULHOS", "Sem Vítimas", 0, 0, 0, "-23,45500", "-46,53200"),
  linhaPrf("2023-01-01", 116, "230,7", "GUARULHOS", "Sem Vítimas", 0, 0, 0, "-23,45150", "-46,53350"), // fora da janela
  linhaPrf("2026-08-01", 381, "480,0", "BETIM", "Sem Vítimas", 0, 0, 0, "", ""), // sem coordenada
  "9;2026-08-02;sabado;09:00:00;;116;;;;;;;;;;;;;;;;;;;;;;;;", // inválida (sem UF)
].join("\r\n")}`;

describe("PRF: parser e UPS", () => {
  it("lê o layout oficial com vírgula decimal e coordenadas", () => {
    const r = parseAcidentesPrf(CSV_PRF);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(6);
    expect(r.ignorados).toBe(1);
    expect(r.registros).toHaveLength(5);
    expect(r.registros[0]).toMatchObject({ data: "2026-05-10", uf: "SP", rodovia: "BR-116/SP", km: 230.5, municipio: "GUARULHOS", classificacao: "Com Vítimas Feridas", feridosGraves: 1, feridosLeves: 1, latitude: -23.45123, longitude: -46.53321, ups: UPS.comFeridos });
    expect(r.registros[1].ups).toBe(UPS.comMortos);
    expect(r.registros[2].ups).toBe(UPS.semVitimas);
    expect(r.registros[4]).toMatchObject({ rodovia: "BR-381/SP", latitude: null, longitude: null });
  });

  it("é honesto sobre vazio e cabeçalho estranho", () => {
    expect(parseAcidentesPrf("")).toMatchObject({ ok: false, reason: "PRF_CSV_VAZIO" });
    expect(parseAcidentesPrf("a;b\n1;2")).toMatchObject({ ok: false, reason: "PRF_CSV_CABECALHO_DESCONHECIDO" });
  });

  it("UPS pela classificação ou pelas vítimas", () => {
    expect(upsDaOcorrencia({ classificacao: "Com Vítimas Fatais" })).toBe(13);
    expect(upsDaOcorrencia({ mortos: 0, feridosGraves: 2 })).toBe(5);
    expect(upsDaOcorrencia({})).toBe(1);
  });
});

describe("células e agregação", () => {
  it("célula de ~1,1 km determinística", () => {
    const c = celulaDe(-23.45123, -46.53321);
    expect(c).toEqual({ chave: "-2346_-4654", lat: -23.455, lon: -46.535 });
    expect(celulaDe(-23.45999, -46.53001).chave).toBe("-2346_-4654");
    expect(celulaDe(91, 0)).toBeNull();
  });

  it("agregarRiscoPrf: só a janela, células com UPS e segmentos por rodovia/km", () => {
    const { registros } = parseAcidentesPrf(CSV_PRF);
    const r = agregarRiscoPrf(registros, { agora: AGORA, janelaMeses: 24 });
    expect(r.foraDaJanela).toBe(1);
    expect(r.semCoordenada).toBe(1);
    expect(r.celulas).toHaveLength(1);
    expect(r.celulas[0]).toMatchObject({ chave: "-2346_-4654", acidentes: 3, mortos: 1, feridosGraves: 1, feridosLeves: 1, ups: 19, primeiro: "2026-05-10", ultimo: "2026-07-15", rodovias: ["BR-116/SP"] });
    const seg116 = r.segmentos.filter((s) => s.rodovia === "BR-116/SP");
    expect(seg116.map((s) => s.km).sort()).toEqual([230, 231]);
    expect(seg116.find((s) => s.km === 230)).toMatchObject({ acidentes: 2, mortos: 1, ups: 18 });
    expect(r.segmentos.find((s) => s.rodovia === "BR-381/SP")).toMatchObject({ km: 480, acidentes: 1 });
  });

  it("ANTT: parser do demonstrativo por km e segmentos sem severidade", () => {
    const csv = 'Concessionaria;Data;Km;Trecho\r\n"NOVA 381";"02/07/2026";247,000;"BR-381/MG"\r\n"NOVA 381";"03/07/2026";247,400;"BR-381/MG"\r\n"NOVA 381";"01/01/2024";300,000;"BR-381/MG"\r\n';
    const p = parseAcidentesAnttPorKm(csv);
    expect(p.ok).toBe(true);
    expect(p.registros).toHaveLength(3);
    expect(p.registros[0]).toEqual({ data: "2026-07-02", km: 247, rodovia: "BR-381/MG", concessionaria: "NOVA 381" });
    const ag = agregarSegmentosAntt(p.registros, { agora: AGORA, janelaMeses: 12 });
    expect(ag.semSeveridade).toBe(true);
    expect(ag.foraDaJanela).toBe(1);
    expect(ag.segmentos).toEqual([{ rodovia: "BR-381/MG", km: 247, concessionaria: "NOVA 381", acidentes: 2, ups: 2, primeiro: "2026-07-02", ultimo: "2026-07-03" }]);
    expect(parseAcidentesAnttPorKm("x;y\n1;2")).toMatchObject({ ok: false, reason: "ANTT_CSV_CABECALHO_DESCONHECIDO" });
  });
});

describe("traçado e risco da rota", () => {
  const GEOJSON = [[-46.6333, -23.5505], [-46.64, -23.555], [-46.65, -23.56]]; // [lon, lat]

  it("aceita [lon,lat], [lat,lon] e objetos; amostra a cada passo", () => {
    expect(normalizarTracado(GEOJSON)[0]).toEqual({ lat: -23.5505, lon: -46.6333 });
    expect(normalizarTracado([[-23.5505, -46.6333]])[0]).toEqual({ lat: -23.5505, lon: -46.6333 });
    expect(normalizarTracado([{ latitude: -23.5, longitude: -46.6 }])[0]).toEqual({ lat: -23.5, lon: -46.6 });
    const { amostras, distanciaKm } = amostrarTracado(GEOJSON, { passoKm: 0.25 });
    expect(distanciaKm).toBeGreaterThan(1.9);
    expect(distanciaKm).toBeLessThan(2.3);
    expect(amostras.length).toBeGreaterThanOrEqual(9);
    expect(amostras[amostras.length - 1]).toEqual({ lat: -23.56, lon: -46.65 });
  });

  it("sem índice ingerido o score é null (RISK_DATA_NOT_AVAILABLE), não zero", () => {
    expect(riscoDaRota(GEOJSON, new Map())).toMatchObject({ riskScore: null, reason: "RISK_DATA_NOT_AVAILABLE", confidence: "UNKNOWN" });
    expect(riscoDaRota([[-46.63, -23.55]], new Map([["x", {}]]))).toMatchObject({ riskScore: null, reason: "ROUTE_TOO_SHORT" });
  });

  it("com índice: soma a UPS das células atravessadas, normaliza por km e explica", () => {
    const indice = new Map();
    for (const p of normalizarTracado(GEOJSON)) {
      const c = celulaDe(p.lat, p.lon);
      indice.set(c.chave, { chave: c.chave, lat: c.lat, lon: c.lon, acidentes: 4, mortos: 1, feridosGraves: 1, feridosLeves: 0, ups: 20, ultimo: "2026-08-01", rodovias: ["BR-116/SP"] });
    }
    const r = riscoDaRota(GEOJSON, indice, { agora: AGORA });
    expect(r.riskScore).toBeGreaterThan(0);
    expect(r.riskScore).toBeLessThanOrEqual(100);
    expect(r.celulasComRisco).toBeGreaterThanOrEqual(2);
    expect(r.upsTotal).toBe(20 * r.celulasComRisco);
    expect(r.upsPorKm).toBeCloseTo(r.upsTotal / r.distanciaKm, 1);
    expect(r.riskScore).toBe(Math.round(100 * (1 - Math.exp(-r.upsPorKm / ESCALA_RISCO_UPS_KM))));
    expect(r.confidence).toBe("HIGH");
    expect(r.trechosCriticos[0]).toMatchObject({ ups: 20, rodovias: ["BR-116/SP"] });
    expect(r.metodologia).toHaveLength(3);
    // Índice existe mas a rota não passa por célula com ocorrência: 0 com confiança MEDIUM.
    const longe = riscoDaRota([[-40.0, -20.0], [-40.02, -20.02]], indice, { agora: AGORA });
    expect(longe).toMatchObject({ riskScore: 0, celulasComRisco: 0, confidence: "MEDIUM" });
  });

  it("avisosPorRodovia casa as refs da rota com os segmentos", () => {
    const segmentos = [
      { rodovia: "BR-381/MG", km: 247, acidentes: 12, ups: 12, concessionaria: "NOVA 381" },
      { rodovia: "BR-381/MG", km: 480, acidentes: 40, ups: 40, concessionaria: "NOVA 381" },
      { rodovia: "BR-116/SP", km: 230, acidentes: 2, ups: 18 },
    ];
    const avisos = avisosPorRodovia(["BR-381", "BR-116", "SP-330"], segmentos);
    expect(avisos).toEqual([
      { rodovia: "BR-381", segmentos: 2, acidentes: 52, kmCritico: 480, acidentesKmCritico: 40, fonte: "antt" },
      { rodovia: "BR-116", segmentos: 1, acidentes: 2, kmCritico: 230, acidentesKmCritico: 2, fonte: "prf" },
    ]);
  });
});
