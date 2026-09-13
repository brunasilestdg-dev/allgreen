// ===== Reserva de carregador (bloco 05 Charging/GreenOn) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// Reservar é dizer "este ponto é meu das 22h às 2h". Sem reserva, dois veículos
// chegam ao mesmo carregador e um espera sem saber por quê. A reserva resolve o
// conflito ANTES da viagem, e conversa com a recarga inteligente: a janela fora
// de ponta é onde as reservas se concentram.
//
// A regra que dá valor ao módulo é uma só: DUAS reservas ativas não podem
// ocupar o MESMO ponto em horários que se cruzam. Essa checagem é pura e roda
// nos dois lados — na tela (para avisar antes de salvar) e no servidor (guarda
// de escrita), a mesma função, para o botão não liberar o que o servidor
// recusa. Reserva cancelada ou concluída não bloqueia nada: liberou o ponto.

const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const ms = (iso) => {
  const t = new Date(texto(iso)).getTime();
  return Number.isFinite(t) ? t : null;
};

export const STATUS_RESERVA = Object.freeze(["reservada", "em_uso", "concluida", "cancelada"]);
// Só as reservas que ainda ocupam o ponto entram na checagem de conflito.
export const STATUS_ATIVOS = Object.freeze(["reservada", "em_uso"]);

export const statusReservaValido = (v) =>
  STATUS_RESERVA.includes(texto(v)) ? texto(v) : "reservada";

export const reservaAtiva = (reserva) => STATUS_ATIVOS.includes(statusReservaValido(reserva?.status));

export const normalizarReserva = (corpo = {}) => ({
  pontoId: texto(corpo.pontoId, 120),
  pontoNome: texto(corpo.pontoNome, 200),
  veiculoId: texto(corpo.veiculoId, 120),
  veiculoRotulo: texto(corpo.veiculoRotulo, 120),
  motoristaId: texto(corpo.motoristaId, 120),
  motoristaNome: texto(corpo.motoristaNome, 160),
  inicioEm: texto(corpo.inicioEm, 40),
  fimEm: texto(corpo.fimEm, 40),
  status: statusReservaValido(corpo.status),
  observacao: texto(corpo.observacao, 500),
});

export const validarReserva = (corpo = {}) => {
  if (!texto(corpo.pontoId) && !texto(corpo.pontoNome))
    return "Escolha o ponto de recarga a reservar.";
  const ini = ms(corpo.inicioEm);
  const fim = ms(corpo.fimEm);
  if (ini == null) return "Informe o início da reserva.";
  if (fim == null) return "Informe o fim da reserva.";
  if (fim <= ini) return "O fim da reserva precisa ser depois do início.";
  return "";
};

// Dois intervalos [inicio, fim) se sobrepõem? Fronteira que apenas encosta
// (uma termina exatamente quando a outra começa) NÃO é conflito — é o encaixe
// perfeito de duas reservas seguidas no mesmo ponto.
export const intervalosSobrepoem = (a, b) => {
  const aIni = ms(a?.inicioEm);
  const aFim = ms(a?.fimEm);
  const bIni = ms(b?.inicioEm);
  const bFim = ms(b?.fimEm);
  if (aIni == null || aFim == null || bIni == null || bFim == null) return false;
  return aIni < bFim && bIni < aFim;
};

// A reserva que conflita com uma nova (mesmo ponto, ativa, horário cruzado), ou
// null. Ignora a própria (por id) na edição. É o coração do módulo.
export const conflitoDeReserva = (existentes = [], nova = {}) => {
  const pontoId = texto(nova.pontoId);
  const pontoNome = texto(nova.pontoNome);
  const mesmoPonto = (r) =>
    (pontoId && texto(r.pontoId) === pontoId) ||
    (!pontoId && pontoNome && texto(r.pontoNome) === pontoNome);
  return (
    (Array.isArray(existentes) ? existentes : []).find(
      (r) =>
        texto(r.id) !== texto(nova.id) &&
        reservaAtiva(r) &&
        mesmoPonto(r) &&
        intervalosSobrepoem(r, nova),
    ) || null
  );
};

// O ponto está livre num instante? (para a tela mostrar disponibilidade agora).
// `agoraIso` default = momento da chamada; puro recebendo o instante evita
// depender do relógio dentro da função.
export const pontoDisponivelEm = (reservas = [], pontoId, agoraIso = new Date().toISOString()) => {
  const instante = ms(agoraIso);
  if (instante == null) return true;
  const alvo = texto(pontoId);
  return !(Array.isArray(reservas) ? reservas : []).some((r) => {
    if (!reservaAtiva(r) || texto(r.pontoId) !== alvo) return false;
    const ini = ms(r.inicioEm);
    const fim = ms(r.fimEm);
    return ini != null && fim != null && ini <= instante && instante < fim;
  });
};

// Próximas reservas a partir de um instante (ativas, ordenadas por início) —
// a agenda que a tela mostra. Passadas e encerradas ficam de fora.
export const proximasReservas = (reservas = [], agoraIso = new Date().toISOString()) => {
  const instante = ms(agoraIso) ?? 0;
  return (Array.isArray(reservas) ? reservas : [])
    .filter((r) => reservaAtiva(r) && (ms(r.fimEm) ?? 0) >= instante)
    .sort((a, b) => (ms(a.inicioEm) ?? 0) - (ms(b.inicioEm) ?? 0));
};

// Resumo para o topo da tela — números derivados.
export const resumoReservas = (reservas = [], agoraIso = new Date().toISOString()) => {
  const lista = Array.isArray(reservas) ? reservas : [];
  const instante = ms(agoraIso) ?? 0;
  return {
    total: lista.length,
    ativas: lista.filter(reservaAtiva).length,
    emUso: lista.filter((r) => statusReservaValido(r.status) === "em_uso").length,
    futuras: lista.filter((r) => reservaAtiva(r) && (ms(r.inicioEm) ?? 0) > instante).length,
    concluidas: lista.filter((r) => statusReservaValido(r.status) === "concluida").length,
    canceladas: lista.filter((r) => statusReservaValido(r.status) === "cancelada").length,
  };
};

export const MENSAGEM_CONFLITO = "Este ponto já está reservado em um horário que cruza com o pedido.";
