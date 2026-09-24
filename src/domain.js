// Camada de lógica pura (sem React/JSX): helpers fundamentais e regras de
// negócio testáveis, extraídos de App.jsx para começar a quebrar o monólito.
// App.jsx importa daqui e reexporta o que os testes consomem via "./App".

export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);

export const contactLinks = (contact) => {
  const value = String(contact || "").trim();
  if (!value) return { phone: "", email: "" };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { phone: "", email: value };
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return { phone: "", email: "" };
  return { phone: digits.length <= 11 ? `55${digits}` : digits, email: "" };
};

// ── Gamificação (pontos, níveis, conquistas) ────────────────────────────
export const DEFAULT_LEVELS = [
  { name: "Iniciante", minPoints: 0 },
  { name: "Assistente", minPoints: 50 },
  { name: "Colaborador", minPoints: 150 },
  { name: "Colaborador confiável", minPoints: 300 },
  { name: "Especialista", minPoints: 600 },
];

const isApprovedMission = (task, userId) =>
  task.isMission &&
  Number(task.points) > 0 &&
  task.missionStatus === "aprovada" &&
  (task.assigneeId === userId ||
    (task.assignees || []).some((a) => a.userId === userId));

export const computeUserPoints = (tasks, userId) =>
  (tasks || [])
    .filter((t) => isApprovedMission(t, userId))
    .reduce((sum, t) => sum + Number(t.points || 0), 0);

export const levelForPoints = (points, levels = DEFAULT_LEVELS) =>
  [...levels]
    .sort((a, b) => a.minPoints - b.minPoints)
    .reduce((current, level) => (points >= level.minPoints ? level : current), levels[0]);

export const levelProgress = (points, levels = DEFAULT_LEVELS) => {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  const current = levelForPoints(points, sorted);
  const currentIndex = sorted.findIndex((l) => l.name === current.name);
  const next = sorted[currentIndex + 1] || null;
  if (!next) return { next: null, pct: 100, pointsToNext: 0 };
  const span = next.minPoints - current.minPoints;
  const pct = span > 0
    ? Math.min(100, Math.max(0, Math.round(((points - current.minPoints) / span) * 100)))
    : 100;
  return { next, pct, pointsToNext: Math.max(0, next.minPoints - points) };
};

export const computeAchievements = (tasks, userId) => {
  const approved = (tasks || []).filter((t) => isApprovedMission(t, userId));
  const onTime = approved.filter(
    (t) => t.due && t.deliveries?.length && t.deliveries[0].createdAt?.slice(0, 10) <= t.due,
  );
  const noCorrections = approved.filter(
    (t) => (t.deliveries || []).every((d) => d.status !== "correcao_solicitada"),
  );
  const achievements = [];
  if (approved.length >= 1)
    achievements.push({ id: "primeira-entrega", label: "Primeira entrega" });
  if (approved.length >= 5)
    achievements.push({ id: "cinco-tarefas", label: "5 missões concluídas" });
  if (onTime.length >= 1)
    achievements.push({ id: "entrega-no-prazo", label: "Entrega no prazo" });
  if (noCorrections.length >= 1 && approved.length >= 1)
    achievements.push({
      id: "sem-correcoes",
      label: "Entrega aprovada sem correções",
    });
  return achievements;
};

// Consolida o "meu trabalho" da pessoa logada dentro do espaço ativo: tarefas
// atribuídas a ela, o que precisa de atenção e seu desempenho. Puro e testável.
export const computeMyWork = (db, userId, business, ymdValue = today()) => {
  const inBiz = (t) => !business || !t.businessId || t.businessId === business.id;
  const mine = (db?.tasks || []).filter(
    (t) =>
      inBiz(t) &&
      (t.assigneeId === userId ||
        (t.assignees || []).some((a) => a?.userId === userId)),
  );
  const active = mine
    .filter((t) => t.status !== "Concluído")
    .sort((a, b) =>
      String(a.due || "9999").localeCompare(String(b.due || "9999")),
    );
  return {
    all: mine,
    active,
    inProgress: active.length,
    inReview: mine.filter((t) => t.missionStatus === "enviada_para_revisao")
      .length,
    corrections: mine.filter((t) => t.missionStatus === "correcao_solicitada")
      .length,
    overdue: active.filter((t) => t.due && t.due < ymdValue).length,
    done: mine.filter((t) => t.status === "Concluído").length,
  };
};

// Painel de resultados do dono: transforma os dados já conectados (caixa,
// pedidos, orçamentos) em indicadores. Puro e testável. Janela de 30 dias
// com comparação contra os 30 anteriores para a tendência.
export const computeBusinessInsights = (db, business, nowMs = Date.now()) => {
  const inBiz = (x) =>
    !business || !x?.businessId || x.businessId === business.id;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const cut30 = ymd(nowMs - 30 * 86400000);
  const cut60 = ymd(nowMs - 60 * 86400000);
  const dateOf = (x) => String(x?.date || x?.createdAt || "").slice(0, 10);

  const receitas = (db?.transactions || []).filter(
    (t) => inBiz(t) && t.type === "Receita",
  );
  const sumIn = (from, to) =>
    receitas
      .filter((t) => {
        const d = dateOf(t);
        return d && d >= from && (!to || d < to);
      })
      .reduce((s, t) => s + Number(t.value || 0), 0);
  const revenue30 = sumIn(cut30, null);
  const revenuePrev = sumIn(cut60, cut30);
  const revenueTrend =
    revenuePrev > 0
      ? Math.round(((revenue30 - revenuePrev) / revenuePrev) * 100)
      : revenue30 > 0
        ? 100
        : 0;

  const orders = (db?.orders || []).filter(inBiz);
  const orders30 = orders.filter((o) => dateOf(o) >= cut30);
  const ordersCount = orders30.length;
  const avgTicket = ordersCount
    ? Math.round(
        orders30.reduce((s, o) => s + Number(o.total || 0), 0) / ordersCount,
      )
    : 0;

  const quotes = (db?.quotes || []).filter(inBiz);
  const decided = quotes.filter(
    (q) => q.status === "aprovado" || q.status === "recusado",
  ).length;
  const approved = quotes.filter((q) => q.status === "aprovado").length;
  const conversion = decided ? Math.round((approved / decided) * 100) : 0;

  const byClient = new Map();
  for (const o of orders) {
    const key = (o.clientName || "").trim() || "Sem nome";
    const cur = byClient.get(key) || { name: key, total: 0, orders: 0 };
    cur.total += Number(o.total || 0);
    cur.orders += 1;
    byClient.set(key, cur);
  }
  const topClients = [...byClient.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    revenue30,
    revenueTrend,
    ordersCount,
    avgTicket,
    conversion,
    approved,
    decided,
    topClients,
    hasData: receitas.length > 0 || orders.length > 0 || quotes.length > 0,
  };
};

