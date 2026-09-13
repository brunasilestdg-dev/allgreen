// ===== Tarifa de energia: ANEEL (referência) + hierarquia + curva horária =====
// Camada PURA e DETERMINÍSTICA. Sem rede, sem banco, sem DOM.
//
// Seções 61–62 da consolidação. A tarifa que alimenta custo/kWh, smart charging
// e TCO vem da MELHOR fonte disponível, nesta ordem, sempre com origem e data:
//
//   tarifa contratual real (conta/contrato com a distribuidora)
//     > tarifa informada pelo cliente/operação
//       > referência ANEEL (tarifas homologadas de aplicação, por distribuidora,
//         subgrupo, modalidade e posto — dados abertos)
//         > fallback configurado
//
// Nada de número fixo escondido no código: o fallback é PARÂMETRO e aparece
// marcado como fallback. A ANEEL publica R$/MWh (TUSD + TE) com vírgula
// decimal; aqui vira R$/kWh e uma curva de 24 h por posto tarifário.

import { CONFIDENCE_LEVELS, MEASUREMENT_TYPES, provenance } from "./dataProvenanceDomain.js";
import { TARIFA_BRANCA_PADRAO } from "./smartChargingDomain.js";

export const TARIFF_TIERS = Object.freeze(["contractual", "informed", "aneel", "fallback"]);

const TIER_META = {
  contractual: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.HIGH, source: "contrato com a distribuidora" },
  informed: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.MEDIUM, source: "informada pela operação" },
  aneel: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.HIGH, source: "ANEEL — tarifas homologadas (dados abertos)" },
  fallback: { measurementType: MEASUREMENT_TYPES.DERIVED, confidence: CONFIDENCE_LEVELS.LOW, source: "fallback configurado" },
};

const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const semAcento = (v) => texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Data da ANEEL → "AAAA-MM-DD" (aceita "AAAA-MM-DD…" e "DD/MM/AAAA"); inválida → "". */
export function dataIso(valor) {
  const s = texto(valor, 30);
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}
const round = (v, c = 4) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** c;
  return Math.round(n * f) / f;
};

