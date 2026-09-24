// ===== Reuniões: transcrição, ata e ações =====
// Camada pura. A captura de áudio acontece no navegador e a transcrição no
// Worker (Whisper). Aqui ficam a estruturação da transcrição em falas, a leitura
// da ata gerada pela IA e a extração das tarefas — tudo testável sem rede.

// Converte segundos em "mm:ss" (ou "h:mm:ss" quando passa de uma hora).
export const formatTimestamp = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

// Estrutura a transcrição em falas. Aceita dois formatos:
//   "Renata: falou algo"        -> participante identificado
//   "[01:20] Renata: falou"     -> com marcação de tempo
// Linhas sem participante entram como continuação da fala anterior.
export const parseTranscript = (raw) => {
  const linhas = String(raw || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const falas = [];
  for (const linha of linhas) {
    const comTempo = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/.exec(linha);
    const tempo = comTempo ? comTempo[1] : "";
    const resto = comTempo ? comTempo[2] : linha;
    // Participante: nome curto (até 3 palavras), sem pontuação de fim de frase.
    // Rótulo de fala em transcrição é um nome ("Renata", "Cliente da padaria");
    // um trecho mais longo antes dos dois-pontos é frase, não participante —
    // "Ficou decidido o seguinte: ..." precisa continuar sendo frase.
    const comFalante = /^([^:]{1,40}):\s+(.+)$/.exec(resto);
    const nomePlausivel =
      comFalante &&
      !/[.?!,;]$/.test(comFalante[1]) &&
      comFalante[1].trim().split(/\s+/).length <= 3;
    if (nomePlausivel) {
      falas.push({
        speaker: comFalante[1].trim(),
        text: comFalante[2].trim(),
        at: tempo,
      });
      continue;
    }
    if (falas.length > 0) {
      const ultima = falas[falas.length - 1];
      ultima.text = `${ultima.text} ${resto}`.trim();
      continue;
    }
    falas.push({ speaker: "", text: resto, at: tempo });
  }
  return falas;
};

// Quem falou e quanto — dá para ver se a reunião foi conversa ou monólogo.
export const speakerStats = (falas) => {
  const mapa = new Map();
  let totalPalavras = 0;
  for (const fala of falas || []) {
    const nome = fala.speaker || "Não identificado";
    const palavras = String(fala.text || "").split(/\s+/).filter(Boolean).length;
    totalPalavras += palavras;
    const atual = mapa.get(nome) || { speaker: nome, turns: 0, words: 0 };
    atual.turns += 1;
    atual.words += palavras;
    mapa.set(nome, atual);
  }
  return [...mapa.values()]
    .map((s) => ({
      ...s,
      share:
        totalPalavras > 0 ? Math.round((s.words / totalPalavras) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.words - a.words);
};

// Corrige o nome de um participante em toda a transcrição — o Whisper erra
// nomes próprios com frequência.
export const renameSpeaker = (falas, de, para) =>
  (falas || []).map((f) =>
    f.speaker === de ? { ...f, speaker: String(para || "").trim() } : f,
  );

// Busca dentro da transcrição, devolvendo as falas que contêm o termo.
export const searchTranscript = (falas, termo) => {
  const alvo = String(termo || "").trim().toLowerCase();
  if (!alvo) return [];
  return (falas || [])
    .map((fala, index) => ({ fala, index }))
    .filter(({ fala }) =>
      `${fala.speaker} ${fala.text}`.toLowerCase().includes(alvo),
    );
};

// Seções que pedimos à IA na ata. A ordem é a ordem de leitura da ata.
export const MINUTES_SECTIONS = [
  { id: "resumo", label: "Resumo" },
  { id: "decisoes", label: "Decisões" },
  { id: "tarefas", label: "Tarefas" },
  { id: "riscos", label: "Riscos" },
  { id: "pendencias", label: "Perguntas pendentes" },
  { id: "temas", label: "Temas" },
];

// Lê a ata que a IA devolve em texto e a divide nas seções conhecidas.
// Tolera variação de acento, maiúsculas, markdown (##, **) e dois-pontos.
export const parseMinutes = (raw) => {
  const texto = String(raw || "");
  const semAcento = (s) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const alias = {
    resumo: "resumo",
    decisoes: "decisoes",
    tarefas: "tarefas",
    acoes: "tarefas",
    riscos: "riscos",
    pendencias: "pendencias",
    "perguntas pendentes": "pendencias",
    temas: "temas",
  };
  const secoes = { resumo: "", decisoes: [], tarefas: [], riscos: [], pendencias: [], temas: [] };
  let atual = null;
  for (const linhaBruta of texto.split("\n")) {
    const linha = linhaBruta.trim();
    if (!linha) continue;
    const limpa = linha.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:$/, "");
    const chave = alias[semAcento(limpa)];
    if (chave) {
      atual = chave;
      continue;
    }
    if (!atual) continue;
    const item = linha
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (!item) continue;
    if (atual === "resumo")
      secoes.resumo = secoes.resumo ? `${secoes.resumo} ${item}` : item;
    else secoes[atual].push(item);
  }
  return secoes;
};

// Extrai responsável e prazo de uma linha de tarefa da ata.
// Formatos aceitos: "Enviar proposta — Renata — 05/08" ou "Enviar (Renata, 05/08)".
export const parseActionItem = (linha) => {
  const texto = String(linha || "").trim();
  const entreParenteses = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(texto);
  let corpo = texto;
  let extras = [];
  if (entreParenteses) {
    corpo = entreParenteses[1].trim();
    extras = entreParenteses[2].split(/[,;]/).map((p) => p.trim());
  } else {
    const partes = texto.split(/\s+[—–-]\s+/);
    corpo = partes.shift()?.trim() || texto;
    extras = partes.map((p) => p.trim());
  }
  const dataBr = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/;
  let prazo = "";
  const responsaveis = [];
  for (const extra of extras) {
    if (!extra) continue;
    const achou = dataBr.exec(extra);
    if (achou && !prazo) {
      prazo = achou[1];
      const sobra = extra.replace(achou[1], "").replace(/^(até|para)\s*/i, "").trim();
      if (sobra) responsaveis.push(sobra);
      continue;
    }
    responsaveis.push(
      extra.replace(/^(respons[áa]vel|resp\.?)\s*:?\s*/i, "").trim(),
    );
  }
  return {
    title: corpo,
    owner: responsaveis.filter(Boolean).join(", "),
    due: prazo,
  };
};

// Converte o prazo "05/08" ou "05/08/2026" em AAAA-MM-DD, usando o ano da
// reunião como referência quando o ano não vem escrito.
export const actionDueDate = (prazo, referencia) => {
  const texto = String(prazo || "").trim();
  const achou = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(texto);
  if (!achou) return "";
  const dia = Number(achou[1]);
  const mes = Number(achou[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  let ano = achou[3] ? Number(achou[3]) : Number(String(referencia || "").slice(0, 4));
  if (!ano) ano = new Date().getUTCFullYear();
  if (ano < 100) ano += 2000;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDia) return "";
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};

// As tarefas da ata prontas para virarem tarefas de verdade no app.
export const minutesToTasks = (minutes, { referencia } = {}) =>
  (minutes?.tarefas || [])
    .map((linha) => {
      const item = parseActionItem(linha);
      return {
        ...item,
        dueDate: actionDueDate(item.due, referencia),
        raw: linha,
      };
    })
    // Um travessão solto ou linha só de pontuação não é uma tarefa.
    .filter((t) => /[\p{L}\p{N}]/u.test(t.title));

// Prompt da ata. Fica aqui (puro) para poder ser testado e revisado.
export const buildMinutesPrompt = (meeting, falas) => {
  const transcricao = (falas || [])
    .map((f) => `${f.at ? `[${f.at}] ` : ""}${f.speaker ? `${f.speaker}: ` : ""}${f.text}`)
    .join("\n");
  return `Você é secretário de reuniões de uma empresa brasileira. Leia a transcrição e escreva a ata em português do Brasil.

Reunião: ${meeting?.title || "sem título"}
Data: ${meeting?.date || "não informada"}
Participantes informados: ${(meeting?.participants || []).join(", ") || "não informados"}

Responda EXATAMENTE com estas seções, nesta ordem, sem introdução:

Resumo
(um parágrafo curto)

Decisões
- uma decisão por linha; se não houver, escreva "- Nenhuma decisão registrada"

Tarefas
- uma por linha no formato: o que fazer — responsável — prazo em DD/MM
- se não houver responsável ou prazo, deixe em branco mas mantenha os travessões

Riscos
- um por linha; se não houver, escreva "- Nenhum risco levantado"

Perguntas pendentes
- uma por linha; se não houver, escreva "- Nenhuma"

Temas
- palavras-chave dos assuntos tratados

Não invente decisões, prazos ou responsáveis que não estejam na transcrição.

Transcrição:
${transcricao}`;
};

// Filtra a biblioteca de reuniões por texto, etiqueta, projeto ou cliente.
export const filterMeetings = (meetings, { term = "", tag = "", client = "" } = {}) => {
  const alvo = String(term || "").trim().toLowerCase();
  return (meetings || []).filter((m) => {
    if (tag && !(m.tags || []).includes(tag)) return false;
    if (client && String(m.client || "") !== client) return false;
    if (!alvo) return true;
    const texto = `${m.title || ""} ${m.client || ""} ${(m.participants || []).join(" ")} ${
      m.transcript || ""
    } ${m.minutes?.resumo || ""}`.toLowerCase();
    return texto.includes(alvo);
  });
};

export const allTags = (meetings) =>
  [...new Set((meetings || []).flatMap((m) => m.tags || []))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

export const makeMeeting = (id, { businessId = null, ownerId = null } = {}) => ({
  id,
  title: "",
  date: new Date().toISOString().slice(0, 10),
  participants: [],
  client: "",
  project: "",
  tags: [],
  transcript: "",
  minutes: null,
  consent: false,
  durationSeconds: 0,
  businessId,
  ownerId,
  createdAt: new Date().toISOString(),
});

// Dica de contexto para a transcrição (`initial_prompt` do Whisper): o modelo
// erra muito nome próprio, e dar a ele os nomes que a pessoa já cadastrou na
// reunião é o jeito mais barato de acertar. Só entra o que foi informado —
// sem participante nem cliente, a dica fica vazia e não é enviada.
export const transcriptionHint = (meeting) => {
  const nomes = [...new Set((meeting?.participants || []).map((p) => String(p || "").trim()).filter(Boolean))];
  const partes = [];
  if (nomes.length) partes.push(`Participantes: ${nomes.join(", ")}.`);
  const cliente = String(meeting?.client || "").trim();
  if (cliente) partes.push(`Cliente: ${cliente}.`);
  return partes.join(" ").slice(0, 300);
};
