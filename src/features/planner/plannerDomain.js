// ===== Captura em linguagem natural + agendamento inteligente =====
// Camada pura. Duas metades que se encaixam:
//  1) parseTaskInput: entende "ligar pro fornecedor sexta às 15h por 30min !alta"
//  2) autoSchedule: encaixa as tarefas nos horários livres da agenda
// Sem React, sem rede, sem relógio implícito — a data de hoje sempre entra
// como parâmetro, para poder ser testado.

const DIAS_SEMANA = [
  ["domingo", 0],
  ["segunda", 1],
  ["segunda-feira", 1],
  ["terça", 2],
  ["terca", 2],
  ["terça-feira", 2],
  ["quarta", 3],
  ["quarta-feira", 3],
  ["quinta", 4],
  ["quinta-feira", 4],
  ["sexta", 5],
  ["sexta-feira", 5],
  ["sábado", 6],
  ["sabado", 6],
];

const MESES = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

export const PRIORITIES = [
  { id: "alta", label: "Alta", rank: 1 },
  { id: "media", label: "Média", rank: 2 },
  { id: "baixa", label: "Baixa", rank: 3 },
];

const COMPLETED_TASK_STATUSES = new Set(["concluído", "concluido", "concluída", "concluida"]);

export const isTaskCompleted = (status) =>
  COMPLETED_TASK_STATUSES.has(String(status || "").trim().toLocaleLowerCase("pt-BR"));

const semAcento = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const pad = (n) => String(n).padStart(2, "0");
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

export const addDays = (date, days) => {
  if (!isDate(date)) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
};

export const weekdayOf = (date) =>
  isDate(date) ? new Date(`${date}T00:00:00Z`).getUTCDay() : 0;

// Próxima ocorrência de um dia da semana. Quando `proxima` é true, pula a
// semana atual mesmo que o dia ainda não tenha chegado ("próxima segunda").
export const nextWeekday = (from, alvo, proxima = false) => {
  if (!isDate(from)) return from;
  const atual = weekdayOf(from);
  let delta = (alvo - atual + 7) % 7;
  if (delta === 0) delta = 7; // "sexta" numa sexta significa a próxima
  if (proxima && delta < 7) delta += 7;
  return addDays(from, delta);
};

