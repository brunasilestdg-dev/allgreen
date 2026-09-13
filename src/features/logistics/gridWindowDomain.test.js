import { describe, expect, it } from "vitest";
import {
  DISPONIBILIDADE_PADRAO_HORAS,
  horasDisponiveis,
  janelasDeRecarga,
  parseCurvaCargaOns,
  perfilDeMedias,
  perfilHorarioCarga,
} from "./gridWindowDomain.js";
import { curvaTarifaria } from "./smartChargingDomain.js";

// Carga sintética do SIN: vale de madrugada (3h–6h), pico às 19h.
const cargaNaHora = (h) => 30000 - 12000 * Math.cos(((h - 3) / 24) * 2 * Math.PI);
const csvOns = (dias, { subsistemas = ["SE", "S"] } = {}) => {
  const linhas = ["id_subsistema;nom_subsistema;din_instante;val_cargaenergiahomwmed"];
  for (let d = 0; d < dias; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const dia = String(1 + d).padStart(2, "0");
      for (const s of subsistemas) linhas.push(`${s};${s === "SE" ? "SUDESTE" : "SUL"};2026-09-${dia} ${String(h).padStart(2, "0")}:00:00;${(cargaNaHora(h) * (s === "SE" ? 1 : 0.3)).toFixed(3).replace(".", ",")}`);
    }
  }
  return linhas.join("\r\n");
};

describe("parseCurvaCargaOns", () => {
  it("lê só o subsistema pedido e a janela de dias mais recente", () => {
    const r = parseCurvaCargaOns(csvOns(10), { subsistema: "SE", dias: 7 });
    expect(r.ok).toBe(true);
    expect(r.subsistema).toBe("SE");
    expect(r.total).toBe(240);
    // 7 dias × 24 h + a hora limite inclusiva
    expect(r.registros.length).toBeGreaterThanOrEqual(168);
    expect(r.registros.length).toBeLessThanOrEqual(169);
    expect(r.ultimoInstante).toBe("2026-09-10T23:00:00.000Z");
    expect(r.registros.every((x) => Number.isInteger(x.hora) && x.cargaMw > 0)).toBe(true);
  });

  it("é honesto sobre CSV vazio, cabeçalho estranho e subsistema ausente", () => {
    expect(parseCurvaCargaOns("")).toMatchObject({ ok: false, reason: "ONS_CSV_VAZIO" });
    expect(parseCurvaCargaOns("a;b;c\n1;2;3")).toMatchObject({ ok: false, reason: "ONS_CSV_CABECALHO_DESCONHECIDO" });
    expect(parseCurvaCargaOns(csvOns(2), { subsistema: "NE" })).toMatchObject({ ok: false, reason: "ONS_SEM_REGISTROS_DO_SUBSISTEMA" });
  });

  it("aceita BOM no início do arquivo", () => {
    expect(parseCurvaCargaOns(`\uFEFF${csvOns(1)}`).ok).toBe(true);
  });
});

describe("perfilHorarioCarga", () => {
  it("média por hora, normalização 0–1 e confiança pelos dias cobertos", () => {
    const { registros } = parseCurvaCargaOns(csvOns(14), { dias: 14 });
    const p = perfilHorarioCarga(registros);
    expect(p.ok).toBe(true);
    expect(p.mediaMw).toHaveLength(24);
    expect(Math.min(...p.normalizado)).toBe(0);
    expect(Math.max(...p.normalizado)).toBe(1);
    expect(p.horaMaisLeve).toBe(3);
    expect(p.horaMaisPesada).toBe(15);
    expect(p.dias).toBeGreaterThanOrEqual(14);
    expect(p.confidence).toBe("HIGH");
  });

  it("poucos dias → confiança menor; hora sem amostra → inválido", () => {
    expect(perfilHorarioCarga(parseCurvaCargaOns(csvOns(3), { dias: 3 }).registros).confidence).toBe("LOW");
    expect(perfilHorarioCarga(parseCurvaCargaOns(csvOns(8), { dias: 8 }).registros).confidence).toBe("MEDIUM");
    const incompleto = perfilHorarioCarga([{ hora: 1, cargaMw: 100 }, { hora: 2, cargaMw: 90 }]);
    expect(incompleto).toMatchObject({ ok: false, reason: "PERFIL_INCOMPLETO", horasCobertas: 2 });
  });

  it("perfilDeMedias reconstrói o perfil a partir do cache (24 médias + dias)", () => {
    const medias = Array.from({ length: 24 }, (_, h) => cargaNaHora(h));
    const p = perfilDeMedias(medias, { dias: 20 });
    expect(p).toMatchObject({ ok: true, horaMaisLeve: 3, confidence: "HIGH", dias: 20 });
    expect(perfilDeMedias([1, 2, 3])).toMatchObject({ ok: false, reason: "PERFIL_INCOMPLETO" });
    expect(perfilDeMedias(Array(24).fill(null))).toMatchObject({ ok: false });
  });
});

