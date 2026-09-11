// ===== Jornada do motorista: turno de trabalho (bloco 03 · fatia 2) =====
// Camada pura.
//
// Depois da vistoria, o segundo gesto do dia: começar o turno. O motorista
// INICIA e ENCERRA a jornada; as horas trabalhadas saem da diferença, não de um
// campo digitado. Um turno é aberto ao iniciar e fechado ao encerrar — só um
// aberto por vez (o banco também trava isso). As horas são derivadas, como o
// avanço da rota vem das paradas: o registro é o par início/fim, a hora é a soma.
//
// Nada grava aqui; o servidor é a autoridade. `agora` entra por argumento para
// o turno aberto ter uma duração determinística e testável.

const parseMs = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
};

// Minutos entre dois instantes ISO. Fim antes do início ou data inválida → 0
// (nunca negativo, nunca NaN).
export const duracaoMinutos = (inicio, fim) => {
  const a = parseMs(inicio);
  const b = parseMs(fim);
  if (a == null || b == null || b < a) return 0;
  return Math.round((b - a) / 60000);
};

// "3h07" a partir de minutos — o formato que o motorista lê.
export const formatarDuracao = (minutos) => {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

// O turno aberto (iniciado e ainda não encerrado), ou null.
export const turnoAberto = (turnos = []) =>
  (Array.isArray(turnos) ? turnos : []).find((t) => t && t.iniciadoEm && !t.encerradoEm) || null;

// Retrato da jornada: em turno ou não, quanto já rodou hoje, e as travas de
// ação (não inicia com um aberto; não encerra sem um aberto).
export const resumoDaJornada = (turnos = [], agora = "") => {
  const lista = Array.isArray(turnos) ? turnos : [];
  const agoraMs = parseMs(agora);
  const agoraIso = agoraMs != null ? agora : "";
  const hoje = String(agoraIso).slice(0, 10);
  const aberto = turnoAberto(lista);

  let minutosHoje = 0;
  let turnosHoje = 0;
  for (const t of lista) {
    const data = String(t?.dataServico || t?.iniciadoEm || "").slice(0, 10);
    if (!hoje || data !== hoje) continue;
    turnosHoje += 1;
    minutosHoje += duracaoMinutos(t.iniciadoEm, t.encerradoEm || agoraIso);
  }

  return {
    emTurno: Boolean(aberto),
    turnoAtual: aberto
      ? { ...aberto, minutosDecorridos: agoraIso ? duracaoMinutos(aberto.iniciadoEm, agoraIso) : 0 }
      : null,
    minutosHoje,
    turnosHoje,
    podeIniciar: !aberto,
    podeEncerrar: Boolean(aberto),
  };
};
