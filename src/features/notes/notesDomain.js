// ===== Conhecimento conectado: notas ligadas, grafo, diário e revisão =====
// Camada pura. A ideia central não é "mais um editor de texto": é a nota deixar
// de ser um arquivo solto e virar parte de uma rede, onde uma anotação puxa a
// outra e nada se perde por ter sido escrita no dia errado.

const NON_LETTER = "(?![\\p{L}\\p{N}])";

// Regex escapado para uso literal dentro de outra expressão.
const escapeRe = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Acento é letra. `\b` do JavaScript NÃO enxerga isso: /\bnotação\b/ nunca casa
// direito porque "ç" e "ã" ficam fora da classe \w. Por isso toda a fronteira de
// palavra deste módulo é feita com lookahead Unicode, nunca com \b.
export const normalize = (texto) =>
  String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

export const addDays = (date, days) => {
  if (!isDate(date)) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
};

export const daysBetween = (de, ate) => {
  if (!isDate(de) || !isDate(ate)) return 0;
  return Math.round(
    (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000,
  );
};

// ---------------------------------------------------------------------------
// Nota
// ---------------------------------------------------------------------------

export const makeNote = (
  id,
  {
    title = "",
    content = "",
    kind = "nota", // nota | diaria | atomica
    date = "",
    tags = [],
    businessId = "",
    linkedEntities = [],
    createdAt = "",
    updatedAt = "",
  } = {},
) => ({
  id,
  title: String(title || "").trim(),
  content: String(content || ""),
  kind,
  date,
  tags: [...new Set(tags.map((t) => String(t || "").trim()).filter(Boolean))],
  businessId,
  linkedEntities: linkedEntities
    .filter((item) => item && item.id && item.type)
    .map((item) => ({
      type: String(item.type),
      id: String(item.id),
      name: String(item.name || ""),
      route: String(item.route || ""),
    })),
  createdAt: createdAt || new Date().toISOString(),
  updatedAt: updatedAt || createdAt || new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Ligações: [[nota]] e #etiqueta
// ---------------------------------------------------------------------------

// Aceita [[Nota]] e [[Nota|texto que aparece]].
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

export const parseLinks = (texto) => {
  const achados = [];
  const vistos = new Set();
  for (const m of String(texto || "").matchAll(LINK_RE)) {
    const alvo = m[1].trim();
    if (!alvo) continue;
    const chave = normalize(alvo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    achados.push({ target: alvo, alias: (m[2] || "").trim() });
  }
  return achados;
};

export const parseTags = (texto) => {
  const achados = [];
  const vistos = new Set();
  // Etiqueta dentro de [[...]] não conta: lá o # faz parte do endereço do bloco.
  const limpo = String(texto || "").replace(LINK_RE, " ");
  for (const m of limpo.matchAll(TAG_RE)) {
    const t = m[2];
    const chave = normalize(t);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    achados.push(t);
  }
  return achados;
};

// Índice por título normalizado. Título repetido é problema real de quem escreve
// muito, então o índice guarda a lista e quem consulta decide o que fazer.
export const indexByTitle = (notes = []) => {
  const mapa = new Map();
  for (const n of notes) {
    const chave = normalize(n.title);
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(n);
  }
  return mapa;
};

export const duplicateTitles = (notes = []) =>
  [...indexByTitle(notes).entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([chave, lista]) => ({ key: chave, title: lista[0].title, notes: lista }));

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

// Uma ligação para nota que ainda não existe NÃO é erro: é o jeito normal de
// escrever primeiro e criar depois. Ela vira um nó "a criar", nunca um crash.
export const buildGraph = (notes = []) => {
  const porTitulo = indexByTitle(notes);
  const nodes = notes.map((n) => ({
    id: n.id,
    title: n.title,
    kind: n.kind,
    missing: false,
  }));
  const idsExistentes = new Set(nodes.map((n) => n.id));
  const edges = [];
  const faltando = new Map();

  for (const n of notes) {
    for (const { target } of parseLinks(n.content)) {
      const chave = normalize(target);
      const destino = porTitulo.get(chave)?.[0];
      if (destino) {
        if (destino.id === n.id) continue; // nota que liga para si mesma
        edges.push({ from: n.id, to: destino.id, missing: false });
      } else {
        const idFalso = `ausente:${chave}`;
        if (!faltando.has(idFalso)) {
          faltando.set(idFalso, { id: idFalso, title: target, kind: "ausente", missing: true });
        }
        edges.push({ from: n.id, to: idFalso, missing: true });
      }
    }
  }

  for (const nó of faltando.values()) {
    if (!idsExistentes.has(nó.id)) nodes.push(nó);
  }
  return { nodes, edges };
};

export const backlinksFor = (noteId, notes = []) => {
  const alvo = notes.find((n) => n.id === noteId);
  if (!alvo) return [];
  const chave = normalize(alvo.title);
  if (!chave) return [];
  return notes
    .filter((n) => n.id !== noteId)
    .map((n) => {
      const liga = parseLinks(n.content).some((l) => normalize(l.target) === chave);
      if (!liga) return null;
      return { note: n, excerpt: excerptAround(n.content, alvo.title) };
    })
    .filter(Boolean);
};

// Menção não vinculada: a nota cita o título em texto corrido mas não ligou.
// Duas armadilhas cobertas aqui: (1) fronteira de palavra com acento, que o \b
// erra; (2) não acusar o que já está dentro de [[...]], senão toda ligação
// existente apareceria como "faltando ligar".
export const unlinkedMentions = (noteId, notes = []) => {
  const alvo = notes.find((n) => n.id === noteId);
  if (!alvo) return [];
  const titulo = alvo.title.trim();
  if (titulo.length < 3) return []; // título curto demais gera ruído
  const chave = normalize(titulo);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(chave)}${NON_LETTER}`, "u");

  return notes
    .filter((n) => n.id !== noteId)
    .map((n) => {
      const jaLiga = parseLinks(n.content).some((l) => normalize(l.target) === chave);
      if (jaLiga) return null;
      const semLinks = n.content.replace(LINK_RE, " ");
      if (!re.test(normalize(semLinks))) return null;
      return { note: n, excerpt: excerptAround(n.content, titulo) };
    })
    .filter(Boolean);
};

const excerptAround = (texto, termo, raio = 60) => {
  // A marcação [[...]] some do trecho: quem lê o backlink quer ver a frase,
  // não a sintaxe. O apelido, quando existe, é o que a pessoa escreveu.
  const plano = String(texto || "")
    .replace(LINK_RE, (_, alvo, apelido) => (apelido || alvo).trim())
    .replace(/\s+/g, " ");
  const pos = normalize(plano).indexOf(normalize(termo));
  if (pos < 0) return plano.slice(0, raio * 2).trim();
  const ini = Math.max(0, pos - raio);
  const fim = Math.min(plano.length, pos + termo.length + raio);
  return `${ini > 0 ? "…" : ""}${plano.slice(ini, fim).trim()}${fim < plano.length ? "…" : ""}`;
};

// Vizinhança de uma nota até certa distância. Serve para o grafo local, que é o
// que realmente ajuda: o grafo inteiro de 500 notas não diz nada.
export const localGraph = (noteId, notes = [], depth = 1) => {
  const { nodes, edges } = buildGraph(notes);
  const porId = new Map(nodes.map((n) => [n.id, n]));
  if (!porId.has(noteId)) return { nodes: [], edges: [] };

  const dentro = new Set([noteId]);
  let fronteira = [noteId];
  for (let d = 0; d < Math.max(0, depth); d += 1) {
    const proxima = [];
    for (const id of fronteira) {
      for (const e of edges) {
        if (e.from === id && !dentro.has(e.to)) {
          dentro.add(e.to);
          proxima.push(e.to);
        }
        if (e.to === id && !dentro.has(e.from)) {
          dentro.add(e.from);
          proxima.push(e.from);
        }
      }
    }
    fronteira = proxima;
    if (!fronteira.length) break;
  }
  return {
    nodes: [...dentro].map((id) => porId.get(id)).filter(Boolean),
    edges: edges.filter((e) => dentro.has(e.from) && dentro.has(e.to)),
  };
};

// Nota órfã: ninguém liga para ela e ela não liga para ninguém.
export const orphanNotes = (notes = []) => {
  const { edges } = buildGraph(notes);
  const ligadas = new Set();
  for (const e of edges) {
    ligadas.add(e.from);
    if (!e.missing) ligadas.add(e.to);
  }
  return notes.filter((n) => !ligadas.has(n.id));
};

// ---------------------------------------------------------------------------
// Blocos: referência e transclusão
// ---------------------------------------------------------------------------

// Um bloco é um parágrafo com âncora no fim: "texto do bloco ^abc123".
const BLOCK_ANCHOR_RE = /\s*\^([\p{L}\p{N}-]+)\s*$/u;

export const splitBlocks = (texto) =>
  String(texto || "")
    .split(/\n{2,}/)
    .map((bruto, i) => {
      const t = bruto.trim();
      const m = t.match(BLOCK_ANCHOR_RE);
      return {
        index: i,
        anchor: m ? m[1] : "",
        text: m ? t.replace(BLOCK_ANCHOR_RE, "").trim() : t,
      };
    })
    .filter((b) => b.text);

export const findBlock = (note, anchor) => {
  if (!note || !anchor) return null;
  return splitBlocks(note.content).find((b) => b.anchor === anchor) || null;
};

const EMBED_RE = /!\[\[([^\]#|]+)(?:#\^([^\]|]+))?\]\]/g;

// Transclusão: ![[Nota]] ou ![[Nota#^bloco]] traz o texto para dentro.
// O perigo real aqui é ciclo: A embute B, B embute A, e a tela congela. Por isso
// a pilha de visitados é obrigatória e o ciclo vira aviso visível, não silêncio.
export const resolveTransclusions = (texto, notes = [], _stack = []) => {
  const porTitulo = indexByTitle(notes);
  const avisos = [];
  const saida = String(texto || "").replace(
    EMBED_RE,
    (inteiro, titulo, ancora) => {
      const chave = normalize(titulo.trim());
      const destino = porTitulo.get(chave)?.[0];
      if (!destino) {
        avisos.push({ type: "ausente", title: titulo.trim() });
        return `[nota "${titulo.trim()}" ainda não existe]`;
      }
      if (_stack.includes(destino.id)) {
        avisos.push({ type: "ciclo", title: destino.title });
        return `[a nota "${destino.title}" se embute em si mesma; parei aqui]`;
      }
      if (ancora) {
        const bloco = findBlock(destino, ancora.trim());
        if (!bloco) {
          avisos.push({ type: "bloco-ausente", title: destino.title, anchor: ancora.trim() });
          return `[bloco "${ancora.trim()}" não existe em "${destino.title}"]`;
        }
        const dentro = resolveTransclusions(bloco.text, notes, [..._stack, destino.id]);
        avisos.push(...dentro.warnings);
        return dentro.text;
      }
      const dentro = resolveTransclusions(destino.content, notes, [
        ..._stack,
        destino.id,
      ]);
      avisos.push(...dentro.warnings);
      return dentro.text;
    },
  );
  return { text: saida, warnings: avisos };
};

// ---------------------------------------------------------------------------
// Nota diária e journaling
// ---------------------------------------------------------------------------

export const DAILY_PROMPTS = [
  { id: "foco", label: "O foco de hoje" },
  { id: "aconteceu", label: "O que aconteceu" },
  { id: "aprendi", label: "O que aprendi" },
  { id: "amanha", label: "Para amanhã" },
];

export const dailyTitle = (date) => {
  if (!isDate(date)) return "";
  const [a, m, d] = date.split("-");
  return `Diário ${d}/${m}/${a}`;
};

export const dailyTemplate = () =>
  // O texto vive num campo de escrita simples: prefixo de markdown ali é
  // ruído visual, não título. As perguntas entram como linhas de gente.
  DAILY_PROMPTS.map((p) => `${p.label}:\n\n`).join("\n");

export const ensureDailyNote = (notes = [], date, businessId = "") => {
  if (!isDate(date)) return { notes, note: null, created: false };
  const existente = notes.find((n) => n.kind === "diaria" && n.date === date);
  if (existente) return { notes, note: existente, created: false };
  const nova = makeNote(`nota-${date}-${Math.random().toString(36).slice(2, 8)}`, {
    title: dailyTitle(date),
    content: dailyTemplate(),
    kind: "diaria",
    date,
    businessId,
    createdAt: `${date}T08:00:00.000Z`,
  });
  return { notes: [...notes, nova], note: nova, created: true };
};

// ---------------------------------------------------------------------------
// Revisão espaçada (SM-2 simplificado)
// ---------------------------------------------------------------------------

export const CARD_GRADES = [
  { id: 0, label: "Não lembrei", hint: "Volta para hoje." },
  { id: 3, label: "Lembrei com esforço", hint: "Volta logo." },
  { id: 4, label: "Lembrei", hint: "Volta mais adiante." },
  { id: 5, label: "Fácil", hint: "Demora bem mais para voltar." },
];

export const makeCard = (
  id,
  { front = "", back = "", noteId = "", businessId = "", createdAt = "" } = {},
) => ({
  id,
  front: String(front || "").trim(),
  back: String(back || "").trim(),
  noteId,
  businessId,
  ease: 2.5,
  interval: 0,
  reps: 0,
  lapses: 0,
  due: "",
  lastReviewed: "",
  createdAt: createdAt || new Date().toISOString(),
});

// Nota vira flashcard por linhas "pergunta :: resposta". Formato explícito de
// propósito: adivinhar onde termina a pergunta gera cartão ruim.
export const cardsFromNote = (note, existentes = []) => {
  if (!note) return [];
  const jaTem = new Set(
    existentes
      .filter((c) => c.noteId === note.id)
      .map((c) => normalize(c.front)),
  );
  const novos = [];
  for (const linha of String(note.content || "").split("\n")) {
    const m = linha.match(/^(.+?)\s*::\s*(.+)$/);
    if (!m) continue;
    const frente = m[1].replace(/^[-*\s]+/, "").trim();
    const verso = m[2].trim();
    if (!frente || !verso) continue;
    if (jaTem.has(normalize(frente))) continue;
    jaTem.add(normalize(frente));
    novos.push(
      makeCard(`card-${note.id}-${novos.length}-${Math.random().toString(36).slice(2, 6)}`, {
        front: frente,
        back: verso,
        noteId: note.id,
        businessId: note.businessId,
      }),
    );
  }
  return novos;
};

// SM-2. Dois pisos que existem por motivo prático: a facilidade nunca cai abaixo
// de 1.3 (senão um cartão difícil volta para sempre no mesmo dia e a pessoa
// desiste), e o intervalo nunca fica negativo.
export const reviewCard = (card, grade, hoje) => {
  const nota = Number(grade);
  const base = { ...card };
  const q = Number.isFinite(nota) ? Math.max(0, Math.min(5, nota)) : 0;

  if (q < 3) {
    base.reps = 0;
    base.lapses = (card.lapses || 0) + 1;
    base.interval = 0;
    base.due = hoje;
  } else {
    base.reps = (card.reps || 0) + 1;
    if (base.reps === 1) base.interval = 1;
    else if (base.reps === 2) base.interval = 6;
    else base.interval = Math.round((card.interval || 1) * (card.ease || 2.5));
    base.interval = Math.max(1, base.interval);
    base.due = addDays(hoje, base.interval);
  }

  const novoEase =
    (card.ease || 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  base.ease = Math.max(1.3, Math.round(novoEase * 100) / 100);
  base.lastReviewed = hoje;
  return base;
};

export const dueCards = (cards = [], hoje) =>
  cards.filter((c) => !c.due || c.due <= hoje);

export const cardStats = (cards = [], hoje) => {
  const total = cards.length;
  const novos = cards.filter((c) => !c.reps).length;
  const paraHoje = dueCards(cards, hoje).length;
  const dificeis = cards.filter((c) => (c.lapses || 0) >= 3).length;
  return { total, novos, paraHoje, dificeis };
};

// ---------------------------------------------------------------------------
// Conexão automática entre ideias
// ---------------------------------------------------------------------------

const STOP = new Set(
  ("a as o os um uma uns umas de do da dos das em no na nos nas por para com sem " +
    "que se ao aos e ou mas como quando onde qual quais isso isto aquilo ser estar " +
    "ter foi era mais menos muito pouco ja nao sim sobre entre ate apos antes " +
    "todo toda todos todas cada outro outra pelo pela nosso nossa seu sua meu minha")
    .split(" "),
);

const termsOf = (texto) =>
  normalize(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP.has(t));

// Sugere ligações por termos raros em comum. Termo que aparece em quase toda
// nota não conecta nada, então pesa pelo inverso da frequência.
export const suggestConnections = (noteId, notes = [], limite = 5) => {
  const alvo = notes.find((n) => n.id === noteId);
  if (!alvo) return [];
  // Ligação conta nos dois sentidos. Se a outra nota já aponta para esta, elas
  // JÁ estão conectadas e aparecem em "citada em" — sugerir de novo seria
  // mandar ligar o que já está ligado.
  const chaveAlvo = normalize(alvo.title);
  const jaLigadas = new Set(
    parseLinks(alvo.content).map((l) => normalize(l.target)),
  );
  for (const n of notes) {
    if (n.id === noteId) continue;
    if (parseLinks(n.content).some((l) => normalize(l.target) === chaveAlvo)) {
      jaLigadas.add(normalize(n.title));
    }
  }

  const docFreq = new Map();
  const porNota = new Map();
  for (const n of notes) {
    const termos = new Set(termsOf(`${n.title} ${n.content}`));
    porNota.set(n.id, termos);
    for (const t of termos) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const meus = porNota.get(noteId) || new Set();
  const total = notes.length || 1;

  return notes
    .filter((n) => n.id !== noteId && !jaLigadas.has(normalize(n.title)))
    .map((n) => {
      const outros = porNota.get(n.id) || new Set();
      const comuns = [...meus].filter((t) => outros.has(t));
      const score = comuns.reduce(
        (s, t) => s + Math.log(total / (docFreq.get(t) || 1)) + 1,
        0,
      );
      return { note: n, score: Math.round(score * 100) / 100, shared: comuns.slice(0, 6) };
    })
    .filter((r) => r.shared.length > 0 && r.score > 0)
    .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
    .slice(0, limite);
};

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export const toMarkdown = (note) => {
  if (!note) return "";
  const cabecalho = [
    "---",
    `titulo: ${note.title}`,
    note.date ? `data: ${note.date}` : null,
    note.tags?.length ? `etiquetas: ${note.tags.join(", ")}` : null,
    "---",
  ]
    .filter(Boolean)
    .join("\n");
  return `${cabecalho}\n\n# ${note.title}\n\n${note.content}\n`;
};

export const exportAll = (notes = []) =>
  notes.map((n) => ({
    filename: `${(n.title || n.id).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.md`,
    content: toMarkdown(n),
  }));

// Importa markdown simples, aproveitando o título do primeiro "# " quando o
// arquivo não traz cabeçalho.
export const fromMarkdown = (texto, id, businessId = "") => {
  const bruto = String(texto || "");
  let corpo = bruto;
  let titulo = "";
  let data = "";
  let tags = [];

  const fm = bruto.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    corpo = bruto.slice(fm[0].length);
    for (const linha of fm[1].split("\n")) {
      const m = linha.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      if (m[1] === "titulo") titulo = m[2].trim();
      if (m[1] === "data") data = m[2].trim();
      if (m[1] === "etiquetas")
        tags = m[2].split(",").map((t) => t.trim()).filter(Boolean);
    }
  }
  if (!titulo) {
    const h1 = corpo.match(/^#\s+(.+)$/m);
    if (h1) {
      titulo = h1[1].trim();
      corpo = corpo.replace(h1[0], "");
    }
  }
  return makeNote(id, {
    title: titulo || "Sem título",
    content: corpo.trim(),
    date: isDate(data) ? data : "",
    tags,
    businessId,
  });
};
