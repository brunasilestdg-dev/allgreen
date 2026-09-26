// ===== Sinal de mercado (market_signal) =====
// Camada PURA e DETERMINÍSTICA. Sem rede, sem banco, sem DOM, sem IA.
//
// Seções 66–70 da consolidação. Um SINAL é uma oportunidade ou notícia vinda de
// uma fonte estruturada — PNCP (API pública de licitações), Compras.gov.br
// (contratações federais), GDELT (notícias) ou a busca web do radar — já
// normalizada num único formato, com FINGERPRINT determinístico (dedupe entre
// fontes e execuções) e SCORE EXPLICÁVEL: cada ponto tem um motivo em
// português; o que não serve é rejeitado com o motivo, não escondido.
//
// O léxico de transporte/eletrificação/fora-de-escopo mora aqui e é o mesmo do
// radar (worker/services/todogreen-market-radar.js importa daqui) — uma régua só.

export const SIGNAL_SOURCES = Object.freeze({ pncp: "PNCP", "compras-gov": "Compras.gov.br", gdelt: "GDELT", web: "Busca web" });
export const SIGNAL_KINDS = Object.freeze(["licitacao", "noticia"]);
export const SIGNAL_STATUS = Object.freeze(["new", "triaged", "dismissed", "converted"]);
export const MARKET_SIGNAL_VERSION = "market-signal@1.0.0";

export const clean = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const fold = (value) => clean(value, 6000).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const includesAny = (text, terms) => terms.some((term) => text.includes(fold(term)));

export const TERMOS = Object.freeze({
  TRANSPORT: Object.freeze(["transporte", "transportadora", "transportadoras", "logistica", "frete", "fretes", "frota", "last mile", "middle mile", "first mile", "line haul", "transferencia", "distribuicao", "entrega", "entregas", "carrier", "transportation", "freight", "delivery", "cross docking", "coleta e entrega", "cargas"]),
  STRONG_FIT: Object.freeze(["last mile", "middle mile", "first mile", "transferencia", "distribuicao", "dedicada", "dedicado", "ship from store", "same day", "cross docking", "coleta", "abastecimento de lojas", "transporte de cargas", "transporte rodoviario de cargas"]),
  ELECTRIC: Object.freeze(["eletrico", "eletrica", "eletricos", "eletricas", "zero emissao", "zero emission", "descarbonizacao", "baixo carbono", "sustentavel", "veiculo eletrico", "ev fleet", "escopo 3", "eletrificacao", "recarga"]),
  FLEET: Object.freeze(["moto", "motocicleta", "van", "vuc", "3/4", "toco", "caminhao", "caminhoes", "carreta", "truck", "utilitario"]),
  UNSUPPORTED: Object.freeze(["bitrem", "bi-trem", "bi trem", "rodotrem", "rodo-trem", "rodo trem"]),
  CLOSED: Object.freeze(["encerrada", "encerrado", "finalizada", "finalizado", "homologada", "homologado", "adjudicada", "adjudicado", "resultado final", "processo concluido", "closed tender", "award notice", "revogada", "anulada", "fracassada", "deserta"]),
  // Contratação cujo OBJETO não é serviço de transporte de carga, mesmo citando
  // "frota"/"veículos"/"transporte" de passagem. A To Do Green vende transporte B2B.
  OFF_SCOPE: Object.freeze([
    "seguro de veiculo", "seguro de veiculos", "seguro da frota", "seguro frota", "seguro auto", "apolice",
    "pavimentacao", "recapeamento", "terraplanagem", "sinalizacao viaria", "obra de engenharia", "obras de engenharia",
    "construcao civil", "reforma predial", "manutencao predial", "vigilancia patrimonial", "limpeza predial", "limpeza urbana",
    "coleta de residuos", "residuos solidos", "coleta de lixo", "transporte de residuos",
    "fornecimento de combustivel", "aquisicao de combustivel", "aquisicao de pneus", "fornecimento de pneus",
    "fornecimento de pecas", "aquisicao de pecas", "aquisicao de veiculo", "aquisicao de veiculos", "compra de veiculos",
    "merenda escolar", "transporte escolar", "transporte de pacientes", "transporte de servidores",
    "auto eletrica", "borracharia", "alinhamento e balanceamento", "manutencao de veiculos", "manutencao da frota",
  ]),
});
export const foraDoEscopoDeTransporte = (texto) => includesAny(fold(texto), TERMOS.OFF_SCOPE);

