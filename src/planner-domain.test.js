import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_HOURS,
  addDays,
  autoSchedule,
  dayLoad,
  detectConflicts,
  formatDuration,
  freeSlots,
  isTaskCompleted,
  mergeIntervals,
  minutesToTime,
  nextWeekday,
  parseTaskInput,
  rescheduleOverdue,
  scheduleOrder,
  timeToMinutes,
  weekdayOf,
} from "./features/planner/plannerDomain.js";

// 2026-07-29 é uma quarta-feira.
const HOJE = "2026-07-29";
const p = (texto, extra = {}) => parseTaskInput(texto, { today: HOJE, ...extra });

describe("utilitários de data e hora", () => {
  it("sabe o dia da semana", () => {
    expect(weekdayOf("2026-07-29")).toBe(3);
    expect(weekdayOf("2026-08-01")).toBe(6);
  });

  it("soma dias virando o mês", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("acha o próximo dia da semana, nunca hoje", () => {
    // De quarta, sexta é em 2 dias.
    expect(nextWeekday(HOJE, 5)).toBe("2026-07-31");
    // De quarta, "quarta" significa a próxima semana.
    expect(nextWeekday(HOJE, 3)).toBe("2026-08-05");
  });

  it("'próxima' pula a semana corrente", () => {
    expect(nextWeekday(HOJE, 5, true)).toBe("2026-08-07");
  });

  it("converte hora e minutos nos dois sentidos", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(minutesToTime(570)).toBe("09:30");
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("qualquer")).toBeNull();
  });

  it("formata duração de forma legível", () => {
    expect(formatDuration(45)).toBe("45min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h30");
  });
});

describe("parseTaskInput — datas", () => {
  it("entende hoje, amanhã e depois de amanhã", () => {
    expect(p("pagar boleto hoje").due).toBe(HOJE);
    expect(p("pagar boleto amanhã").due).toBe("2026-07-30");
    expect(p("pagar boleto depois de amanhã").due).toBe("2026-07-31");
  });

  it("entende dia da semana e 'próxima'", () => {
    expect(p("reunião sexta").due).toBe("2026-07-31");
    expect(p("reunião próxima sexta").due).toBe("2026-08-07");
    expect(p("entregar terça-feira").due).toBe("2026-08-04");
  });

  it("entende 'em N dias' e 'em N semanas'", () => {
    expect(p("revisar em 3 dias").due).toBe("2026-08-01");
    expect(p("revisar em 2 semanas").due).toBe("2026-08-12");
  });

  it("entende data com barra, com e sem ano", () => {
    expect(p("entregar 15/08").due).toBe("2026-08-15");
    expect(p("entregar 15/08/2027").due).toBe("2027-08-15");
    expect(p("entregar 05/01/27").due).toBe("2027-01-05");
  });

  it("entende 'dia 15 de agosto' e 'dia 15'", () => {
    expect(p("fechar caixa dia 15 de agosto").due).toBe("2026-08-15");
    expect(p("fechar caixa dia 31").due).toBe("2026-07-31");
  });

  it("'dia 5' que já passou vai para o mês seguinte", () => {
    expect(p("fechar caixa dia 5").due).toBe("2026-08-05");
  });

  it("recusa data impossível em vez de inventar", () => {
    const r = p("entregar 31/02");
    expect(r.due).toBe("");
    expect(r.understood).not.toContain("data");
  });

  it("sem data, não inventa prazo", () => {
    expect(p("comprar embalagens").due).toBe("");
  });
});

describe("parseTaskInput — hora e duração", () => {
  it("entende 'às 15h' e '15:30'", () => {
    expect(p("reunião sexta às 15h").time).toBe("15:00");
    expect(p("reunião sexta 15:30").time).toBe("15:30");
    expect(p("reunião amanhã as 9h30").time).toBe("09:30");
  });

  it("entende duração em horas e minutos", () => {
    expect(p("gravar vídeo por 30min").durationMinutes).toBe(30);
    expect(p("gravar vídeo por 2h").durationMinutes).toBe(120);
    expect(p("gravar vídeo 1h30").durationMinutes).toBe(90);
  });

  it("hora inválida não é aceita", () => {
    const r = p("reunião às 99h");
    expect(r.time).toBe("");
  });
});

