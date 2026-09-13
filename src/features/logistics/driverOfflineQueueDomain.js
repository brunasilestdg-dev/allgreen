// ===== Fila offline do app do motorista (idempotente) =====
// Camada PURA. Sem banco, sem rede, sem DOM, sem localStorage.
//
// Na estrada o sinal cai. O registro (entrega, POD, ocorrência) fica no celular
// e é reenviado sozinho quando a internet volta. Estas são as REGRAS da fila,
// extraídas do DriverPortalPage para serem testáveis e reaproveitáveis pelo
// dreno, pelo servidor e pelo teste — a mesma régua nos três lugares.
//
// Invariante do produto (seção 24): um clique repetido NÃO pode virar duas
// entregas, dois PODs, duas ocorrências ou dois eventos financeiros. Cada
// evento carrega uma chave de idempotência; a fila deduplica por ela ANTES de
// enviar, e o servidor deduplica por ela ao receber — cinto e suspensório.
//
// Forma canônica de um item da fila:
//   { id, viagemId, referencia, tipo, criadoEm,
//     payload: { idempotencyKey, ocorridoEm, ... } }

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Identidade de idempotência do item: preferimos a chave que o servidor também
// enxerga (payload.idempotencyKey); o id da linha da fila é o fallback.
export function eventKey(item = {}) {
  return texto(item?.payload?.idempotencyKey) || texto(item?.id);
}

// Chave determinística para eventos SINGLETON (um por entidade): dois cliques
// no "concluir entrega" da MESMA parada produzem a MESMA chave e colapsam num
// só evento. Eventos repetíveis (ocorrência, foto extra) não usam isto — cada
// um é legítimo e recebe chave própria.
export function singletonKey({ viagemId, entityId, eventType } = {}) {
  return [texto(viagemId), texto(entityId), texto(eventType)]
    .filter(Boolean)
    .join(":");
}

// Remove duplicatas por chave de idempotência, preservando a ORDEM e a PRIMEIRA
// ocorrência. Itens sem chave nenhuma são mantidos (não há como afirmar que são
// duplicados) — mas isso é justamente o que buildQueueEvent evita.
export function dedupeQueue(list = []) {
  const vistos = new Set();
  const saida = [];
  for (const item of Array.isArray(list) ? list : []) {
    const chave = eventKey(item);
    if (chave) {
      if (vistos.has(chave)) continue;
      vistos.add(chave);
    }
    saida.push(item);
  }
  return saida;
}

// Colapsa eventos singleton: para cada (viagem+entidade+tipo) marcado como
// singleton, mantém só o primeiro. Complementa o dedupe por chave para o caso
// em que a chave não pôde ser determinística.
export function collapseSingletons(list = [], singletonTypes = []) {
  const tipos = new Set(singletonTypes.map(texto));
  const vistos = new Set();
  const saida = [];
  for (const item of Array.isArray(list) ? list : []) {
    const tipo = texto(item?.tipo || item?.payload?.tipo);
    if (tipos.has(tipo)) {
      const chave = singletonKey({
        viagemId: item.viagemId,
        entityId: item.entityId ?? item?.payload?.entityId ?? item.referencia,
        eventType: tipo,
      });
      if (chave) {
        if (vistos.has(chave)) continue;
        vistos.add(chave);
      }
    }
    saida.push(item);
  }
  return saida;
}

const momento = (item) => {
  const t = Date.parse(item?.criadoEm || item?.payload?.ocorridoEm || "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; // sem data vai para o fim, estável
};

// Ordena para sincronizar: mais antigo primeiro (a ordem em que aconteceu na
// estrada). Estável para itens com o mesmo instante.
export function orderForSync(list = []) {
  return (Array.isArray(list) ? [...list] : [])
    .map((item, i) => [item, i])
    .sort((a, b) => (momento(a[0]) - momento(b[0])) || (a[1] - b[1]))
    .map(([item]) => item);
}

// Atribui id aos itens legados que não têm (gerador INJETADO — puro). Não
// altera itens que já têm id.
export function assignMissingIds(list = [], gen) {
  let mudou = false;
  const saida = (Array.isArray(list) ? list : []).map((item) => {
    if (item && !item.id) {
      mudou = true;
      return { ...item, id: gen() };
    }
    return item;
  });
  return { list: saida, changed: mudou };
}

// Remove da fila os ids já processados pelo dreno (aceitos ou rejeitados em
// definitivo). `processedIds` pode ser Set ou array.
export function removeProcessed(list = [], processedIds) {
  const ids = processedIds instanceof Set ? processedIds : new Set(processedIds || []);
  return (Array.isArray(list) ? list : []).filter((item) => !ids.has(item?.id));
}

// Remove da fila todo item cuja CHAVE de idempotência foi processada. Diferente
// de removeProcessed (por id), isto tira também as duplicatas que o dreno
// colapsou e nunca chegou a enviar individualmente — senão elas ficariam presas
// na fila reaparecendo a cada dreno.
export function removeProcessedByKey(list = [], processedKeys) {
  const keys = processedKeys instanceof Set ? processedKeys : new Set(processedKeys || []);
  return (Array.isArray(list) ? list : []).filter((item) => {
    const k = eventKey(item);
    return !(k && keys.has(k));
  });
}

export const pendingCount = (list = []) => (Array.isArray(list) ? list.length : 0);

// Monta o batch a enviar: dedupe por chave, colapsa singletons e ordena.
export function prepareDrainBatch(list = [], { singletonTypes = ["entrega"] } = {}) {
  return orderForSync(collapseSingletons(dedupeQueue(list), singletonTypes));
}
