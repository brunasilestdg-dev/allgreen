// ===== NPS de cliente (Portal — ACOMPANHAR) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A voz do cliente vira número que fecha ciclo. Depois da entrega, o cliente dá
// uma nota de 0 a 10; a plataforma classifica (promotor, neutro, detrator) e
// calcula o NPS. A regra que dá sentido ao indicador está na ponta: toda nota
// de DETRATOR precisa virar uma ocorrência com responsável e prazo — NPS que
// não trata detrator é enquete, não gestão.
//
// Honestidade (regra da vertical): sem respostas, o NPS é `null`, não 0 — zero
// seria uma leitura falsa de "neutro". Nota fora de 0..10 não conta.

const inteiroValido = (valor) => {
  // Nota em branco não é 0 — é ausência de resposta. Sem esta guarda, `null`,
  // `undefined`, `""` e booleanos coagiriam para número (Number(null) === 0) e
  // uma resposta vazia entraria como detrator. Só número ou string numérica passa.
  if (valor === null || valor === undefined || valor === "" || typeof valor === "boolean")
    return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
};

export const LIMITE_PROMOTOR = 9; // 9-10
export const LIMITE_DETRATOR = 6; // 0-6 (neutro = 7-8)

// Classifica uma nota. Nota inválida → null (não entra na conta).
export const classificarNPS = (nota) => {
  const n = inteiroValido(nota);
  if (n == null) return null;
  if (n >= LIMITE_PROMOTOR) return "promotor";
  if (n <= LIMITE_DETRATOR) return "detrator";
  return "neutro";
};

// Uma nota de detrator (0..6) precisa abrir ocorrência. É a ponte que fecha o
// ciclo — a mesma regra que a tela e o servidor usam.
export const precisaOcorrencia = (nota) => classificarNPS(nota) === "detrator";

// NPS = % promotores − % detratores, sobre as respostas VÁLIDAS. Faixa −100..100.
export const calcularNPS = (respostas = []) => {
  const lista = Array.isArray(respostas) ? respostas : [];
  let promotores = 0;
  let neutros = 0;
  let detratores = 0;
  for (const r of lista) {
    const classe = classificarNPS(r?.nota);
    if (classe === "promotor") promotores += 1;
    else if (classe === "neutro") neutros += 1;
    else if (classe === "detrator") detratores += 1;
  }
  const respondidos = promotores + neutros + detratores;
  const nps = respondidos > 0
    ? Math.round(((promotores - detratores) / respondidos) * 100)
    : null; // sem resposta válida → sem NPS, nunca 0
  return { respondidos, promotores, neutros, detratores, nps };
};

// NPS agrupado por uma dimensão (região, rota, motorista). Devolve uma lista
// ordenada do pior para o melhor NPS, para a tela mostrar onde dói.
export const npsPorDimensao = (respostas = [], chave = "regiao") => {
  const grupos = {};
  for (const r of (Array.isArray(respostas) ? respostas : [])) {
    if (classificarNPS(r?.nota) == null) continue;
    const rotulo = String(r?.[chave] ?? "").trim() || "Sem informação";
    (grupos[rotulo] ||= []).push(r);
  }
  return Object.entries(grupos)
    .map(([rotulo, itens]) => ({ rotulo, ...calcularNPS(itens) }))
    .sort((a, b) => (a.nps ?? 0) - (b.nps ?? 0));
};

// Ranking das causas de insatisfação: agrupa os motivos citados por detratores.
export const causasDeInsatisfacao = (respostas = []) => {
  const contagem = {};
  for (const r of (Array.isArray(respostas) ? respostas : [])) {
    if (classificarNPS(r?.nota) !== "detrator") continue;
    const causa = String(r?.motivo ?? "").trim() || "Não informado";
    contagem[causa] = (contagem[causa] || 0) + 1;
  }
  return Object.entries(contagem)
    .map(([causa, total]) => ({ causa, total }))
    .sort((a, b) => b.total - a.total);
};

// Faixa de leitura do NPS, para a tela colorir sem duplicar regra.
export const faixaNPS = (nps) => {
  if (nps == null) return "sem-dados";
  if (nps >= 75) return "excelente";
  if (nps >= 50) return "muito-bom";
  if (nps >= 0) return "razoavel";
  return "critico";
};