describe("parseTaskInput — prioridade, projeto, responsável", () => {
  it("entende !alta, !p1 e 'urgente'", () => {
    expect(p("ligar !alta").priority).toBe("alta");
    expect(p("ligar !p1").priority).toBe("alta");
    expect(p("ligar !baixa").priority).toBe("baixa");
    expect(p("ligar urgente").priority).toBe("alta");
  });

  it("entende #projeto e casa com projeto já existente", () => {
    expect(p("post #marketing").project).toBe("marketing");
    expect(p("post #Lancamento", { projects: ["Lançamento"] }).project).toBe(
      "Lançamento",
    );
  });

  it("entende @responsável", () => {
    expect(p("revisar @ana").assignee).toBe("ana");
  });
});

describe("parseTaskInput — recorrência", () => {
  it("entende 'toda segunda' e já marca a primeira ocorrência", () => {
    const r = p("enviar relatório toda segunda");
    expect(r.recurrence).toBe("semanal:1");
    expect(r.due).toBe("2026-08-03");
  });

  it("entende 'todos os dias' e 'todo mês'", () => {
    expect(p("regar as plantas todos os dias").recurrence).toBe("diaria");
    expect(p("pagar aluguel todo mês").recurrence).toBe("mensal");
  });

  it("'toda sexta' não é confundido com data única", () => {
    const r = p("fechar caixa toda sexta");
    expect(r.recurrence).toBe("semanal:5");
    expect(r.title).toBe("fechar caixa");
  });
});

describe("parseTaskInput — título limpo", () => {
  it("tira do título tudo o que foi entendido", () => {
    const r = p("ligar pro fornecedor sexta às 15h por 30min !alta #compras @ana");
    expect(r.title).toBe("ligar pro fornecedor");
    expect(r.due).toBe("2026-07-31");
    expect(r.time).toBe("15:00");
    expect(r.durationMinutes).toBe(30);
    expect(r.priority).toBe("alta");
    expect(r.project).toBe("compras");
    expect(r.assignee).toBe("ana");
    expect(r.understood).toContain("data");
    expect(r.understood).toContain("hora");
  });

  it("quando nada sobra, mantém o texto original", () => {
    expect(p("amanhã").title).toBe("amanhã");
  });

  it("texto vazio não quebra", () => {
    const r = p("");
    expect(r.title).toBe("");
    expect(r.due).toBe("");
  });
});

