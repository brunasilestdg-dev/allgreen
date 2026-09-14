// ===== Notícias Green On — foco no core (recarga, energia, e-mobilidade) =====
//
// Camada pura. É a mesma ideia da noticiaDomain.js do TDG (limpeza, extração
// de data, classificação por tema), MAS com léxico próprio da Green On: nada
// de "last mile" ou "transportadora". Aqui o mundo é infraestrutura de
// recarga, mercado de energia, veículos elétricos, baterias e regulação
// (ANEEL/distribuidora). Reaproveitamos os utilitários puros do TDG para
// não duplicar código nem inventar outra régua de limpeza.

import { extrairDataDaNoticia, limparResumoDeBusca } from "../logistics/noticiaDomain.js";

const semAcento = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Cada tema é um bloco de termos. A ordem importa: o primeiro tema que casar
// vence, para uma notícia sobre "leilão de recarga da ANEEL" cair em
// "regulatorio" (o assunto principal) em vez de virar só "recarga".
const TERMOS_POR_TEMA = Object.freeze([
  {
    tema: "regulatorio",
    rotulo: "Regulatório",
    // Deve vir antes de "energia" para que decisões da ANEEL/ANP/EPE não sejam
    // classificadas apenas como "energia".
    termos: [
      "aneel", "anp", "epe", "mme", "leilao de energia", "leilao de recarga",
      "resolucao normativa", "consulta publica", "audiencia publica",
      "concessionaria", "distribuidora", "outorga", "regulacao",
      "tarifa branca", "bandeira tarifaria",
    ],
  },
  {
    tema: "recarga",
    rotulo: "Recarga",
    termos: [
      "eletroposto", "eletropostos", "recarga rapida", "recarga ultra rapida",
      "carregador", "carregadores", "estacao de recarga", "ocpp", "csms",
      "hub de recarga", "recharge", "charging station", "point of charging",
      "wallbox", "dc fast", "recarga publica", "recarga corporativa",
      "roaming de recarga", "ocpi", "fast charger",
    ],
  },
  {
    tema: "energia",
    rotulo: "Energia",
    // Contém termos amplos de energia; fica depois de regulatório e recarga
    // para não roubar notícias mais específicas.
    termos: [
      "energia solar", "energia renovavel", "energias renovaveis", "solar fotovoltaico",
      "fotovoltaica", "geracao distribuida", "microgeracao", "minigeracao",
      "bess", "sistema de armazenamento", "bateria estacionaria", "armazenamento de energia",
      "smart grid", "rede eletrica", "demanda", "contrato de energia",
      "mercado livre de energia", "acl", "acr", "ppa", "horario de ponta",
      "smart charging", "gestao de energia", "cogeracao", "biometano",
    ],
  },
  {
    tema: "e-mobilidade",
    rotulo: "E-mobilidade",
    termos: [
      "veiculo eletrico", "veiculos eletricos", "carro eletrico", "carros eletricos",
      "eletrificacao", "eletrificar", "ev", "mobilidade eletrica",
      "onibus eletrico", "caminhao eletrico", "moto eletrica",
      "byd", "tesla", "volvo eletrico", "mercedes eletrico", "bmw eletrico",
      "bateria de litio", "bateria de veiculo", "autonomia", "lifepo4",
      "hidrogenio", "celula combustivel", "veiculo autonomo",
    ],
  },
]);

export const GREEN_ON_TEMAS_DE_NOTICIA = Object.freeze([
  ["todas", "Todas"],
  ...TERMOS_POR_TEMA.map((t) => [t.tema, t.rotulo]),
  ["outros", "Outros"],
]);

// Devolve o tema Green On da notícia. `outros` é honesto: não força uma
// notícia genérica a virar "energia" só porque a fonte é do setor.
export const temaDaNoticiaGreenOn = (item = {}) => {
  const texto = semAcento(
    `${item.title || ""} ${item.summary || item.snippet || ""} ${item.source || ""}`,
  );
  if (!texto.trim()) return "outros";
  for (const bloco of TERMOS_POR_TEMA) {
    if (bloco.termos.some((termo) => texto.includes(semAcento(termo)))) {
      return bloco.tema;
    }
  }
  return "outros";
};