// ── Contratos / receita recorrente ──────────────────────────────────────
// Um contrato recorrente (ex.: mensalidade de lavanderia) gera receita todo
// mês. `history["AAAA-MM"]` guarda o mês já lançado (idempotência).
export const recurringStatus = (contract, ymd = today()) => {
  const ym = ymd.slice(0, 7);
  const day = Number(ymd.slice(8, 10));
  const dueDay = Math.min(28, Math.max(1, Number(contract?.dueDay) || 1));
  const posted = !!contract?.history?.[ym];
  if (!contract?.active) return { status: "off", ym, dueDay, posted };
  if (posted) return { status: "lancado", ym, dueDay, posted: true };
  if (day >= dueDay) return { status: "a_lancar", ym, dueDay, posted: false };
  return { status: "agendado", ym, dueDay, posted: false };
};

// Uma receita no caixa a partir de um contrato, para o mês corrente. Pura.
export const buildRecurringTransaction = (
  contract,
  { userId, businessId } = {},
  ymd = today(),
) => {
  const value = Number(contract?.amount) || 0;
  if (!(value > 0)) return null;
  return {
    id: uid(),
    type: "Receita",
    description: `Contrato — ${contract?.clientName || contract?.description || "recorrente"}`,
    value,
    date: ymd,
    category: "Contratos",
    businessId: businessId || contract?.businessId || null,
    ownerId: userId || contract?.ownerId || null,
    sourceRecurringId: contract?.id || null,
  };
};

// Lançamentos automáticos: só dos contratos marcados como autoPost que estão
// vencidos e ainda não lançados no mês. Idempotente via history[ym]. Pura.
export const buildRecurringPostings = (
  recurring,
  ctx = {},
  ymd = today(),
) => {
  const ym = ymd.slice(0, 7);
  const postings = [];
  for (const c of recurring || []) {
    if (!c?.autoPost) continue;
    if (recurringStatus(c, ymd).status !== "a_lancar") continue;
    const transaction = buildRecurringTransaction(c, ctx, ymd);
    if (transaction) postings.push({ contractId: c.id, ym, transaction });
  }
  return postings;
};

// Lembrete (uma notificação/mês) dos contratos MANUAIS vencidos e não lançados.
// Os autoPost entram sozinhos, então não geram lembrete. Idempotente. Pura.
export const buildRecurringReminder = (
  recurring,
  notifications,
  userId,
  ymd = today(),
) => {
  if (!userId) return null;
  const ym = ymd.slice(0, 7);
  const manual = (recurring || []).filter(
    (c) => !c?.autoPost && recurringStatus(c, ymd).status === "a_lancar",
  );
  if (manual.length === 0) return null;
  const notifId = `recurring-${ym}`;
  if ((notifications || []).some((n) => n && n.id === notifId)) return null;
  const message =
    manual.length === 1
      ? `O contrato recorrente de ${manual[0].clientName || "cliente"} vence este mês. Lance no caixa quando receber.`
      : `${manual.length} contratos recorrentes vencem este mês. Lance no caixa quando receber.`;
  return [
    {
      id: notifId,
      assigneeId: userId,
      ownerId: userId,
      message,
      link: "financeiro",
      read: false,
      createdAt: new Date().toISOString(),
    },
    ...(notifications || []),
  ];
};

// Converte a resposta da IA (JSON ou texto) numa lista de slides normalizada.
// Cada slide: { title, bullets: string[], notes }. Tolerante a cercas ```json,
// texto antes/depois do array e a formatos de fallback em Markdown.
export const parseDeckSlides = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return [];
  const clean = (s) =>
    String(s == null ? "" : s)
      .replace(/\s+/g, " ")
      .replace(/^[-*•#\d.)\s]+/, "")
      .trim();
  const normalizeSlide = (s) => {
    if (!s || typeof s !== "object") return null;
    const title = clean(s.title || s.titulo || s.heading || "");
    const rawBullets = s.bullets || s.pontos || s.items || s.topicos || [];
    const bullets = (Array.isArray(rawBullets) ? rawBullets : [rawBullets])
      .map(clean)
      .filter(Boolean)
      .slice(0, 8);
    const notes = clean(s.notes || s.notas || s.observacoes || "");
    if (!title && bullets.length === 0) return null;
    return { title: title || "Slide", bullets, notes };
  };
  // 1) Tenta JSON (com ou sem cercas de código)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(body.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const slides = arr.map(normalizeSlide).filter(Boolean);
        if (slides.length) return slides;
      }
    } catch {
      // segue para o fallback em texto
    }
  }
  // 2) Fallback: divide por títulos de Markdown ("## " ou "Slide N:")
  const blocks = body
    .split(/\n(?=#{1,3}\s|slide\s*\d+\s*[:-]|título\s*[:-])/i)
    .map((b) => b.trim())
    .filter(Boolean);
  const slides = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const title = clean(lines[0].replace(/^slide\s*\d+\s*[:-]/i, ""));
    const bullets = lines
      .slice(1)
      .filter((l) => /^[-*•]/.test(l) || /^\d+[.)]/.test(l))
      .map(clean)
      .filter(Boolean)
      .slice(0, 8);
    if (title || bullets.length) slides.push({ title: title || "Slide", bullets, notes: "" });
  }
  return slides;
};

// Extrai um array JSON tolerante a cercas ```json e a texto ao redor.
// Retorna [] quando não encontra um array válido.
const extractJsonArray = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

// Normaliza a resposta da IA num calendário editorial: lista de posts
// { channel, format, hook, caption, cta, hashtags[] }. Aceita chaves em
// português (canal/formato/gancho/legenda/chamada/hashtags).
export const parseContentPlan = (raw) => {
  const oneLine = (s) =>
    String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const asText = (v) => (Array.isArray(v) ? v.join(" ") : oneLine(v));
  const normalizeTag = (t) =>
    oneLine(t)
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .replace(/[^\p{L}\p{N}_]/gu, "");
  return extractJsonArray(raw)
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const channel = oneLine(p.channel || p.canal || p.rede || "Instagram");
      const format = oneLine(p.format || p.formato || p.tipo || "Post");
      const hook = oneLine(p.hook || p.gancho || p.titulo || p.title || p.tema || "");
      const caption = asText(p.caption || p.legenda || p.texto || p.body || "");
      const cta = oneLine(p.cta || p.chamada || p.callToAction || "");
      const rawTags = p.hashtags || p.tags || p.hashtag || [];
      const hashtags = (Array.isArray(rawTags) ? rawTags : asText(rawTags).split(/[\s,]+/))
        .map(normalizeTag)
        .filter(Boolean)
        .slice(0, 12);
      if (!hook && !caption) return null;
      return { channel, format, hook: hook || caption.slice(0, 60), caption, cta, hashtags };
    })
    .filter(Boolean);
};

