const STOP_WORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "eu",
  "o",
  "os",
  "para",
  "por",
  "que",
  "se",
  "um",
  "uma",
]);

const words = (value) =>
  String(value || "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[\p{L}\p{N}]{3,}/gu) || [];

const meaningfulWords = (value) =>
  [...new Set(words(value).filter((word) => !STOP_WORDS.has(word)))];

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function evaluateAiResponse({
  prompt = "",
  response = "",
  sources = "",
} = {}) {
  const promptTerms = meaningfulWords(prompt);
  const responseTerms = new Set(meaningfulWords(response));
  const matchedTerms = promptTerms.filter((term) => responseTerms.has(term));
  const relevance = promptTerms.length
    ? clampScore((matchedTerms.length / promptTerms.length) * 100)
    : 0;
  const responseLength = String(response).trim().length;
  const hasStructure = /(^|\n)\s*(?:[-*]|\d+[.)]|#{1,3})\s+/m.test(response);
  const hasAction = /\b(próximo|passo|faça|implemente|crie|teste|prioridade)\b/i.test(
    response,
  );
  const hasCaveat =
    /\b(limite|risco|incerteza|estimativa|pode variar|não substitui)\b/i.test(
      response,
    );
  const sourceLines = String(sources)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasLinks = /https?:\/\/\S+/i.test(`${response}\n${sources}`);

  const dimensions = {
    relevance,
    completeness: clampScore(
      Math.min(70, responseLength / 8) + (hasAction ? 20 : 0) + (hasStructure ? 10 : 0),
    ),
    clarity: clampScore(
      45 +
        (hasStructure ? 30 : 0) +
        (responseLength >= 80 && responseLength <= 4_000 ? 20 : 0),
    ),
    evidence: clampScore(
      (sourceLines.length ? 55 : 0) + (hasLinks ? 35 : 0) + (hasCaveat ? 10 : 0),
    ),
    safety: clampScore(
      65 +
        (hasCaveat ? 20 : 0) -
        (/\b(garantido|100% certo|sem risco|nunca falha)\b/i.test(response)
          ? 35
          : 0),
    ),
  };
  const score = clampScore(
    dimensions.relevance * 0.3 +
      dimensions.completeness * 0.22 +
      dimensions.clarity * 0.18 +
      dimensions.evidence * 0.18 +
      dimensions.safety * 0.12,
  );
  const suggestions = [];
  if (dimensions.relevance < 60)
    suggestions.push("Retome explicitamente os termos e o objetivo do pedido.");
  if (dimensions.completeness < 65)
    suggestions.push("Inclua ações concretas, responsáveis ou próximos passos.");
  if (dimensions.clarity < 65)
    suggestions.push("Separe a resposta em blocos curtos e escaneáveis.");
  if (dimensions.evidence < 60)
    suggestions.push("Adicione fontes verificáveis e diferencie fatos de estimativas.");
  if (dimensions.safety < 70)
    suggestions.push("Declare limites e evite promessas absolutas.");

  return {
    score,
    dimensions,
    matchedTerms,
    suggestions,
    verdict:
      score >= 80 ? "forte" : score >= 60 ? "precisa de revisão leve" : "revisão necessária",
    disclaimer:
      "Avaliação heurística: ajuda a revisar, mas não comprova que a resposta esteja correta.",
  };
}

const APP_BLOCKS = {
  hero: (title, id) => ({
    id,
    type: "hero",
    title,
    text: "Uma solução simples, clara e pronta para receber clientes.",
  }),
  benefits: (_title, id) => ({
    id,
    type: "benefits",
    title: "Por que escolher",
    items: ["Atendimento próximo", "Processo transparente", "Resultado prático"],
  }),
  form: (_title, id) => ({
    id,
    type: "form",
    title: "Peça um contato",
    fields: ["Nome", "WhatsApp", "Mensagem"],
  }),
  faq: (_title, id) => ({
    id,
    type: "faq",
    title: "Dúvidas frequentes",
    items: ["Como funciona?", "Qual é o prazo?", "Como começo?"],
  }),
  metrics: (_title, id) => ({
    id,
    type: "metrics",
    title: "Indicadores",
    items: ["Clientes", "Pedidos", "Conversão"],
  }),
};

const cleanName = (value, fallback = "Meu aplicativo") =>
  String(value || fallback)
    .replace(/[<>{}]/g, "")
    .trim()
    .slice(0, 80) || fallback;

export function appFromPrompt(
  prompt,
  businessName = "",
  createId = () => crypto.randomUUID(),
) {
  const source = String(prompt || "").trim();
  const titleMatch = source.match(
    /(?:chamad[oa]|nome|título|titulo)\s+["“]?([^".\n”]{3,80})/i,
  );
  const name = cleanName(titleMatch?.[1] || businessName || source.split(/[.!?\n]/)[0]);
  const lower = source.toLocaleLowerCase("pt-BR");
  const types = ["hero", "benefits"];
  if (/(formulário|formulario|contato|lead|orçamento|orcamento)/i.test(lower))
    types.push("form");
  if (/(faq|dúvida|duvida|pergunta)/i.test(lower)) types.push("faq");
  if (/(painel|dashboard|indicador|métrica|metrica)/i.test(lower))
    types.push("metrics");
  if (types.length === 2) types.push("form", "faq");
  return {
    version: 1,
    name,
    theme: {
      accent: "#6d4aff",
      background: "#f7f6ff",
      surface: "#ffffff",
      text: "#17152b",
    },
    blocks: types.map((type, index) => APP_BLOCKS[type](name, createId(type, index))),
  };
}

const officialBlockIds = (templateId) => (type, index) =>
  `${templateId}-${type}-${index + 1}`;

