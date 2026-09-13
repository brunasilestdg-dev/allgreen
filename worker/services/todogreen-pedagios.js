import { normalizarPracas, pracasNaRota } from "../../src/features/logistics/pedagiosDomain.js";

// #94 (gratuito): praças de pedágio da rota pelos dados abertos da ANTT.
// A ANTT publica a localização das praças (concessões federais), mas NÃO a
// tarifa — então trazemos QUAIS/QUANTAS praças a rota cruza; o valor fica como
// estimativa que o usuário informa na tela. Sem chave, sem custo.
const ANTT_PRACAS_URL =
  "https://dados.antt.gov.br/dataset/a7e1e12d-f8e8-40cd-bc1f-57973a4a4a6d/resource/d400debd-8058-4971-9625-8b614b08cf9c/download/dados-dos-pracas-de-pedagio6_2026.json";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h: localização de praça muda pouco.

// Cache por isolate: uma busca serve muitas consultas até o TTL.
let cachePracas = { emCache: null, buscadoEm: 0 };

async function carregarPracas({ fetcher = fetch } = {}) {
  const agora = Date.now();
  if (cachePracas.emCache && agora - cachePracas.buscadoEm < TTL_MS) return cachePracas.emCache;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort("timeout"), 12_000);
  try {
    const resposta = await fetcher(ANTT_PRACAS_URL, {
      headers: { accept: "application/json" },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`ANTT respondeu HTTP ${resposta.status}`);
    const bruto = await resposta.json();
    const pracas = normalizarPracas(bruto);
    if (pracas.length) cachePracas = { emCache: pracas, buscadoEm: agora };
    return pracas;
  } finally {
    clearTimeout(timer);
  }
}

// Reduz a polyline a no máximo `max` pontos preservando começo e fim — mantém a
// cobertura da rota sem custo de casar milhares de vértices.
function amostrarLinha(polyline, max = 600) {
  const linha = (Array.isArray(polyline) ? polyline : [])
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (linha.length <= max) return linha;
  const passo = Math.ceil(linha.length / max);
  const amostra = linha.filter((_, i) => i % passo === 0);
  const ultimo = linha[linha.length - 1];
  if (amostra[amostra.length - 1] !== ultimo) amostra.push(ultimo);
  return amostra;
}

// `fetcher`/`pracas` injetáveis: o ranking de alternativas (routing-maps) e os
// testes reutilizam a MESMA consulta sem sair para a ANTT.
export async function consultarPedagiosDaRota(polyline, { fetcher = fetch, pracas: pracasInformadas = null } = {}) {
  const linha = amostrarLinha(polyline);
  if (linha.length < 2) throw new Error("Trace a rota antes de consultar os pedágios.");
  const pracas = Array.isArray(pracasInformadas) ? pracasInformadas : await carregarPracas({ fetcher });
  const naRota = pracasNaRota(pracas, linha, 1.5);
  return {
    pracas: naRota,
    quantidade: naRota.length,
    fonte: "ANTT · Dados Abertos (praça de pedágio)",
    cobertura: "Apenas concessões federais (BR-xxx). Pedágios de concessão estadual não constam nos dados abertos da ANTT.",
    tarifaFornecida: false,
  };
}