// Distribui N posts a partir de uma data inicial (AAAA-MM-DD), a cada
// `everyDays` dias, pulando domingos. Retorna as datas no formato AAAA-MM-DD.
export const scheduleContentDates = (count, startYmd = today(), everyDays = 2) => {
  const dates = [];
  const step = Math.max(1, Number(everyDays) || 1);
  const [y, m, d] = String(startYmd).split("-").map(Number);
  const cursor = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + step);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return dates;
};

// Normaliza a resposta da IA num objeto de planilha { title, columns[], rows[][] }.
// Tolera cercas ```json e texto ao redor; cada linha é ajustada ao número de
// colunas (preenche vazios / descarta excedente). Sem colunas → planilha vazia.
export const parseSheet = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return { title: "", columns: [], rows: [] };
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return { title: "", columns: [], rows: [] };
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return { title: "", columns: [], rows: [] };
  }
  const cell = (v) =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).trim();
  const columns = (Array.isArray(obj.columns || obj.colunas) ? obj.columns || obj.colunas : [])
    .map(cell)
    .filter(Boolean)
    .slice(0, 30);
  if (!columns.length) return { title: cell(obj.title || obj.titulo), columns: [], rows: [] };
  const rawRows = Array.isArray(obj.rows || obj.linhas) ? obj.rows || obj.linhas : [];
  const rows = rawRows
    .map((r) => {
      const arr = Array.isArray(r)
        ? r
        : r && typeof r === "object"
          ? columns.map((c) => r[c])
          : [r];
      return columns.map((_, i) => cell(arr[i]));
    })
    .slice(0, 200);
  return { title: cell(obj.title || obj.titulo), columns, rows };
};

// Serializa colunas + linhas em CSV. Separador ";" por padrão (Excel pt-BR),
// campos entre aspas com escape de aspas internas. Sem BOM (adicionado no
// download). Uma linha por registro, terminada em \r\n.
export const buildCsv = (columns = [], rows = [], sep = ";") => {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [columns.map(esc).join(sep)];
  for (const row of rows) {
    lines.push(columns.map((_, i) => esc(row[i])).join(sep));
  }
  return lines.join("\r\n");
};

// Normaliza a resposta da IA de análise num objeto
// { summary, keyPoints[], risks[], actions[], answer }. Tolera cercas ```json,
// texto ao redor e chaves em português. Retorna null quando não há conteúdo útil.
export const parseAnalysis = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return null;
  const oneLine = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const toList = (v) => {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    return arr
      .map((x) =>
        oneLine(typeof x === "object" ? x.text || x.item || JSON.stringify(x) : x).replace(
          /^[-*•\d.)\s]+/,
          "",
        ),
      )
      .filter(Boolean)
      .slice(0, 12);
  };
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const summary = oneLine(obj.summary || obj.resumo || "");
  const keyPoints = toList(obj.keyPoints || obj.pontos || obj.pontosChave || obj.destaques);
  const risks = toList(obj.risks || obj.riscos || obj.atencao || obj.alertas);
  const actions = toList(obj.actions || obj.acoes || obj.proximosPassos || obj.proximas);
  const answer = oneLine(obj.answer || obj.resposta || "");
  if (!summary && !keyPoints.length && !risks.length && !actions.length && !answer)
    return null;
  return { summary, keyPoints, risks, actions, answer };
};

// Normaliza a resposta da IA num mapa de ideias
// { title, branches: [{ title, ideas: string[] }] }. Tolera cercas ```json,
// texto ao redor e chaves em português. Retorna { title, branches: [] } vazio
// quando não há ramos utilizáveis.
export const parseMindMap = (raw) => {
  const text = String(raw || "").trim();
  const empty = { title: "", branches: [] };
  if (!text) return empty;
  const oneLine = (s) =>
    String(s == null ? "" : s)
      .replace(/\s+/g, " ")
      .replace(/^[-*•\d.)\s]+/, "")
      .trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return empty;
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return empty;
  }
  const rawBranches = obj.branches || obj.ramos || obj.temas || obj.categorias || [];
  const branches = (Array.isArray(rawBranches) ? rawBranches : [])
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const title = oneLine(b.title || b.titulo || b.tema || b.nome || "");
      const rawIdeas = b.ideas || b.ideias || b.itens || b.pontos || [];
      const ideas = (Array.isArray(rawIdeas) ? rawIdeas : [rawIdeas])
        .map((x) => oneLine(typeof x === "object" ? x.text || x.ideia || "" : x))
        .filter(Boolean)
        .slice(0, 10);
      if (!title && ideas.length === 0) return null;
      return { title: title || "Ramo", ideas };
    })
    .filter(Boolean)
    .slice(0, 12);
  return { title: oneLine(obj.title || obj.titulo || obj.tema || ""), branches };
};

