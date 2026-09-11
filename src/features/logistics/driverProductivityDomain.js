// ===== Produtividade do motorista: o dia dele (bloco 03 · fatia 4) =====
// Camada pura.
//
// Fecha o bloco 03 cruzando a JORNADA (horas do turno) com as ENTREGAS: quantas
// entregou hoje e na semana, quantos km rodou, e a razão que amarra os dois —
// entregas por hora. É o "quanto rendi" do motorista, derivado do que ele já
// registra, nunca digitado.
//
// Honestidade: entregas por hora só existe com horas de turno lançadas — sem
// jornada, fica `null` (não se divide por zero nem se inventa produtividade).
// Tudo derivado, como o score e a jornada.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};
const ms = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
};

// `viagens` no formato do portal (entregueEm, distanciaKm). `minutosHoje` vem da
// jornada (resumoDaJornada). `agora` ISO para recortar hoje e a semana.
export const resumoDeProdutividade = (viagens = [], { minutosHoje = 0, agora = "" } = {}) => {
  const lista = Array.isArray(viagens) ? viagens : [];
  const entregues = lista.filter((v) => v && v.entregueEm);
  const agoraMs = ms(agora);
  const hoje = String(agora).slice(0, 10);
  const seteDiasAtras = agoraMs != null ? agoraMs - 7 * 86400000 : null;

  const entreguesHoje = entregues.filter((v) => String(v.entregueEm).slice(0, 10) === hoje);
  const entreguesSemana = seteDiasAtras != null
    ? entregues.filter((v) => { const t = ms(v.entregueEm); return t != null && t >= seteDiasAtras; })
    : [];

  const kmHoje = entreguesHoje.reduce((s, v) => s + num(v.distanciaKm), 0);
  const kmSemana = entreguesSemana.reduce((s, v) => s + num(v.distanciaKm), 0);

  const horasHoje = num(minutosHoje) / 60;
  // Entregas por hora: só com turno lançado. Sem horas, null — não se finge.
  const entregasPorHora = horasHoje > 0 ? entreguesHoje.length / horasHoje : null;

  return {
    entregasHoje: entreguesHoje.length,
    entregasSemana: entreguesSemana.length,
    kmHoje: arred(kmHoje),
    kmSemana: arred(kmSemana),
    horasHoje: arred(horasHoje),
    entregasPorHora: entregasPorHora != null ? arred(entregasPorHora) : null,
  };
};
