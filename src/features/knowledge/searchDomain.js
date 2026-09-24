// ===== Busca por significado no workspace, com citação da origem =====
// Camada pura, sem rede: índice invertido + BM25 + sinônimos da empresa +
// trecho destacado + detecção de duplicado e de conteúdo velho.
// A busca semântica "de verdade" (embeddings) exigiria armazenar vetores; aqui
// o ganho vem de normalização agressiva, radicais e glossário — que resolve o
// caso real de um negócio pequeno sem custo e sem depender de modelo.

// `page` é a tela do app que abre cada coleção. O id da coleção ("tasks",
// "wikiPages") não é id de tela: "Abrir" mandava para uma página inexistente
// e a pessoa via uma tela em branco.
export const SEARCHABLE_SOURCES = [
  { id: "tasks", label: "Tarefas", page: "operacao", titleField: "title", bodyFields: ["notes", "project"] },
  { id: "documents", label: "Documentos", page: "documentos", titleField: "title", bodyFields: ["content", "type"] },
  { id: "meetings", label: "Reuniões", page: "reunioes", titleField: "title", bodyFields: ["transcript", "client"] },
  { id: "leads", label: "CRM", page: "vendas", titleField: "name", bodyFields: ["company", "notes", "status"] },
  { id: "contacts", label: "Contatos", page: "contatos", titleField: "name", bodyFields: ["email", "phone", "notes"] },
  { id: "bills", label: "Contas", page: "contas", titleField: "description", bodyFields: ["contactName", "category"] },
  { id: "transactions", label: "Financeiro", page: "financeiro", titleField: "description", bodyFields: ["category", "type"] },
  { id: "opportunities", label: "Funil", page: "funil", titleField: "title", bodyFields: ["contactName", "notes"] },
  { id: "objectives", label: "Metas", page: "metas", titleField: "title", bodyFields: ["description"] },
  { id: "wikiPages", label: "Base de conhecimento", page: "wiki", titleField: "title", bodyFields: ["content"] },
  { id: "memories", label: "Memória da IA", page: "memoria-busca", titleField: "text", bodyFields: ["scopeRef"] },
];

// Palavras muito comuns em português não ajudam a distinguir nada.
const STOPWORDS = new Set([
  "para","com","que","dos","das","uma","por","como","mas","não","nao","sem","sobre",
  "este","esta","isso","aquele","aquela","pelo","pela","nos","nas","meu","minha",
  "seu","sua","ele","ela","eles","elas","foi","ser","tem","ter","fazer","mais",
  "muito","todo","toda","quando","onde","qual","quais","the","and","for",
]);

export const normalizeToken = (word) =>
  String(word || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// Radical simples para português: corta plural e sufixos comuns. Não é um
// stemmer completo, mas faz "pagamento/pagamentos" e "cliente/clientes"
// caírem no mesmo termo, que é o que importa aqui.
export const stem = (word) => {
  let w = normalizeToken(word);
  if (w.length <= 4) return w;
  w = w.replace(/(coes|çoes|oes)$/, "ao");
  w = w.replace(/(mentos|mento)$/, "ment");
  w = w.replace(/(acao|acoes)$/, "ac");
  w = w.replace(/(ais|eis|ois|uis)$/, "l");
  w = w.replace(/(ns)$/, "m");
  w = w.replace(/s$/, "");
  return w;
};

export const tokenize = (text) =>
  String(text || "")
    .split(/\s+/)
    .map(normalizeToken)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);

// Glossário da empresa: "NF" significa "nota fiscal", "DAS" o imposto do MEI.
// Expandir a consulta pelos sinônimos é o que mais aproxima de busca semântica
// sem modelo nenhum.
export const expandWithSynonyms = (tokens, glossary = []) => {
  const mapa = new Map();
  for (const entrada of glossary || []) {
    const termos = [entrada?.term, ...(entrada?.synonyms || [])]
      .filter(Boolean)
      .map((t) => tokenize(t).join(" "))
      .filter(Boolean);
    for (const t of termos)
      mapa.set(
        t,
        termos.flatMap((x) => x.split(" ")),
      );
  }
  const expandidos = new Set(tokens);
  for (const token of tokens) {
    const alvo = mapa.get(token);
    if (alvo) for (const extra of alvo) expandidos.add(extra);
  }
  return [...expandidos];
};