// Modelos prontos de documentos para pequenos negócios (BR). O corpo usa
// {{empresa}} e {{data}} (preenchidos automaticamente) e campos entre
// [COLCHETES] que a pessoa completa. Conteúdo genérico e editável — NÃO é
// aconselhamento jurídico.
export const DOCUMENT_TEMPLATES = [
  {
    id: "contrato-servico",
    name: "Contrato de prestação de serviços",
    type: "Contrato",
    segment: "Serviços",
    body: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

CONTRATADA: {{empresa}}, doravante denominada PRESTADORA.
CONTRATANTE: [NOME DO CLIENTE], CPF/CNPJ [DOCUMENTO], doravante denominado CLIENTE.

1. OBJETO
A PRESTADORA se compromete a executar os seguintes serviços: [DESCREVER O SERVIÇO].

2. PRAZO
Os serviços serão executados no período de [DATA INÍCIO] a [DATA FIM].

3. VALOR E PAGAMENTO
O valor total é de R$ [VALOR], pago da seguinte forma: [FORMA DE PAGAMENTO].

4. OBRIGAÇÕES
A PRESTADORA executará os serviços com zelo e qualidade. O CLIENTE fornecerá as informações necessárias e efetuará os pagamentos nas datas combinadas.

5. RESCISÃO
Este contrato pode ser rescindido por qualquer parte mediante aviso de [PRAZO] dias.

Local e data: [CIDADE], {{data}}.

_______________________________        _______________________________
PRESTADORA                              CLIENTE`,
  },
  {
    id: "recibo",
    name: "Recibo de pagamento",
    type: "Recibo",
    segment: "Financeiro",
    body: `RECIBO

Recebi de [NOME DE QUEM PAGOU], CPF/CNPJ [DOCUMENTO], a quantia de R$ [VALOR] ([VALOR POR EXTENSO]), referente a [DESCRIÇÃO DO PAGAMENTO].

Para clareza, firmo o presente recibo.

[CIDADE], {{data}}.

_______________________________
{{empresa}}`,
  },
  {
    id: "proposta",
    name: "Proposta comercial",
    type: "Proposta comercial",
    segment: "Vendas",
    body: `PROPOSTA COMERCIAL

De: {{empresa}}
Para: [NOME DO CLIENTE]
Data: {{data}}

1. APRESENTAÇÃO
[Breve apresentação do seu negócio e do que resolve para o cliente.]

2. ESCOPO
- [Item ou entrega 1]
- [Item ou entrega 2]
- [Item ou entrega 3]

3. INVESTIMENTO
Valor: R$ [VALOR]
Condições de pagamento: [CONDIÇÕES]

4. PRAZO
Entrega estimada em [PRAZO] após a aprovação.

5. VALIDADE
Esta proposta é válida por [X] dias.

Qualquer dúvida, estou à disposição.
{{empresa}}`,
  },
  {
    id: "nda",
    name: "Termo de confidencialidade (NDA)",
    type: "Termo",
    segment: "Serviços",
    body: `TERMO DE CONFIDENCIALIDADE

PARTES: {{empresa}} e [NOME DA OUTRA PARTE].

As partes comprometem-se a manter em sigilo todas as informações confidenciais a que tiverem acesso em razão de [MOTIVO / PROJETO], não as divulgando a terceiros sem autorização por escrito.

Este compromisso permanece válido pelo prazo de [X] anos após o término da relação.

[CIDADE], {{data}}.

_______________________________        _______________________________
{{empresa}}                             [OUTRA PARTE]`,
  },
  {
    id: "ordem-servico",
    name: "Ordem de serviço",
    type: "Ordem de serviço",
    segment: "Operação",
    body: `ORDEM DE SERVIÇO Nº [NÚMERO]

Empresa: {{empresa}}
Cliente: [NOME DO CLIENTE] — Contato: [TELEFONE]
Data de abertura: {{data}}

SERVIÇO SOLICITADO
[Descrever o que será feito.]

MATERIAIS / PEÇAS
- [Item] — R$ [Valor]

MÃO DE OBRA: R$ [VALOR]
TOTAL: R$ [VALOR]

Prazo de execução: [PRAZO].
Observações: [OBSERVAÇÕES].

_______________________________
Assinatura do cliente`,
  },
  {
    id: "cobranca",
    name: "Carta de cobrança amigável",
    type: "Comunicado",
    segment: "Financeiro",
    body: `Assunto: Lembrete de pagamento

Olá, [NOME DO CLIENTE], tudo bem?

Passando para lembrar, com todo respeito, que consta em aberto o valor de R$ [VALOR], referente a [DESCRIÇÃO], com vencimento em [DATA].

Se já efetuou o pagamento, por favor desconsidere esta mensagem. Caso contrário, o pagamento pode ser feito por [FORMA DE PAGAMENTO].

Qualquer dificuldade, podemos combinar a melhor forma juntos. Fico à disposição.

Atenciosamente,
{{empresa}} — {{data}}`,
  },
];

export const fillDocTemplate = (template, ctx = {}) => {
  if (!template || !template.body) return "";
  const empresa = (ctx.business || "").trim() || "[SUA EMPRESA]";
  const data =
    ctx.date ||
    new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  return template.body
    .replace(/\{\{\s*empresa\s*\}\}/gi, empresa)
    .replace(/\{\{\s*data\s*\}\}/gi, data);
};

// Normaliza um número de telefone brasileiro para link de WhatsApp (só dígitos,
// com DDI 55 quando parecer um número nacional sem DDI).
export const normalizeWhatsappNumber = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const normalizeUrl = (raw) => {
  const v = String(raw || "").trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
};

const instagramUrl = (raw) => {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, "")}`;
};

// Monta uma assinatura de e-mail profissional a partir dos dados do usuário.
// Retorna { html, text } — o HTML usa estilos inline (compatível com clientes
// de e-mail) e o texto é a versão simples para colar em qualquer lugar.
export const buildEmailSignature = (data = {}) => {
  const clean = (s) => String(s == null ? "" : s).trim();
  const esc = (s) =>
    clean(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const name = clean(data.name);
  const role = clean(data.role);
  const business = clean(data.business);
  const phone = clean(data.phone);
  const email = clean(data.email);
  const site = clean(data.site);
  const city = clean(data.city);
  const instagram = clean(data.instagram);
  const whatsapp = clean(data.whatsapp || data.phone);
  const accent = /^#[0-9a-f]{3,8}$/i.test(clean(data.accent))
    ? clean(data.accent)
    : "#0369a1";

  // Linha de contato (texto)
  const contactBits = [];
  if (phone) contactBits.push(`Tel: ${phone}`);
  if (email) contactBits.push(email);
  if (site) contactBits.push(site);
  const linkBits = [];
  const waNumber = normalizeWhatsappNumber(whatsapp);
  if (waNumber) linkBits.push(`WhatsApp: https://wa.me/${waNumber}`);
  if (instagram) linkBits.push(`Instagram: ${instagramUrl(instagram)}`);

  const textLines = [
    name,
    [role, business].filter(Boolean).join(" — "),
    city,
    ...contactBits,
    ...linkBits,
  ].filter(Boolean);
  const text = textLines.join("\n");

  // HTML (estilos inline)
  const rows = [];
  if (name)
    rows.push(
      `<div style="font-size:16px;font-weight:700;color:#111827;">${esc(name)}</div>`,
    );
  const roleLine = [role, business].filter(Boolean).map(esc).join(" — ");
  if (roleLine)
    rows.push(`<div style="font-size:13px;color:#6b7280;">${roleLine}</div>`);
  if (city)
    rows.push(`<div style="font-size:12px;color:#9ca3af;">${esc(city)}</div>`);

  const htmlContact = [];
  if (phone) htmlContact.push(esc(phone));
  if (email)
    htmlContact.push(
      `<a href="mailto:${esc(email)}" style="color:${accent};text-decoration:none;">${esc(email)}</a>`,
    );
  if (site)
    htmlContact.push(
      `<a href="${esc(normalizeUrl(site))}" style="color:${accent};text-decoration:none;">${esc(site)}</a>`,
    );
  if (htmlContact.length)
    rows.push(
      `<div style="font-size:13px;color:#374151;margin-top:6px;">${htmlContact.join(' <span style="color:#d1d5db;">|</span> ')}</div>`,
    );

  const htmlLinks = [];
  if (waNumber)
    htmlLinks.push(
      `<a href="https://wa.me/${waNumber}" style="color:${accent};text-decoration:none;">WhatsApp</a>`,
    );
  if (instagram)
    htmlLinks.push(
      `<a href="${esc(instagramUrl(instagram))}" style="color:${accent};text-decoration:none;">Instagram</a>`,
    );
  if (htmlLinks.length)
    rows.push(
      `<div style="font-size:13px;margin-top:4px;">${htmlLinks.join(' <span style="color:#d1d5db;">|</span> ')}</div>`,
    );

  const html = `<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;border-left:3px solid ${accent};padding-left:12px;"><tr><td>${rows.join("")}</td></tr></table>`;

  return { html, text };
};

// CRC16-CCITT-FALSE (init 0xFFFF, polinômio 0x1021) usado no BR Code do Pix.
// Retorna 4 dígitos hexadecimais em maiúsculas. Vetor de teste conhecido:
// "123456789" => "29B1".
export const pixCrc16 = (str) => {
  let crc = 0xffff;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

// Remove acentos e caracteres fora do padrão para campos do BR Code.
const pixSanitize = (raw, max) =>
  String(raw || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,-]/g, "")
    .trim()
    .slice(0, max);

// Monta o "Pix copia e cola" (BR Code estático) a partir da chave, nome do
// recebedor, cidade, valor (opcional) e descrição (opcional). Retorna "" sem
// chave. Formato EMV: cada campo é ID(2) + tamanho(2) + valor.
export const buildPixCode = ({ key, name, city, amount, txid, description } = {}) => {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return "";
  const emv = (id, value) => {
    const v = String(value);
    return `${id}${v.length.toString().padStart(2, "0")}${v}`;
  };
  const merchantName = pixSanitize(name, 25) || "RECEBEDOR";
  const merchantCity = pixSanitize(city, 15) || "BRASIL";
  const gui = emv("00", "br.gov.bcb.pix");
  const keyField = emv("01", cleanKey);
  const descText = pixSanitize(description, 40);
  const descField = descText ? emv("02", descText) : "";
  const mai = emv("26", gui + keyField + descField);
  const amountNum = Number(amount);
  const amountField =
    amount && Number.isFinite(amountNum) && amountNum > 0
      ? emv("54", amountNum.toFixed(2))
      : "";
  const ref = pixSanitize(txid, 25) || "***";
  const adf = emv("62", emv("05", ref));
  const payload =
    emv("00", "01") +
    mai +
    emv("52", "0000") +
    emv("53", "986") +
    amountField +
    emv("58", "BR") +
    emv("59", merchantName) +
    emv("60", merchantCity) +
    adf +
    "6304";
  return payload + pixCrc16(payload);
};

// ===== Banco de dados personalizável (bases tipo Notion/Airtable) =====
export const DB_FIELD_TYPES = [
  { id: "text", label: "Texto" },
  { id: "longtext", label: "Texto longo" },
  { id: "number", label: "Número" },
  { id: "currency", label: "Moeda" },
  { id: "percent", label: "Percentual" },
  { id: "date", label: "Data" },
  { id: "datetime", label: "Data e hora" },
  { id: "email", label: "E-mail" },
  { id: "phone", label: "Telefone" },
  { id: "url", label: "URL" },
  { id: "select", label: "Seleção" },
  { id: "multiselect", label: "Múltipla seleção" },
  { id: "checkbox", label: "Sim / Não" },
  { id: "relation", label: "Relação (outra base)" },
  { id: "lookup", label: "Busca em relação (lookup)" },
  { id: "rollup", label: "Agregação de relação (rollup)" },
  { id: "formula", label: "Fórmula (cálculo)" },
];

// Converte o valor bruto de uma célula para o tipo do campo.
export const coerceCellValue = (type, raw) => {
  if (["number", "currency", "percent"].includes(type)) {
    if (raw === "" || raw == null) return "";
    const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : Number(raw);
  }
  if (type === "checkbox")
    return raw === true || raw === "true" || raw === "on" || raw === 1;
  if (type === "multiselect")
    return Array.isArray(raw)
      ? [...new Set(raw.map(String).filter(Boolean))]
      : String(raw || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  return raw == null ? "" : String(raw);
};

// Mostra o valor de uma célula de forma amigável (para leitura/kanban/galeria).
export const formatCellValue = (type, value) => {
  if (type === "checkbox") return value ? "Sim" : "Não";
  if (value == null || value === "") return "";
  if (["number", "currency", "percent"].includes(type))
    return String(value).replace(".", ",");
  if (type === "multiselect" && Array.isArray(value)) return value.join(", ");
  return String(value);
};

// Agrupa as linhas por um campo (usado no kanban). Valores vazios caem em "—".
export const groupRowsByField = (rows, fieldId) => {
  const groups = {};
  for (const row of rows || []) {
    const raw = row?.cells?.[fieldId];
    const key = raw === undefined || raw === null || raw === "" ? "—" : String(raw);
    (groups[key] ||= []).push(row);
  }
  return groups;
};

// As colunas do kanban a partir de um campo de seleção: as opções do campo,
// mais "—" (sem valor) quando houver linhas sem valor.
export const kanbanColumns = (base, fieldId) => {
  const field = (base?.fields || []).find((f) => f.id === fieldId);
  const options = field?.options ? [...field.options] : [];
  const groups = groupRowsByField(base?.rows || [], fieldId);
  const cols = options.map((opt) => ({ key: opt, rows: groups[opt] || [] }));
  if (groups["—"]?.length) cols.push({ key: "—", rows: groups["—"] });
  return cols;
};

// Rótulo de um registro de uma base (o valor do primeiro campo) — para campos
// de relação, galeria e kanban mostrarem algo legível em vez do id.
export const recordLabel = (base, recordId) => {
  const row = (base?.rows || []).find((r) => r.id === recordId);
  if (!row) return "";
  const first = (base?.fields || [])[0];
  const raw = first ? row.cells?.[first.id] : "";
  return raw == null ? "" : String(raw);
};

// Agrupa as linhas por dia (AAAA-MM-DD) a partir de um campo de data. Usado na
// visão de calendário. Ignora valores que não sejam datas.
export const groupRowsByDate = (rows, fieldId) => {
  const map = {};
  for (const row of rows || []) {
    const v = String(row?.cells?.[fieldId] ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) (map[v] ||= []).push(row);
  }
  return map;
};

// Matriz de 6 semanas (começando no domingo) para o mês "AAAA-MM". Cada célula
// tem a data (AAAA-MM-DD) e se pertence ao mês. Pura, para a visão calendário.
export const monthMatrix = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  const first = new Date(Date.UTC(y || 1970, (m || 1) - 1, 1));
  const cursor = new Date(first);
  cursor.setUTCDate(1 - first.getUTCDay());
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({
        date: cursor.toISOString().slice(0, 10),
        inMonth: cursor.getUTCMonth() === (m || 1) - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

// ===== Wiki / páginas aninhadas =====
// Monta a árvore de páginas a partir da lista plana (cada página tem parentId).
// Ordena por título. Filhos órfãos (parent inexistente) sobem para a raiz.
export const buildPageTree = (pages = []) => {
  const byId = new Map((pages || []).map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId && byId.get(node.parentId);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list) => {
    list.sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), "pt-BR"),
    );
    list.forEach((n) => sortRec(n.children));
    return list;
  };
  return sortRec(roots);
};

// IDs de uma página e de todos os seus descendentes (para excluir em cascata).
export const pageDescendantIds = (pages = [], id) => {
  const childrenOf = (pid) => (pages || []).filter((p) => p.parentId === pid);
  const acc = [id];
  const walk = (pid) => {
    for (const child of childrenOf(pid)) {
      acc.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return acc;
};

// Filtra páginas por texto no título ou conteúdo (case-insensitive).
export const searchPages = (pages = [], query = "") => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return pages || [];
  return (pages || []).filter((p) =>
    `${p.title || ""} ${p.content || ""}`.toLowerCase().includes(q),
  );
};

// ===== Automações (regras que rodam sozinhas) =====
export const AUTOMATION_WEEKDAYS = [
  [1, "Segunda-feira"],
  [2, "Terça-feira"],
  [3, "Quarta-feira"],
  [4, "Quinta-feira"],
  [5, "Sexta-feira"],
  [6, "Sábado"],
  [0, "Domingo"],
];
export const AUTOMATION_ACTIONS = [
  { id: "task", label: "Criar uma tarefa" },
  { id: "reminder", label: "Me lembrar (notificação)" },
];

// Uma regra está "no ponto de disparar" hoje? Retorna a chave do período
// (para deduplicar) ou null. Semanal: dispara no dia da semana escolhido,
// dedup pela data. Mensal: dispara a partir do dia escolhido, dedup por mês.
export const automationDue = (rule, ymd = today()) => {
  if (!rule || rule.enabled === false) return null;
  const [y, m, d] = String(ymd).split("-").map(Number);
  const date = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, 12));
  let key;
  if (rule.frequency === "monthly") {
    if ((d || 1) < (Number(rule.day) || 1)) return null;
    key = ymd.slice(0, 7);
  } else {
    // semanal (padrão)
    if (date.getUTCDay() !== (Number(rule.day) || 1)) return null;
    key = ymd;
  }
  if (rule.history && rule.history[key]) return null;
  return key;
};

// Roda as automações: devolve as regras atualizadas (com o período marcado no
// history, idempotente) e a lista de "intenções" a aplicar (o App transforma
// em tarefas/notificações reais). Não executa nada sozinho aqui.
export const runAutomations = (rules, ymd = today()) => {
  const intents = [];
  const now = new Date().toISOString();
  const updated = (rules || []).map((rule) => {
    const key = automationDue(rule, ymd);
    if (!key) return rule;
    intents.push({
      ruleId: rule.id,
      actionType: rule.actionType || "task",
      text: rule.actionText || rule.name || "Tarefa automática",
    });
    return {
      ...rule,
      lastRun: now,
      history: { ...(rule.history || {}), [key]: now },
    };
  });
  return { rules: updated, intents };
};

// ===== Compras / RFQ de fornecedores =====
// Valores chegam de planilhas e propostas brasileiras em formatos diferentes.
// Esta normalização aceita número, "1.234,56", "R$ 1.234,56" e "1234.56".
export const procurementNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) raw = raw.replace(/,/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const supplierBidTotals = (rfq, bid) => {
  const offers = bid?.offers || {};
  let subtotal = 0;
  let quotedItems = 0;
  for (const item of rfq?.items || []) {
    const offer = offers[item.id] || {};
    const unitPrice = procurementNumber(offer.unitPrice);
    if (unitPrice > 0) quotedItems += 1;
    subtotal += procurementNumber(item.quantity) * unitPrice;
  }
  const freight = procurementNumber(bid?.freight);
  const taxes = procurementNumber(bid?.taxes);
  const discount = procurementNumber(bid?.discount);
  return {
    subtotal,
    freight,
    taxes,
    discount,
    total: Math.max(0, subtotal + freight + taxes - discount),
    quotedItems,
    coverage: (rfq?.items || []).length
      ? Math.round((quotedItems / rfq.items.length) * 100)
      : 0,
  };
};

// Ranqueia sem esconder lacunas: proposta incompleta nunca ganha de uma completa.
// Em empate, respeita a prioridade declarada na RFQ.
export const compareSupplierBids = (rfq) => {
  const complete = (rfq?.bids || []).map((bid) => ({
    ...bid,
    metrics: supplierBidTotals(rfq, bid),
    deliveryDays: Math.max(0, procurementNumber(bid.deliveryDays)),
  }));
  const priority = rfq?.priority || "equilibrio";
  complete.sort((a, b) => {
    if (a.metrics.coverage !== b.metrics.coverage)
      return b.metrics.coverage - a.metrics.coverage;
    if (priority === "prazo" && a.deliveryDays !== b.deliveryDays)
      return a.deliveryDays - b.deliveryDays;
    if (a.metrics.total !== b.metrics.total)
      return a.metrics.total - b.metrics.total;
    return a.deliveryDays - b.deliveryDays;
  });
  return complete.map((bid, index) => ({ ...bid, rank: index + 1 }));
};

export const bestOffersByItem = (rfq) =>
  (rfq?.items || []).map((item) => {
    const offers = (rfq?.bids || [])
      .map((bid) => ({
        bidId: bid.id,
        supplierName: bid.supplierName,
        unitPrice: procurementNumber(bid.offers?.[item.id]?.unitPrice),
      }))
      .filter((offer) => offer.unitPrice > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice);
    return { itemId: item.id, best: offers[0] || null, offers };
  });

export const buildProcurementCsv = (rfq) => {
  const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const bids = compareSupplierBids(rfq);
  const head = [
    "Fornecedor",
    ...(rfq?.items || []).map(
      (item) => `${item.name} (${item.quantity} ${item.unit || "un"})`,
    ),
    "Frete",
    "Impostos",
    "Desconto",
    "Total",
    "Prazo (dias)",
    "Pagamento",
    "Cobertura",
    "Ranking",
  ];
  const rows = bids.map((bid) => [
    bid.supplierName,
    ...(rfq?.items || []).map((item) =>
      procurementNumber(bid.offers?.[item.id]?.unitPrice),
    ),
    bid.metrics.freight,
    bid.metrics.taxes,
    bid.metrics.discount,
    bid.metrics.total,
    bid.deliveryDays,
    bid.paymentTerms || "",
    `${bid.metrics.coverage}%`,
    bid.rank,
  ]);
  return [head, ...rows].map((row) => row.map(esc).join(";")).join("\r\n");
};

// Normaliza JSON extraído pela IA de PDFs, DOCX, CSV ou texto de fornecedores.
export const parseSupplierProposal = (raw, rfq) => {
  const source = String(raw || "").replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
  const proposedItems = parsed.items || parsed.itens || [];
  const offers = {};
  for (const item of rfq?.items || []) {
    const normalized = String(item.name || "").trim().toLowerCase();
    const match = proposedItems.find((entry) => {
      const name = String(entry.name || entry.nome || entry.item || "")
        .trim()
        .toLowerCase();
      return name === normalized || name.includes(normalized) || normalized.includes(name);
    });
    offers[item.id] = {
      unitPrice: procurementNumber(
        match?.unitPrice ?? match?.precoUnitario ?? match?.preco ?? 0,
      ),
      notes: String(match?.notes || match?.observacoes || ""),
    };
  }
  return {
    supplierName: String(
      parsed.supplierName || parsed.fornecedor || parsed.empresa || "",
    ).trim(),
    supplierContact: String(parsed.contact || parsed.contato || "").trim(),
    freight: procurementNumber(parsed.freight ?? parsed.frete),
    taxes: procurementNumber(parsed.taxes ?? parsed.impostos),
    discount: procurementNumber(parsed.discount ?? parsed.desconto),
    deliveryDays: procurementNumber(parsed.deliveryDays ?? parsed.prazoDias),
    paymentTerms: String(
      parsed.paymentTerms || parsed.condicaoPagamento || "",
    ).trim(),
    notes: String(parsed.notes || parsed.observacoes || "").trim(),
    offers,
  };
};

// ===== Mala direta (mail merge) =====
// Extrai os campos {{nome}} de um texto (únicos, na ordem de aparição).
export const extractMergeFields = (text) => {
  const seen = [];
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const key = m[1].trim();
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
};

// Substitui {{campo}} pelos valores fornecidos. Campo sem valor vira vazio.
export const applyMergeFields = (text, values = {}) =>
  String(text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
    const v = values[k.trim()];
    return v == null ? "" : String(v);
  });