describe("horasDisponiveis", () => {
  it("retorno→saída informados: intervalo circular exato, sem assumption", () => {
    const r = horasDisponiveis({ saidaHora: 6, chegadaHora: 20 });
    expect([...r.permitidas].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 20, 21, 22, 23]);
    expect(r.assumptions).toEqual([]);
  });

  it("só saída: N horas antes, declarado como assumption", () => {
    const r = horasDisponiveis({ saidaHora: 6 });
    expect(r.permitidas.size).toBe(DISPONIBILIDADE_PADRAO_HORAS);
    expect(r.permitidas.has(5)).toBe(true);
    expect(r.permitidas.has(6)).toBe(false);
    expect(r.permitidas.has(18)).toBe(true);
    expect(r.permitidas.has(17)).toBe(false);
    expect(r.assumptions).toEqual(["disponibilidade_12h_antes_da_saida"]);
  });

  it("sem saída, todas as horas", () => {
    expect(horasDisponiveis({})).toMatchObject({ permitidas: null, saida: null, assumptions: [] });
  });
});

describe("janelasDeRecarga", () => {
  const tarifa = curvaTarifaria(0.6); // branca padrão: ponta 18–20, intermediário 17 e 21
  const perfil = perfilHorarioCarga(parseCurvaCargaOns(csvOns(14), { dias: 14 }).registros);

  it("sem ONS: financeira fora de ponta, recomendada = financeira, aviso ONS_NOT_AVAILABLE", () => {
    const r = janelasDeRecarga({ curvaTarifa: tarifa, horasNecessarias: 4, saidaHora: 6 });
    expect(r.financeira).toMatchObject({ horas: 4, tarifaMedia: 0.6, foraDaDisponibilidade: false });
    expect(r.financeira.fim).toBeLessThanOrEqual(6);
    expect(r.energetica).toBeNull();
    expect(r.recomendada.derivadaDe).toBe("financeira");
    expect(r.avisos).toContain("ONS_NOT_AVAILABLE");
    expect(r.assumptions).toEqual(["disponibilidade_12h_antes_da_saida"]);
    expect(r.confidence).toBe("MEDIUM");
    expect(r.metodologia).toHaveLength(3);
  });

  it("com ONS: energética no vale de carga e recomendada ponderada dentro da disponibilidade", () => {
    const r = janelasDeRecarga({ curvaTarifa: tarifa, perfilCarga: perfil, horasNecessarias: 3, saidaHora: 7, chegadaHora: 21 });
    expect(r.energetica).toMatchObject({ horas: 3, confidence: "HIGH", criterio: expect.stringContaining("ONS") });
    // vale sintético em 3h → janela 2–5 ou 3–6
    expect([2, 3]).toContain(r.energetica.inicio);
    expect(r.energetica.cargaMediaMw).toBeGreaterThan(0);
    expect(r.recomendada.pesos).toEqual({ financeiro: 0.6, energetico: 0.4 });
    expect(r.recomendada.tarifaMedia).toBe(0.6);
    // tudo dentro de 21h→7h
    for (const j of [r.financeira, r.energetica, r.recomendada]) {
      const horas = Array.from({ length: j.horas }, (_, k) => (j.inicio + k) % 24);
      expect(horas.every((h) => h >= 21 || h < 7)).toBe(true);
    }
    expect(r.avisos).toEqual([]);
    expect(r.confidence).toBe("HIGH");
  });

  it("tarifa plana avisa que não há ganho horário", () => {
    const plana = Array.from({ length: 24 }, (_, hora) => ({ hora, tarifa: 0.7 }));
    const r = janelasDeRecarga({ curvaTarifa: plana, horasNecessarias: 2 });
    expect(r.financeira.plana).toBe(true);
    expect(r.avisos).toContain("TARIFA_PLANA_SEM_GANHO_HORARIO");
    expect(r.financeira.economiaVsPiorPercent).toBe(0);
  });

  it("sem tarifa não inventa janela financeira", () => {
    const r = janelasDeRecarga({ curvaTarifa: [], perfilCarga: perfil, horasNecessarias: 2 });
    expect(r.financeira).toBeNull();
    expect(r.recomendada).toBeNull();
    expect(r.energetica).not.toBeNull();
    expect(r.avisos).toContain("TARIFA_INDISPONIVEL");
    expect(r.confidence).toBe("UNKNOWN");
  });

  it("janela maior que a disponibilidade avisa e marca a saída fora da disponibilidade", () => {
    const r = janelasDeRecarga({ curvaTarifa: tarifa, horasNecessarias: 6, saidaHora: 6, chegadaHora: 3 });
    expect(r.avisos).toContain("JANELA_MAIOR_QUE_DISPONIBILIDADE");
    expect(r.financeira.foraDaDisponibilidade).toBe(true);
    expect(r.horasDisponiveis).toBe(3);
  });
});