const valorDoCampo = (item, campo) => {
  const v = item?.[campo];
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" ");
  if (typeof v === "object") return "";
  return String(v);
};

// Monta os documentos indexáveis a partir do workspace, respeitando o negócio
// ativo e a visibilidade de cada item.
export const buildIndex = (db, { businessId = null, userId = null } = {}) => {
  const docs = [];
  for (const fonte of SEARCHABLE_SOURCES) {
    const lista = db?.[fonte.id];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      if (businessId && item.businessId && item.businessId !== businessId) continue;
      // Respeita a visibilidade: privado de outra pessoa não entra na busca.
      if (
        item.visibility === "privado" &&
        item.ownerId &&
        userId &&
        item.ownerId !== userId
      )
        continue;
      const titulo = valorDoCampo(item, fonte.titleField);
      const corpo = fonte.bodyFields.map((c) => valorDoCampo(item, c)).join(" ");
      if (!titulo && !corpo) continue;
      docs.push({
        id: `${fonte.id}:${item.id}`,
        sourceId: fonte.id,
        sourceLabel: fonte.label,
        sourcePage: fonte.page,
        itemId: item.id,
        title: titulo || "(sem título)",
        body: corpo,
        updatedAt: item.updatedAt || item.createdAt || "",
        titleTokens: tokenize(titulo),
        bodyTokens: tokenize(corpo),
      });
    }
  }
  return docs;
};

// BM25: pontua por frequência do termo no documento e raridade no acervo.
// O título pesa mais que o corpo, porque é o que a pessoa lembra.
export const scoreDocuments = (
  docs,
  queryTokens,
  { titleBoost = 3, k1 = 1.5, b = 0.75 } = {},
) => {
  const total = (docs || []).length;
  if (total === 0 || (queryTokens || []).length === 0) return [];
  const df = new Map();
  for (const doc of docs) {
    const presentes = new Set([...doc.titleTokens, ...doc.bodyTokens]);
    for (const t of presentes) df.set(t, (df.get(t) || 0) + 1);
  }
  const tamanhos = docs.map((d) => d.titleTokens.length + d.bodyTokens.length);
  const media = tamanhos.reduce((s, n) => s + n, 0) / total || 1;
  const resultados = [];
  for (const doc of docs) {
    const comprimento = doc.titleTokens.length + doc.bodyTokens.length || 1;
    let score = 0;
    const casados = [];
    for (const termo of queryTokens) {
      const noTitulo = doc.titleTokens.filter((t) => t === termo).length;
      const noCorpo = doc.bodyTokens.filter((t) => t === termo).length;
      const tf = noTitulo * titleBoost + noCorpo;
      if (tf === 0) continue;
      casados.push(termo);
      const n = df.get(termo) || 0;
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (comprimento / media))));
    }
    if (score > 0)
      resultados.push({
        doc,
        score: Math.round(score * 1000) / 1000,
        matched: casados,
      });
  }
  return resultados.sort((a, b2) => b2.score - a.score);
};

// Trecho ao redor da primeira ocorrência, com a palavra marcada por «».
export const snippetFor = (text, queryTokens, { size = 160 } = {}) => {
  const bruto = String(text || "").replace(/\s+/g, " ").trim();
  if (!bruto) return "";
  const palavras = bruto.split(" ");
  const alvo = new Set(queryTokens || []);
  let indice = palavras.findIndex((p) => alvo.has(stem(p)));
  if (indice < 0) return bruto.slice(0, size) + (bruto.length > size ? "..." : "");
  const inicio = Math.max(0, indice - 12);
  const pedaco = palavras
    .slice(inicio, inicio + 30)
    .map((p) => (alvo.has(stem(p)) ? `«${p}»` : p))
    .join(" ");
  return `${inicio > 0 ? "..." : ""}${pedaco}${
    inicio + 30 < palavras.length ? "..." : ""
  }`;
};

