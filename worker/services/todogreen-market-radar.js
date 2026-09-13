import { searchWeb, webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { podeNaVertical } from "./todogreen-access.js";
import { limparResumoDeBusca } from "../../src/features/logistics/noticiaDomain.js";
import {
  TERMOS,
  canonicalUrl,
  clean,
  fold,
  foraDoEscopoDeTransporte,
  includesAny,
} from "../../src/features/logistics/marketSignalDomain.js";

// O léxico de transporte/eletrificação/fora-de-escopo/encerrado mora em
// marketSignalDomain (a mesma régua dos sinais estruturados PNCP/Compras/GDELT).
// Aqui ficam só os termos próprios da BUSCA WEB: vaga, conteúdo educativo,
// sinais de abertura/ação e o tipo de processo.
const { CLOSED, TRANSPORT, ELECTRIC, STRONG_FIT, FLEET, UNSUPPORTED, OFF_SCOPE } = TERMOS;
export { foraDoEscopoDeTransporte };

const VACANCY = ["vaga", "vagas", "career", "careers", "emprego", "empregos", "job", "jobs", "hiring", "recrutamento", "talentos", "comprador de fretes"];
const EDUCATIONAL = ["o que e rfq", "o que e rfi", "o que e rfp", "what is rfq", "what is rfi", "what is rfp", "modelo de rfq", "template rfq", "guia de rfq", "curso", "glossario"];
const OPEN = ["aberta", "aberto", "publicada", "publicado", "prazo", "data limite", "recebimento de propostas", "envio de propostas", "envie sua proposta", "participe", "inscricoes", "cadastro", "credenciamento", "submission deadline", "open tender", "open for bids", "bid deadline", "proposal deadline", "closing date"];
const ACTION = ["portal", "proposta", "propostas", "inscreva", "cadastre", "cadastro", "submeta", "envie", "documentos", "participar", "participacao", "edital", "termo de referencia", "submission", "register", "bid"];

const TYPE_RULES = [
  ["RFI", [" rfi ", "request for information", "solicitacao de informacoes"]],
  ["RFQ", [" rfq ", "request for quotation", "solicitacao de cotacao", "cotacao de frete", "cotacao transporte"]],
  ["RFP", [" rfp ", "request for proposal", "solicitacao de proposta"]],
  ["Licitação", ["licitacao", "edital", "pregao", "aviso de contratacao", "chamamento publico"]],
  ["Concorrência", ["concorrencia", "tender", "bid invitation", "invitation to bid"]],
];

const procurementType = (text) => {
  const padded = ` ${text} `;
  for (const [label, terms] of TYPE_RULES) if (terms.some((term) => padded.includes(fold(term)))) return label;
  return "";
};

const sourceClass = (url, planSource = "") => {
  const value = fold(url);
  if (value.includes("pncp.gov.br")) return "PNCP";
  if (value.includes("compras.gov.br") || value.includes("gov.br/compras")) return "Compras.gov.br";
  if (value.includes("gov.br") || value.includes(".gov.br")) return "Portal público";
  if (planSource === "private-market") return "Mercado privado";
  return "Web pública";
};

const extractDeadline = (text) => {
  const value = clean(text, 4000);
  const numeric = value.match(/\b([0-3]?\d)[/.-]([01]?\d)[/.-](20\d{2})\b/);
  if (numeric) return `${numeric[1].padStart(2, "0")}/${numeric[2].padStart(2, "0")}/${numeric[3]}`;
  const iso = value.match(/\b(20\d{2})-([01]\d)-([0-3]\d)\b/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : "";
};

const fitForTodoGreen = (text) => {
  let score = 45;
  const reasons = ["escopo de transporte/logística"];
  if (includesAny(text, STRONG_FIT)) { score += 20; reasons.push("produto aderente a first, middle ou last mile"); }
  if (includesAny(text, ELECTRIC)) { score += 25; reasons.push("eletrificação, baixa emissão ou descarbonização"); }
  if (includesAny(text, FLEET)) { score += 8; reasons.push("classe de veículo compatível para avaliação"); }
  if (/\bsao paulo\b|\bsp\b|grande sao paulo|cajamar|guarulhos|osasco/.test(text)) { score += 7; reasons.push("sinal de operação em São Paulo"); }
  return { score: Math.min(100, score), reasons };
};

const confidenceFor = ({ text, source, url }) => {
  let score = 45;
  if (["PNCP", "Compras.gov.br", "Portal público"].includes(source)) score += 25;
  if (includesAny(text, OPEN)) score += 15;
  if (includesAny(text, ACTION)) score += 10;
  if (canonicalUrl(url)) score += 5;
  const value = Math.min(100, score);
  return { score: value, label: value >= 85 ? "alta" : value >= 65 ? "média" : "validar" };
};

export function buildMarketRadarPlans({ query = "", company = "", year = new Date().getUTCFullYear() } = {}) {
  const extra = clean(query, 120);
  const companyTerm = clean(company, 120);
  const focus = [companyTerm && `"${companyTerm}"`, extra].filter(Boolean).join(" ");
  const negative = "-vaga -vagas -emprego -empregos -jobs -career -carreira -bitrem -rodotrem -seguro -pavimentação -\"transporte escolar\"";
  const transport = '(transporte OR transportadora OR logística OR frete OR "last mile" OR "middle mile" OR distribuição)';
  const procurement = '(RFQ OR RFI OR RFP OR licitação OR edital OR concorrência OR cotação OR tender)';
  const open = '(aberta OR aberto OR prazo OR proposta OR propostas OR edital OR portal OR "submission deadline")';
  return [
    { id: "pncp", source: "pncp", label: "PNCP", query: clean(`site:pncp.gov.br ${focus} ${transport} (edital OR licitação OR "aviso de contratação" OR concorrência) ${open} ${year} ${negative}`) },
    { id: "compras-gov", source: "compras-gov", label: "Compras.gov.br", query: clean(`(site:gov.br/compras OR site:dadosabertos.compras.gov.br) ${focus} ${transport} (licitação OR edital OR pregão OR concorrência) ${open} ${year} ${negative}`) },
    { id: "private-market", source: "private-market", label: "Mercado privado", query: clean(`${focus} Brasil ${procurement} ${transport} ${open} ${year} ${negative}`) },
    { id: "private-market-en", source: "private-market", label: "Mercado privado internacional no Brasil", query: clean(`${focus} Brazil ("request for quotation" OR "request for information" OR "request for proposal" OR tender OR "bid invitation") (transportation OR logistics OR freight OR carrier OR "last mile") (open OR deadline OR proposal OR submission) ${year} ${negative}`) },
  ];
}

export function classifyMarketRadarResults(searches = [], { now = new Date() } = {}) {
  const seen = new Set();
  const rejected = { vacancies: 0, educational: 0, closed: 0, nonTransport: 0, nonProcurement: 0, notOpen: 0, incompatibleFleet: 0, duplicate: 0 };
  const opportunities = [];
  for (const search of searches || []) {
    const plan = search?.plan || {};
    for (const item of search?.results || []) {
      const url = canonicalUrl(item?.url);
      if (!url) continue;
      if (seen.has(url)) { rejected.duplicate += 1; continue; }
      seen.add(url);
      const raw = `${item?.title || ""} ${item?.snippet || item?.description || ""} ${url}`;
      const text = fold(raw);
      if (includesAny(text, VACANCY)) { rejected.vacancies += 1; continue; }
      if (includesAny(text, EDUCATIONAL)) { rejected.educational += 1; continue; }
      // Sinal de encerramento vence sinal de abertura: "resultado final publicado"
      // contém "publicado" (lista OPEN) e escapava daqui quando as duas listas
      // eram exigidas ao mesmo tempo — processo morto virando oportunidade.
      if (includesAny(text, CLOSED)) { rejected.closed += 1; continue; }
      if (includesAny(text, UNSUPPORTED)) { rejected.incompatibleFleet += 1; continue; }
      if (includesAny(text, OFF_SCOPE)) { rejected.nonTransport += 1; continue; }
      if (!includesAny(text, TRANSPORT)) { rejected.nonTransport += 1; continue; }
      const kind = procurementType(text);
      if (!kind) { rejected.nonProcurement += 1; continue; }
      if (!includesAny(text, OPEN) || !includesAny(text, ACTION)) { rejected.notOpen += 1; continue; }
      const source = sourceClass(url, plan.source);
      const fit = fitForTodoGreen(text);
      const confidence = confidenceFor({ text, source, url });
      opportunities.push({
        id: `market-${crypto.randomUUID()}`, kind, title: limparResumoDeBusca(clean(item?.title || url, 260)),
        snippet: limparResumoDeBusca(clean(item?.snippet || item?.description, 900)), url, source,
        provider: clean(item?.provider || search?.providers?.[0] || "", 80), deadline: extractDeadline(raw),
        status: "new", confidence: confidence.label, confidenceScore: confidence.score,
        fitScore: fit.score, fitReasons: fit.reasons, checkedAt: now.toISOString(), planId: plan.id || "",
      });
    }
  }
  opportunities.sort((a, b) => (b.fitScore - a.fitScore) || (b.confidenceScore - a.confidenceScore) || a.title.localeCompare(b.title, "pt-BR"));
  return { opportunities, rejected };
}

export async function buildTodoGreenMarketRadar(env, ownerId, { query = "", company = "", now = new Date() } = {}) {
  const plans = buildMarketRadarPlans({ query, company });
  const envBusca = await envComChavesDeBuscaDoEspaco(env, ownerId);
  const searches = [];
  const failures = [];
  for (const plan of plans) {
    try {
      const result = await searchWeb(envBusca, plan.query);
      searches.push({ ...result, plan });
      for (const failure of result.failures || []) failures.push({ plan: plan.label, ...failure });
    } catch (error) {
      failures.push({ plan: plan.label, provider: "busca", error: clean(error?.message || "Falha na busca", 180) });
    }
  }
  const classified = classifyMarketRadarResults(searches, { now });
  return {
    checkedAt: now.toISOString(), query: clean(query, 120), company: clean(company, 120),
    configuration: webSearchConfiguration(envBusca), opportunities: classified.opportunities.slice(0, 80),
    rejected: classified.rejected, sources: plans.map((plan) => ({ id: plan.id, label: plan.label })), failures,
    policy: "Somente processos com evidência de contratação em transporte/logística e sinais de participação aberta. Vagas, conteúdo educativo, processos encerrados e equipamentos incompatíveis são descartados.",
  };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function handleTodoGreenMarketRadar(request, env, access) {
  if (!podeNaVertical(access, "market:read") && !podeNaVertical(access, "market:research")) return json({ error: "Seu acesso não permite consultar o radar de mercado." }, 403);
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"), 120);
  const company = clean(url.searchParams.get("company"), 120);
  try { return json(await buildTodoGreenMarketRadar(env, access.ownerId, { query, company })); }
  catch (error) { console.error("To Do Green market radar", error); return json({ error: "Não foi possível pesquisar RFQs, RFIs e licitações agora." }, 500); }
}
