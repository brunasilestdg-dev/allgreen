import { describe, expect, it } from "vitest";
import {
  MODALIDADES_ANEEL,
  SUBGRUPOS_ANEEL,
  TARIFF_TIERS,
  curvaHorariaDePostos,
  dataIso,
  faixaDoPosto,
  normalizarTarifaAneel,
  numeroBr,
  resolverTarifaEnergia,
  selecionarTarifasVigentes,
} from "./energyTariffDomain.js";

// Registros como a ANEEL devolve (datastore_search, resource das tarifas
// homologadas): R$/MWh com vírgula decimal, datas ISO, "Não se aplica".
const reg = (extra = {}) => ({
  SigAgente: "CPFL-PAULISTA",
  NumCNPJDistribuidora: "33050196000188",
  DscREH: "REH 3.456/2026",
  DatInicioVigencia: "2026-04-08",
  DatFimVigencia: "2027-04-07",
  DscBaseTarifaria: "Tarifa de Aplicação",
  DscSubGrupo: "A4",
  DscModalidadeTarifaria: "Verde",
  DscClasse: "Não se aplica",
  DscSubClasse: "Não se aplica",
  DscDetalhe: "Não se aplica",
  NomPostoTarifario: "Fora ponta",
  DscUnidadeTerciaria: "MWh",
  VlrTUSD: "164,16",
  VlrTE: "272,82",
  DatGeracaoConjuntoDados: "2026-09-12",
  ...extra,
});

describe("números e datas no formato da ANEEL", () => {
  it("converte vírgula decimal e milhar", () => {
    expect(numeroBr("343,25")).toBe(343.25);
    expect(numeroBr("1.234,56")).toBe(1234.56);
    expect(numeroBr(",00")).toBe(0);
    expect(numeroBr("")).toBeNull();
    expect(numeroBr("abc")).toBeNull();
    expect(numeroBr(12.5)).toBe(12.5);
  });

  it("normaliza datas ISO e dd/mm/aaaa", () => {
    expect(dataIso("2026-04-08")).toBe("2026-04-08");
    expect(dataIso("2026-04-08T00:00:00")).toBe("2026-04-08");
    expect(dataIso("08/04/2026")).toBe("2026-04-08");
    expect(dataIso("")).toBe("");
    expect(dataIso("ontem")).toBe("");
  });

  it("mapeia postos tarifários para as faixas do smart charging", () => {
    expect(faixaDoPosto("Ponta")).toBe("ponta");
    expect(faixaDoPosto("Fora ponta")).toBe("fora-ponta");
    expect(faixaDoPosto("Intermediário")).toBe("intermediario");
    expect(faixaDoPosto("Não se aplica")).toBe("unica");
    expect(faixaDoPosto("")).toBe("unica");
  });
});