// Mantém a API histórica enquanto o avaliador enterprise vive no módulo da feature.
export {
  evalFormula,
  evaluateFormula,
  validateFormula,
} from "./features/databases/formulas.js";

// ===== Gráficos nas planilhas =====
// Converte um texto para número aceitando formato BR ("R$ 1.200,50" => 1200.5).
export const parseBrNumber = (raw) => {
  let s = String(raw == null ? "" : raw).replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) {
    // vírgula = decimal; pontos = milhar
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // sem vírgula, mas pontos em grupos de 3 = milhar (ex.: 2.000, 1.234.567)
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Série {label, value} a partir de uma coluna de rótulo e uma de valor.
// Ignora linhas totalmente vazias. Valores não numéricos viram 0.
export const sheetChartSeries = (columns, rows, labelIdx, valueIdx) => {
  const li = Number(labelIdx);
  const vi = Number(valueIdx);
  return (rows || [])
    .filter((r) => (r || []).some((c) => String(c ?? "").trim() !== ""))
    .map((r, i) => ({
      label: String(r[li] ?? "").trim() || `Linha ${i + 1}`,
      value: parseBrNumber(r[vi]),
    }));
};

// ===== Modelos de resposta de e-mail =====
// Catálogo curado; campos entre [COLCHETES] a pessoa completa. Não é
// aconselhamento — é ponto de partida editável.
export const EMAIL_TEMPLATES = [
  {
    id: "boas-vindas",
    name: "Boas-vindas a novo cliente",
    category: "Relacionamento",
    subject: "Bem-vindo(a) à [SUA EMPRESA]!",
    body: "Olá, [NOME],\n\nQue alegria ter você com a gente! Sou [SEU NOME], da [SUA EMPRESA], e estou à disposição para o que precisar.\n\nQualquer dúvida, é só responder este e-mail.\n\nAbraço,\n[SEU NOME]",
  },
  {
    id: "follow-up",
    name: "Follow-up de proposta",
    category: "Vendas",
    subject: "Retomando nossa conversa",
    body: "Olá, [NOME],\n\nPassando para saber se você teve a chance de analisar a proposta que enviei em [DATA]. Fico à disposição para ajustar o que for necessário ou tirar qualquer dúvida.\n\nPodemos conversar esta semana?\n\nAtenciosamente,\n[SEU NOME]",
  },
  {
    id: "agradecimento",
    name: "Agradecimento pós-venda",
    category: "Relacionamento",
    subject: "Obrigado pela confiança!",
    body: "Olá, [NOME],\n\nMuito obrigado por escolher a [SUA EMPRESA]. Foi um prazer atender você!\n\nSe puder, adoraríamos ouvir sua opinião — e conte com a gente sempre que precisar.\n\nUm abraço,\n[SEU NOME]",
  },
  {
    id: "cobranca",
    name: "Lembrete de pagamento",
    category: "Financeiro",
    subject: "Lembrete: pagamento em aberto",
    body: "Olá, [NOME], tudo bem?\n\nPassando para lembrar, com todo respeito, do valor de R$ [VALOR] referente a [DESCRIÇÃO], com vencimento em [DATA].\n\nSe já efetuou o pagamento, por favor desconsidere. Caso contrário, o pagamento pode ser feito por [FORMA DE PAGAMENTO].\n\nQualquer dificuldade, podemos combinar juntos. Fico à disposição.\n\nAtenciosamente,\n[SEU NOME]",
  },
  {
    id: "orcamento",
    name: "Envio de orçamento",
    category: "Vendas",
    subject: "Seu orçamento — [SUA EMPRESA]",
    body: "Olá, [NOME],\n\nConforme conversamos, segue o orçamento para [SERVIÇO/PRODUTO]:\n\n- [ITEM 1] — R$ [VALOR]\n- [ITEM 2] — R$ [VALOR]\n\nValor total: R$ [VALOR]\nValidade: [X] dias.\n\nFico à disposição para dúvidas ou ajustes.\n\nAtenciosamente,\n[SEU NOME]",
  },
  {
    id: "reagendamento",
    name: "Reagendar compromisso",
    category: "Atendimento",
    subject: "Podemos remarcar?",
    body: "Olá, [NOME],\n\nPreciso remarcar nosso compromisso de [DATA/HORA]. Peço desculpas pelo transtorno.\n\nVocê teria disponibilidade em [OPÇÃO 1] ou [OPÇÃO 2]? Me avise o melhor horário para você.\n\nObrigado pela compreensão,\n[SEU NOME]",
  },
];

// ===== Assinatura eletrônica de documentos =====
// Assinatura eletrônica SIMPLES (Lei 14.063/2020): identifica quem assinou,
// quando, e detecta se o documento foi alterado depois. Não é certificado
// digital ICP-Brasil — a interface deixa isso explícito para a titular.

// Normaliza o conteúdo antes de calcular a impressão digital, para que apenas
// mudanças reais (não fim de linha ou espaço final) invalidem a assinatura.
export const normalizeForSigning = (content) =>
  String(content == null ? "" : content)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();

// Impressão digital determinística do conteúdo: combina FNV-1a e djb2 em 16
// caracteres hexadecimais. Pura, síncrona e igual em qualquer navegador.
export const documentFingerprint = (content) => {
  const text = normalizeForSigning(content);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + code) >>> 0;
  }
  const size = text.length >>> 0;
  const head = (fnv ^ size) >>> 0;
  return `${head.toString(16).padStart(8, "0")}${djb.toString(16).padStart(8, "0")}`;
};