describe("mergeIntervals", () => {
  it("junta os que se sobrepõem", () => {
    expect(
      mergeIntervals([
        { start: 540, end: 600 },
        { start: 580, end: 660 },
        { start: 700, end: 720 },
      ]),
    ).toEqual([
      { start: 540, end: 660 },
      { start: 700, end: 720 },
    ]);
  });

  it("lista vazia devolve vazia", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe("freeSlots", () => {
  const jornada = { ...DEFAULT_WORK_HOURS };

  it("dia livre tem manhã e tarde separadas pelo almoço", () => {
    const vagas = freeSlots([], HOJE, jornada);
    expect(vagas).toHaveLength(2);
    expect(minutesToTime(vagas[0].start)).toBe("09:00");
    expect(minutesToTime(vagas[0].end)).toBe("12:00");
    expect(minutesToTime(vagas[1].start)).toBe("13:00");
    expect(minutesToTime(vagas[1].end)).toBe("18:00");
  });

  it("um compromisso parte a vaga em duas", () => {
    const vagas = freeSlots(
      [{ date: HOJE, start: "10:00", end: "11:00", title: "Cliente" }],
      HOJE,
      jornada,
    );
    expect(vagas.map((v) => minutesToTime(v.start))).toEqual([
      "09:00",
      "11:00",
      "13:00",
    ]);
  });

  it("fim de semana não tem vaga", () => {
    expect(freeSlots([], "2026-08-01", jornada)).toEqual([]);
  });

  it("compromisso fora da jornada é ignorado", () => {
    const vagas = freeSlots(
      [{ date: HOJE, start: "20:00", end: "21:00", title: "Noite" }],
      HOJE,
      jornada,
    );
    expect(vagas).toHaveLength(2);
  });

  it("agenda cheia não sobra vaga", () => {
    const vagas = freeSlots(
      [{ date: HOJE, start: "09:00", end: "18:00", title: "Dia todo" }],
      HOJE,
      jornada,
    );
    expect(vagas).toEqual([]);
  });

  it("usa a duração quando o compromisso não tem hora de fim", () => {
    const vagas = freeSlots(
      [{ date: HOJE, start: "09:00", durationMinutes: 60, title: "X" }],
      HOJE,
      jornada,
    );
    expect(minutesToTime(vagas[0].start)).toBe("10:00");
  });
});

describe("scheduleOrder", () => {
  it("prazo mais próximo primeiro, prioridade desempata", () => {
    const ordem = scheduleOrder([
      { id: "c", due: "2026-08-10", priority: "alta" },
      { id: "a", due: "2026-07-30", priority: "baixa" },
      { id: "b", due: "2026-07-30", priority: "alta" },
      { id: "d", due: "", priority: "alta" },
    ]).map((t) => t.id);
    expect(ordem).toEqual(["b", "a", "c", "d"]);
  });
});

describe("autoSchedule", () => {
  const jornada = { ...DEFAULT_WORK_HOURS };

  it("encaixa tarefas na primeira vaga do dia", () => {
    const { placements, unplaced } = autoSchedule(
      [
        { id: "t1", title: "Escrever proposta", durationMinutes: 60, due: "2026-07-31" },
        { id: "t2", title: "Revisar contrato", durationMinutes: 30, due: "2026-07-31" },
      ],
      [],
      { from: HOJE, days: 3, workHours: jornada },
    );
    expect(unplaced).toEqual([]);
    expect(placements).toHaveLength(2);
    expect(placements[0].date).toBe(HOJE);
    expect(minutesToTime(placements[0].start)).toBe("09:00");
    // A segunda não pode sobrepor a primeira.
    expect(placements[1].start).toBeGreaterThanOrEqual(placements[0].end);
  });

  it("não agenda depois do prazo e avisa quando não cabe", () => {
    const { placements, unplaced } = autoSchedule(
      [{ id: "t1", title: "Tarefa gigante", durationMinutes: 600, due: "2026-07-30" }],
      [],
      { from: HOJE, days: 5, workHours: jornada },
    );
    expect(placements).toEqual([]);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].reason).toMatch(/antes do prazo/);
  });

  it("respeita a hora fixa pedida quando ela cabe", () => {
    const { placements } = autoSchedule(
      [{ id: "t1", title: "Reunião", durationMinutes: 60, due: HOJE, time: "15:00" }],
      [],
      { from: HOJE, days: 1, workHours: jornada },
    );
    expect(minutesToTime(placements[0].start)).toBe("15:00");
    expect(placements[0].fixed).toBe(true);
  });

  it("desvia da hora fixa quando ela está ocupada", () => {
    const { placements } = autoSchedule(
      [{ id: "t1", title: "Reunião", durationMinutes: 60, due: HOJE, time: "10:00" }],
      [{ date: HOJE, start: "10:00", end: "11:00", title: "Já marcado" }],
      { from: HOJE, days: 1, workHours: jornada },
    );
    expect(placements).toHaveLength(1);
    expect(minutesToTime(placements[0].start)).not.toBe("10:00");
    expect(placements[0].fixed).toBe(false);
  });

  it("pula o fim de semana", () => {
    // 2026-07-31 é sexta; days=4 cobre sexta, sábado, domingo e segunda.
    // 300 min cabe exatamente na vaga da tarde (13:00-18:00); duas tarefas
    // assim não cabem no mesmo dia, então a segunda pula o fim de semana.
    const { placements } = autoSchedule(
      [
        { id: "t1", title: "A", durationMinutes: 300 },
        { id: "t2", title: "B", durationMinutes: 300 },
      ],
      [],
      { from: "2026-07-31", days: 4, workHours: jornada },
    );
    expect(placements.map((x) => x.date)).toEqual(["2026-07-31", "2026-08-03"]);
  });

  it("usa duração padrão quando a tarefa não tem", () => {
    const { placements } = autoSchedule([{ id: "t1", title: "Rápida" }], [], {
      from: HOJE,
      days: 1,
      workHours: jornada,
      defaultMinutes: 45,
    });
    expect(placements[0].end - placements[0].start).toBe(45);
  });

  it("lista vazia não gera nada", () => {
    expect(autoSchedule([], [], { from: HOJE })).toEqual({
      placements: [],
      unplaced: [],
    });
  });
});

describe("detectConflicts", () => {
  it("acha compromissos que se sobrepõem no mesmo dia", () => {
    const conflitos = detectConflicts([
      { date: HOJE, start: "10:00", end: "11:30", title: "Cliente A" },
      { date: HOJE, start: "11:00", end: "12:00", title: "Cliente B" },
      { date: HOJE, start: "15:00", end: "16:00", title: "Sozinho" },
    ]);
    expect(conflitos).toHaveLength(1);
    expect(conflitos[0].overlapMinutes).toBe(30);
    expect(conflitos[0].a).toBe("Cliente A");
  });

  it("dias diferentes não conflitam", () => {
    expect(
      detectConflicts([
        { date: HOJE, start: "10:00", end: "11:00", title: "A" },
        { date: "2026-07-30", start: "10:00", end: "11:00", title: "B" },
      ]),
    ).toEqual([]);
  });
});

describe("dayLoad", () => {
  const jornada = { ...DEFAULT_WORK_HOURS };

  it("mede a capacidade do dia descontando o almoço", () => {
    const carga = dayLoad([], HOJE, jornada);
    // 09:00 às 18:00 = 540 min, menos 60 de almoço = 480.
    expect(carga.capacityMinutes).toBe(480);
    expect(carga.freeMinutes).toBe(480);
    expect(carga.usage).toBe(0);
  });

  it("calcula a ocupação e o uso em percentual", () => {
    const carga = dayLoad(
      [{ date: HOJE, start: "09:00", end: "13:00", title: "Longo" }],
      HOJE,
      jornada,
    );
    expect(carga.busyMinutes).toBe(240);
    expect(carga.usage).toBe(50);
    expect(carga.overloaded).toBe(false);
  });

  it("acusa sobrecarga quando passa da jornada", () => {
    const carga = dayLoad(
      [
        { date: HOJE, start: "08:00", end: "13:00", title: "A" },
        { date: HOJE, start: "13:00", end: "19:00", title: "B" },
      ],
      HOJE,
      jornada,
    );
    expect(carga.overloaded).toBe(true);
  });

  it("dia não trabalhado tem capacidade zero", () => {
    expect(dayLoad([], "2026-08-01", jornada).capacityMinutes).toBe(0);
  });
});

describe("rescheduleOverdue", () => {
  it("traz o atrasado para o próximo dia útil e preserva concluídas canônicas e legadas", () => {
    const tarefas = [
      { id: "a", due: "2026-07-20", status: "A fazer" },
      { id: "b", due: "2026-08-10", status: "Em andamento" },
      { id: "c", due: "2026-07-20", status: "concluida" },
      { id: "d", due: "2026-07-20", status: "Concluído" },
    ];
    const r = rescheduleOverdue(tarefas, HOJE);
    expect(r[0].due).toBe(HOJE);
    expect(r[0].reagendada).toBe(true);
    expect(r[1].due).toBe("2026-08-10");
    // Concluída não é reagendada.
    expect(r[2].due).toBe("2026-07-20");
    expect(r[3].due).toBe("2026-07-20");
  });

  it("reconhece o status canônico e os legados como concluídos", () => {
    expect(isTaskCompleted("Concluído")).toBe(true);
    expect(isTaskCompleted("concluida")).toBe(true);
    expect(isTaskCompleted("A fazer")).toBe(false);
  });

  it("no fim de semana joga para segunda", () => {
    const r = rescheduleOverdue(
      [{ id: "a", due: "2026-07-20", status: "pendente" }],
      "2026-08-01",
    );
    expect(r[0].due).toBe("2026-08-03");
  });
});
