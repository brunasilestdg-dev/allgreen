// ===== Prompt Guard: texto de fora não dá ordem à IA =====
//
// Resultado de busca na web, pesquisa de empresa, pergunta do cliente no
// portal e dado de ferramenta podem trazer texto escrito por terceiros
// tentando mandar na IA ("ignore as instruções anteriores", "revele o
// prompt"). Antes de a IA ler esse texto, ele passa por duas camadas:
//
//   1) heurística local (pt, en, es): sempre ligada, custo zero, pega as
//      frases clássicas de quem tenta sobrescrever instruções;
//   2) Llama Prompt Guard 2 86M, da Meta, na Groq (com GROQ_API_KEY):
//      classificador treinado para injeção e jailbreak, avaliado em português
//      (AUC multilíngue 0,995 no model card). Na Groq ele está em "Preview",
//      que pode sair do ar sem aviso, e o formato da resposta não é
//      documentado — por isso qualquer falha dele (404, 429, resposta
//      estranha) volta para a heurística sem travar nada.
//
// Grátis na Groq: 30 pedidos/min, 14,4 mil/dia, 15 mil tokens/min (conferido
// em 24/09/2026). A janela do modelo é de 512 tokens: texto longo é fatiado
// e vale a MAIOR nota entre as fatias, como no utilitário oficial da Meta.
// A Groq não treina com o conteúdo da API (Services Agreement §4.2).

const MODELO_PADRAO = "meta-llama/llama-prompt-guard-2-86m";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
// ~512 tokens do mDeBERTa em português ficam acima de 1.500 caracteres; 1.400
// deixa folga. Mais de 4 fatias por texto não entram (custo e limite/min).
const TAMANHO_DA_FATIA = 1400;
const FATIAS_POR_TEXTO = 4;
const LIMIAR_PADRAO = 0.8;

// ===== Camada 1: heurística =====
// Só frases inequívocas de quem tenta trocar as regras da IA. Ficam de fora
// construções que aparecem em texto normal: "a partir de agora você deve"
// (instrução de cliente), "modo desenvolvedor" (tutorial de celular), "novas
// instruções:" (procedimento interno). O texto é comparado sem acentos.
const QUALIFICADOR = "(anteriores|acima|previas|originais|iniciais|recebidas|dadas|do sistema)";
const PADROES = [
  // português
  new RegExp(`\\b(ignore|ignora|ignorar|desconsidere|desconsidera|desconsiderar|esqueca|esquece|esquecer)\\s+(todas?\\s+)?(as\\s+|os\\s+)?(suas\\s+|tuas\\s+)?(instrucoes|orientacoes|regras|comandos|diretrizes)\\s+${QUALIFICADOR}`, "i"),
  /\b(esqueca|esquece)\s+tudo\s+(o\s+)?que\s+(te|lhe)\s+(disseram|foi\s+dito|mandaram)/i,
  /\binstrucoes\s+(do\s+sistema|de\s+sistema)\s*:/i,
  /\b(revele|mostre|exiba|imprima|repita|vaze)\s+(o\s+|a\s+|os\s+|as\s+|seu\s+|sua\s+|suas\s+|seus\s+)?(prompt(\s+do\s+sistema|\s+inicial)?|system\s+prompt|instrucoes\s+(do\s+sistema|internas|originais|iniciais))\b/i,
  /\bnao\s+(conte|diga|avise|informe|mencione)\s+(isso\s+|nada\s+)?(ao|a|para\s+o|para\s+a)\s+(usuario|usuaria)\b/i,
  /\bmodo\s+(dan|jailbreak|sem\s+restricoes|sem\s+filtros)\b/i,
  // inglês
  /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|of\s+)*(previous|prior|above|earlier|preceding|original|initial|system)\s+(instructions?|prompts?|rules|directions|guidelines|messages)\b/i,
  /\byou\s+are\s+now\s+(in\s+)?(dan|jailbroken|unrestricted|unfiltered|developer\s+mode)\b/i,
  /\b(reveal|print|show|repeat|output|leak)\s+(your|the)\s+(system\s+prompt|initial\s+prompt|hidden\s+instructions|original\s+instructions)\b/i,
  /\bdo\s+not\s+(tell|inform|alert)\s+the\s+user\b/i,
  /\b(dan|jailbreak)\s+mode\b/i,
  // espanhol
  /\b(ignora|olvida|descarta)\s+(todas\s+)?(las\s+)?(instrucciones|reglas|indicaciones)\s+(anteriores|previas|originales)\b/i,
  // marcadores de papel que só servem para enganar o modelo
  /<\/?\s*(system|instructions?)\s*>/i,
  /\[\/?(system|INST)\]|<\|(im_start|im_end|system|endoftext)\|>/i,
];

const semAcento = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function pareceInjecao(texto) {
  const alvo = semAcento(texto).slice(0, TAMANHO_DA_FATIA * FATIAS_POR_TEXTO);
  return PADROES.some((padrao) => padrao.test(alvo));
}

// ===== Camada 2: Prompt Guard 2 na Groq =====
let pausadoAte = 0;
const memoria = new Map();
const MEMORIA_MAXIMA = 500;

export function reiniciarPromptGuard() {
  pausadoAte = 0;
  memoria.clear();
}

const lembrar = (chave, valor) => {
  if (memoria.size >= MEMORIA_MAXIMA) memoria.delete(memoria.keys().next().value);
  memoria.set(chave, valor);
};

