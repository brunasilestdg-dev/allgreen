// ===== Preço do diesel (ANP) com hierarquia para o TCO =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM, sem IA.
//
// Seção 9: o TCO/payback (elétrico x diesel) não pode depender de preço fixo
// escondido no código. O preço deve vir da MELHOR fonte disponível, nesta
// hierarquia, e mostrar SEMPRE a origem e a data:
//
//   contratual do cliente
//     > preço de frota informado
//       > ANP municipal
//         > ANP estadual
//           > ANP regional
//             > ANP nacional
//               > fallback configurado
//
// A ingestão periódica da ANP (cron) alimenta os níveis municipal/estadual/
// regional/nacional; enquanto a fonte não está conectada, o resolvedor cai para
// o próximo nível disponível e marca a proveniência — nunca finge preço atual
// nem apresenta estimativa como medição (seções 14, 53).

import { provenance, MEASUREMENT_TYPES, CONFIDENCE_LEVELS, isStale } from "./dataProvenanceDomain.js";

// Ordem da hierarquia (índice menor = mais forte).
export const DIESEL_PRICE_TIERS = Object.freeze([
  "contractual",   // preço de contrato do cliente
  "fleet",         // preço de frota informado
  "anp_municipal",
  "anp_state",
  "anp_region",
  "anp_national",
  "fallback",
]);

const TIER_META = {
  contractual: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.HIGH, source: "contrato" },
  fleet: { measurementType: MEASUREMENT_TYPES.INFORMED, confidence: CONFIDENCE_LEVELS.HIGH, source: "frota" },
  anp_municipal: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.HIGH, source: "ANP município" },
  anp_state: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.MEDIUM, source: "ANP estado" },
  anp_region: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.MEDIUM, source: "ANP região" },
  anp_national: { measurementType: MEASUREMENT_TYPES.EXTERNAL, confidence: CONFIDENCE_LEVELS.LOW, source: "ANP nacional" },
  fallback: { measurementType: MEASUREMENT_TYPES.DERIVED, confidence: CONFIDENCE_LEVELS.LOW, source: "fallback configurado" },
};

const price = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Resolve o preço do diesel pela hierarquia. `inputs` traz, por nível, um
 * objeto { price, date } (ou só um número). Devolve o envelope de proveniência
 * do nível escolhido + o tier + os níveis que foram pulados por não ter valor.
 *
 * @param {object} inputs  ex.: { contractual:{price,date}, anp_municipal:{...}, ... }
 * @param {object} options { staleMs, now } — marca o preço como stale se velho.
 */
export function resolveDieselPrice(inputs = {}, options = {}) {
  const skipped = [];
  for (const tier of DIESEL_PRICE_TIERS) {
    const raw = inputs[tier];
    const value = price(typeof raw === "object" && raw !== null ? raw.price : raw);
    if (value === null) {
      if (raw !== undefined) skipped.push({ tier, reason: "sem_valor" });
      continue;
    }
    const meta = TIER_META[tier];
    const capturedAt = typeof raw === "object" && raw !== null ? (raw.date || raw.capturedAt || "") : "";
    const env = provenance(value, {
      unit: "R$/L",
      source: meta.source,
      sourceType: tier.startsWith("anp") ? "gov_api" : (tier === "fallback" ? "config" : "informed"),
      measurementType: meta.measurementType,
      confidence: meta.confidence,
      capturedAt,
      method: `hierarquia_diesel:${tier}`,
      provider: tier.startsWith("anp") ? "ANP" : "",
    });
    const stale = isStale(env, { maxAgeMs: options.staleMs, now: options.now });
    return {
      resolved: true,
      tier,
      priceRs: value,
      stale,
      provenance: env,
      skipped,
    };
  }
  return { resolved: false, tier: null, priceRs: null, stale: false, provenance: null, skipped, reason: "sem_preco_disponivel" };
}

