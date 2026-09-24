// ===== Busca por significado: regras puras =====
//
// Complementa o BM25 de searchDomain.js: a palavra exata acha "nota fiscal";
// o significado acha "NF da remessa de ontem" quando o texto diz "documento
// fiscal do envio". Os vetores vêm do `bge-m3` (Workers AI, multilíngue, 1.024
// dimensões) e a comparação roda no aparelho — o servidor só calcula e guarda
// o vetor de cada texto, sem índice pago nem limite por conta.
//
// Nada aqui toca rede ou armazenamento: servidor e tela usam as mesmas regras.

export const MODELO_EMBEDDING = "@cf/baai/bge-m3";
export const DIMENSOES = 1024;
// ~400 tokens em português: cabe na janela de qualquer leitura do modelo.
export const TEXTO_MAXIMO = 1500;
export const CONSULTA_MAXIMA = 300;
export const HASH_VALIDO = /^[a-f0-9]{16,64}$/;

export const textoParaVetor = (doc) =>
  `${doc?.title || ""}\n${doc?.body || ""}`.replace(/\s+/g, " ").trim().slice(0, TEXTO_MAXIMO);

// Guardar em int8 (1 byte por dimensão) em vez de float32 corta 75% do espaço.
// A escala de cada vetor não precisa ser guardada: o cosseno não muda quando
// um vetor é multiplicado por uma constante.
export function quantizar(vetor) {
  let maior = 0;
  for (const valor of vetor) maior = Math.max(maior, Math.abs(Number(valor) || 0));
  const escala = maior > 0 ? 127 / maior : 0;
  return Int8Array.from(vetor, (valor) => Math.round((Number(valor) || 0) * escala));
}

export function paraBase64(bytes) {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binario = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    binario += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(binario);
}

export function deBase64(texto) {
  const binario = atob(String(texto || ""));
  const bytes = new Int8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = (binario.charCodeAt(i) << 24) >> 24;
  return bytes;
}

export function similaridade(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i += 1) {
    produto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  return normaA && normaB ? produto / Math.sqrt(normaA * normaB) : 0;
}

// Parecidos com a consulta. No bge-m3, textos sem relação ficam perto de 0,3–
// 0,45 de cosseno; o piso de 0,5 e a janela de 0,2 abaixo do melhor evitam
// encher a lista de resultado "parecido com nada".
export function rankearPorSignificado(
  docs,
  vetorDoDoc,
  consulta,
  { limite = 25, minimo = 0.5, janela = 0.2 } = {},
) {
  if (!consulta?.length) return [];
  const pontuados = [];
  for (const doc of docs || []) {
    const vetor = vetorDoDoc(doc);
    if (!vetor) continue;
    const score = similaridade(vetor, consulta);
    if (score >= minimo) pontuados.push({ doc, score });
  }
  pontuados.sort((a, b) => b.score - a.score);
  const melhor = pontuados[0]?.score || 0;
  return pontuados
    .filter((item) => item.score >= melhor - janela)
    .slice(0, limite)
    .map((item) => ({ ...item, score: Math.round(item.score * 1000) / 1000 }));
}

// Fusão por posição (Reciprocal Rank Fusion): soma 1/(k + posição) de cada
// lista. Não compara nota de BM25 com cosseno — escalas diferentes —, só a
// ordem de cada uma. `origem` diz à tela por que o item apareceu.
export function fundirResultados(porPalavra, porSignificado, { k = 60, limite = 25 } = {}) {
  const itens = new Map();
  const somar = (lista, origem) =>
    (lista || []).forEach((resultado, posicao) => {
      const atual = itens.get(resultado.id) || { resultado, fusao: 0, origens: new Set() };
      atual.fusao += 1 / (k + posicao + 1);
      atual.origens.add(origem);
      // O resultado do BM25 tem o trecho com a palavra marcada; fica com ele.
      if (origem === "palavra") atual.resultado = resultado;
      itens.set(resultado.id, atual);
    });
  somar(porPalavra, "palavra");
  somar(porSignificado, "significado");
  return [...itens.values()]
    .sort((a, b) => b.fusao - a.fusao)
    .slice(0, limite)
    .map(({ resultado, origens }) => ({
      ...resultado,
      origem: origens.size === 2 ? "ambos" : [...origens][0],
    }));
}