// Código de verificação legível, para conferir a assinatura sem sistema:
// "SF-XXXX-XXXX" derivado da impressão digital e do momento da assinatura.
export const signatureCode = (fingerprint, signedAt) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
  const seed = `${fingerprint}${signedAt || ""}`;
  let acc = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1)
    acc = Math.imul(acc ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[acc % alphabet.length];
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return `SF-${out.slice(0, 4)}-${out.slice(4)}`;
};

// Cria o registro de uma assinatura sobre o conteúdo do documento.
export const makeSignature = ({
  id,
  signerName,
  signerEmail = "",
  signerRole = "",
  content,
  signedAt,
  imageDataUrl = "",
} = {}) => {
  const at = signedAt || new Date().toISOString();
  const fingerprint = documentFingerprint(content);
  return {
    id: id || `sig-${fingerprint}-${at}`,
    signerName: String(signerName || "").trim(),
    signerEmail: String(signerEmail || "").trim(),
    signerRole: String(signerRole || "").trim(),
    signedAt: at,
    fingerprint,
    code: signatureCode(fingerprint, at),
    imageDataUrl: imageDataUrl || "",
  };
};

// Confere uma assinatura contra o conteúdo atual do documento.
// valid=false com motivo "alterado" quando o texto mudou depois de assinado.
export const verifySignature = (signature, content) => {
  if (!signature?.fingerprint)
    return { valid: false, reason: "invalida", message: "Assinatura inválida." };
  const current = documentFingerprint(content);
  if (current !== signature.fingerprint)
    return {
      valid: false,
      reason: "alterado",
      message: "O documento foi alterado depois desta assinatura.",
    };
  return {
    valid: true,
    reason: "ok",
    message: "Documento íntegro: idêntico ao que foi assinado.",
  };
};