// Busca completa: devolve resultados com a fonte, o trecho e onde clicar.
export const searchWorkspace = (
  db,
  query,
  { businessId = null, userId = null, glossary = [], limit = 20, sources = [] } = {},
) => {
  const tokens = expandWithSynonyms(tokenize(query), glossary);
  if (tokens.length === 0) return { results: [], tokens: [], total: 0 };
  let docs = buildIndex(db, { businessId, userId });
  if ((sources || []).length > 0)
    docs = docs.filter((d) => sources.includes(d.sourceId));
  const pontuados = scoreDocuments(docs, tokens);
  return {
    tokens,
    total: pontuados.length,
    results: pontuados.slice(0, limit).map(({ doc, score, matched }) => ({
      id: doc.id,
      sourceId: doc.sourceId,
      sourceLabel: doc.sourceLabel,
      sourcePage: doc.sourcePage,
      itemId: doc.itemId,
      title: doc.title,
      snippet: snippetFor(doc.body || doc.title, tokens),
      score,
      matched,
      updatedAt: doc.updatedAt,
    })),
  };
};

// Conteúdo repetido no workspace: dois itens da mesma fonte dizendo o mesmo.
export const findDuplicates = (db, { businessId = null, threshold = 0.75 } = {}) => {
  const docs = buildIndex(db, { businessId });
  const pares = [];
  const porFonte = new Map();
  for (const doc of docs) {
    if (!porFonte.has(doc.sourceId)) porFonte.set(doc.sourceId, []);
    porFonte.get(doc.sourceId).push(doc);
  }
  for (const [, lista] of porFonte)
    for (let i = 0; i < lista.length; i += 1)
      for (let j = i + 1; j < lista.length; j += 1) {
        const A = new Set(lista[i].titleTokens);
        const B = new Set(lista[j].titleTokens);
        if (A.size === 0 || B.size === 0) continue;
        let comuns = 0;
        for (const t of A) if (B.has(t)) comuns += 1;
        const jaccard = comuns / (A.size + B.size - comuns);
        if (jaccard >= threshold)
          pares.push({
            sourceLabel: lista[i].sourceLabel,
            a: { id: lista[i].itemId, title: lista[i].title },
            b: { id: lista[j].itemId, title: lista[j].title },
            similarity: Math.round(jaccard * 100) / 100,
          });
      }
  return pares.sort((x, y) => y.similarity - x.similarity);
};

// Conteúdo velho: não é mexido há muito tempo. Só avisa — não apaga nada.
export const staleContent = (db, today, { businessId = null, days = 180 } = {}) => {
  const limite = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return buildIndex(db, { businessId })
    .filter((d) => d.updatedAt && String(d.updatedAt).slice(0, 10) < limite)
    .map((d) => ({
      sourceLabel: d.sourceLabel,
      itemId: d.itemId,
      title: d.title,
      updatedAt: String(d.updatedAt).slice(0, 10),
    }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
};

// Prompt de resposta com citação: a IA só pode usar os trechos entregues, e
// tem de citar de onde tirou. É o que evita resposta inventada.
export const buildAnswerPrompt = (query, results) => {
  const fontes = (results || [])
    .slice(0, 6)
    .map(
      (r, i) =>
        `[${i + 1}] (${r.sourceLabel} — ${r.title})\n${String(r.snippet || "").replace(/[«»]/g, "")}`,
    )
    .join("\n\n");
  return `Responda à pergunta usando SOMENTE os trechos abaixo, que vêm do próprio sistema desta empresa.

Regras:
- Cite a fonte de cada afirmação no formato [1], [2].
- Se os trechos não responderem, diga exatamente: "Não encontrei essa informação no seu workspace." Não complete com conhecimento geral.
- Responda em português do Brasil, direto, em no máximo dois parágrafos.

Pergunta: ${query}

Trechos:
${fontes || "(nenhum trecho encontrado)"}`;
};

export const makeGlossaryEntry = (id, { term = "", synonyms = [] } = {}) => ({
  id,
  term: String(term).trim(),
  synonyms: (synonyms || []).map((s) => String(s).trim()).filter(Boolean),
});
