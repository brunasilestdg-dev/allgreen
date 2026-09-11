// Rota do dia atribuída a um motorista (#139) — núcleo puro e testável.
//
// O roteirizador desenha e otimiza a rota; aqui ela vira um objeto salvável e
// atribuível: paradas ORDENADAS, com endereço, coordenada, janela de horário e
// marca de recarga. O app do motorista lê essas paradas e vai concluindo uma a
// uma. Tudo puro para que a régua de status e de progresso seja a mesma no
// cliente, no servidor e no teste.

const texto = (valor) => String(valor ?? "").trim();
// null/undefined/"" NÃO viram 0 (que seria uma coordenada no meio do oceano);
// viram null. Só número finito de verdade passa.
const finito = (valor) =>
  valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor))
    ? null
    : Number(valor);

// Monta as paradas canônicas a partir do estado do roteirizador. `paradas` são
// as paradas já traçadas ({ rotulo, coord: [lat, lng] }); `recargas` é o Set de
// índices marcados para recarga; `janelas` são as janelas de horário por parada.
// Índice fora do alcance nunca inventa parada — só entra o que foi traçado.
export function montarParadasDaRota({ paradas = [], recargas, janelas = [] } = {}) {
  const marcadas = recargas instanceof Set ? recargas : new Set(Array.isArray(recargas) ? recargas : []);
  return paradas
    .map((parada, indice) => {
      const rotulo = texto(parada?.rotulo || parada?.endereco);
      if (!rotulo) return null;
      const coord = Array.isArray(parada?.coord) ? parada.coord : [];
      const janela = janelas[indice] || {};
      return {
        ordem: indice + 1,
        rotulo,
        endereco: texto(parada?.endereco) || rotulo,
        lat: finito(coord[0]),
        lng: finito(coord[1]),
        janelaInicio: texto(janela.inicio),
        janelaFim: texto(janela.fim),
        recarga: marcadas.has(indice),
        concluida: false,
      };
    })
    .filter(Boolean)
    .map((parada, indice) => ({ ...parada, ordem: indice + 1 }));
}

// Resumo honesto da rota: quantas paradas, quantas recargas, quantas já foram
// concluídas e quantas faltam. Usado no cartão do operador e do motorista.
export function resumoDaRota(stops = []) {
  const lista = Array.isArray(stops) ? stops : [];
  const concluidas = lista.filter((p) => p?.concluida).length;
  return {
    total: lista.length,
    recargas: lista.filter((p) => p?.recarga).length,
    concluidas,
    pendentes: lista.length - concluidas,
  };
}

// Progresso 0–100 pela conclusão das paradas. Rota vazia é 0 (não 100): não há
// o que concluir, então não está "pronta".
export function progressoDaRota(stops = []) {
  const { total, concluidas } = resumoDaRota(stops);
  if (total === 0) return 0;
  return Math.round((concluidas / total) * 100);
}

// Status derivado da conclusão — nunca marcado por clique solto: nenhuma parada
// feita = planejada; todas feitas = concluída; no meio = em rota. Espelha a
// regra da jornada de eletrificação (avanço vem do que aconteceu, não de um
// botão de status).
export function statusPelaConclusao(stops = []) {
  const { total, concluidas } = resumoDaRota(stops);
  if (total === 0 || concluidas === 0) return "planejada";
  if (concluidas >= total) return "concluida";
  return "em_rota";
}

// Alterna a conclusão de UMA parada (por índice) e devolve a lista nova, sem
// mutar a original. É o que o motorista dispara ao marcar/desmarcar uma parada.
export function marcarParadaConcluida(stops = [], indice, concluida) {
  const lista = Array.isArray(stops) ? stops : [];
  return lista.map((parada, i) => (i === indice ? { ...parada, concluida: Boolean(concluida) } : parada));
}

// Projeta um fato da operação na rota otimizada. A operação é a verdade: a
// coleta conclui apenas a parada de coleta; a entrega conclui coleta + entrega
// da mesma operação, porque uma carga entregue necessariamente foi coletada.
// Paradas manuais, sem operationId, continuam intocadas.
export function concluirParadasDaOperacao(stops = [], operationId, tipoEvento) {
  const id = texto(operationId);
  const tipo = texto(tipoEvento).toLowerCase();
  if (!id || !["coleta", "entrega"].includes(tipo)) return Array.isArray(stops) ? stops : [];
  const tiposConcluidos = tipo === "entrega" ? new Set(["coleta", "entrega"]) : new Set(["coleta"]);
  return (Array.isArray(stops) ? stops : []).map((parada) => (
    texto(parada?.operationId) === id && tiposConcluidos.has(texto(parada?.tipo).toLowerCase())
      ? { ...parada, concluida: true }
      : parada
  ));
}

// Link de navegação para o motorista: usa a coordenada quando há (mais preciso),
// senão o endereço em texto. Abre no Google Maps, que todo celular tem.
export function linkNavegacao(stop = {}) {
  const lat = finito(stop.lat);
  const lng = finito(stop.lng);
  if (lat !== null && lng !== null)
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const alvo = texto(stop.endereco || stop.rotulo);
  if (!alvo) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(alvo)}`;
}

// A rota é válida para atribuir? Precisa de um motorista e de pelo menos duas
// paradas (origem e destino) — uma "rota" de um ponto só não é rota.
export function rotaValidaParaAtribuir({ driverId, stops } = {}) {
  if (!texto(driverId)) return { valido: false, erro: "Escolha o motorista que vai receber a rota." };
  const lista = Array.isArray(stops) ? stops : [];
  if (lista.length < 2) return { valido: false, erro: "Trace a rota (origem e destino) antes de atribuir." };
  return { valido: true, erro: "" };
}

// Rótulo humano do status, para a tela não mostrar o código cru.
export const ROTULO_STATUS_ROTA = Object.freeze({
  planejada: "Planejada",
  em_rota: "Em rota",
  concluida: "Concluída",
});