// Situação geral do documento a partir da lista de assinaturas.
export const signatureStatus = (signatures, content) => {
  const list = Array.isArray(signatures) ? signatures : [];
  if (list.length === 0) return { state: "sem-assinatura", valid: 0, total: 0 };
  const valid = list.filter((s) => verifySignature(s, content).valid).length;
  return {
    state: valid === list.length ? "assinado" : "alterado",
    valid,
    total: list.length,
  };
};

// Bloco de texto anexado ao documento na exportação (PDF/DOCX/TXT).
export const signatureBlockText = (signatures, content) => {
  const list = Array.isArray(signatures) ? signatures : [];
  if (list.length === 0) return "";
  const lines = list.map((s) => {
    const check = verifySignature(s, content);
    const when = new Date(s.signedAt);
    const data = Number.isNaN(when.getTime())
      ? s.signedAt
      : when.toLocaleString("pt-BR");
    const who = [s.signerName, s.signerRole].filter(Boolean).join(" — ");
    return [
      `Assinado por: ${who || "—"}`,
      s.signerEmail ? `E-mail: ${s.signerEmail}` : "",
      `Data e hora: ${data}`,
      `Código de verificação: ${s.code}`,
      `Impressão digital do documento: ${s.fingerprint}`,
      check.valid ? "" : `ATENÇÃO: ${check.message}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "--------------------------------------------",
    "ASSINATURAS ELETRÔNICAS",
    ...lines,
    "Assinatura eletrônica simples (Lei 14.063/2020). Não substitui",
    "certificado digital ICP-Brasil quando este for exigido por lei.",
  ].join("\n\n");
};

// ===== Sugestões de endereço (Photon/komoot) =====
// O Roteirizador sugeria endereços pelo Nominatim público, cuja política proíbe
// autocompletar no navegador. O Photon é feito para isso (busca enquanto se
// digita, dados do OpenStreetMap) e aceita recorte por caixa geográfica.
export const BRASIL_BBOX = "-74.0,-33.8,-34.7,5.3";

// Rótulo legível de cada sugestão: nome, rua e número, bairro, cidade e UF,
// sem repetir partes (o nome de uma rua costuma vir também como "street").
export function photonSuggestionLabels(data, limite = 4) {
  const features = Array.isArray(data?.features) ? data.features : [];
  const vistos = new Set();
  const rotulos = [];
  for (const feature of features) {
    const p = feature?.properties || {};
    const rua = [p.street, p.housenumber].filter(Boolean).join(", ");
    const partes = [];
    for (const parte of [p.name, rua, p.district || p.locality, p.city, p.state]) {
      const valor = String(parte || "").trim();
      if (!valor) continue;
      // "Avenida Paulista" (nome) e "Avenida Paulista, 1000" (rua) são a mesma
      // parte: fica a versão mais completa, no lugar da primeira.
      const igual = partes.findIndex(
        (ja) => ja === valor || valor.startsWith(`${ja},`) || ja.startsWith(`${valor},`),
      );
      if (igual === -1) partes.push(valor);
      else if (valor.length > partes[igual].length) partes[igual] = valor;
    }
    const rotulo = partes.join(", ");
    if (rotulo && !vistos.has(rotulo)) {
      vistos.add(rotulo);
      rotulos.push(rotulo);
    }
    if (rotulos.length >= limite) break;
  }
  return rotulos;
}