describe("normalizarTarifaAneel", () => {
  it("soma TUSD + TE em R$/MWh e devolve R$/kWh com a proveniência do registro", () => {
    const linha = normalizarTarifaAneel(reg());
    expect(linha).toMatchObject({ distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde", posto: "Fora ponta", faixa: "fora-ponta", unidade: "MWh", tusdMwh: 164.16, teMwh: 272.82, vigenciaInicio: "2026-04-08", vigenciaFim: "2027-04-07", fonteAtualizadaEm: "2026-09-12" });
    expect(linha.tarifaKwh).toBeCloseTo(0.43698, 5);
  });

  it("registro sem valor tarifário é descartado (null)", () => {
    expect(normalizarTarifaAneel({ SigAgente: "X", VlrTUSD: "", VlrTE: "" })).toBeNull();
    expect(normalizarTarifaAneel({})).toBeNull();
  });
});

describe("selecionarTarifasVigentes", () => {
  const linhas = [
    normalizarTarifaAneel(reg()),
    normalizarTarifaAneel(reg({ NomPostoTarifario: "Ponta", VlrTUSD: "1351,57", VlrTE: "272,82" })),
    // Variante SCEE (geração distribuída) — não deve vencer a linha "Não se aplica".
    normalizarTarifaAneel(reg({ DscDetalhe: "SCEE", VlrTE: "37,36" })),
    // Demanda em kW não é energia: fica fora da curva.
    normalizarTarifaAneel(reg({ NomPostoTarifario: "Não se aplica", DscUnidadeTerciaria: "kW", VlrTUSD: "16,53", VlrTE: ",00" })),
    // Base econômica não vai para a conta.
    normalizarTarifaAneel(reg({ DscBaseTarifaria: "Base Econômica", VlrTUSD: "150,00" })),
    // Ciclo anterior (vencido).
    normalizarTarifaAneel(reg({ DatInicioVigencia: "2025-04-08", DatFimVigencia: "2026-04-07", VlrTUSD: "150,00", VlrTE: "250,00" })),
    normalizarTarifaAneel(reg({ DatInicioVigencia: "2025-04-08", DatFimVigencia: "2026-04-07", NomPostoTarifario: "Ponta", VlrTUSD: "1200,00", VlrTE: "250,00" })),
    // Outra modalidade.
    normalizarTarifaAneel(reg({ DscModalidadeTarifaria: "Azul", VlrTUSD: "90,00" })),
  ];

  it("escolhe só Tarifa de Aplicação em MWh do subgrupo/modalidade, no ciclo vigente, preferindo 'Não se aplica'", () => {
    const r = selecionarTarifasVigentes(linhas, { subgrupo: "A4", modalidade: "Verde", referencia: "2026-09-13" });
    expect(r.vigente).toBe(true);
    expect(r.vigenciaInicio).toBe("2026-04-08");
    expect(r.vigenciaFim).toBe("2027-04-07");
    expect(Object.keys(r.vigentes).sort()).toEqual(["fora-ponta", "ponta"]);
    expect(r.vigentes["fora-ponta"].detalhe).toBe("Não se aplica");
    expect(r.vigentes["fora-ponta"].tarifaKwh).toBeCloseTo(0.43698, 5);
    expect(r.vigentes.ponta.tarifaKwh).toBeCloseTo(1.62439, 5);
    expect(r.fonteAtualizadaEm).toBe("2026-09-12");
  });

  it("referência antes do ciclo atual cai no ciclo vigente naquela data", () => {
    const r = selecionarTarifasVigentes(linhas, { subgrupo: "A4", modalidade: "Verde", referencia: "2025-12-01" });
    expect(r.vigente).toBe(true);
    expect(r.vigenciaInicio).toBe("2025-04-08");
    expect(r.vigentes["fora-ponta"].tarifaKwh).toBeCloseTo(0.4, 5);
  });

  it("sem ciclo vigente na referência usa o mais recente e diz que não está vigente", () => {
    const r = selecionarTarifasVigentes(linhas, { subgrupo: "A4", modalidade: "Verde", referencia: "2030-01-01" });
    expect(r.vigente).toBe(false);
    expect(r.vigenciaInicio).toBe("2026-04-08");
  });

  it("par inexistente devolve vazio, não uma tarifa parecida", () => {
    const r = selecionarTarifasVigentes(linhas, { subgrupo: "B3", modalidade: "Branca" });
    expect(r).toMatchObject({ vigente: false, vigentes: {}, total: 0 });
  });
});

describe("curvaHorariaDePostos", () => {
  const porPosto = { ponta: { tarifaKwh: 1.62439 }, "fora-ponta": { tarifaKwh: 0.43698 } };

  it("aplica ponta/fora nas faixas padrão da tarifa branca e declara a assumption", () => {
    const { curva, base, assumptions } = curvaHorariaDePostos(porPosto);
    expect(curva).toHaveLength(24);
    expect(base).toBeCloseTo(0.43698, 5);
    expect(curva[19]).toMatchObject({ faixa: "ponta", tarifa: 1.62439 });
    expect(curva[3]).toMatchObject({ faixa: "fora-ponta", tarifa: 0.43698 });
    expect(assumptions).toContain("faixas_horarias_padrao_tarifa_branca");
  });

  it("faixas informadas pela distribuidora vencem a régua padrão", () => {
    const { curva, assumptions } = curvaHorariaDePostos(porPosto, { horasPonta: [17, 18, 19], horasIntermediario: [] });
    expect(curva[17].faixa).toBe("ponta");
    expect(curva[20].faixa).toBe("fora-ponta");
    expect(assumptions).toEqual([]);
  });

  it("modalidade sem postos é plana ('unica'); sem nada, curva vazia", () => {
    const plana = curvaHorariaDePostos({ unica: { tarifaKwh: 0.7 } });
    expect(plana.curva.every((p) => p.faixa === "unica" && p.tarifa === 0.7)).toBe(true);
    expect(curvaHorariaDePostos({})).toMatchObject({ curva: [], base: null, assumptions: ["sem_tarifa_por_posto"] });
  });
});

describe("resolverTarifaEnergia — hierarquia contratual > informada > ANEEL > fallback", () => {
  const aneel = { porPosto: { ponta: { tarifaKwh: 1.62439 }, "fora-ponta": { tarifaKwh: 0.43698 } }, vigenciaInicio: "2026-04-08", vigenciaFim: "2027-04-07", fonteAtualizadaEm: "2026-09-12", distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde" };
  const now = Date.parse("2026-09-13T12:00:00Z");

  it("ordem dos níveis é a da consolidação", () => {
    expect(TARIFF_TIERS).toEqual(["contractual", "informed", "aneel", "fallback"]);
    expect(SUBGRUPOS_ANEEL).toContain("A4");
    expect(MODALIDADES_ANEEL).toContain("Branca");
  });

  it("contratual vence tudo e é INFORMED/HIGH", () => {
    const r = resolverTarifaEnergia({ contractual: { tarifaKwh: 0.61, date: "2026-08-01" }, informed: { tarifaKwh: 0.9 }, aneel, fallback: { tarifaKwh: 0.92 } }, { now });
    expect(r.tier).toBe("contractual");
    expect(r.tarifaKwhBase).toBe(0.61);
    expect(r.curva).toHaveLength(24);
    expect(r.provenance).toMatchObject({ measurementType: "INFORMED", confidence: "HIGH", unit: "R$/kWh" });
    expect(r.skipped).toEqual([]);
  });

  it("sem contrato, a ANEEL entra com curva por posto, EXTERNAL e vigência", () => {
    const r = resolverTarifaEnergia({ aneel, fallback: { tarifaKwh: 0.92 } }, { now });
    expect(r.tier).toBe("aneel");
    expect(r.tarifaKwhBase).toBeCloseTo(0.43698, 5);
    expect(r.curva[19].tarifa).toBeCloseTo(1.62439, 5);
    expect(r.stale).toBe(false);
    expect(r.provenance).toMatchObject({ measurementType: "EXTERNAL", confidence: "HIGH", provider: "ANEEL", effectiveAt: "2026-04-08", capturedAt: "2026-09-12" });
    expect(r.skipped).toEqual(["contractual", "informed"]);
    expect(r.detalhe.distribuidora).toBe("CPFL-PAULISTA");
  });

  it("ANEEL com vigência vencida é stale e perde confiança", () => {
    const r = resolverTarifaEnergia({ aneel: { ...aneel, vigenciaFim: "2026-04-07" } }, { now });
    expect(r.tier).toBe("aneel");
    expect(r.stale).toBe(true);
    expect(r.provenance.confidence).toBe("MEDIUM");
  });

  it("informada velha demais fica stale; fallback é DERIVED/LOW e declara a assumption", () => {
    const velha = resolverTarifaEnergia({ informed: { tarifaKwh: 0.8, date: "2024-01-01" } }, { now });
    expect(velha).toMatchObject({ tier: "informed", stale: true });
    expect(velha.provenance.confidence).toBe("LOW");
    const fb = resolverTarifaEnergia({ fallback: { tarifaKwh: 0.92 } }, { now });
    expect(fb).toMatchObject({ tier: "fallback", tarifaKwhBase: 0.92, assumptions: ["tarifa_fallback_configurada"] });
    expect(fb.provenance).toMatchObject({ measurementType: "DERIVED", confidence: "LOW" });
  });

  it("nada disponível → tier null, curva vazia, sem número inventado", () => {
    const r = resolverTarifaEnergia({ informed: { tarifaKwh: 0 }, aneel: { porPosto: {} } }, { now });
    expect(r).toMatchObject({ tier: null, tarifaKwhBase: null, curva: [], assumptions: ["sem_tarifa_disponivel"] });
    expect(r.skipped).toEqual(["contractual", "informed", "aneel", "fallback"]);
    expect(r.provenance.value).toBeNull();
  });
});