/** "343,25" → 343.25; ",00" → 0; "1.234,56" → 1234.56; vazio/inválido → null. */
export function numeroBr(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const s = String(valor).trim();
  if (!s) return null;
  const normalizado = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// Postos tarifários da ANEEL → faixa usada pelo smart charging.
export const POSTO_PARA_FAIXA = Object.freeze({
  "ponta": "ponta",
  "fora ponta": "fora-ponta",
  "intermediario": "intermediario",
  "nao se aplica": "unica",
});

export function faixaDoPosto(posto) {
  const chave = semAcento(posto).replace(/\s+/g, " ");
  return POSTO_PARA_FAIXA[chave] || (chave.includes("ponta") && !chave.includes("fora") ? "ponta" : chave.includes("fora") ? "fora-ponta" : chave.includes("interm") ? "intermediario" : "unica");
}

/**
 * Um registro do datastore da ANEEL → linha normalizada. Preço em R$/kWh =
 * (TUSD + TE) / 1000. Devolve null quando não há valor tarifário.
 */
export function normalizarTarifaAneel(record = {}) {
  const tusd = numeroBr(record.VlrTUSD);
  const te = numeroBr(record.VlrTE);
  if (tusd === null && te === null) return null;
  const totalMwh = (tusd || 0) + (te || 0);
  return {
    distribuidora: texto(record.SigAgente, 40),
    cnpj: texto(record.NumCNPJDistribuidora, 20),
    resolucao: texto(record.DscREH, 200),
    baseTarifaria: texto(record.DscBaseTarifaria, 60),
    subgrupo: texto(record.DscSubGrupo, 20),
    modalidade: texto(record.DscModalidadeTarifaria, 40),
    classe: texto(record.DscClasse, 60),
    subclasse: texto(record.DscSubClasse, 80),
    detalhe: texto(record.DscDetalhe, 80),
    posto: texto(record.NomPostoTarifario, 40),
    faixa: faixaDoPosto(record.NomPostoTarifario),
    unidade: texto(record.DscUnidadeTerciaria, 10) || "MWh",
    tusdMwh: tusd,
    teMwh: te,
    tarifaKwh: round(totalMwh / 1000, 5),
    vigenciaInicio: dataIso(record.DatInicioVigencia),
    vigenciaFim: dataIso(record.DatFimVigencia),
    fonteAtualizadaEm: dataIso(record.DatGeracaoConjuntoDados),
  };
}

/**
 * Filtra as linhas normalizadas para o par subgrupo/modalidade, só "Tarifa de
 * Aplicação" (a que vai para a conta), vigentes na data de referência — ou, se
 * nenhuma vigente, a vigência mais recente. Devolve um mapa posto→linha.
 */
export function selecionarTarifasVigentes(linhas = [], { subgrupo = "", modalidade = "", classe = "", referencia = new Date().toISOString().slice(0, 10) } = {}) {
  const sub = semAcento(subgrupo);
  const mod = semAcento(modalidade);
  const cls = semAcento(classe);
  const candidatas = (Array.isArray(linhas) ? linhas : []).filter((l) => l
    && semAcento(l.baseTarifaria).includes("aplicacao")
    && semAcento(l.unidade || "MWh") === "mwh"
    && (!sub || semAcento(l.subgrupo) === sub)
    && (!mod || semAcento(l.modalidade) === mod)
    && (!cls || semAcento(l.classe) === cls || semAcento(l.classe) === "nao se aplica"));
  if (!candidatas.length) return { vigentes: {}, vigenciaInicio: "", vigenciaFim: "", vigente: false, total: 0 };

  const ref = texto(referencia, 10);
  const vigentes = candidatas.filter((l) => l.vigenciaInicio <= ref && (!l.vigenciaFim || l.vigenciaFim >= ref));
  const base = vigentes.length ? vigentes : candidatas;
  // Vigência mais recente vence (várias resoluções podem coexistir no dump).
  const maisRecente = base.reduce((m, l) => (l.vigenciaInicio > m ? l.vigenciaInicio : m), "");
  const doCiclo = base.filter((l) => l.vigenciaInicio === maisRecente);
  const porPosto = {};
  for (const l of doCiclo) {
    // Sem detalhe específico ("Não se aplica") prevalece sobre variantes.
    const atual = porPosto[l.faixa];
    if (!atual || semAcento(l.detalhe) === "nao se aplica") porPosto[l.faixa] = l;
  }
  return {
    vigentes: porPosto,
    vigenciaInicio: maisRecente,
    vigenciaFim: doCiclo[0]?.vigenciaFim || "",
    vigente: vigentes.length > 0,
    total: candidatas.length,
    fonteAtualizadaEm: doCiclo[0]?.fonteAtualizadaEm || "",
  };
}

/**
 * Curva de 24 h (R$/kWh por hora) a partir das tarifas por posto. As FAIXAS
 * HORÁRIAS são a régua da distribuidora quando informada; senão a padrão da
 * tarifa branca (registrado como assumption). Modalidade sem postos (única) é
 * plana.
 */
export function curvaHorariaDePostos(porPosto = {}, { horasPonta, horasIntermediario } = {}) {
  const ponta = porPosto["ponta"]?.tarifaKwh ?? null;
  const fora = porPosto["fora-ponta"]?.tarifaKwh ?? null;
  const inter = porPosto["intermediario"]?.tarifaKwh ?? null;
  const unica = porPosto["unica"]?.tarifaKwh ?? null;
  const assumptions = [];
  const hp = Array.isArray(horasPonta) && horasPonta.length ? horasPonta : [...TARIFA_BRANCA_PADRAO.horasPonta];
  const hi = Array.isArray(horasIntermediario) ? horasIntermediario : [...TARIFA_BRANCA_PADRAO.horasIntermediario];
  if (!Array.isArray(horasPonta) || !horasPonta.length) assumptions.push("faixas_horarias_padrao_tarifa_branca");

  if (fora === null && ponta === null && unica === null) return { curva: [], base: null, assumptions: ["sem_tarifa_por_posto"] };
  const base = fora ?? unica ?? ponta;
  const curva = Array.from({ length: 24 }, (_, hora) => {
    let faixa = "fora-ponta";
    let tarifa = fora ?? unica ?? ponta;
    if (unica !== null && fora === null && ponta === null) { faixa = "unica"; tarifa = unica; }
    else if (hp.includes(hora) && ponta !== null) { faixa = "ponta"; tarifa = ponta; }
    else if (hi.includes(hora) && inter !== null) { faixa = "intermediario"; tarifa = inter; }
    return { hora, faixa, tarifa: round(tarifa, 5) };
  });
  return { curva, base: round(base, 5), assumptions };
}

/**
 * Hierarquia da tarifa (seção 62). `inputs`:
 *   contractual: { tarifaKwh, curva?, date }   // R$/kWh contratual (pode ter curva)
 *   informed:    { tarifaKwh, date }
 *   aneel:       { porPosto, vigenciaInicio, vigenciaFim, fonteAtualizadaEm, distribuidora, subgrupo, modalidade }
 *   fallback:    { tarifaKwh }
 * Devolve base R$/kWh, curva 24 h, tier, proveniência e o que foi pulado.
 */
export function resolverTarifaEnergia(inputs = {}, { now = Date.now(), staleMs = 400 * 24 * 60 * 60 * 1000, horasPonta, horasIntermediario } = {}) {
  const skipped = [];
  for (const tier of TARIFF_TIERS) {
    const entrada = inputs[tier];
    if (!entrada) { skipped.push(tier); continue; }
    if (tier === "aneel") {
      const curva = curvaHorariaDePostos(entrada.porPosto || {}, { horasPonta, horasIntermediario });
      if (!curva.curva.length || curva.base === null) { skipped.push(tier); continue; }
      const fim = Date.parse(entrada.vigenciaFim || "");
      const stale = Number.isFinite(fim) ? fim + 24 * 60 * 60 * 1000 < now : false;
      const meta = TIER_META.aneel;
      return {
        tier,
        tarifaKwhBase: curva.base,
        curva: curva.curva,
        stale,
        skipped,
        assumptions: curva.assumptions,
        provenance: provenance(curva.base, {
          unit: "R$/kWh",
          source: meta.source,
          sourceType: "gov_api",
          measurementType: meta.measurementType,
          confidence: stale ? CONFIDENCE_LEVELS.MEDIUM : meta.confidence,
          capturedAt: entrada.fonteAtualizadaEm || "",
          effectiveAt: entrada.vigenciaInicio || "",
          method: `ANEEL ${entrada.distribuidora || ""} ${entrada.subgrupo || ""} ${entrada.modalidade || ""}`.trim(),
          assumptions: curva.assumptions,
          provider: "ANEEL",
        }),
        detalhe: { distribuidora: entrada.distribuidora || "", subgrupo: entrada.subgrupo || "", modalidade: entrada.modalidade || "", vigenciaInicio: entrada.vigenciaInicio || "", vigenciaFim: entrada.vigenciaFim || "" },
      };
    }
    const base = Number(entrada.tarifaKwh ?? entrada);
    if (!Number.isFinite(base) || base <= 0) { skipped.push(tier); continue; }
    const meta = TIER_META[tier];
    const curva = Array.isArray(entrada.curva) && entrada.curva.length === 24
      ? entrada.curva
      : Array.from({ length: 24 }, (_, hora) => ({ hora, faixa: "unica", tarifa: round(base, 5) }));
    const data = Date.parse(entrada.date || "");
    const stale = Number.isFinite(data) ? now - data > staleMs : false;
    return {
      tier,
      tarifaKwhBase: round(base, 5),
      curva,
      stale,
      skipped,
      assumptions: tier === "fallback" ? ["tarifa_fallback_configurada"] : [],
      provenance: provenance(round(base, 5), {
        unit: "R$/kWh",
        source: meta.source,
        sourceType: tier === "fallback" ? "config" : "informed",
        measurementType: meta.measurementType,
        confidence: stale ? CONFIDENCE_LEVELS.LOW : meta.confidence,
        capturedAt: entrada.date || "",
      }),
      detalhe: {},
    };
  }
  return { tier: null, tarifaKwhBase: null, curva: [], stale: false, skipped, assumptions: ["sem_tarifa_disponivel"], provenance: provenance(null, { unit: "R$/kWh", measurementType: MEASUREMENT_TYPES.DERIVED }), detalhe: {} };
}

/** Subgrupos/modalidades que a operação escolhe na tela (ANEEL). */
export const SUBGRUPOS_ANEEL = Object.freeze(["A1", "A2", "A3", "A3a", "A4", "AS", "B1", "B2", "B3", "B4a", "B4b"]);
export const MODALIDADES_ANEEL = Object.freeze(["Convencional", "Branca", "Azul", "Verde", "Convencional pré-pagamento"]);