// Comparação elétrico x diesel por km, para o TCO (seção 9). Não inventa: exige
// os dois custos por km; devolve economia e % ou marca o que falta.
export function dieselVsElectricPerKm({ dieselPrice, dieselConsumptionLPerKm, energyPricePerKwh, energyConsumptionKwhPerKm } = {}) {
  const dp = price(dieselPrice);
  const dc = Number(dieselConsumptionLPerKm);
  const ep = price(energyPricePerKwh);
  const ec = Number(energyConsumptionKwhPerKm);
  const faltando = [];
  if (dp === null) faltando.push("dieselPrice");
  if (!(dc > 0)) faltando.push("dieselConsumptionLPerKm");
  if (ep === null) faltando.push("energyPricePerKwh");
  if (!(ec > 0)) faltando.push("energyConsumptionKwhPerKm");
  if (faltando.length) return { comparable: false, faltando };

  const dieselPerKm = dp * dc;
  const electricPerKm = ep * ec;
  const savingPerKm = dieselPerKm - electricPerKm;
  const savingPercent = dieselPerKm > 0 ? (savingPerKm / dieselPerKm) * 100 : 0;
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    comparable: true,
    dieselPerKm: round(dieselPerKm),
    electricPerKm: round(electricPerKm),
    savingPerKm: round(savingPerKm),
    savingPercent: Math.round(savingPercent * 10) / 10,
    electricCheaper: savingPerKm > 0,
  };
}

// ===== Ingestão da ANP: CSV do Levantamento de Preços (série/últimas semanas) =====
// A ANP publica o levantamento semanal por revenda em CSV (`;`, vírgula
// decimal, datas dd/mm/aaaa, UTF-8 com BOM): "Regiao - Sigla;Estado - Sigla;
// Municipio;Revenda;CNPJ da Revenda;...;Produto;Data da Coleta;Valor de Venda;
// Valor de Compra;Unidade de Medida;Bandeira". Aqui o arquivo vira registros
// normalizados e, depois, a MEDIANA por município/UF/região/país por semana de
// coleta — é isso que alimenta os níveis anp_* da hierarquia acima. Nada de
// endereço/CNPJ de posto fica retido: só o agregado.

export const ANP_PRODUTOS = Object.freeze({
  "DIESEL": "diesel",
  "DIESEL S10": "diesel_s10",
  "DIESEL S500": "diesel",
  "GNV": "gnv",
  "GASOLINA": "gasolina",
  "GASOLINA ADITIVADA": "gasolina_aditivada",
  "ETANOL": "etanol",
  "GLP": "glp",
});
export const ANP_NIVEIS = Object.freeze(["municipal", "estadual", "regional", "nacional"]);
export const ANP_PRODUTO_PADRAO = "diesel_s10";

const semAcento = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const chaveNormalizada = (v) => semAcento(v).toUpperCase().replace(/\s+/g, " ");
const numBr = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dataBr = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? "").trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "").trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