export const canonicalUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach((key) => url.searchParams.delete(key));
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
};

// FNV-1a 32 bits, duas passadas com sal → 16 hex; determinístico e barato.
const fnv1a = (str, seed = 0x811c9dc5) => {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
};
/** Identidade estável do sinal: id externo da fonte > URL canônica > título dobrado. */
export function fingerprintDeSinal({ source = "", externalId = "", url = "", title = "" } = {}) {
  const src = fold(source) || "web";
  const base = clean(externalId, 200) ? `${src}|id:${clean(externalId, 200).toLowerCase()}`
    : canonicalUrl(url) ? `${src}|url:${canonicalUrl(url).toLowerCase()}`
      : `${src}|t:${fold(title).slice(0, 300)}`;
  return `${fnv1a(base)}${fnv1a(`${base}|tdg`, 0x9747b28c)}`;
}

const iso = (value, fuso = "Z") => {
  const s = clean(value, 40);
  if (!s) return "";
  const gdelt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
  if (gdelt) return `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}.000Z`;
  // O PNCP publica horários civis de Brasília sem offset no texto. Nunca
  // deixar o fuso da máquina que executa o Worker decidir o prazo.
  const data = s.length === 10 ? `${s}T00:00:00` : s;
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(data) ? data : `${data}${fuso}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};
const positivo = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export const MODALIDADES_PNCP = Object.freeze({ 1: "Leilão - Eletrônico", 2: "Diálogo Competitivo", 3: "Concurso", 4: "Concorrência - Eletrônica", 5: "Concorrência - Presencial", 6: "Pregão - Eletrônico", 7: "Pregão - Presencial", 8: "Dispensa", 9: "Inexigibilidade", 10: "Manifestação de Interesse", 11: "Pré-qualificação", 12: "Credenciamento", 13: "Leilão - Presencial" });

/** "01612441000107-1-000131/2026" → URL do processo no portal do PNCP. */
export function urlDoProcessoPncp(numeroControle, fallback = "") {
  const m = /^(\d{14})-\d-(\d+)\/(\d{4})$/.exec(clean(numeroControle, 40));
  if (!m) return canonicalUrl(fallback);
  return `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${String(Number(m[2]))}`;
}

const sinalBase = (extra) => ({
  version: MARKET_SIGNAL_VERSION, source: "web", kind: "licitacao", externalId: "", title: "", summary: "", url: "",
  orgao: "", uf: "", municipio: "", esfera: "", modalidade: "", situacao: "", valorEstimado: null,
  publicadoEm: "", prazoProposta: "", dominio: "", idioma: "", ...extra,
});

/** Contratação da API de consulta do PNCP OU do Compras.gov (campos equivalentes). */
export function normalizarContratacaoPncp(item = {}, { source = "pncp" } = {}) {
  const numeroControle = clean(item.numeroControlePNCP, 40);
  const orgao = item.orgaoEntidade?.razaoSocial || item.orgaoEntidadeRazaoSocial || "";
  const uf = item.unidadeOrgao?.ufSigla || item.unidadeOrgaoUfSigla || "";
  const municipio = item.unidadeOrgao?.municipioNome || item.unidadeOrgaoMunicipioNome || "";
  const modalidadeId = item.modalidadeId ?? item.modalidadeIdPncp;
  const modalidade = item.modalidadeNome || MODALIDADES_PNCP[Number(modalidadeId)] || "";
  const situacao = item.situacaoCompraNome || item.situacaoCompraNomePncp || "";
  const sinal = sinalBase({
    source, kind: "licitacao", externalId: numeroControle,
    title: clean(item.objetoCompra, 200) || `Contratação ${numeroControle}`,
    summary: clean(item.objetoCompra, 900) + (item.informacaoComplementar ? ` — ${clean(item.informacaoComplementar, 300)}` : ""),
    url: urlDoProcessoPncp(numeroControle, item.linkSistemaOrigem || ""),
    orgao: clean(orgao, 160), uf: clean(uf, 2).toUpperCase(), municipio: clean(municipio, 80),
    esfera: clean(item.orgaoEntidade?.esferaId || item.orgaoEntidadeEsferaId, 2), modalidade: clean(modalidade, 60), situacao: clean(situacao, 60),
    valorEstimado: positivo(item.valorTotalEstimado),
    publicadoEm: iso(item.dataPublicacaoPncp, "-03:00"), prazoProposta: iso(item.dataEncerramentoProposta || item.dataEncerramentoPropostaPncp, "-03:00"),
  });
  return { ...sinal, fingerprint: fingerprintDeSinal(sinal) };
}

/** Item da API de busca do portal do PNCP (/api/search). */
export function normalizarBuscaPncp(item = {}) {
  const numeroControle = clean(item.numero_controle_pncp, 40);
  const sinal = sinalBase({
    source: "pncp", kind: "licitacao", externalId: numeroControle || clean(item.id, 64),
    title: clean(item.description, 200) || clean(item.title, 200),
    summary: clean(item.description, 900),
    url: urlDoProcessoPncp(numeroControle, item.item_url ? `https://pncp.gov.br/app/editais${String(item.item_url).replace(/^\/compras/, "")}` : ""),
    orgao: clean(item.orgao_nome, 160), uf: clean(item.uf, 2).toUpperCase(), municipio: clean(item.municipio_nome, 80),
    esfera: clean(item.esfera_id, 2), modalidade: clean(item.modalidade_licitacao_nome, 60), situacao: clean(item.situacao_nome, 60),
    valorEstimado: positivo(item.valor_global),
    publicadoEm: iso(item.data_publicacao_pncp, "-03:00"), prazoProposta: iso(item.data_fim_vigencia, "-03:00"),
  });
  return { ...sinal, fingerprint: fingerprintDeSinal(sinal) };
}

