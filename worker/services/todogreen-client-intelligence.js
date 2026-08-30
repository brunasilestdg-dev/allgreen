import { podeNaVertical, recorteDeCarteira, TENANT_ID } from "./todogreen-access.js";
import { searchWeb, webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { normalizedPhone } from "../../src/features/logistics/crmContactNormalizationDomain.js";

const clean = (value, max = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const parse = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const normalize = (value) => clean(value, 1200).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const safeUrl = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
const resultKey = (item) => safeUrl(item?.url).replace(/[#?].*$/, "").replace(/\/$/, "");
const includesAny = (text, terms) => terms.some((term) => text.includes(term));
export const COMPANY_RESEARCH_VERSION = 12;

const VACANCY = ["vaga", "vagas", "career", "carreira", "emprego", "job", "jobs", "hiring", "we are hiring", "we're looking", "talentos", "recrutamento", "analista de compras", "comprador"];
const TRANSPORT = ["transporte", "transportadora", "logistica", "frete", "frota", "middle mile", "last mile", "transferencia", "distribuicao", "carrier"];
const RFQ = ["rfq", "rfp", "request for proposal", "bid", "licitacao", "edital", "concorrencia", "cotacao de frete"];
const OPEN = ["aberta", "aberto", "inscricoes", "prazo", "participe", "envie sua proposta", "recebimento de propostas", "chamada publica", "submission deadline", "open tender"];
const ACTION_CHANNEL = ["inscreva", "cadastre", "envie", "submeta", "formulario", "portal", "documentos", "propostas ate", "recebimento de propostas", "submission", "apply", "register"];
const RFQ_EDUCATIONAL = ["o que e", "what is", "significa", "diferencas", "afinal", "sopa de letrinhas", "guia", "glossario", "template", "modelo de rfp", "como funciona"];
const SUPPLIER = ["cadastro de fornecedores", "seja fornecedor", "portal do fornecedor", "supplier portal", "supplier registration", "homologacao de fornecedores"];
const ESG = ["esg", "sustentabilidade", "descarbonizacao", "emissoes", "escopo 3", "scope 3", "net zero", "carbono", "clima"];
const PROCUREMENT = ["procurement", "compras", "suprimentos", "sourcing", "supply chain"];
const LOGISTICS_PROCUREMENT = [
  "logistica", "logistics", "transporte", "transportes", "transportation", "frete",
  "freight", "carrier", "distribution", "distribuicao", "supply chain", "last mile",
  "middle mile", "inbound", "outbound",
];
const LOGISTICS_DECISION = [
  "gerente de logistica", "gerente logistica", "gerente de transportes", "gerente transportes",
  "gerente sr de transportes", "diretor de supply chain", "diretora de supply chain",
  "responsavel pela area de transportes", "gestor de logistica", "outbound manager",
  "transportadoras", "contratacao de transportadoras", "parceiros de transporte",
];
const BRAZIL = [
  "brasil", "brazil", "sao paulo", "campinas", "jundiai", "guarulhos", "osasco",
  "barueri", "rio de janeiro", "belo horizonte", "curitiba", "porto alegre", "recife",
  "salvador", "fortaleza", "brasilia", "goiania", "manaus", "parana", "santa catarina",
  "rio grande do sul", "minas gerais",
];
const FOREIGN_LOCATION = [
  "north america", "united states", "usa", "canada", "ontario", "toronto", "portugal",
  "porto, portugal", "switzerland", "zurich", "lucerne", "germany", "herzogenaurach",
  "united kingdom", "london", "spain", "france", "mexico", "argentina", "chile",
];
const FORMER_EMPLOYMENT = [
  "ex-funcionario", "ex-funcionaria", "ex colaborador", "ex-colaborador", "ex-colaboradora",
  "former employee", "former manager", "formerly at", "previously at", "worked at",
  "trabalhou na", "trabalhou no", "atuou na", "atuou no", "deixou a empresa",
  "na epoca em que", "quando trabalhava", "experiencia anterior", "cargo anterior",
];
const CURRENT_EMPLOYMENT = [
  "atualmente", "currently", "current role", "present", "desde", "trabalha na", "trabalha no",
  "atua na", "atua no", "responsavel na", "responsavel no", "gerente na", "gerente no",
  "diretor na", "diretora na", "head na", "head no", "o momento", "ate o momento",
];
const BRAZIL_HEADQUARTERS = [
  ["sao paulo", "São Paulo, SP"], ["campinas", "Campinas, SP"], ["jundiai", "Jundiaí, SP"],
  ["guarulhos", "Guarulhos, SP"], ["osasco", "Osasco, SP"], ["barueri", "Barueri, SP"],
  ["rio de janeiro", "Rio de Janeiro, RJ"], ["belo horizonte", "Belo Horizonte, MG"],
  ["curitiba", "Curitiba, PR"], ["porto alegre", "Porto Alegre, RS"], ["recife", "Recife, PE"],
  ["salvador", "Salvador, BA"], ["fortaleza", "Fortaleza, CE"], ["brasilia", "Brasília, DF"],
  ["goiania", "Goiânia, GO"], ["manaus", "Manaus, AM"],
];
const SEGMENTS = [
  ["E-commerce", ["e-commerce", "marketplace", "comercio eletronico"]],
  ["Varejo", ["varejo", "lojas", "retail"]],
  ["Alimentos e bebidas", ["alimentos", "bebidas", "food", "restaurante"]],
  ["Indústria", ["industria", "industrial", "manufatura", "fabricacao"]],
  ["Saúde e farmacêutico", ["saude", "farmaceut", "hospital", "healthcare"]],
  ["Tecnologia", ["tecnologia", "software", "cloud", "tecnologia da informacao"]],
  ["Energia", ["energia", "eletricidade", "oil & gas", "petroleo"]],
  ["Logística e transportes", ["logistica", "transporte", "transportadora", "frete"]],
  ["Serviços financeiros", ["banco", "financeir", "fintech", "seguros"]],
];

const AMBIGUOUS_PLACE_BRANDS = {
  "tres coracoes": {
    aliases: ["3coracoes", "3 coracoes", "grupo 3coracoes", "grupo tres coracoes"],
    businessCues: ["empresa", "companhia", "grupo", "marca", "cnpj", "cafe", "cafes", "industria", "linkedin.com/company"],
    placeCues: ["prefeitura", "municipio", "camara municipal", "cidade de", "turismo", "secretaria municipal"],
  },
};

const cnpjDigits = (value) => clean(value, 40).replace(/\D/g, "");
const validCnpj = (value) => {
  const digits = cnpjDigits(value);
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const digit = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(`${digits.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${first}${second}`);
};

const registryText = (value) => typeof value === "object" && value
  ? clean(value.descricao || value.nome || value.description, 240)
  : clean(value, 240);

export async function lookupPublicCompanyRegistry(document, { fetcher = fetch } = {}) {
  const cnpj = cnpjDigits(document);
  if (!validCnpj(cnpj)) return null;
  const endpoints = [
    `https://api.opencnpj.org/${cnpj}`,
    `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
  ];
  for (const url of endpoints) {
    try {
      const result = await fetcher(url, { headers: { accept: "application/json" } });
      if (!result?.ok) continue;
      const payload = await result.json();
      const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      const legalName = clean(data?.razao_social || data?.razaoSocial || data?.nome_empresarial || data?.nomeEmpresarial, 200);
      const tradeName = clean(data?.nome_fantasia || data?.nomeFantasia, 200);
      const city = registryText(data?.municipio || data?.cidade || data?.endereco?.municipio);
      const state = clean(data?.uf || data?.estado || data?.endereco?.uf, 2).toUpperCase();
      const mainActivity = registryText(data?.cnae_fiscal_descricao || data?.cnae_principal_descricao || data?.cnae_principal || data?.cnaePrincipal);
      const status = registryText(data?.descricao_situacao_cadastral || data?.situacao_cadastral || data?.situacaoCadastral);
      if (!legalName && !city && !mainActivity) continue;
      return { cnpj, legalName, tradeName, city, state, mainActivity, status, sourceUrl: url };
    } catch { /* tenta a próxima fonte pública */ }
  }
  return null;
}

const NEWS_PROFILE_NOISE = [
  "company size", "associated members", "people who've listed", "founded", "funding last round",
  "total rounds", "investors n/a", "specialties n/a", "get directions", "overview",
];

const cleanSnippet = (value, max = 420) => clean(value, 1800)
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/#{1,6}\s*/g, "")
  .replace(/\bN\/?A\b/gi, "")
  .replace(/\s*\[\.\.\.\]\s*/g, " … ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const source = (item, category, extra = {}) => ({
  title: clean(item?.title, 240),
  url: safeUrl(item?.url),
  snippet: cleanSnippet(item?.snippet, category === "procurement_contact" ? 300 : 420),
  provider: clean(item?.provider, 60),
  category,
  ...extra,
});

const evidence = (suggestion, checkedAt, method = "Pesquisa web") => {
  if (!suggestion?.value && !suggestion?.url) return null;
  const item = suggestion.source || suggestion;
  const url = safeUrl(item?.url || item?.sourceUrl);
  if (!url) return null;
  return {
    value: clean(suggestion.value, 300),
    sourceUrl: url,
    sourceTitle: clean(item?.title, 240) || "Fonte pública",
    checkedAt,
    confidence: clean(suggestion.confidence, 40) || "moderada",
    method,
  };
};

const unique = (items, limit = 8) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = resultKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
};

// Portais de vaga e ATS: página institucional deles fala da empresa sem dizer
// "vaga" no título — foi assim que a Gupy entrou como "informação" do Grupo
// Três Corações. Domínio de recrutamento nunca é notícia nem evidência de
// decisor.
const JOB_PORTAL_HOSTS = [
  "gupy.io", "gupy.com", "vagas.com", "vagas.com.br", "catho.com", "indeed.com",
  "glassdoor.com", "infojobs.com.br", "99jobs.com", "kenoby.com", "abler.com.br",
  "solides.com", "trabalhabrasil.com.br", "lever.co", "greenhouse.io",
  "myworkdayjobs.com", "linkedin.com/jobs",
];
const isJobPortal = (item) => {
  const url = normalize(item?.url);
  return JOB_PORTAL_HOSTS.some((host) => url.includes(host));
};
const isVacancy = (item) =>
  isJobPortal(item) || includesAny(normalize(`${item.title} ${item.snippet} ${item.url}`), VACANCY);

const isCompanyProfileNoise = (item) => {
  const url = safeUrl(item?.url);
  const text = normalize(`${item?.title} ${item?.snippet}`);
  return /linkedin\.com\/(?:company|in)\//i.test(url) ||
    NEWS_PROFILE_NOISE.filter((term) => text.includes(term)).length >= 2;
};

const resultsByKind = (searches = []) => searches.reduce((groups, item) => {
  const kind = clean(item?.kind, 40);
  if (!kind) return groups;
  groups[kind] = [...(groups[kind] || []), ...(Array.isArray(item?.results) ? item.results : [])];
  return groups;
}, {});

const companyTokens = (company) => normalize(company)
  .split(/\s+/)
  .filter((item) => item.length > 3 && !["grupo", "brasil"].includes(item));

const ambiguousPlaceBrand = (company) => AMBIGUOUS_PLACE_BRANDS[normalize(company)] || null;

const companySearchTerm = (company) =>
  `"${clean(company, 200)}" (empresa OR companhia OR marca OR CNPJ) -prefeitura -município -municipio -"cidade de"`;

const isGovernmentWebsite = (value) => {
  try {
    const host = new URL(safeUrl(value)).hostname.replace(/^www\./, "").toLowerCase();
    return host.endsWith(".gov.br") || host === "gov.br";
  } catch { return false; }
};

const websiteBelongsToCompany = (value, company) => {
  let host = "";
  try { host = normalize(new URL(safeUrl(value)).hostname.replace(/^www\./, "")); } catch { return false; }
  const tokens = companyTokens(company);
  const aliases = ambiguousPlaceBrand(company)?.aliases || [];
  return Boolean(host && ((tokens.length && tokens.some((token) => host.includes(token))) || aliases.some((alias) => host.includes(normalize(alias).replace(/\s+/g, "")))));
};

export function resolveWebsiteEnrichment({ existingWebsite, previousResearchWebsite, officialWebsite, company }) {
  const existing = safeUrl(existingWebsite);
  const previous = safeUrl(previousResearchWebsite);
  const official = safeUrl(officialWebsite);
  const wasAutoFilled = Boolean(existing && previous && resultKey({ url: existing }) === resultKey({ url: previous }));
  const shouldCorrect = Boolean(existing && !websiteBelongsToCompany(existing, company) && wasAutoFilled);
  return {
    value: shouldCorrect ? official : (!existing && official ? official : existing),
    filled: !existing && Boolean(official),
    corrected: shouldCorrect && Boolean(official),
    removed: shouldCorrect && !official,
  };
}

export function buildPublicAccountEnrichment({ line = {}, fields = {}, report = {}, company = "" }) {
  const filledLegalName = !clean(line.legal_name, 200) && report.suggestedLegalName?.value
    ? clean(report.suggestedLegalName.value, 200)
    : clean(line.legal_name, 200);
  const filledSegment = !clean(line.segment, 120) && report.suggestedSegment?.value
    ? clean(report.suggestedSegment.value, 120)
    : clean(line.segment, 120);
  const websiteEnrichment = resolveWebsiteEnrichment({
    existingWebsite: fields.website,
    previousResearchWebsite: fields.intelligence?.officialWebsite?.url,
    officialWebsite: report.officialWebsite?.url,
    company,
  });
  const filledWebsite = websiteEnrichment.value;
  const filledLinkedin = !clean(fields.linkedinUrl, 1000) && report.linkedinCompany?.url
    ? safeUrl(report.linkedinCompany.url)
    : clean(fields.linkedinUrl, 1000);
  const filledHeadquarters = !clean(fields.headquarters, 160) && report.suggestedHeadquarters?.value
    ? clean(report.suggestedHeadquarters.value, 160)
    : clean(fields.headquarters, 160);
  const qualification = fields.qualification && typeof fields.qualification === "object"
    ? { ...fields.qualification }
    : {};
  const filledQualification = [];
  const institutionalWebsite = filledWebsite && websiteBelongsToCompany(filledWebsite, company) ? filledWebsite : "";
  const institutionalLinkedin = /linkedin\.com\/company\//i.test(filledLinkedin) ? filledLinkedin : "";
  if (!clean(qualification.publicProfile, 1000) && (report.publicRegistry || institutionalWebsite || institutionalLinkedin)) {
    qualification.publicProfile = [
      report.publicRegistry ? `Cadastro público de CNPJ${report.publicRegistry.status ? ` com situação ${report.publicRegistry.status}` : ""}` : "",
      institutionalWebsite ? "site institucional compatível com a empresa" : "",
      institutionalLinkedin ? "página institucional no LinkedIn" : "",
    ].filter(Boolean).join("; ") + ".";
    qualification.publicProfileSource = report.publicRegistry?.sourceUrl || report.officialWebsite?.url || report.linkedinCompany?.url || institutionalWebsite || institutionalLinkedin;
    filledQualification.push("perfil público");
  }
  const procurementPeople = Array.isArray(report.procurementPeople) ? report.procurementPeople : [];
  const openRfqs = Array.isArray(report.openRfqs) ? report.openRfqs : [];
  const logisticsSignals = Array.isArray(report.logisticsSignals) ? report.logisticsSignals : [];
  if (!clean(qualification.logisticsSignals, 1000) && (logisticsSignals.length || procurementPeople.length || openRfqs.length)) {
    qualification.logisticsSignals = openRfqs.length
      ? "Há processo público acionável ligado a logística ou transportes; valide escopo e prazo na fonte."
      : procurementPeople.length
        ? "Há evidência pública de pessoas com vínculo atual em Procurement de Logística e Transportes no Brasil."
        : `${logisticsSignals.length} evidência(s) pública(s) relacionam a empresa a logística, transportes, frete ou distribuição.`;
    qualification.logisticsSignalsSource = openRfqs[0]?.url || procurementPeople[0]?.url || logisticsSignals[0]?.url || "";
    filledQualification.push("sinais logísticos");
  }
  const esgSignals = Array.isArray(report.esg?.signals) ? report.esg.signals : [];
  if (!clean(qualification.esgCommitments, 1000) && esgSignals.length) {
    qualification.esgCommitments = `${esgSignals.length} fonte(s) pública(s) indicam agenda ESG relacionada à empresa. Consulte as evidências vinculadas antes de usar em proposta.`;
    qualification.esgCommitmentsSource = esgSignals[0]?.url || "";
    filledQualification.push("sinais ESG");
  }
  return {
    filledLegalName, filledSegment, filledWebsite, filledLinkedin, filledHeadquarters,
    websiteEnrichment, qualification, filledQualification,
  };
}

const mentionsCompany = (item, company) => {
  const tokens = companyTokens(company);
  if (!tokens.length) return true;
  const text = normalize(`${item?.title} ${item?.snippet} ${item?.url}`).slice(0, 900);
  const nameMatches = tokens.some((token) => text.includes(token));
  const ambiguous = ambiguousPlaceBrand(company);
  if (!ambiguous) return nameMatches;
  const aliasMatches = ambiguous.aliases.some((alias) => text.includes(normalize(alias)));
  const businessEvidence = includesAny(text, ambiguous.businessCues);
  const placeEvidence = includesAny(text, ambiguous.placeCues);
  if (placeEvidence && !businessEvidence) return false;
  return (nameMatches || aliasMatches) && businessEvidence;
};

const profileGeography = (item) => {
  let host = "";
  try { host = new URL(safeUrl(item?.url)).hostname.replace(/^www\./, ""); } catch { host = ""; }
  const linkedinLocale = host.match(/^([a-z]{2})\.linkedin\.com$/i)?.[1]?.toLowerCase() || "";
  if (linkedinLocale && linkedinLocale !== "br") return "foreign";
  const leadingEvidence = normalize(`${item?.title} ${item?.snippet}`).slice(0, 650);
  if (includesAny(leadingEvidence, FOREIGN_LOCATION)) return "foreign";
  if (host === "br.linkedin.com" || includesAny(leadingEvidence, BRAZIL)) return "brazil";
  return "unknown";
};

const currentEmploymentEvidence = (item, company) => {
  const text = normalize(`${item?.title}. ${item?.snippet}`);
  const companyTerms = companyTokens(company);
  const companyStatements = text.split(/[.!?;\n]+/).filter((statement) =>
    companyTerms.some((token) => statement.includes(token)));
  const cueInCompanyStatement = (cues) => companyStatements.some((statement) => includesAny(statement, cues));
  const closedCompanyRange = companyStatements.some((statement) =>
    /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/.test(statement));
  if (cueInCompanyStatement(FORMER_EMPLOYMENT) || closedCompanyRange) return "former";
  // O título do resultado pode permanecer indexado por meses depois de uma
  // troca de emprego. Empresa + cargo no título ajuda a achar a pessoa, mas
  // não comprova atualidade. Só aceitamos como vínculo atual quando a própria
  // evidência pública traz um marcador explícito ("atualmente", "present",
  // "desde" etc.) no trecho associado à empresa-alvo.
  const explicitCurrentRole = cueInCompanyStatement(CURRENT_EMPLOYMENT);
  return explicitCurrentRole ? "current" : "unknown";
};

const classifyContactResult = (item, company) => {
  if (!/linkedin\.com\/in\//i.test(safeUrl(item?.url))) return "not-profile";
  if (isVacancy(item)) return "vacancy";
  if (!mentionsCompany(item, company)) return "other-company";
  const text = normalize(`${item?.title} ${item?.snippet}`);
  const employment = currentEmploymentEvidence(item, company);
  if (employment === "former") return "former-employment";
  const geography = profileGeography(item);
  if (geography === "foreign") return "foreign";
  if (!includesAny(text, PROCUREMENT) && !includesAny(text, LOGISTICS_DECISION)) return "not-procurement";
  if (!includesAny(text, LOGISTICS_PROCUREMENT)) return "not-logistics";
  if (geography !== "brazil") return "no-brazil-evidence";
  if (employment !== "current") return "current-employment-unverified";
  return "accepted";
};

const inferredSegment = (items) => {
  const evidence = unique(items, 12);
  const ranked = SEGMENTS.map(([value, terms]) => ({
    value,
    matches: evidence.filter((item) => includesAny(normalize(`${item.title} ${item.snippet}`), terms)),
  })).filter((item) => item.matches.length).sort((a, b) => b.matches.length - a.matches.length);
  const winner = ranked[0];
  if (!winner) return null;
  return { value: winner.value, source: source(winner.matches[0], "segment_evidence"), confidence: winner.matches.length > 1 ? "alta" : "moderada" };
};

const inferredHeadquarters = (items) => {
  const evidence = unique(items, 12);
  for (const item of evidence) {
    const rawText = clean(`${item.title}. ${item.snippet}`, 1600);
    const text = normalize(rawText);
    const anchoredLocation = rawText.match(/(?:sede|headquarters|localizad[oa]|endere[cç]o|located)\s*(?:em|at|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{2,48}),\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
    if (anchoredLocation) return {
      value: `${clean(anchoredLocation[1], 60)}, ${anchoredLocation[2].toUpperCase()}`,
      source: source(item, "headquarters_evidence"), confidence: "alta",
    };
    if (!includesAny(text, ["brasil", "brazil"])) continue;
    const city = BRAZIL_HEADQUARTERS.find(([term]) => text.includes(term));
    if (city) return { value: city[1], source: source(item, "headquarters_evidence"), confidence: "moderada" };
  }
  return null;
};

const inferredLegalName = (items, company) => {
  for (const item of unique(items, 12)) {
    const text = clean(`${item.title}. ${item.snippet}`, 1800);
    const match = text.match(/(?:raz[aã]o social|nome empresarial|legal name)\s*[:\-–—]\s*([^|;]{4,200})/i);
    if (!match) continue;
    const value = clean(match[1].split(/\b(?:cnpj|nome fantasia|situa[cç][aã]o cadastral|endere[cç]o)\b/i)[0], 200).replace(/[.,\s]+$/, "");
    const normalizedValue = normalize(value);
    if (!value || !companyTokens(company).some((token) => normalizedValue.includes(token))) continue;
    return { value, source: source(item, "legal_name_evidence"), confidence: "moderada" };
  }
  return null;
};

const contactEmail = (item, officialHost, company) => {
  const matches = clean(`${item?.title} ${item?.snippet}`, 1600)
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const companyToken = companyTokens(company)[0] || "";
  const allowed = [...new Set(matches.map((value) => value.toLowerCase()))].filter((value) => {
    const domain = value.split("@")[1] || "";
    return (officialHost && (domain === officialHost || domain.endsWith(`.${officialHost}`))) ||
      (companyToken && normalize(domain).includes(companyToken));
  });
  return allowed.length === 1 ? allowed[0] : "";
};

const contactPhone = (item) => {
  const matches = clean(`${item?.title} ${item?.snippet}`, 1600)
    .match(/(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]*\d{4}/g) || [];
  const phones = [...new Set(matches.map(normalizedPhone).filter(Boolean))];
  return phones.length === 1 ? phones[0] : "";
};

const profileParts = (item, company) => {
  const parts = clean(item.title, 240).replace(/\s*[|·]\s*LinkedIn.*$/i, "").split(/\s+[–—-]\s+/).map((part) => clean(part, 120)).filter(Boolean);
  const name = parts[0] || "";
  if (name.split(/\s+/).length < 2 || /linkedin|procurement|compras|suprimentos/i.test(name)) return null;
  const title = parts.slice(1).filter((part) => !companyTokens(company).some((token) => normalize(part).includes(token))).join(" · ");
  return { name, title };
};

const publicContact = (item, index, { company, officialHost, checkedAt }) => {
  const profile = profileParts(item, company);
  if (!profile) return null;
  return {
    id: `web-contact-${index + 1}`,
    name: profile.name,
    title: profile.title || "Atuação logística a confirmar",
    department: "Procurement de Logística e Transportes",
    email: contactEmail(item, officialHost, company),
    phone: contactPhone(item),
    linkedinUrl: safeUrl(item.url),
    relationshipRole: "Compras",
    source: "Pesquisa web",
    sourceUrl: safeUrl(item.url),
    country: "Brasil",
    specialty: "Procurement logístico",
    validation: "A fonte pública indica vínculo atual com a empresa, atuação no Brasil e escopo de logística/transportes na data da pesquisa.",
    confidence: "alta",
    evidence: { sourceUrl: safeUrl(item.url), checkedAt, method: "Pesquisa web", confidence: "alta" },
    verifiedBrazil: true,
    currentEmploymentVerified: true,
    employmentCheckedAt: checkedAt,
    employmentStatus: "current",
    researchVersion: COMPANY_RESEARCH_VERSION,
    active: true,
  };
};

const brazilEvidenceFromSavedContact = (contact) => {
  if (!contact) return false;
  if (normalize(contact.country) === "brasil" || contact.verifiedBrazil === true) return true;
  const digits = String(contact.phone || "").replace(/\D/g, "");
  return digits.startsWith("55") ? digits.length === 12 || digits.length === 13 : digits.length === 10 || digits.length === 11;
};

const knownContactCandidate = (item, index, company, knownContacts = [], checkedAt = "") => {
  const names = Array.isArray(item?.knownContactNames) ? item.knownContactNames : [item?.knownContactName];
  const evidence = normalize(`${item?.title} ${item?.snippet}`);
  const name = names.map((value) => clean(value, 160)).find((value) => {
    const tokens = normalize(value).split(/\s+/).filter((token) => token.length > 2);
    return tokens.length >= 2 && tokens.every((token) => evidence.includes(token));
  }) || "";
  if (!name) return null;
  const profile = profileParts(item, company);
  if (!profile) return null;
  const employment = currentEmploymentEvidence(item, company);
  if (employment === "former") return null;
  const geography = profileGeography(item);
  const savedContact = knownContacts.find((contact) => normalize(contact?.name) === normalize(name));
  if (geography === "foreign" || (geography !== "brazil" && !brazilEvidenceFromSavedContact(savedContact))) return null;
  const current = employment === "current";
  return {
    id: `known-web-contact-${index + 1}`,
    name,
    title: profile.title,
    department: "",
    email: "",
    phone: "",
    linkedinUrl: safeUrl(item.url),
    relationshipRole: "Influenciador",
    source: "Pesquisa web (LinkedIn do contato)",
    sourceUrl: safeUrl(item.url),
    country: "Brasil",
    specialty: "Contato já cadastrado",
    validation: current
      ? geography === "brazil"
        ? "LinkedIn localizado pelo nome do contato cadastrado, com evidência pública de vínculo atual com a empresa e atuação no Brasil."
        : "LinkedIn localizado pelo nome e empresa, com vínculo atual indicado na fonte; a atuação no Brasil foi confirmada pelo telefone ou país já cadastrado no CRM."
      : "LinkedIn localizado para o contato já cadastrado. O perfil coincide por nome e empresa, mas a fonte pública não comprova que o vínculo ainda é atual; confirme antes de tratá-lo como decisor.",
    confidence: current ? "alta" : "moderada",
    evidence: { sourceUrl: safeUrl(item.url), checkedAt, method: "Pesquisa web", confidence: current ? "alta" : "moderada" },
    verifiedBrazil: true,
    currentEmploymentVerified: current,
    employmentCheckedAt: checkedAt,
    employmentStatus: current ? "current" : "unknown",
    researchVersion: COMPANY_RESEARCH_VERSION,
    active: true,
  };
};

const isLegacyUnverifiedWebContact = (contact) =>
  normalize(contact?.source).startsWith("pesquisa web") &&
  (Number(contact?.researchVersion || 0) < COMPANY_RESEARCH_VERSION ||
    contact?.verifiedBrazil !== true || contact?.currentEmploymentVerified !== true);

export function reconcileResearchedContacts({ existingContacts = [], contactCandidates = [], formerContacts = [], checkedAt = "" }) {
  const currentCandidateIdentities = new Set(contactCandidates.filter((item) => item.currentEmploymentVerified === true).flatMap((item) => [
    normalize(item.linkedinUrl), normalize(item.email), normalize(item.name),
  ]).filter(Boolean));
  const formerIdentities = new Set(formerContacts.flatMap((item) => [
    normalize(item.linkedinUrl), normalize(item.name),
  ]).filter(Boolean));
  let staleWebContactsRemoved = 0;
  let formerContactsMarkedInactive = 0;
  const contacts = existingContacts.flatMap((contact) => {
    const identities = [normalize(contact.linkedinUrl), normalize(contact.email), normalize(contact.name)].filter(Boolean);
    const webDiscovered = normalize(contact.source).startsWith("pesquisa web");
    const protectedChannel = Boolean(clean(contact.email, 320) || clean(contact.phone, 500));
    const current = identities.some((identity) => currentCandidateIdentities.has(identity));
    // Contato cadastrado À MÃO é patrimônio da carteira: só vira "ex" com
    // identidade forte (LinkedIn ou e-mail) apontando o desligamento. Nome
    // solto coincide com homônimo e com lixo de portal de vaga — foi assim
    // que contato recém-criado "sumia" do mapa logo após uma pesquisa.
    const strongIdentities = [normalize(contact.linkedinUrl), normalize(contact.email)].filter(Boolean);
    const former = webDiscovered
      ? identities.some((identity) => formerIdentities.has(identity))
      : strongIdentities.some((identity) => formerIdentities.has(identity));
    if (webDiscovered && !current && !protectedChannel) {
      staleWebContactsRemoved += 1;
      return [];
    }
    if (former) {
      formerContactsMarkedInactive += 1;
      return [{
        ...contact,
        active: false,
        employmentStatus: "former",
        currentEmploymentVerified: false,
        employmentCheckedAt: checkedAt,
        validation: "Contato preservado como histórico: a fonte pública indica que o vínculo com esta empresa não é mais atual.",
      }];
    }
    if (webDiscovered && !current && protectedChannel) {
      return [{
        ...contact,
        // Telefone/e-mail importado é patrimônio da carteira. A pesquisa pode
        // retirar a pessoa do mapa decisório, mas não desativar nem excluir o
        // cadastro sem uma ação humana explícita.
        active: contact.active !== false,
        currentEmploymentVerified: false,
        employmentCheckedAt: checkedAt,
        employmentStatus: "unknown",
        validation: "Contato preservado por possuir telefone ou e-mail. O vínculo atual não foi reconfirmado; ele não conta como decisor até validação ou edição manual.",
      }];
    }
    return [contact];
  });
  return {
    contacts,
    staleWebContactsRemoved,
    formerContactsMarkedInactive,
    legacyContactsRetained: contacts.filter(isLegacyUnverifiedWebContact).length,
  };
}

/** Classifica apenas o que está evidenciado no resultado. Não transforma notícia ou vaga em RFQ. */
const reviewReason = (reason) => ({
  "no-brazil-evidence": "Sem evidência pública de atuação no Brasil",
  "not-logistics": "Sem evidência de responsabilidade por Logística ou Transportes",
  "not-procurement": "Sem evidência de Compras, Procurement ou decisão logística",
  "other-company": "Vínculo com a empresa-alvo não comprovado",
  "former-employment": "A fonte indica vínculo anterior, não atual, com a empresa",
  "current-employment-unverified": "Sem evidência pública suficiente de vínculo atual com a empresa",
  foreign: "Atuação indicada fora do Brasil",
  vacancy: "O resultado é uma vaga, não um contato",
}[reason] || "Resultado insuficiente para cadastro automático");

export function classifyCompanyResearch({ company, segment, searches, knownContacts = [], publicRegistry = null, checkedAt = new Date().toISOString(), discardedUrls = [] }) {
  // O que a titular descartou não volta: a pesquisa erra (Gupy no Grupo Três
  // Corações) e a correção humana precisa ser definitiva, não até a próxima
  // atualização.
  const descartadas = new Set((discardedUrls || []).map((url) => normalize(safeUrl(url))).filter(Boolean));
  if (descartadas.size) {
    searches = (searches || []).map((busca) => ({
      ...busca,
      results: (busca.results || []).filter((item) => !descartadas.has(normalize(safeUrl(item?.url)))),
    }));
  }
  const byKind = resultsByKind(searches);
  const all = unique(searches.flatMap((item) => item.results || []), 40);
  const companyToken = companyTokens(company)[0] || "";
  const linkedInCompany = all.find((item) => /linkedin\.com\/company\//i.test(item.url) && mentionsCompany(item, company));
  const officialWebsiteResult = (byKind.identity || []).find((item) => {
    const url = normalize(safeUrl(item.url));
    return Boolean(url) && !isGovernmentWebsite(item.url) && !includesAny(url, ["linkedin.com", "facebook.com", "instagram.com", "wikipedia.org", "youtube.com", "jusbrasil.com", "glassdoor."]) &&
      websiteBelongsToCompany(item.url, company);
  });
  const officialWebsite = officialWebsiteResult ? {
    ...officialWebsiteResult,
    url: new URL(officialWebsiteResult.url).origin,
  } : null;
  const officialHost = officialWebsite ? new URL(officialWebsite.url).hostname.replace(/^www\./, "") : "";
  const trustedForCompany = (item) => {
    let host = "";
    try { host = new URL(safeUrl(item.url)).hostname.replace(/^www\./, ""); } catch { return false; }
    return (officialHost && (host === officialHost || host.endsWith(`.${officialHost}`))) ||
      (companyToken && normalize(host).includes(companyToken)) ||
      /(?:^|\.)(gov\.br|sp\.gov\.br)$/.test(host);
  };
  const supplierCandidates = unique((byKind.supplier || []).filter((item) => includesAny(normalize(`${item.title} ${item.snippet} ${item.url}`), SUPPLIER) && mentionsCompany(item, company) && !isVacancy(item)));
  const supplierLinks = supplierCandidates.filter(trustedForCompany).map((item) => source(item, "supplier", { actionable: true, validation: "Link compatível com o domínio da empresa ou portal público; confirme os requisitos da homologação." }));
  const supplierRejected = supplierCandidates.length - supplierLinks.length;
  const rfqCandidates = unique((byKind.rfq || []).filter((item) => {
    const text = normalize(`${item.title} ${item.snippet} ${item.url}`);
    return includesAny(text, RFQ) && !includesAny(text, RFQ_EDUCATIONAL) && !isVacancy(item) && mentionsCompany(item, company);
  }));
  const openRfqs = rfqCandidates.filter((item) => {
    const text = normalize(`${item.title} ${item.snippet} ${item.url}`);
    return includesAny(text, TRANSPORT) && includesAny(text, OPEN) && includesAny(text, ACTION_CHANNEL);
  }).filter(trustedForCompany).map((item) => source(item, "rfq", { actionable: true, validation: "O resultado menciona processo aberto e escopo de transporte em domínio compatível; confirme prazo e elegibilidade." }));
  const rejectedRfqCandidates = rfqCandidates.length - openRfqs.length;
  const esgSignals = unique((byKind.esg || []).filter((item) => mentionsCompany(item, company) && includesAny(normalize(`${item.title} ${item.snippet}`), ESG) && !isVacancy(item))).map((item) => source(item, "esg"));
  const logisticsSignals = unique(all.filter((item) =>
    mentionsCompany(item, company) && includesAny(normalize(`${item.title} ${item.snippet}`), TRANSPORT) &&
    !isVacancy(item) && !isCompanyProfileNoise(item)), 8).map((item) => source(item, "logistics_signal"));
  const profileResults = unique(all.filter((item) => /linkedin\.com\/in\//i.test(item.url)), 20);
  const classifiedProfiles = profileResults.map((item) => ({ item, reason: classifyContactResult(item, company) }));
  const acceptedProfiles = classifiedProfiles.filter((item) => item.reason.startsWith("accepted"));
  const procurementPeople = acceptedProfiles.map(({ item }) => source(item, "procurement_contact", {
    currentness: "A fonte pública indica vínculo atual com a empresa na data da pesquisa.",
    validation: "Resultado com evidência explícita de vínculo atual, empresa, Brasil e escopo de logística/transportes.",
  }));
  const procurementCandidates = acceptedProfiles.map(({ item }, index) => publicContact(item, index, { company, officialHost, checkedAt })).filter(Boolean);
  const reviewCandidates = classifiedProfiles
    .filter(({ reason }) => !["accepted", "vacancy", "foreign", "other-company", "not-profile", "former-employment"].includes(reason))
    .map(({ item, reason }) => source(item, "contact_review", {
      validation: reviewReason(reason),
      rejectionReason: reason,
      actionable: false,
    }))
    .slice(0, 12);
  const knownContactResults = unique((byKind.known_contacts || []).filter((item) => /linkedin\.com\/in\//i.test(item.url) && mentionsCompany(item, company) && !isVacancy(item)), 100);
  const knownContactCandidates = knownContactResults.map((item, index) => knownContactCandidate(item, index, company, knownContacts, checkedAt)).filter(Boolean);
  const seenCandidateProfiles = new Set();
  const contactCandidates = [...procurementCandidates, ...knownContactCandidates].filter((item) => {
    const key = normalize(item.linkedinUrl);
    if (!key || seenCandidateProfiles.has(key)) return false;
    seenCandidateProfiles.add(key);
    return true;
  });
  const knownContactProfiles = knownContactCandidates.map((item) => source({
    title: item.name,
    url: item.linkedinUrl,
    snippet: item.validation,
    provider: "Pesquisa web",
  }, "known_contact_profile", { validation: item.validation }));
  const formerContacts = classifiedProfiles
    .filter(({ reason }) => reason === "former-employment")
    .map(({ item }) => {
      const profile = profileParts(item, company);
      return profile ? {
        name: profile.name,
        linkedinUrl: safeUrl(item.url),
        sourceUrl: safeUrl(item.url),
        validation: "A fonte pública indica que o vínculo com a empresa é anterior, não atual.",
      } : null;
    })
    .filter(Boolean);
  const officialWebsiteKey = officialWebsite ? resultKey(officialWebsite) : "";
  const companyNewsResults = unique((byKind.news || []).filter((item) =>
    mentionsCompany(item, company) && !isVacancy(item) && !isCompanyProfileNoise(item) &&
    (!officialWebsiteKey || resultKey(item) !== officialWebsiteKey)
  ), 4);
  const companyNewsKeys = new Set(companyNewsResults.map(resultKey));
  const segmentTokens = normalize(segment).split(/\s+/).filter((item) => item.length > 3);
  const segmentNewsResults = unique((byKind.segment || []).filter((item) => {
    const text = normalize(`${item?.title} ${item?.snippet} ${item?.url}`);
    return !isVacancy(item) && !isCompanyProfileNoise(item) && !mentionsCompany(item, company) &&
      !companyNewsKeys.has(resultKey(item)) &&
      (includesAny(text, TRANSPORT) || segmentTokens.some((token) => text.includes(token)));
  }), 4);
  const companyNews = companyNewsResults.map((item) => source(item, "company_news"));
  const segmentNews = segmentNewsResults.map((item) => source(item, "segment_news"));
  const esgRelevance = esgSignals.length ? "Alta" : segment && includesAny(normalize(segment), TRANSPORT.concat(["varejo", "industria", "e-commerce", "alimentos", "energia"])) ? "Provável" : "A validar";
  const registrySource = publicRegistry?.sourceUrl ? source({
    title: "Cadastro público de CNPJ",
    url: publicRegistry.sourceUrl,
    snippet: [publicRegistry.legalName, publicRegistry.city && publicRegistry.state ? `${publicRegistry.city}, ${publicRegistry.state}` : "", publicRegistry.mainActivity].filter(Boolean).join(" · "),
    provider: "Cadastro público",
  }, "public_registry", { verification: "Dados cadastrais públicos vinculados ao CNPJ informado na conta." }) : null;
  const researchIdentity = [...(byKind.identity || []), ...(byKind.registry || []), ...(byKind.news || [])]
    .filter((item) => mentionsCompany(item, company));
  const suggestedLegalName = publicRegistry?.legalName
    ? { value: publicRegistry.legalName, source: registrySource, confidence: "alta" }
    : inferredLegalName(researchIdentity, company);
  const suggestedHeadquarters = publicRegistry?.city && publicRegistry?.state
    ? { value: `${publicRegistry.city}, ${publicRegistry.state}`, source: registrySource, confidence: "alta" }
    : inferredHeadquarters(researchIdentity);
  const suggestedSegment = inferredSegment(researchIdentity) || (publicRegistry?.mainActivity
    ? inferredSegment([{ title: publicRegistry.mainActivity, snippet: publicRegistry.mainActivity, url: publicRegistry.sourceUrl }])
    : null);

  const nextActions = [];
  if (openRfqs.length) nextActions.push("Validar imediatamente prazo, rota, frota e documentos da RFQ identificada.");
  if (supplierLinks.length) nextActions.push("Iniciar ou revisar a homologação no portal oficial de fornecedores.");
  if (procurementPeople.length) nextActions.push("Priorizar os contatos com vínculo atual indicado e validar o melhor canal de abordagem.");
  if (esgSignals.length) nextActions.push("Usar a meta ESG encontrada para adaptar o argumento de redução de emissões da operação.");
  if (!nextActions.length) nextActions.push("Completar o mapa de procurement e monitorar sinais públicos; nenhuma oportunidade acionável foi comprovada nesta pesquisa.");

  return {
    version: COMPANY_RESEARCH_VERSION,
    company: clean(company, 200),
    segment: clean(segment, 120),
    suggestedLegalName,
    suggestedSegment,
    suggestedHeadquarters,
    publicRegistry: publicRegistry ? { ...publicRegistry, source: registrySource } : null,
    checkedAt,
    officialWebsite: officialWebsite ? source(officialWebsite, "official_candidate", { verification: "Candidato a site oficial; confirme o domínio antes de usar." }) : null,
    linkedinCompany: linkedInCompany ? source(linkedInCompany, "linkedin_company") : null,
    esg: { relevance: esgRelevance, signals: esgSignals },
    logisticsSignals,
    supplierLinks,
    supplierRejected,
    openRfqs,
    rfqRejected: rejectedRfqCandidates,
    procurementPeople,
    knownContactProfiles,
    formerContacts,
    contactCandidates,
    reviewCandidates,
    contactSearchQuality: {
      accepted: acceptedProfiles.length,
      candidatesForReview: reviewCandidates.length,
      foreignRejected: classifiedProfiles.filter((item) => item.reason === "foreign").length,
      noBrazilEvidenceRejected: classifiedProfiles.filter((item) => item.reason === "no-brazil-evidence").length,
      nonLogisticsRejected: classifiedProfiles.filter((item) => item.reason === "not-logistics").length,
      otherCompanyRejected: classifiedProfiles.filter((item) => item.reason === "other-company").length,
      formerEmploymentRejected: classifiedProfiles.filter((item) => item.reason === "former-employment").length,
      currentEmploymentUnverified: classifiedProfiles.filter((item) => item.reason === "current-employment-unverified").length,
      vacanciesRejected: classifiedProfiles.filter((item) => item.reason === "vacancy").length,
      policy: "Somente vínculo atual evidenciado + Brasil + empresa confirmada + Procurement ligado a Logística, Transportes, Frete, Distribuição ou Supply Chain.",
    },
    companyNews,
    segmentNews,
    nextActions,
    descartes: [...descartadas],
    excludedVacancies: all.filter(isVacancy).length,
    disclaimer: "Resultados públicos verificados na data indicada. Contatos só são aceitos com evidência de vínculo atual, Brasil, empresa e escopo de procurement logístico. Perfis com vínculo anterior ou sem atualidade comprovada não entram no mapa ativo. RFQ só aparece quando há empresa-alvo, transporte, processo aberto e canal real de participação.",
  };
}

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** Uma pesquisa 360 reaproveita cada resultado em várias classificações. */
export function buildCompanyResearchPlans({ company, segment, year, focus = "company", knownContacts = [] }) {
  const name = clean(company, 200);
  const companyTerm = companySearchTerm(name);
  const ambiguous = ambiguousPlaceBrand(name);
  const contactTarget = ambiguous
    ? `("${name}" empresa OR ${ambiguous.aliases.map((alias) => `"${alias}"`).join(" OR ")}) -prefeitura -município -municipio -"cidade de"`
    : `"${name}"`;
  const market = clean(segment, 120) || "logística e transporte";
  const plans = [
    {
      kinds: ["identity"],
      query: `${companyTerm} Brasil site oficial LinkedIn segmento`,
    },
    {
      kinds: ["registry"],
      query: `${companyTerm} Brasil ("razão social" OR "nome empresarial" OR CNPJ) (sede OR endereço OR segmento)`,
    },
    {
      kinds: ["esg", "news"],
      query: `${companyTerm} Brasil ESG sustentabilidade logística notícias ${year}`,
    },
    {
      kinds: ["segment"],
      query: `"${market}" Brasil logística transportes tendências notícias ${year}`,
    },
    {
      kinds: ["supplier", "rfq"],
      query: `${companyTerm} Brasil ("cadastro de fornecedores" OR "seja fornecedor" OR "RFQ aberta" OR "RFP aberta" OR licitação OR concorrência) (transporte OR transportadora OR logística OR frete) (inscrições OR prazo OR proposta OR portal)`,
    },
    {
      kinds: ["contacts"],
      contactScope: "brazil-procurement-logistics",
      query: `site:linkedin.com/in ${contactTarget} (Brasil OR Brazil OR "São Paulo") (procurement OR compras OR suprimentos) (logística OR transportes OR frete OR "supply chain")`,
    },
    {
      kinds: ["contacts"],
      contactScope: "brazil-procurement-logistics",
      query: `site:br.linkedin.com/in ${contactTarget} Brasil (compras OR procurement OR logística OR transportes OR "supply chain")`,
    },
    {
      kinds: ["contacts"],
      contactScope: "brazil-procurement-logistics",
      query: `${contactTarget} Brasil LinkedIn gerente compras suprimentos transportes logística`,
    },
  ];
  // A busca do decisor com cargo de decisão roda SEMPRE: a titular precisa do
  // nome de quem assina, não só do analista de compras que o filtro básico traz.
  plans.push({
    kinds: ["contacts"],
    contactScope: "brazil-procurement-logistics",
    query: `site:linkedin.com/in ${contactTarget} (Brasil OR Brazil OR "São Paulo") (diretor OR gerente OR head) ("supply chain" OR transportes OR distribuição OR outbound)`,
  });
  if (focus === "contacts") {
    const contactsToFind = (Array.isArray(knownContacts) ? knownContacts : [])
      .filter((item) => clean(item?.name, 160).split(/\s+/).length >= 2 && !safeUrl(item?.linkedinUrl))
      .slice(0, 100)
      .map((item) => clean(item.name, 160));
    for (let index = 0; index < contactsToFind.length; index += 5) {
      const contactNames = contactsToFind.slice(index, index + 5);
      const namesQuery = contactNames.map((contactName) => `"${contactName}"`).join(" OR ");
      plans.push({
        kinds: ["known_contacts"],
        contactScope: "brazil-known-contact",
        knownContactNames: contactNames,
        query: `site:linkedin.com/in (${namesQuery}) ${contactTarget} (Brasil OR Brazil OR "São Paulo") -jobs -vaga`,
      });
    }
  }
  return plans;
}

export async function handleTodoGreenClientIntelligence(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (!['GET', 'POST'].includes(request.method)) return response({ error: "Método não permitido." }, 405);
  const url = new URL(request.url);
  const path = url.pathname.split("/").filter(Boolean);
  const clientId = clean(path[3], 60);
  const subresource = clean(path[4], 40);
  if (!clientId) return response({ error: "Informe o cliente." }, 400);
  const scope = recorteDeCarteira(access, user?.email, "c", "id");
  const row = await env.DB.prepare(
    `SELECT c.id,c.name,c.legal_name,c.document,c.segment,c.notes,c.fields_json,c.revision
       FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${scope.sql}`,
  ).bind(clientId, TENANT_ID, access.ownerId, ...scope.params).first();
  if (!row) return response({ error: "Cliente não encontrado na sua carteira." }, 404);
  // A busca configurada por ESTE espaço (SearXNG próprio, chaves de reserva)
  // decide o `configured` que a tela mostra e o gate do fluxo.
  const envBusca = await envComChavesDeBuscaDoEspaco(env, access.ownerId);
  const fields = parse(row.fields_json, {});
  const cached = fields.intelligence && typeof fields.intelligence === "object" && Number(fields.intelligence.version || 0) >= COMPANY_RESEARCH_VERSION ? fields.intelligence : null;
  const watch = await env.DB.prepare(
    `SELECT enabled,frequency_hours,focus,next_run_at,last_run_at,last_status,last_error,revision
       FROM todogreen_intelligence_watches
      WHERE tenant_id=? AND workspace_owner_id=? AND client_id=?`,
  ).bind(TENANT_ID, access.ownerId, clientId).first().catch(() => null);
  if (subresource === "watch") {
    if (request.method === "GET") return response({ watch: watch ? {
      enabled: Boolean(watch.enabled), frequencyHours: watch.frequency_hours, focus: watch.focus,
      nextRunAt: watch.next_run_at, lastRunAt: watch.last_run_at, status: watch.last_status,
      error: watch.last_error, revision: watch.revision,
    } : null });
    if (!podeNaVertical(access, "crm:manage"))
      return response({ error: "Seu papel não pode configurar o monitoramento da conta." }, 403);
    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled !== false;
    const frequencyHours = [24, 72, 168].includes(Number(body.frequencyHours)) ? Number(body.frequencyHours) : 24;
    const focus = body.focus === "contacts" ? "contacts" : "company";
    const now = new Date().toISOString();
    const nextRun = enabled ? now : new Date(Date.now() + frequencyHours * 3600000).toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_intelligence_watches
         (id,tenant_id,workspace_owner_id,client_id,enabled,frequency_hours,focus,next_run_at,
          last_run_at,last_status,last_error,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,NULL,'pending','',1,?,?,?,?)
       ON CONFLICT(tenant_id,workspace_owner_id,client_id) DO UPDATE SET
         enabled=excluded.enabled,frequency_hours=excluded.frequency_hours,focus=excluded.focus,
         next_run_at=excluded.next_run_at,last_status='pending',last_error='',revision=revision+1,
         updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, clientId, enabled ? 1 : 0,
      frequencyHours, focus, nextRun, user.id, user.id, now, now,
    ).run();
    return response({ watch: { enabled, frequencyHours, focus, nextRunAt: nextRun, status: "pending" } });
  }
  if (request.method === "GET")
    return response({
      intelligence: cached,
      configured: webSearchConfiguration(envBusca).configured,
      watch: watch ? {
        enabled: Boolean(watch.enabled), frequencyHours: watch.frequency_hours, focus: watch.focus,
        nextRunAt: watch.next_run_at, lastRunAt: watch.last_run_at, status: watch.last_status,
        error: watch.last_error, revision: watch.revision,
      } : null,
    });
  const body = await request.json().catch(() => ({}));

  // Edições humanas sobre o que a pesquisa trouxe — sem disparar busca nova.
  // A pesquisa erra (a Gupy entrou como "informação" de conta); a correção da
  // titular é definitiva: o item sai da ficha e a URL entra nos descartes, que
  // as próximas pesquisas respeitam.
  const urlDescartada = safeUrl(clean(body.descartarUrl, 2000));
  const acaoConcluida = clean(body.concluirAcao, 300);
  if (urlDescartada || acaoConcluida) {
    if (!podeNaVertical(access, "crm:manage"))
      return response({ error: "Seu papel não pode editar a inteligência desta conta." }, 403);
    const atual = fields.intelligence && typeof fields.intelligence === "object" ? fields.intelligence : {};
    let intelligence = atual;
    if (urlDescartada) {
      const alvo = normalize(urlDescartada);
      const semItem = (lista) => (Array.isArray(lista) ? lista.filter((item) => normalize(safeUrl(item?.url)) !== alvo) : lista);
      intelligence = {
        ...atual,
        descartes: [...new Set([...(Array.isArray(atual.descartes) ? atual.descartes : []), urlDescartada])].slice(0, 300),
        companyNews: semItem(atual.companyNews),
        segmentNews: semItem(atual.segmentNews),
        openRfqs: semItem(atual.openRfqs),
        supplierLinks: semItem(atual.supplierLinks),
        procurementPeople: semItem(atual.procurementPeople),
        knownContactProfiles: semItem(atual.knownContactProfiles),
        logisticsSignals: semItem(atual.logisticsSignals),
        reviewCandidates: semItem(atual.reviewCandidates),
        esg: atual.esg && typeof atual.esg === "object" ? { ...atual.esg, signals: semItem(atual.esg.signals) } : atual.esg,
      };
    }
    if (acaoConcluida) {
      const feitas = { ...(intelligence.nextActionsDone && typeof intelligence.nextActionsDone === "object" ? intelligence.nextActionsDone : {}) };
      if (body.desfazer === true) delete feitas[acaoConcluida];
      else feitas[acaoConcluida] = new Date().toISOString();
      intelligence = { ...intelligence, nextActionsDone: feitas };
    }
    const agora = new Date().toISOString();
    const gravou = await env.DB.prepare(
      `UPDATE todogreen_clients SET fields_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
    ).bind(JSON.stringify({ ...fields, intelligence }), user.id, agora, row.id, TENANT_ID, access.ownerId, row.revision).run();
    if (!gravou?.meta?.changes) return response({ error: "A conta mudou enquanto você editava. Recarregue a tela." }, 409);
    return response({ intelligence, revision: Number(row.revision || 0) + 1 });
  }

  const resultado = await pesquisarEmpresa(env, {
    linha: row,
    ownerId: access.ownerId,
    userId: user.id,
    forcar: body.force === true,
    focus: body.focus === "contacts" ? "contacts" : "company",
  });
  if (resultado.erro) return response({ error: resultado.erro, failures: resultado.failures }, resultado.status || 502);
  if (resultado.doCache) return response({ intelligence: resultado.relatorio, cached: true });
  return response({ intelligence: resultado.relatorio, enrichment: resultado.enrichment, client: resultado.clientPatch, cached: false });
}

export async function runTodoGreenIntelligenceWatches(env, now = new Date()) {
  if (!env?.DB || !webSearchConfiguration(env).configured) return { processed: 0 };
  const nowIso = now.toISOString();
  const { results } = await env.DB.prepare(
    `SELECT w.id,w.workspace_owner_id,w.client_id,w.frequency_hours,w.focus,w.created_by,
            c.id AS account_id,c.name,c.legal_name,c.document,c.segment,c.notes,c.fields_json,c.revision
       FROM todogreen_intelligence_watches w
       JOIN todogreen_clients c
         ON c.tenant_id=w.tenant_id AND c.workspace_owner_id=w.workspace_owner_id AND c.id=w.client_id
      WHERE w.tenant_id=? AND w.enabled=1 AND w.next_run_at<=? AND c.archived_at IS NULL
      ORDER BY w.next_run_at LIMIT 2`,
  ).bind(TENANT_ID, nowIso).all();
  let processed = 0;
  for (const item of results || []) {
    const next = new Date(now.getTime() + Math.max(24, Number(item.frequency_hours) || 24) * 3600000).toISOString();
    try {
      const result = await pesquisarEmpresa(env, {
        linha: { ...item, id: item.account_id }, ownerId: item.workspace_owner_id, userId: item.created_by,
        forcar: true, focus: item.focus === "contacts" ? "contacts" : "company",
      });
      if (result.erro) throw new Error(result.erro);
      await env.DB.prepare(
        `UPDATE todogreen_intelligence_watches
            SET last_run_at=?,last_status='success',last_error='',next_run_at=?,updated_at=?,revision=revision+1
          WHERE id=?`,
      ).bind(nowIso, next, nowIso, item.id).run();
      processed += 1;
    } catch (error) {
      await env.DB.prepare(
        `UPDATE todogreen_intelligence_watches
            SET last_run_at=?,last_status='error',last_error=?,next_run_at=?,updated_at=?,revision=revision+1
          WHERE id=?`,
      ).bind(nowIso, clean(error?.message, 500), next, nowIso, item.id).run();
    }
  }
  return { processed };
}

/** Pesquisa compartilhada pelos botões do CRM e pelas ações confirmadas da Semente. */
export async function pesquisarEmpresa(env, { linha, ownerId, userId, forcar = false, focus = "company" }) {
  // A busca sai pelo SearXNG (ou pelas chaves) que ESTE espaço cadastrou. Sem
  // esta sobreposição a pesquisa só enxergaria o que está no cofre do Worker, e
  // a instância que a titular ligou na tela não teria efeito.
  const envBusca = await envComChavesDeBuscaDoEspaco(env, ownerId);
  const fields = parse(linha.fields_json, {});
  const cached = fields.intelligence && typeof fields.intelligence === "object" && Number(fields.intelligence.version || 0) >= COMPANY_RESEARCH_VERSION ? fields.intelligence : null;
  const idadeDoCache = cached?.checkedAt ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
  const cachedHasContacts = Number(cached?.contactSearchQuality?.accepted || 0) > 0 || Number(cached?.knownContactProfiles?.length || 0) > 0;
  if (!forcar && focus !== "contacts" && idadeDoCache < 24 * 60 * 60 * 1000 && cachedHasContacts)
    return { relatorio: cached, doCache: true };

  const company = clean(linha.name, 200);
  const segment = clean(linha.segment, 120);
  const year = new Date().getUTCFullYear();
  const knownContacts = Array.isArray(fields.contacts) ? fields.contacts : [];
  const plans = buildCompanyResearchPlans({ company, segment, year, focus, knownContacts });
  const [planResults, publicRegistry] = await Promise.all([
    Promise.all(plans.map(async (plan) => ({ ...plan, ...(await searchWeb(envBusca, plan.query)) }))),
    lookupPublicCompanyRegistry(linha.document),
  ]);
  const settled = planResults.flatMap((item) => item.kinds.map((kind) => ({
    kind,
    configured: item.configured,
    results: (item.results || []).map((result) => ({
      ...result,
      searchScope: item.contactScope || "",
      knownContactName: item.knownContactName || "",
      knownContactNames: item.knownContactNames || [],
    })),
  })));
  if (planResults.every((item) => !item.configured)) {
    console.error("Pesquisa de empresa: nenhuma fonte de busca configurada", { company });
    return { erro: "Pesquisa web indisponível. A integração precisa ser revisada por um administrador.", status: 503 };
  }
  const report = classifyCompanyResearch({
    company, segment, searches: settled, knownContacts, publicRegistry,
    checkedAt: new Date().toISOString(),
    discardedUrls: Array.isArray(fields.intelligence?.descartes) ? fields.intelligence.descartes : [],
  });
  report.providers = [...new Set(planResults.flatMap((item) => item.providers || []))];
  report.failures = planResults.flatMap((item) => item.failures || []).slice(0, 12);
  if (!report.providers.length && report.failures.length) {
    console.error("Pesquisa de empresa: nenhum provedor respondeu", { company, failures: report.failures });
    return { erro: "A pesquisa web está configurada, mas o provedor não respondeu. Tente novamente em instantes.", failures: report.failures, status: 502 };
  }
  // O caso silencioso: o provedor RESPONDEU, então nenhum dos dois erros acima
  // dispara — mas veio vazio, e a pessoa recebe uma pesquisa que não achou
  // nada, sem distinguir isso de "esta empresa não tem presença na web". Não é
  // erro a ponto de recusar a resposta; é sinal a ponto de precisar aparecer
  // em algum lugar quando alguém for investigar "a pesquisa não funciona".
  if (!report.failures.length && !settled.some((item) => item.results.length))
    console.error("Pesquisa de empresa: provedor respondeu sem nenhum resultado", {
      company,
      providers: report.providers,
    });
  else if (report.failures.length)
    console.error("Pesquisa de empresa: parte dos provedores falhou", {
      company,
      providers: report.providers,
      failures: report.failures,
    });
  const allExistingContacts = Array.isArray(fields.contacts) ? fields.contacts : [];
  const {
    contacts: existingContacts,
    staleWebContactsRemoved,
    formerContactsMarkedInactive,
    legacyContactsRetained,
  } = reconcileResearchedContacts({
    existingContacts: allExistingContacts,
    contactCandidates: report.contactCandidates,
    formerContacts: report.formerContacts,
    checkedAt: report.checkedAt,
  });
  let contactsUpdated = 0;
  const matchedCandidates = new Set();
  const enrichedContacts = existingContacts.map((existing) => {
    const match = (report.contactCandidates || []).find((candidate) =>
      (normalize(existing.linkedinUrl) && normalize(existing.linkedinUrl) === normalize(candidate.linkedinUrl)) ||
      (normalize(existing.email) && normalize(existing.email) === normalize(candidate.email)) ||
      normalize(existing.name) === normalize(candidate.name));
    if (!match) return existing;
    matchedCandidates.add(match.linkedinUrl);
    const currentEmploymentVerified = match.currentEmploymentVerified === true;
    const next = {
      ...existing,
      title: existing.title || match.title,
      department: existing.department || match.department,
      email: existing.email || match.email,
      phone: existing.phone || match.phone,
      linkedinUrl: existing.linkedinUrl || match.linkedinUrl,
      source: existing.source || "Cadastro existente",
      sourceUrl: existing.sourceUrl || match.sourceUrl,
      validation: existing.validation || match.validation,
      confidence: match.confidence || existing.confidence || "moderada",
      evidence: match.evidence || existing.evidence || null,
      country: existing.country || match.country,
      specialty: existing.specialty || match.specialty,
      currentEmploymentVerified,
      employmentCheckedAt: report.checkedAt,
      employmentStatus: currentEmploymentVerified ? "current" : "unknown",
      researchVersion: COMPANY_RESEARCH_VERSION,
      active: currentEmploymentVerified && existing.active === false && existing.employmentStatus === "former" ? true : existing.active,
    };
    if (JSON.stringify(next) !== JSON.stringify(existing)) contactsUpdated += 1;
    return next;
  });
  const existingIdentities = new Set(enrichedContacts.flatMap((item) => [normalize(item.linkedinUrl), normalize(item.email), normalize(item.name)].filter(Boolean)));
  const discoveredContacts = (report.contactCandidates || []).filter((item) => item.currentEmploymentVerified === true && !matchedCandidates.has(item.linkedinUrl) && !existingIdentities.has(normalize(item.linkedinUrl)) && !existingIdentities.has(normalize(item.email)) && !existingIdentities.has(normalize(item.name)));
  const {
    filledLegalName, filledSegment, filledWebsite, filledLinkedin, filledHeadquarters,
    websiteEnrichment, qualification, filledQualification,
  } = buildPublicAccountEnrichment({ line: linha, fields, report, company });
  report.autoEnrichment = {
    legalNameFilled: !clean(linha.legal_name, 200) && Boolean(filledLegalName),
    segmentFilled: !clean(linha.segment, 120) && Boolean(filledSegment),
    websiteFilled: websiteEnrichment.filled,
    websiteCorrected: websiteEnrichment.corrected,
    invalidWebsiteRemoved: websiteEnrichment.removed,
    linkedinFilled: !clean(fields.linkedinUrl, 1000) && Boolean(filledLinkedin),
    headquartersFilled: !clean(fields.headquarters, 160) && Boolean(filledHeadquarters),
    contactsAdded: discoveredContacts.length,
    contactsUpdated,
    legacyContactsRemoved: staleWebContactsRemoved,
    legacyContactsRetained,
    formerContactsMarkedInactive,
  };
  const nextContacts = [...enrichedContacts, ...discoveredContacts];
  report.autoEnrichment.qualificationFilled = filledQualification;
  const previousEvidence = fields.enrichmentEvidence && typeof fields.enrichmentEvidence === "object"
    ? fields.enrichmentEvidence
    : {};
  const enrichmentEvidence = {
    ...previousEvidence,
    ...(!clean(linha.legal_name, 200) && filledLegalName ? { legalName: evidence(report.suggestedLegalName, report.checkedAt) } : {}),
    ...(!clean(linha.segment, 120) && filledSegment ? { segment: evidence(report.suggestedSegment, report.checkedAt) } : {}),
    ...(websiteEnrichment.filled || websiteEnrichment.corrected ? { website: evidence({ value: filledWebsite, ...report.officialWebsite, source: report.officialWebsite }, report.checkedAt) } : {}),
    ...(!clean(fields.linkedinUrl, 1000) && filledLinkedin ? { linkedinUrl: evidence({ value: filledLinkedin, ...report.linkedinCompany, source: report.linkedinCompany }, report.checkedAt) } : {}),
    ...(!clean(fields.headquarters, 160) && filledHeadquarters ? { headquarters: evidence(report.suggestedHeadquarters, report.checkedAt) } : {}),
  };
  const nextFields = { ...fields, website: filledWebsite, linkedinUrl: filledLinkedin, headquarters: filledHeadquarters, qualification, contacts: nextContacts, intelligence: report, enrichmentEvidence };
  await env.DB.prepare(
    `UPDATE todogreen_clients SET legal_name=?,segment=?,fields_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(filledLegalName, filledSegment, JSON.stringify(nextFields), userId, report.checkedAt, linha.id, TENANT_ID, ownerId).run();
  return {
    relatorio: report,
    enrichment: report.autoEnrichment,
    clientPatch: {
      id: linha.id,
      legalName: filledLegalName,
      segment: filledSegment,
      revision: Number(linha.revision || 0) + 1,
      updatedAt: report.checkedAt,
      crm: { website: filledWebsite, linkedinUrl: filledLinkedin, headquarters: filledHeadquarters, qualification, contacts: nextContacts, intelligence: report, enrichmentEvidence },
    },
    doCache: false,
  };
}
