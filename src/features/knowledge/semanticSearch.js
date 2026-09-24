// ===== Busca por significado no aparelho =====
//
// Cada texto do espaço vira um vetor uma vez só: o servidor calcula (bge-m3) e
// guarda por pessoa; aqui ele fica em memória e no IndexedDB do aparelho,
// então abrir a busca de novo não gasta nada. A consulta vira vetor a cada
// busca nova e a comparação roda aqui mesmo (semanticDomain.js).

import { authHeaders } from "../../session/armazenamento.js";
import { deBase64, rankearPorSignificado, textoParaVetor } from "./semanticDomain.js";

const LOTE = 64;
// Por busca, no máximo 8 lotes (512 textos); o resto entra nas próximas.
const LOTES_POR_BUSCA = 8;
const BANCO = "allgreen-busca";
const LOJA = "vetores";

const memoria = new Map();
const consultas = new Map();
let bancoAberto = null;

export function limparMemoriaDaBusca() {
  memoria.clear();
  consultas.clear();
}

// ===== IndexedDB (melhor esforço: sem ele, fica só a memória) =====
function abrirBanco() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!bancoAberto)
    bancoAberto = new Promise((resolver) => {
      try {
        const pedido = indexedDB.open(BANCO, 1);
        pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => resolver(null);
        pedido.onblocked = () => resolver(null);
      } catch {
        resolver(null);
      }
    });
  return bancoAberto;
}

async function lerDoBanco(chaves) {
  const saida = new Map();
  const banco = await abrirBanco();
  if (!banco || !chaves.length) return saida;
  return new Promise((resolver) => {
    try {
      const transacao = banco.transaction(LOJA, "readonly");
      const loja = transacao.objectStore(LOJA);
      for (const chave of chaves) {
        const pedido = loja.get(chave);
        pedido.onsuccess = () => {
          if (pedido.result) saida.set(chave, new Int8Array(pedido.result));
        };
      }
      transacao.oncomplete = () => resolver(saida);
      transacao.onerror = () => resolver(saida);
      transacao.onabort = () => resolver(saida);
    } catch {
      resolver(saida);
    }
  });
}

function gravarNoBanco(entradas) {
  if (!entradas.length) return;
  abrirBanco().then((banco) => {
    if (!banco) return;
    try {
      const loja = banco.transaction(LOJA, "readwrite").objectStore(LOJA);
      for (const [chave, vetor] of entradas)
        loja.put(vetor.buffer.slice(vetor.byteOffset, vetor.byteOffset + vetor.byteLength), chave);
    } catch {
      // Cota do navegador cheia ou modo privado: segue só com a memória.
    }
  });
}

// Sai junto com a sessão: vetor é derivado do conteúdo do espaço.
export function apagarBuscaDoAparelho() {
  limparMemoriaDaBusca();
  bancoAberto = null;
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(BANCO);
  } catch {
    // Sem IndexedDB, não há o que apagar.
  }
}

export async function hashDoTexto(texto) {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(resumo)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Com o armazenamento bloqueado (modo privado de alguns navegadores), ler o
// token lança erro; o cookie HttpOnly da sessão segue no pedido do mesmo jeito.
const cabecalhosDeSessao = () => {
  try {
    return authHeaders();
  } catch {
    return {};
  }
};

async function pedirVetores(corpo, fetcher) {
  const resposta = await fetcher("/api/busca/vetores", {
    method: "POST",
    headers: { "content-type": "application/json", ...cabecalhosDeSessao() },
    credentials: "same-origin",
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.error || "A busca por significado não respondeu agora.");
    erro.indisponivel = true;
    erro.parcial = dados.vetores || {};
    throw erro;
  }
  return dados;
}

const guardar = (userId, vetores) => {
  const novos = [];
  for (const [hash, base64] of Object.entries(vetores || {})) {
    const chave = `${userId}:${hash}`;
    const vetor = deBase64(base64);
    memoria.set(chave, vetor);
    novos.push([chave, vetor]);
  }
  gravarNoBanco(novos);
};

const paraResultado = ({ doc, score }) => ({
  id: doc.id,
  sourceId: doc.sourceId,
  sourceLabel: doc.sourceLabel,
  sourcePage: doc.sourcePage,
  itemId: doc.itemId,
  title: doc.title,
  snippet: String(doc.body || doc.title || "").replace(/\s+/g, " ").trim().slice(0, 160),
  score,
  updatedAt: doc.updatedAt,
});

// `docs`: saída de buildIndex (searchDomain.js), já com o recorte de negócio,
// visibilidade e fonte da tela. Devolve os resultados no mesmo formato da
// busca por palavra, mais quantos textos já têm vetor.
export async function buscarPorSignificado(docs, consulta, { userId = "anonimo", fetcher = fetch } = {}) {
  const pergunta = String(consulta || "").trim();
  const candidatos = (docs || [])
    .map((doc) => ({ doc, texto: textoParaVetor(doc) }))
    .filter((item) => item.texto.length >= 12);
  const hashes = await Promise.all(candidatos.map((item) => hashDoTexto(item.texto)));
  candidatos.forEach((item, i) => {
    item.hash = hashes[i];
    item.chave = `${userId}:${hashes[i]}`;
  });

  const semMemoria = candidatos.filter((item) => !memoria.has(item.chave));
  for (const [chave, vetor] of await lerDoBanco(semMemoria.map((item) => item.chave)))
    memoria.set(chave, vetor);

  const pendentes = [];
  const jaPedidos = new Set();
  for (const item of candidatos)
    if (!memoria.has(item.chave) && !jaPedidos.has(item.hash)) {
      jaPedidos.add(item.hash);
      pendentes.push(item);
    }
  const lotes = [];
  for (let i = 0; i < pendentes.length && lotes.length < LOTES_POR_BUSCA; i += LOTE)
    lotes.push(pendentes.slice(i, i + LOTE));

  let vetorDaConsulta = consultas.get(pergunta) || null;
  let limiteDiario = false;
  // A consulta vai no primeiro pedido: se um lote seguinte falhar, a busca
  // ainda roda com os vetores que já existem.
  if (!vetorDaConsulta || lotes.length) {
    const primeiro = lotes.shift() || [];
    const dados = await pedirVetores(
      {
        itens: primeiro.map((item) => ({ h: item.hash, t: item.texto })),
        ...(vetorDaConsulta ? {} : { consulta: pergunta }),
      },
      fetcher,
    );
    guardar(userId, dados.vetores);
    if (dados.consulta) {
      vetorDaConsulta = deBase64(dados.consulta);
      consultas.set(pergunta, vetorDaConsulta);
    }
    limiteDiario = Boolean(dados.limiteDiario);
    for (const lote of lotes) {
      if (limiteDiario) break;
      try {
        const mais = await pedirVetores({ itens: lote.map((item) => ({ h: item.hash, t: item.texto })) }, fetcher);
        guardar(userId, mais.vetores);
        limiteDiario = Boolean(mais.limiteDiario);
      } catch (erro) {
        guardar(userId, erro.parcial);
        break;
      }
    }
  }

  const chavePorDoc = new Map(candidatos.map((item) => [item.doc.id, item.chave]));
  const resultados = rankearPorSignificado(
    candidatos.map((item) => item.doc),
    (doc) => memoria.get(chavePorDoc.get(doc.id)),
    vetorDaConsulta,
  ).map(paraResultado);
  return {
    resultados,
    indexados: candidatos.filter((item) => memoria.has(item.chave)).length,
    total: candidatos.length,
    limiteDiario,
  };
}
