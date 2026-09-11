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

// ===== Conformidade da jornada (fadiga · Lei 13.103/2015) =====
//
// A jornada crua já é gravada (par início/fim). Aqui entra a camada de
// compliance: os limites da Lei do Motorista viram alertas SOBRE os turnos que
// já existem — sem tabela nova, sem telemetria. É prevenção de fadiga e risco
// trabalhista, derivada, não gravada.
//
// Os limites são referências da lei, editáveis (a empresa pode ser mais
// rígida), nunca custo/verdade gravada. Um turno aberto usa `agora` como fim,
// para o alerta acender AO VIVO enquanto o motorista ainda dirige.
export const LIMITES_JORNADA_PADRAO = Object.freeze({
  direcaoContinuaMaxMin: 330, // 5h30 de direção contínua antes do intervalo
  intervaloMinimoMin: 30, // intervalo mínimo dentro da jornada
  interjornadaMinimaMin: 660, // 11h de descanso entre jornadas
  jornadaDiariaMaxMin: 600, // teto diário de direção (8h + 2h extra)
});

// Recebe os turnos e `agora`; devolve os alertas de conformidade e se está
// conforme. Sem turnos → conforme, sem inventar alerta.
export const avaliarConformidadeJornada = (turnos = [], agora = "", limitesEntrada = {}) => {
  const limites = { ...LIMITES_JORNADA_PADRAO, ...(limitesEntrada || {}) };
  const lista = (Array.isArray(turnos) ? turnos : [])
    .filter((t) => t && t.iniciadoEm)
    .slice()
    .sort((a, b) => String(a.iniciadoEm).localeCompare(String(b.iniciadoEm)));
  const agoraMs = parseMs(agora);
  const agoraIso = agoraMs != null ? agora : "";
  const alertas = [];

  // 1) Direção contínua acima do limite: um turno sem intervalo é direção
  //    contínua por definição; passou do teto, precisava ter parado.
  for (const t of lista) {
    const fim = t.encerradoEm || agoraIso;
    if (!fim) continue;
    const min = duracaoMinutos(t.iniciadoEm, fim);
    if (min > limites.direcaoContinuaMaxMin) {
      const aberto = !t.encerradoEm;
      alertas.push({
        tipo: "direcao_continua",
        gravidade: "critica",
        turnoId: t.id || "",
        minutos: min,
        mensagem: `Direção contínua de ${formatarDuracao(min)}${aberto ? " (turno em aberto)" : ""} — acima do limite de ${formatarDuracao(limites.direcaoContinuaMaxMin)}. É preciso um intervalo de ${limites.intervaloMinimoMin} min.`,
      });
    }
  }

  // 2) Interjornada abaixo de 11h: o descanso entre o fim de um turno e o
  //    início do próximo. Só entre turnos encerrados e o seguinte.
  for (let i = 1; i < lista.length; i += 1) {
    const anterior = lista[i - 1];
    const atual = lista[i];
    if (!anterior.encerradoEm || !atual.iniciadoEm) continue;
    const descanso = duracaoMinutos(anterior.encerradoEm, atual.iniciadoEm);
    if (descanso < limites.interjornadaMinimaMin) {
      alertas.push({
        tipo: "interjornada",
        gravidade: "alta",
        turnoId: atual.id || "",
        minutos: descanso,
        mensagem: `Descanso de apenas ${formatarDuracao(descanso)} entre jornadas — abaixo das ${formatarDuracao(limites.interjornadaMinimaMin)} exigidas.`,
      });
    }
  }

  // 3) Jornada diária excedida: soma da direção no dia acima do teto.
  const porDia = {};
  for (const t of lista) {
    const fim = t.encerradoEm || agoraIso;
    if (!fim) continue;
    const dia = String(t.dataServico || t.iniciadoEm || "").slice(0, 10);
    if (!dia) continue;
    porDia[dia] = (porDia[dia] || 0) + duracaoMinutos(t.iniciadoEm, fim);
  }
  for (const [dia, min] of Object.entries(porDia)) {
    if (min > limites.jornadaDiariaMaxMin) {
      alertas.push({
        tipo: "jornada_diaria",
        gravidade: "alta",
        dia,
        minutos: min,
        mensagem: `Direção de ${formatarDuracao(min)} no dia ${dia} — acima do teto diário de ${formatarDuracao(limites.jornadaDiariaMaxMin)}.`,
      });
    }
  }

  return {
    conforme: alertas.length === 0,
    alertas,
    limites,
  };
};