// Converte minutos em "1h30" / "45min".
export const formatDuration = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${pad(m)}`;
};

export const minutesToTime = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
};

export const timeToMinutes = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

// ===== 1) Captura em linguagem natural =====
// Devolve o que entendeu e o título já limpo dos trechos consumidos.
export const parseTaskInput = (input, { today, projects = [] } = {}) => {
  const original = String(input || "");
  let texto = original;
  const hoje = isDate(today) ? today : new Date().toISOString().slice(0, 10);
  const resultado = {
    title: "",
    due: "",
    time: "",
    durationMinutes: null,
    priority: "",
    project: "",
    assignee: "",
    recurrence: "",
    understood: [],
  };
  // Remove um trecho do título e registra o que foi entendido.
  const consumir = (regex, rotulo) => {
    const achou = regex.exec(texto);
    if (!achou) return null;
    texto = (texto.slice(0, achou.index) + texto.slice(achou.index + achou[0].length))
      .replace(/\s{2,}/g, " ")
      .trim();
    if (rotulo) resultado.understood.push(rotulo);
    return achou;
  };

  // Projeto (#nome) e responsável (@nome)
  const proj = consumir(/#([\p{L}\p{N}_-]+)/u, "projeto");
  if (proj) {
    const alvo = semAcento(proj[1]);
    const conhecido = projects.find((p) => semAcento(p) === alvo);
    resultado.project = conhecido || proj[1];
  }
  const resp = consumir(/@([\p{L}\p{N}_.-]+)/u, "responsável");
  if (resp) resultado.assignee = resp[1];

  // Prioridade: !alta / !p1 / "urgente"
  const prio = consumir(/!\s*(alta|media|média|baixa|p1|p2|p3)\b/iu, "prioridade");
  if (prio) {
    const v = semAcento(prio[1]);
    resultado.priority =
      v === "alta" || v === "p1" ? "alta" : v === "baixa" || v === "p3" ? "baixa" : "media";
  } else if (/\burgente\b/i.test(texto)) {
    consumir(/\burgente\b/i, "prioridade");
    resultado.priority = "alta";
  }

  // Recorrência antes da data, para "toda segunda" não ser lido como data única.
  const recDia = /\bt(?:odas?|oda|odo|odos)\s+(?:as\s+|os\s+)?(domingos?|segundas?(?:-feiras?)?|ter[çc]as?(?:-feiras?)?|quartas?(?:-feiras?)?|quintas?(?:-feiras?)?|sextas?(?:-feiras?)?|s[áa]bados?)\b/iu;
  const recAchou = consumir(recDia, "recorrência");
  if (recAchou) {
    const base = semAcento(recAchou[1]).replace(/s$/, "").replace(/-feira$/, "");
    const par = DIAS_SEMANA.find(([nome]) => semAcento(nome).startsWith(base));
    resultado.recurrence = par ? `semanal:${par[1]}` : "semanal";
  } else if (consumir(/\btodos?\s+os\s+dias\b|\bdiariamente\b/i, "recorrência")) {
    resultado.recurrence = "diaria";
  } else if (consumir(/\btodo\s+m[êe]s(?![\p{L}])|\bmensalmente\b/iu, "recorrência")) {
    resultado.recurrence = "mensal";
  }

  // A HORA é lida antes da duração: "às 15h" é horário, e se a duração viesse
  // primeiro ela engoliria o "15h" como "15 horas de duração".
  // Só conta como hora quando há "às/as" na frente, ou dois-pontos, ou "hMM".
  const hora = consumir(
    /(?<![\p{L}\p{N}])(?:[àa]s\s+|[àa]\s+)(\d{1,2})(?::(\d{2})|h(\d{2})?)?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}:])(\d{1,2}):(\d{2})(?![\p{L}\p{N}])/iu,
    "hora",
  );
  if (hora) {
    const h = Number(hora[1] ?? hora[4]);
    const min = Number(hora[2] ?? hora[3] ?? hora[5] ?? 0);
    if (h <= 23 && min <= 59) resultado.time = `${pad(h)}:${pad(min)}`;
    else resultado.understood = resultado.understood.filter((x) => x !== "hora");
  }

  // Duração: "por 30min", "por 2h", "1h30", "30min".
  // A forma só com horas exige "por/durante" — sem isso "2h" é ambíguo com hora.
  const dur = consumir(
    /(?:por|durante)\s+(\d{1,2})\s*h(?:oras?)?(?:\s*(\d{1,2})\s*(?:min|minutos?)?)?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(\d{1,2})\s*h\s*(\d{1,2})(?![\p{L}\p{N}])|(?:(?:por|durante)\s+)?(\d{1,3})\s*(?:min|minutos?)(?![\p{L}\p{N}])/iu,
    "duração",
  );
  if (dur) {
    if (dur[1] != null)
      resultado.durationMinutes = Number(dur[1]) * 60 + Number(dur[2] || 0);
    else if (dur[3] != null)
      resultado.durationMinutes = Number(dur[3]) * 60 + Number(dur[4] || 0);
    else resultado.durationMinutes = Number(dur[5]);
  }

  // Datas relativas
  // Atenção: \b não cria fronteira ao lado de letra acentuada, então
  // "amanhã" precisa de lookahead de letra em vez de \b no fim.
  if (consumir(/\bhoje(?![\p{L}])/iu, "data")) resultado.due = hoje;
  else if (consumir(/\bdepois\s+de\s+amanh[ãa](?![\p{L}])/iu, "data"))
    resultado.due = addDays(hoje, 2);
  else if (consumir(/\bamanh[ãa](?![\p{L}])/iu, "data"))
    resultado.due = addDays(hoje, 1);
  else {
    const emDias = consumir(/\bem\s+(\d{1,3})\s+dias?\b/i, "data");
    if (emDias) resultado.due = addDays(hoje, Number(emDias[1]));
    else {
      const emSemanas = consumir(/\bem\s+(\d{1,2})\s+semanas?\b/i, "data");
      if (emSemanas) resultado.due = addDays(hoje, Number(emSemanas[1]) * 7);
      else {
        // Data explícita: 15/08 ou 15/08/2026
        const barra = consumir(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, "data");
        if (barra) {
          const dia = Number(barra[1]);
          const mes = Number(barra[2]);
          let ano = barra[3] ? Number(barra[3]) : Number(hoje.slice(0, 4));
          if (ano < 100) ano += 2000;
          const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
          if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimo)
            resultado.due = `${ano}-${pad(mes)}-${pad(dia)}`;
          else resultado.understood = resultado.understood.filter((x) => x !== "data");
        } else {
          // "dia 15 de agosto" ou "dia 15"
          const diaMes = consumir(
            /\bdia\s+(\d{1,2})(?:\s+de\s+([\p{L}]+))?\b/iu,
            "data",
          );
          if (diaMes) {
            const dia = Number(diaMes[1]);
            const mesNome = diaMes[2] ? MESES[semAcento(diaMes[2])] : null;
            const anoAtual = Number(hoje.slice(0, 4));
            const mes = mesNome || Number(hoje.slice(5, 7));
            const ultimo = new Date(Date.UTC(anoAtual, mes, 0)).getUTCDate();
            if (dia >= 1 && dia <= ultimo) {
              let candidata = `${anoAtual}-${pad(mes)}-${pad(dia)}`;
              // Sem mês escrito e já passou: entende como o mês seguinte.
              if (!mesNome && candidata < hoje) {
                const proximoMes = mes === 12 ? 1 : mes + 1;
                const ano2 = mes === 12 ? anoAtual + 1 : anoAtual;
                const ultimo2 = new Date(Date.UTC(ano2, proximoMes, 0)).getUTCDate();
                candidata = `${ano2}-${pad(proximoMes)}-${pad(Math.min(dia, ultimo2))}`;
              }
              resultado.due = candidata;
            } else resultado.understood = resultado.understood.filter((x) => x !== "data");
          } else {
            // Dia da semana, com ou sem "próxima"
            for (const [nome, indice] of DIAS_SEMANA) {
              const re = new RegExp(
                `\\b(pr[óo]xim[ao]\\s+)?${nome.replace("ç", "[çc]").replace("á", "[áa]")}\\b`,
                "iu",
              );
              const achou = consumir(re, "data");
              if (achou) {
                resultado.due = nextWeekday(hoje, indice, !!achou[1]);
                break;
              }
            }
          }
        }
      }
    }
  }

  // Se a recorrência é semanal e não houve data, a primeira ocorrência é o
  // próximo dia daquela semana.
  if (!resultado.due && resultado.recurrence.startsWith("semanal:"))
    resultado.due = nextWeekday(hoje, Number(resultado.recurrence.split(":")[1]));
  if (!resultado.due && resultado.recurrence === "diaria") resultado.due = hoje;

  resultado.title = texto
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
  // Nada sobrou como título: devolve o texto original, sem inventar.
  if (!resultado.title) resultado.title = original.trim();
  return resultado;
};

// ===== 2) Agendamento inteligente =====

export const DEFAULT_WORK_HOURS = {
  start: "09:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
  lunchStart: "12:00",
  lunchEnd: "13:00",
};

const intervalosOcupados = (events, date) =>
  (events || [])
    .filter((e) => String(e?.date || "").slice(0, 10) === date)
    .map((e) => {
      const inicio = timeToMinutes(e.start);
      const fim = timeToMinutes(e.end);
      if (inicio == null) return null;
      return {
        start: inicio,
        end: fim != null && fim > inicio ? fim : inicio + (Number(e.durationMinutes) || 60),
        label: e.title || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

// Junta intervalos que se sobrepõem, para o cálculo de vagas não se confundir.
export const mergeIntervals = (intervalos) => {
  const lista = [...(intervalos || [])].sort((a, b) => a.start - b.start);
  const juntos = [];
  for (const atual of lista) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo && atual.start <= ultimo.end) ultimo.end = Math.max(ultimo.end, atual.end);
    else juntos.push({ ...atual });
  }
  return juntos;
};

// Vagas livres de um dia, respeitando jornada, dias úteis e almoço.
export const freeSlots = (events, date, workHours = DEFAULT_WORK_HOURS, minMinutes = 15) => {
  const dias = workHours?.days || DEFAULT_WORK_HOURS.days;
  if (!isDate(date) || !dias.includes(weekdayOf(date))) return [];
  const inicioJornada = timeToMinutes(workHours?.start) ?? 540;
  const fimJornada = timeToMinutes(workHours?.end) ?? 1080;
  const ocupado = [...intervalosOcupados(events, date)];
  const almocoInicio = timeToMinutes(workHours?.lunchStart);
  const almocoFim = timeToMinutes(workHours?.lunchEnd);
  if (almocoInicio != null && almocoFim != null && almocoFim > almocoInicio)
    ocupado.push({ start: almocoInicio, end: almocoFim, label: "almoço" });
  const juntos = mergeIntervals(ocupado);
  const vagas = [];
  let cursor = inicioJornada;
  for (const bloco of juntos) {
    if (bloco.end <= inicioJornada || bloco.start >= fimJornada) continue;
    const inicioBloco = Math.max(bloco.start, inicioJornada);
    if (inicioBloco - cursor >= minMinutes)
      vagas.push({ date, start: cursor, end: inicioBloco, minutes: inicioBloco - cursor });
    cursor = Math.max(cursor, Math.min(bloco.end, fimJornada));
  }
  if (fimJornada - cursor >= minMinutes)
    vagas.push({ date, start: cursor, end: fimJornada, minutes: fimJornada - cursor });
  return vagas;
};

// Ordena o que agendar: prazo mais próximo primeiro, e prioridade desempata.
export const scheduleOrder = (tasks) => {
  const rank = (p) => PRIORITIES.find((x) => x.id === p)?.rank ?? 2;
  return [...(tasks || [])].sort((a, b) => {
    const prazoA = isDate(a?.due) ? a.due : "9999-12-31";
    const prazoB = isDate(b?.due) ? b.due : "9999-12-31";
    if (prazoA !== prazoB) return prazoA < prazoB ? -1 : 1;
    return rank(a?.priority) - rank(b?.priority);
  });
};

// Encaixa as tarefas nos horários livres. Devolve o que foi colocado e o que
// não caber — dizer "não cabe" é parte do trabalho, não um erro.
export const autoSchedule = (
  tasks,
  events,
  { from, days = 5, workHours = DEFAULT_WORK_HOURS, defaultMinutes = 30 } = {},
) => {
  const inicio = isDate(from) ? from : new Date().toISOString().slice(0, 10);
  const fila = scheduleOrder(tasks);
  const placements = [];
  const ocupadoExtra = [];
  for (const tarefa of fila) {
    const duracao = Math.max(
      15,
      Number(tarefa?.durationMinutes) || Number(defaultMinutes) || 30,
    );
    let colocado = false;
    for (let d = 0; d < days && !colocado; d += 1) {
      const dia = addDays(inicio, d);
      // Não agenda depois do prazo da tarefa.
      if (isDate(tarefa?.due) && dia > tarefa.due) break;
      // Hora fixa pedida pela pessoa: respeita, se couber na jornada.
      const horaFixa = timeToMinutes(tarefa?.time);
      const eventosDoDia = [
        ...(events || []),
        ...ocupadoExtra.filter((e) => e.date === dia),
      ];
      const vagas = freeSlots(eventosDoDia, dia, workHours, 15);
      if (horaFixa != null && isDate(tarefa?.due) && tarefa.due === dia) {
        const cabe = vagas.find(
          (v) => horaFixa >= v.start && horaFixa + duracao <= v.end,
        );
        if (cabe) {
          placements.push({
            taskId: tarefa.id,
            title: tarefa.title,
            date: dia,
            start: horaFixa,
            end: horaFixa + duracao,
            fixed: true,
          });
          ocupadoExtra.push({
            date: dia,
            start: minutesToTime(horaFixa),
            end: minutesToTime(horaFixa + duracao),
            title: tarefa.title,
          });
          colocado = true;
          break;
        }
      }
      const vaga = vagas.find((v) => v.minutes >= duracao);
      if (!vaga) continue;
      placements.push({
        taskId: tarefa.id,
        title: tarefa.title,
        date: dia,
        start: vaga.start,
        end: vaga.start + duracao,
        fixed: false,
      });
      ocupadoExtra.push({
        date: dia,
        start: minutesToTime(vaga.start),
        end: minutesToTime(vaga.start + duracao),
        title: tarefa.title,
      });
      colocado = true;
    }
    if (!colocado)
      placements.push({
        taskId: tarefa.id,
        title: tarefa.title,
        date: "",
        start: null,
        end: null,
        unplaced: true,
        reason: isDate(tarefa?.due)
          ? "Não há horário livre antes do prazo."
          : "Não há horário livre no período.",
      });
  }
  return {
    placements: placements.filter((p) => !p.unplaced),
    unplaced: placements.filter((p) => p.unplaced),
  };
};

// Conflitos na agenda: compromissos que se sobrepõem no mesmo dia.
export const detectConflicts = (events) => {
  const porDia = new Map();
  for (const e of events || []) {
    const dia = String(e?.date || "").slice(0, 10);
    if (!isDate(dia)) continue;
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(e);
  }
  const conflitos = [];
  for (const [dia, lista] of porDia) {
    const intervalos = intervalosOcupados(lista, dia);
    for (let i = 1; i < intervalos.length; i += 1)
      if (intervalos[i].start < intervalos[i - 1].end)
        conflitos.push({
          date: dia,
          a: intervalos[i - 1].label,
          b: intervalos[i].label,
          overlapMinutes: Math.min(
            intervalos[i - 1].end - intervalos[i].start,
            intervalos[i].end - intervalos[i].start,
          ),
        });
  }
  return conflitos;
};

// Carga do dia: quanto da jornada já está comprometido.
export const dayLoad = (events, date, workHours = DEFAULT_WORK_HOURS) => {
  const dias = workHours?.days || DEFAULT_WORK_HOURS.days;
  const trabalha = isDate(date) && dias.includes(weekdayOf(date));
  const inicio = timeToMinutes(workHours?.start) ?? 540;
  const fim = timeToMinutes(workHours?.end) ?? 1080;
  const almoco =
    timeToMinutes(workHours?.lunchStart) != null &&
    timeToMinutes(workHours?.lunchEnd) != null
      ? Math.max(
          0,
          timeToMinutes(workHours.lunchEnd) - timeToMinutes(workHours.lunchStart),
        )
      : 0;
  const capacidade = trabalha ? Math.max(0, fim - inicio - almoco) : 0;
  const ocupado = mergeIntervals(intervalosOcupados(events, date)).reduce(
    (soma, b) =>
      soma + Math.max(0, Math.min(b.end, fim) - Math.max(b.start, inicio)),
    0,
  );
  return {
    date,
    capacityMinutes: capacidade,
    busyMinutes: ocupado,
    freeMinutes: Math.max(0, capacidade - ocupado),
    // Sobrecarga quando o compromissado passa da capacidade da jornada.
    overloaded: capacidade > 0 && ocupado > capacidade,
    usage: capacidade > 0 ? Math.round((ocupado / capacidade) * 100) : 0,
  };
};

// Tarefas atrasadas trazidas para o próximo dia útil.
export const rescheduleOverdue = (tasks, today, workHours = DEFAULT_WORK_HOURS) => {
  const dias = workHours?.days || DEFAULT_WORK_HOURS.days;
  const proximoUtil = (() => {
    for (let i = 0; i < 14; i += 1) {
      const dia = addDays(today, i);
      if (dias.includes(weekdayOf(dia))) return dia;
    }
    return today;
  })();
  return (tasks || []).map((t) =>
    isDate(t?.due) && t.due < today && !isTaskCompleted(t.status)
      ? { ...t, due: proximoUtil, reagendada: true }
      : t,
  );
};