/** Artigo do GDELT DOC 2.0 (mode=artlist, format=json). */
export function normalizarArtigoGdelt(article = {}) {
  const url = canonicalUrl(article.url);
  const sinal = sinalBase({
    source: "gdelt", kind: "noticia", externalId: "", title: clean(article.title, 200), summary: "", url,
    dominio: clean(article.domain, 120), idioma: clean(article.language, 30), uf: "", publicadoEm: iso(article.seendate),
    orgao: clean(article.sourcecountry, 60),
  });
  return { ...sinal, fingerprint: fingerprintDeSinal(sinal) };
}

const DIA = 24 * 60 * 60 * 1000;

/**
 * Score explicável (0–100) + motivo de rejeição. `ufsFoco` são as UFs de
 * operação do espaço (bônus pequeno, não filtro).
 */
export function pontuarSinal(sinal = {}, { agora = Date.now(), ufsFoco = [] } = {}) {
  const t = fold(`${sinal.title || ""} ${sinal.summary || ""}`);
  const reasons = [];
  const now = new Date(agora).getTime();
  const rejeitar = (motivo) => ({ score: 0, reasons: [], rejected: motivo });
  if (includesAny(t, TERMOS.UNSUPPORTED)) return rejeitar("equipamento_incompativel");
  if (includesAny(t, TERMOS.OFF_SCOPE)) return rejeitar("fora_do_escopo");
  const temTransporte = includesAny(t, TERMOS.TRANSPORT);
  const temEletrico = includesAny(t, TERMOS.ELECTRIC);
  if (sinal.kind === "licitacao") {
    if (!temTransporte) return rejeitar("sem_transporte");
    if (includesAny(fold(sinal.situacao || ""), TERMOS.CLOSED) || includesAny(t, TERMOS.CLOSED)) return rejeitar("processo_encerrado");
    const prazo = Date.parse(sinal.prazoProposta || "");
    if (Number.isFinite(prazo) && prazo < now) return rejeitar("prazo_encerrado");
  } else if (!temTransporte && !temEletrico) return rejeitar("sem_relevancia");

  let score = sinal.kind === "licitacao" ? 30 : 15;
  reasons.push(sinal.kind === "licitacao" ? `fonte estruturada de contratação (${SIGNAL_SOURCES[sinal.source] || sinal.source})` : "notícia de fonte monitorada (GDELT)");
  if (includesAny(t, TERMOS.STRONG_FIT)) { score += 25; reasons.push("objeto aderente a transporte de cargas / first-middle-last mile"); }
  else if (temTransporte) { score += 10; reasons.push("menciona transporte/logística"); }
  if (temEletrico) { score += 20; reasons.push("eletrificação, baixa emissão ou descarbonização"); }
  if (includesAny(t, TERMOS.FLEET)) { score += 10; reasons.push("classe de veículo compatível citada"); }
  const prazo = Date.parse(sinal.prazoProposta || "");
  if (sinal.kind === "licitacao" && Number.isFinite(prazo)) {
    const dias = (prazo - now) / DIA;
    if (dias >= 3) { score += 15; reasons.push(`propostas abertas por mais ${Math.floor(dias)} dia(s)`); }
    else { score += 5; reasons.push("prazo de proposta termina em menos de 3 dias (urgente)"); }
  }
  const pub = Date.parse(sinal.publicadoEm || "");
  if (Number.isFinite(pub) && now - pub <= 7 * DIA) { score += 10; reasons.push("publicado nos últimos 7 dias"); }
  const ufs = (ufsFoco || []).map((u) => clean(u, 2).toUpperCase()).filter(Boolean);
  if (ufs.length && sinal.uf && ufs.includes(sinal.uf)) { score += 5; reasons.push(`UF de operação (${sinal.uf})`); }
  if (sinal.valorEstimado >= 100000) { score += 5; reasons.push("valor estimado relevante (≥ R$ 100 mil)"); }
  return { score: Math.min(100, score), reasons, rejected: "" };
}

