// ===== Green On App B2C · Jornada do usuário (P1) =====
// Camada pura. Sem geolocalização de verdade, sem QR real — só o modelo.
//
// A titular pediu no bloco 12: buscar estação, ver disponibilidade e preço,
// reservar (com tolerância), autenticar por QR, acompanhar sessão ao vivo,
// pagar (cartão / GreenPay / carteira pré-paga), receber recibo e histórico.
// Este módulo é o motor puro; a página consome ele e a integração real
// (OCPP + gateway financeiro) fecha o círculo.
//
// Regras:
// 1. Preço na tela = preço GARANTIDO na sessão. Se o CPO subir a tarifa no
//    meio da sessão, o app cobra o preço mostrado — princípio de confiança
//    que o material da titular pede.
// 2. Reserva tem tolerância (padrão 15 min). Passou, libera para outro.
// 3. Sessão sem MeterValues confiáveis NÃO cobra — devolve "sem medição"
//    em vez de estimar. Regra do ESG e da fatura.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
};

// Distância aproximada em km entre dois pontos lat/lon usando fórmula do
// haversine. O aplicativo mostra "3,2 km" — precisão de m não é o que o
// motorista precisa; direção certa e sensibilidade a curvas curtas é.
export const distanceKm = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return arred(2 * R * Math.asin(Math.sqrt(s)), 2);
};

export const CONNECTOR_TYPES = Object.freeze([
  "CCS2", "CHAdeMO", "Type2", "GBT", "NACS",
]);
export const SESSION_STATES = Object.freeze([
  "idle", "reserved", "authenticating", "charging", "finishing", "closed", "cancelled",
]);
export const PAYMENT_METHODS = Object.freeze([
  "cartao", "greenpay", "prepago", "invoice-b2b",
]);

// Filtra estações por localização, tipo de plugue, preço máximo e
// disponibilidade. Ordena por distância crescente. "Estação sem preço" NÃO
// aparece no app — o consumidor não pode ser surpreendido no fim.
export const findStations = (stations = [], filtro = {}) => {
  const {
    origem, raioKm = 50, plug, precoMaximoReais, apenasDisponiveis = false,
  } = filtro;
  return (Array.isArray(stations) ? stations : [])
    .map((s) => {
      const dist = origem ? distanceKm(origem, s.local) : null;
      return { ...s, distanciaKm: dist };
    })
    .filter((s) => {
      // Estação sem preço configurado NÃO entra no app — o consumidor não
      // pode ser surpreendido no fim. `num` devolveria 0 para undefined,
      // então testa direto se o campo é número (não default).
      if (!s || typeof s.precoPorKwh !== "number" || !Number.isFinite(s.precoPorKwh)) return false;
      if (precoMaximoReais != null && s.precoPorKwh > num(precoMaximoReais)) return false;
      if (plug && !(s.plugues || []).includes(plug)) return false;
      if (apenasDisponiveis && !(s.plugues || []).some(() => (s.disponiveis || 0) > 0)) return false;
      if (s.distanciaKm != null && s.distanciaKm > raioKm) return false;
      return true;
    })
    .sort((a, b) => (a.distanciaKm ?? 1e9) - (b.distanciaKm ?? 1e9));
};