/** Segunda-feira (ISO) da semana da data — chave de agregação semanal. */
export function semanaDeColeta(dataIso) {
  const t = Date.parse(`${dataIso}T00:00:00Z`);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const indice = (cabecalho, ...prefixos) => cabecalho.findIndex((c) => prefixos.some((p) => c.startsWith(p)));

/**
 * CSV da ANP → registros { regiao, uf, municipio, produto, coleta, valorVenda }.
 * `produtos` filtra pelos slugs de ANP_PRODUTOS (padrão: os dois dieseis).
 */
export function parseAnpPrecosCsv(csvText = "", { produtos = ["diesel", "diesel_s10"], max = 400000 } = {}) {
  const linhas = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const primeira = linhas.findIndex((l) => l.trim());
  if (primeira < 0 || linhas.length - primeira < 2) return { ok: false, reason: "ANP_CSV_VAZIO", registros: [], total: 0, ignorados: 0 };
  const cabecalho = linhas[primeira].split(";").map((c) => semAcento(c).toLowerCase());
  const iRegiao = indice(cabecalho, "regiao");
  const iUf = indice(cabecalho, "estado");
  const iMun = indice(cabecalho, "municipio");
  const iProd = indice(cabecalho, "produto");
  const iData = indice(cabecalho, "data da coleta", "data");
  const iValor = indice(cabecalho, "valor de venda", "preco de venda", "valor venda");
  if ([iUf, iMun, iProd, iData, iValor].some((i) => i < 0)) return { ok: false, reason: "ANP_CSV_CABECALHO_DESCONHECIDO", registros: [], total: 0, ignorados: 0, cabecalho };
  const aceitos = new Set((Array.isArray(produtos) && produtos.length ? produtos : Object.values(ANP_PRODUTOS)).map(String));
  const registros = [];
  let ignorados = 0;
  let total = 0;
  for (let i = primeira + 1; i < linhas.length && registros.length < max; i += 1) {
    if (!linhas[i].trim()) continue;
    total += 1;
    const cols = linhas[i].split(";");
    const produto = ANP_PRODUTOS[chaveNormalizada(cols[iProd])];
    const coleta = dataBr(cols[iData]);
    const valorVenda = numBr(cols[iValor]);
    const uf = chaveNormalizada(cols[iUf]).slice(0, 2);
    const municipio = chaveNormalizada(cols[iMun]).slice(0, 80);
    if (!produto || !aceitos.has(produto) || !coleta || valorVenda === null || uf.length !== 2 || !municipio) { ignorados += 1; continue; }
    registros.push({ regiao: iRegiao >= 0 ? chaveNormalizada(cols[iRegiao]).slice(0, 2) : "", uf, municipio, produto, coleta, valorVenda });
  }
  if (!registros.length) return { ok: false, reason: "ANP_SEM_REGISTROS_DOS_PRODUTOS", registros: [], total, ignorados };
  return { ok: true, registros, total, ignorados, cabecalho };
}

const mediana = (valores) => {
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
};
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Registros → agregados por (produto, nível, chave, semana): mediana, média,
 * mín/máx, amostras e o intervalo de coleta. Chaves: municipal `UF/MUNICIPIO`,
 * estadual `UF`, regional `REGIAO`, nacional `BR`.
 */
export function agregarPrecosAnp(registros = []) {
  const grupos = new Map();
  const add = (nivel, chave, r) => {
    const semana = semanaDeColeta(r.coleta);
    if (!semana || !chave) return;
    const k = `${r.produto}|${nivel}|${chave}|${semana}`;
    let g = grupos.get(k);
    if (!g) { g = { produto: r.produto, nivel, chave, semana, valores: [], coletaInicio: r.coleta, coletaFim: r.coleta }; grupos.set(k, g); }
    g.valores.push(r.valorVenda);
    if (r.coleta < g.coletaInicio) g.coletaInicio = r.coleta;
    if (r.coleta > g.coletaFim) g.coletaFim = r.coleta;
  };
  for (const r of registros || []) {
    if (!r || !r.produto || !(r.valorVenda > 0)) continue;
    add("municipal", `${r.uf}/${r.municipio}`, r);
    add("estadual", r.uf, r);
    if (r.regiao) add("regional", r.regiao, r);
    add("nacional", "BR", r);
  }
  return [...grupos.values()].map((g) => ({
    produto: g.produto,
    nivel: g.nivel,
    chave: g.chave,
    semana: g.semana,
    mediana: r3(mediana(g.valores)),
    media: r3(g.valores.reduce((s, v) => s + v, 0) / g.valores.length),
    minimo: r3(Math.min(...g.valores)),
    maximo: r3(Math.max(...g.valores)),
    amostras: g.valores.length,
    coletaInicio: g.coletaInicio,
    coletaFim: g.coletaFim,
  })).sort((a, b) => a.produto.localeCompare(b.produto) || ANP_NIVEIS.indexOf(a.nivel) - ANP_NIVEIS.indexOf(b.nivel) || a.chave.localeCompare(b.chave) || b.semana.localeCompare(a.semana));
}

/**
 * Dos agregados (a semana mais recente de cada chave), monta os níveis anp_*
 * para `resolveDieselPrice`, a partir do município/UF/região do espaço.
 */
export function niveisAnpParaResolver(agregados = [], { produto = ANP_PRODUTO_PADRAO, uf = "", municipio = "", regiao = "" } = {}) {
  const alvo = String(produto || ANP_PRODUTO_PADRAO);
  const ufN = chaveNormalizada(uf).slice(0, 2);
  const munN = chaveNormalizada(municipio);
  const regN = chaveNormalizada(regiao).slice(0, 2);
  const maisRecente = (nivel, chave) => (agregados || [])
    .filter((a) => a.produto === alvo && a.nivel === nivel && (!chave || a.chave === chave))
    .sort((a, b) => b.semana.localeCompare(a.semana))[0] || null;
  const envelope = (a) => (a ? { price: a.mediana, date: a.coletaFim, amostras: a.amostras, chave: a.chave, semana: a.semana } : undefined);
  return {
    anp_municipal: ufN && munN ? envelope(maisRecente("municipal", `${ufN}/${munN}`)) : undefined,
    anp_state: ufN ? envelope(maisRecente("estadual", ufN)) : undefined,
    anp_region: regN ? envelope(maisRecente("regional", regN)) : undefined,
    anp_national: envelope(maisRecente("nacional", "BR")),
  };
}