// Fora de escopo Green On: notícias de logística pura (fretes, last mile de
// e-commerce, transportadora, RFP de transporte) NÃO são para esta vertical
// — elas alimentam a TDG. A ideia é o mesmo do "OFF_SCOPE" do market signal,
// mas invertido: aqui rejeita quem é do outro núcleo.
const FORA_DE_ESCOPO = [
  "last mile", "middle mile", "first mile", "transportadora", "transportadoras",
  "carga fracionada", "carga completa", "line haul", "cross docking",
  "coleta e entrega", "expedicao", "distribuidora de bebidas",
  "rota de entrega", "roteirizacao de entrega", "seguro de frota",
];

export const foraDoEscopoGreenOn = (item = {}) => {
  const texto = semAcento(`${item.title || ""} ${item.summary || item.snippet || ""}`);
  if (!texto.trim()) return false;
  return FORA_DE_ESCOPO.some((termo) => texto.includes(semAcento(termo)));
};

// Modelo de notícia Green On para o feed local. `origem` é obrigatória
// (nunca inventar fonte), `publishedAt` opcional — quando ausente, o portal
// mostra a data em que foi cadastrada (createdAt).
export const createGreenOnNoticia = (input = {}) => {
  const raw = {
    id: input.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    title: limparResumoDeBusca(input.title || ""),
    summary: limparResumoDeBusca(input.summary || input.snippet || ""),
    source: String(input.source || "").trim(),
    url: String(input.url || "").trim(),
    publishedAt: input.publishedAt || extrairDataDaNoticia(`${input.title || ""} ${input.summary || ""}`),
    accountId: String(input.accountId || "").trim(), // opcional: liga à conta Green On
    tema: "",
    highlighted: input.highlighted === true,
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((t) => String(t).trim()).filter(Boolean))] : [],
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: input.active !== false,
  };
  raw.tema = temaDaNoticiaGreenOn(raw);
  return raw;
};

// Feed pronto para renderizar: filtra fora-de-escopo, ordena mais recentes
// primeiro (publishedAt quando existe, senão createdAt) e aplica o filtro
// de tema. Uma notícia sem título e sem resumo é descartada — "sem dado
// não vira feed", regra do produto.
export const filtrarFeedGreenOn = (noticias = [], filtroTema = "todas") => {
  const items = noticias
    .filter((n) => n && n.active !== false && (n.title || n.summary))
    .filter((n) => !foraDoEscopoGreenOn(n))
    .map((n) => ({ ...n, tema: n.tema || temaDaNoticiaGreenOn(n) }));
  const filtrado = filtroTema === "todas"
    ? items
    : items.filter((n) => n.tema === filtroTema);
  return filtrado.sort((a, b) => {
    const chaveA = a.publishedAt || a.createdAt || "";
    const chaveB = b.publishedAt || b.createdAt || "";
    return chaveB.localeCompare(chaveA);
  });
};

// Resumo do feed para dashboards: contagem por tema, quantas notícias novas
// nos últimos 7 dias, e se há notícia destacada (highlighted). Serve o card
// "Radar Green On" sem precisar carregar o feed inteiro na home.
export const resumirFeedGreenOn = (noticias = [], agora = new Date()) => {
  const ativas = noticias.filter((n) => n && n.active !== false && (n.title || n.summary) && !foraDoEscopoGreenOn(n));
  const seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentes = ativas.filter((n) => {
    const quando = n.publishedAt || n.createdAt;
    if (!quando) return false;
    const data = new Date(quando.length <= 10 ? `${quando}T00:00:00Z` : quando);
    return Number.isFinite(data.getTime()) && data >= seteDiasAtras;
  });
  const porTema = {};
  for (const bloco of TERMOS_POR_TEMA) porTema[bloco.tema] = 0;
  porTema.outros = 0;
  for (const n of ativas) {
    const tema = n.tema || temaDaNoticiaGreenOn(n);
    porTema[tema] = (porTema[tema] || 0) + 1;
  }
  return {
    total: ativas.length,
    ultimos7dias: recentes.length,
    destacadas: ativas.filter((n) => n.highlighted).length,
    porTema,
  };
};