// Cria reserva com tolerância. O relógio é passado — a camada pura não olha
// para `Date.now()`. `chegouEmMs = null` significa "ainda não apareceu".
export const createReservation = ({ stationId, connectorId, userId, agoraMs, toleranciaMinutos = 15 }) => {
  if (!stationId) throw new Error("stationId obrigatório.");
  if (!userId) throw new Error("userId obrigatório.");
  return {
    id: `res-${agoraMs || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stationId,
    connectorId: connectorId || null,
    userId,
    reservadaEmMs: agoraMs || Date.now(),
    toleranciaMs: Math.max(60000, toleranciaMinutos * 60000),
    chegouEmMs: null,
    state: "reserved",
  };
};

// Está válida agora? Perdeu a tolerância? A resposta serve ao painel do
// dono da estação (libera para o próximo) e ao usuário (aviso "sua reserva
// expira em 3 min").
export const reservationStatus = (reservation, agoraMs) => {
  if (!reservation || reservation.state !== "reserved") return { valid: false, motivo: "não-ativa" };
  const restante = reservation.reservadaEmMs + reservation.toleranciaMs - num(agoraMs);
  if (restante <= 0) return { valid: false, motivo: "tolerância-excedida", restanteMs: 0 };
  return { valid: true, motivo: "ok", restanteMs: restante };
};

// Descreve o QR que autentica o usuário na estação. `stationId + connectorId
// + token curto`. O código do QR é a URL universal do app; a estação lê e
// devolve para o backend que casa reserva↔user↔token.
export const buildAuthQrPayload = ({ stationId, connectorId, userId, tokenExpira, agoraMs }) => {
  if (!stationId || !connectorId || !userId) throw new Error("stationId/connectorId/userId obrigatórios.");
  const now = agoraMs || Date.now();
  const expira = num(tokenExpira) || now + 5 * 60 * 1000;
  const token = randomBase36(24);
  return {
    stationId,
    connectorId,
    userId,
    token,
    expiraEmMs: expira,
    url: `greenon://auth?s=${encodeURIComponent(stationId)}&c=${encodeURIComponent(connectorId)}&t=${token}`,
  };
};

const randomBase36 = (chars) => {
  let s = "";
  for (let i = 0; i < chars; i += 1) s += Math.floor(Math.random() * 36).toString(36);
  return s;
};

// Sessão ao vivo: a partir do consumo acumulado, tempo decorrido e potência
// atual, monta os campos que o app mostra em tempo real. `sample` = { kwh,
// tempoMs, kwAtual, socPct }. `precoPorKwh` é o preço TRAVADO no início.
export const liveSessionMetrics = ({ kwh, tempoMs, kwAtual, socPct, precoPorKwh } = {}) => {
  const consumo = Math.max(0, num(kwh));
  const tempo = Math.max(0, num(tempoMs));
  const potencia = num(kwAtual);
  const preco = num(precoPorKwh);
  return {
    kwh: arred(consumo, 3),
    tempoMinutos: Math.floor(tempo / 60000),
    potenciaKw: arred(potencia, 1),
    socPct: socPct != null ? Math.max(0, Math.min(100, num(socPct))) : null,
    custoEstimadoReais: preco > 0 ? arred(consumo * preco) : null,
    kwhMedioPorMin: tempo > 60000 ? arred(consumo / (tempo / 60000), 3) : null,
  };
};

// Fecha a sessão e monta o RECIBO. Sem medição confiável (kwh <= 0),
// devolve `precisaRevisao: true` — nunca cobra estimando.
export const closeSession = ({ sessionId, kwh, tempoMs, precoPorKwh, metodo, ociosidadeMinutos = 0, precoOciosidadeReais = 0 }) => {
  if (!sessionId) throw new Error("sessionId obrigatório.");
  if (!PAYMENT_METHODS.includes(metodo)) throw new Error(`metodo desconhecido: ${metodo}`);
  const consumo = Math.max(0, num(kwh));
  const preco = Math.max(0, num(precoPorKwh));
  if (consumo <= 0) {
    return {
      sessionId,
      kwh: 0,
      tempoMinutos: Math.floor(num(tempoMs) / 60000),
      valorReais: 0,
      metodo,
      recibo: null,
      precisaRevisao: true,
      motivoRevisao: "sem-medicao-confiavel",
    };
  }
  const valorEnergia = arred(consumo * preco);
  const valorOciosidade = arred(Math.max(0, num(ociosidadeMinutos)) * Math.max(0, num(precoOciosidadeReais)));
  const total = arred(valorEnergia + valorOciosidade);
  return {
    sessionId,
    kwh: arred(consumo, 3),
    tempoMinutos: Math.floor(num(tempoMs) / 60000),
    valorEnergiaReais: valorEnergia,
    valorOciosidadeReais: valorOciosidade,
    valorReais: total,
    metodo,
    recibo: {
      linhas: [
        { label: "Energia entregue", detalhe: `${arred(consumo, 3)} kWh × R$ ${preco.toFixed(2)}`, valor: valorEnergia },
        valorOciosidade > 0
          ? { label: "Ociosidade", detalhe: `${ociosidadeMinutos} min × R$ ${Number(precoOciosidadeReais).toFixed(2)}`, valor: valorOciosidade }
          : null,
      ].filter(Boolean),
      total,
      metodo,
    },
    precisaRevisao: false,
  };
};

// Histórico do usuário — filtro/ordenação prontos para a página.
export const buildHistory = (sessions = [], userId, { desdeMs, ateMs } = {}) => {
  const desde = num(desdeMs) || 0;
  const ate = num(ateMs) || Number.POSITIVE_INFINITY;
  const minhas = (sessions || [])
    .filter((s) => s && s.userId === userId)
    .filter((s) => s.fechadaEmMs >= desde && s.fechadaEmMs <= ate)
    .sort((a, b) => (b.fechadaEmMs || 0) - (a.fechadaEmMs || 0));
  const totalKwh = arred(minhas.reduce((sum, s) => sum + num(s.kwh), 0), 3);
  const totalReais = arred(minhas.reduce((sum, s) => sum + num(s.valorReais), 0));
  return { sessoes: minhas, contagem: minhas.length, totalKwh, totalReais };
};

// Programa de fidelidade — 1 ponto por real gasto, 100 pontos = R$ 5 de
// crédito. Só uma opção padrão, mas o painel do CPO ajusta.
export const loyaltyPoints = (valorReais, { pontosPorReal = 1 } = {}) =>
  Math.floor(Math.max(0, num(valorReais)) * num(pontosPorReal));