/** Dedupe por fingerprint (maior score vence; contagem de vezes visto soma). */
export function dedupeSinais(sinais = []) {
  const mapa = new Map();
  for (const s of sinais || []) {
    if (!s?.fingerprint) continue;
    const atual = mapa.get(s.fingerprint);
    if (!atual) { mapa.set(s.fingerprint, { ...s, seenCount: s.seenCount || 1 }); continue; }
    const vencedor = (s.score ?? 0) > (atual.score ?? 0) ? s : atual;
    mapa.set(s.fingerprint, { ...vencedor, seenCount: (atual.seenCount || 1) + (s.seenCount || 1), sources: [...new Set([...(atual.sources || [atual.source]), s.source])] });
  }
  return [...mapa.values()];
}

/** Normalizados → pontuados, deduplicados e ordenados; rejeições contadas por motivo. */
export function classificarSinais(sinais = [], opts = {}) {
  const rejeitados = {};
  const aceitos = [];
  for (const s of sinais || []) {
    const p = pontuarSinal(s, opts);
    if (p.rejected) { rejeitados[p.rejected] = (rejeitados[p.rejected] || 0) + 1; continue; }
    aceitos.push({ ...s, score: p.score, scoreReasons: p.reasons });
  }
  const unicos = dedupeSinais(aceitos);
  const antes = aceitos.length;
  if (antes > unicos.length) rejeitados.duplicado = (rejeitados.duplicado || 0) + (antes - unicos.length);
  unicos.sort((a, b) => (b.score - a.score) || String(b.publicadoEm).localeCompare(String(a.publicadoEm)) || a.title.localeCompare(b.title, "pt-BR"));
  return { aceitos: unicos, rejeitados };
}