export function normalizeAppSchema(input) {
  const source = input && typeof input === "object" ? input : {};
  const theme = source.theme && typeof source.theme === "object" ? source.theme : {};
  const allowedTypes = new Set(Object.keys(APP_BLOCKS));
  return {
    version: 1,
    name: cleanName(source.name),
    theme: {
      accent: /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : "#6d4aff",
      background: /^#[0-9a-f]{6}$/i.test(theme.background)
        ? theme.background
        : "#f7f6ff",
      surface: /^#[0-9a-f]{6}$/i.test(theme.surface) ? theme.surface : "#ffffff",
      text: /^#[0-9a-f]{6}$/i.test(theme.text) ? theme.text : "#17152b",
    },
    blocks: (Array.isArray(source.blocks) ? source.blocks : [])
      .filter((block) => block && allowedTypes.has(block.type))
      .slice(0, 20)
      .map((block) => ({
        id: String(block.id || crypto.randomUUID()).slice(0, 80),
        type: block.type,
        title: cleanName(block.title, "Bloco"),
        text: String(block.text || "").replace(/[<>]/g, "").slice(0, 500),
        items: (Array.isArray(block.items) ? block.items : [])
          .slice(0, 8)
          .map((item) => String(item).replace(/[<>]/g, "").slice(0, 100)),
        fields: (Array.isArray(block.fields) ? block.fields : [])
          .slice(0, 8)
          .map((item) => String(item).replace(/[<>]/g, "").slice(0, 100)),
      })),
  };
}

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export function appSchemaToHtml(input) {
  const schema = normalizeAppSchema(input);
  const blocks = schema.blocks
    .map((block) => {
      if (block.type === "hero")
        return `<section class="hero"><h1>${escapeHtml(block.title)}</h1><p>${escapeHtml(block.text)}</p><a href="#contato">Quero conversar</a></section>`;
      if (block.type === "form")
        return `<section id="contato"><h2>${escapeHtml(block.title)}</h2><form>${block.fields
          .map(
            (field) =>
              `<label>${escapeHtml(field)}<input aria-label="${escapeHtml(field)}" /></label>`,
          )
          .join("")}<button type="button">Enviar</button></form></section>`;
      return `<section><h2>${escapeHtml(block.title)}</h2><ul>${block.items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul></section>`;
    })
    .join("");
  const { accent, background, surface, text } = schema.theme;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(schema.name)}</title><style>*{box-sizing:border-box}body{margin:0;background:${background};color:${text};font:16px system-ui}section{max-width:920px;margin:24px auto;padding:48px;background:${surface};border-radius:24px}.hero{padding:72px 48px}h1{font-size:clamp(2rem,7vw,4.5rem);margin:0 0 16px}h2{font-size:2rem}a,button{display:inline-block;background:${accent};color:white;border:0;border-radius:12px;padding:14px 20px;text-decoration:none;font-weight:700}form{display:grid;gap:14px}label{display:grid;gap:6px}input{padding:12px;border:1px solid #bbb;border-radius:10px}li{margin:10px 0}@media(max-width:640px){section,.hero{margin:12px;padding:28px}}</style></head><body>${blocks}</body></html>`;
}

export const OFFICIAL_TEMPLATES = [
  {
    id: "official-leads",
    name: "Página de captação",
    description: "Apresentação, benefícios, formulário e dúvidas frequentes.",
    category: "Vendas",
    license: "CC0-1.0",
    publisherName: "To Do Green",
    schema: appFromPrompt(
      "Landing page com formulário de contato e FAQ",
      "Captação de clientes",
      officialBlockIds("official-leads"),
    ),
  },
  {
    id: "official-dashboard",
    name: "Painel de operação",
    description: "Indicadores essenciais para acompanhar a rotina.",
    category: "Gestão",
    license: "CC0-1.0",
    publisherName: "To Do Green",
    schema: appFromPrompt(
      "Dashboard com indicadores",
      "Painel de operação",
      officialBlockIds("official-dashboard"),
    ),
  },
  {
    id: "official-services",
    name: "Catálogo de serviços",
    description: "Página responsiva para apresentar serviços e receber contatos.",
    category: "Marketing",
    license: "CC0-1.0",
    publisherName: "To Do Green",
    schema: appFromPrompt(
      "Site de serviços com contato",
      "Nossos serviços",
      officialBlockIds("official-services"),
    ),
  },
];

export function moderateTemplate({ name, description, license, schema }) {
  const allowedLicenses = new Set(["CC0-1.0", "CC-BY-4.0", "MIT"]);
  const combined = `${name || ""} ${description || ""} ${JSON.stringify(schema || {})}`;
  const forbidden =
    /<script|javascript:|onerror\s*=|onload\s*=|roubar senha|phishing|malware/i;
  const reasons = [];
  if (!String(name || "").trim()) reasons.push("Informe um nome.");
  if (!allowedLicenses.has(license)) reasons.push("Escolha uma licença permitida.");
  if (forbidden.test(combined)) reasons.push("Conteúdo executável ou malicioso não é permitido.");
  if (!normalizeAppSchema(schema).blocks.length)
    reasons.push("O template precisa ter ao menos um bloco válido.");
  return { approved: reasons.length === 0, reasons };
}

export function localTemplateAnswer(prompt, businessName = "") {
  const subject = String(prompt || "").trim() || "esta demanda";
  return `Plano local para ${businessName || "seu negócio"}:

1. Objetivo: resolver ${subject}.
2. Ação imediata: defina o resultado esperado e o prazo.
3. Execução: quebre o trabalho em até três entregas pequenas.
4. Validação: teste com uma pessoa ou cliente e registre o retorno.
5. Próximo passo: ajuste o que falhou antes de ampliar.

Esta resposta foi criada por um modelo determinístico no seu navegador, sem enviar dados para uma API.`;
}