// A Groq não documenta o conteúdo da resposta. O modelo devolve a
// probabilidade de ataque; se vier rótulo, aceita também. Qualquer outra
// coisa é "não sei" (null) e a heurística decide.
export function lerNota(conteudo) {
  const bruto = String(conteudo ?? "").trim();
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/i.test(bruto)) {
    const nota = Number(bruto);
    return nota >= 0 && nota <= 1 ? nota : null;
  }
  if (/\b(malicious|jailbreak|injection)\b/i.test(bruto)) return 1;
  if (/\bbenign\b/i.test(bruto)) return 0;
  return null;
}

export const fatiar = (texto) => {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  const fatias = [];
  for (let i = 0; i < limpo.length && fatias.length < FATIAS_POR_TEXTO; i += TAMANHO_DA_FATIA)
    fatias.push(limpo.slice(i, i + TAMANHO_DA_FATIA));
  return fatias;
};

async function notaDaFatia(env, fatia, fetcher) {
  const resposta = await fetcher(GROQ, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: String(env.PROMPT_GUARD_MODEL || "").trim() || MODELO_PADRAO,
      messages: [{ role: "user", content: fatia }],
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!resposta.ok) {
    // Modelo retirado ou chave recusada: pausa longa. Limite por minuto:
    // pausa curta. Em todos os casos, a heurística segue valendo.
    const pausa = [401, 403, 404].includes(resposta.status) ? 30 * 60_000 : resposta.status === 429 ? 60_000 : 0;
    if (pausa) {
      pausadoAte = Date.now() + pausa;
      console.warn(`prompt-guard: Groq respondeu ${resposta.status}; só heurística por ${pausa / 60_000} min`);
    }
    return null;
  }
  const dados = await resposta.json().catch(() => null);
  return lerNota(dados?.choices?.[0]?.message?.content);
}

function limiar(env) {
  const valor = Number(env?.PROMPT_GUARD_LIMIAR);
  return valor > 0 && valor < 1 ? valor : LIMIAR_PADRAO;
}

// { suspeito, nota, fonte }. `fonte` diz quem decidiu: "prompt-guard-2",
// "heuristica" ou "nenhuma" (texto vazio).
export async function avaliarTexto(env, texto, { fetcher = fetch } = {}) {
  const fatias = fatiar(texto);
  if (!fatias.length) return { suspeito: false, nota: 0, fonte: "nenhuma" };
  if (pareceInjecao(texto)) return { suspeito: true, nota: 1, fonte: "heuristica" };
  if (!env?.GROQ_API_KEY || pausadoAte > Date.now())
    return { suspeito: false, nota: 0, fonte: "heuristica" };
  const chave = fatias.join("\u0000");
  if (memoria.has(chave)) return memoria.get(chave);
  let notas;
  try {
    notas = await Promise.all(fatias.map((fatia) => notaDaFatia(env, fatia, fetcher)));
  } catch (erro) {
    console.warn("prompt-guard: Groq sem resposta", erro?.message || erro);
    return { suspeito: false, nota: 0, fonte: "heuristica" };
  }
  const validas = notas.filter((nota) => typeof nota === "number");
  if (!validas.length) return { suspeito: false, nota: 0, fonte: "heuristica" };
  const nota = Math.max(...validas);
  const resultado = { suspeito: nota >= limiar(env), nota, fonte: "prompt-guard-2" };
  lembrar(chave, resultado);
  return resultado;
}

// Separa uma lista de itens (ex.: resultados da busca) em aprovados e
// barrados. `texto(item)` diz o que avaliar de cada um. Poucos itens em
// paralelo para não estourar o limite por minuto da Groq.
export async function filtrarConteudoExterno(env, itens, { texto, fetcher, paralelo = 3 } = {}) {
  const lista = Array.isArray(itens) ? itens : [];
  const avaliacoes = new Array(lista.length);
  for (let inicio = 0; inicio < lista.length; inicio += paralelo) {
    const lote = lista.slice(inicio, inicio + paralelo);
    const resultados = await Promise.all(
      lote.map((item) => avaliarTexto(env, texto ? texto(item) : String(item ?? ""), { fetcher })),
    );
    resultados.forEach((resultado, i) => {
      avaliacoes[inicio + i] = resultado;
    });
  }
  return {
    aprovados: lista.filter((_, i) => !avaliacoes[i]?.suspeito),
    barrados: lista.filter((_, i) => avaliacoes[i]?.suspeito),
  };
}

export const TEXTO_REMOVIDO = "[texto removido: parecia uma instrução para a IA]";

// Percorre um resultado de ferramenta (JSON do banco) e troca os textos que
// parecem ordem para a IA. Só a heurística aqui: são dezenas de campos por
// resposta e mandar cada um para a Groq estouraria o limite por minuto — a
// fonte externa de verdade (busca, pesquisa) já passou pelo classificador.
export function sanearDados(valor, profundidade = 0) {
  if (profundidade > 8) return valor;
  if (typeof valor === "string")
    return valor.length >= 20 && pareceInjecao(valor) ? TEXTO_REMOVIDO : valor;
  if (Array.isArray(valor)) return valor.map((item) => sanearDados(item, profundidade + 1));
  if (valor && typeof valor === "object")
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [chave, sanearDados(item, profundidade + 1)]),
    );
  return valor;
}
