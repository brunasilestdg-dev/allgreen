import { describe, expect, it } from "vitest";
import { fimDaSemana, origemDaTarefa, workdayTasks, WORKDAY_FILTERS } from "./workdayDomain.js";

describe("Meu dia", () => {
  const tasks = [
    { id: "a", due: "2026-09-03" },
    { id: "b", due: "2026-09-04" },
    { id: "c", due: "2026-09-05" },
    { id: "d" },
    { id: "e", due: "invalida" },
  ];

  it("separa hoje, atrasadas e sem prazo sem alterar os registros", () => {
    expect(workdayTasks(tasks, "today", "2026-09-04").map((task) => task.id)).toEqual(["b"]);
    expect(workdayTasks(tasks, "overdue", "2026-09-04").map((task) => task.id)).toEqual(["a"]);
    expect(workdayTasks(tasks, "undated", "2026-09-04").map((task) => task.id)).toEqual(["d", "e"]);
    expect(workdayTasks(tasks)).toHaveLength(5);
  });

  it("a semana corrente vai de domingo a sábado", () => {
    // 2026-09-04 é uma sexta; o sábado seguinte é 05.
    expect(fimDaSemana("2026-09-04")).toBe("2026-09-05");
    // Domingo abre a semana e enxerga até o sábado seguinte.
    expect(fimDaSemana("2026-09-06")).toBe("2026-09-12");
    // Sábado é o último dia da própria semana.
    expect(fimDaSemana("2026-09-05")).toBe("2026-09-05");
  });

  it("tarefa com prazo futuro não some mais da leitura", () => {
    // Antes existiam só hoje/atrasadas/sem prazo: a tarefa de segunda ficava
    // invisível até virar "hoje", e o Meu Dia parecia vazio com trabalho na fila.
    const semana = [
      { id: "hoje", due: "2026-09-04" },
      { id: "sabado", due: "2026-09-05" },
      { id: "segunda", due: "2026-09-07" },
      { id: "mes-que-vem", due: "2026-10-01" },
    ];
    expect(workdayTasks(semana, "week", "2026-09-04").map((t) => t.id)).toEqual(["sabado"]);
    expect(workdayTasks(semana, "next", "2026-09-04").map((t) => t.id)).toEqual(["segunda", "mes-que-vem"]);
  });

  it("cada tarefa com prazo cai em exatamente um recorte", () => {
    const hoje = "2026-09-04";
    const recortes = WORKDAY_FILTERS.filter((f) => f.id !== "all").map((f) => f.id);
    for (const task of [...tasks, { id: "f", due: "2026-09-07" }, { id: "g", due: "2026-12-01" }]) {
      const encontrados = recortes.filter((id) => workdayTasks([task], id, hoje).length);
      expect(encontrados).toHaveLength(1);
    }
  });

  it("a fila diz de onde a tarefa veio, sem criar outra entidade", () => {
    expect(origemDaTarefa({ clientLabel: "Natura", project: "Implantação Natura" })).toBe("Cliente · Natura · Implantação Natura");
    expect(origemDaTarefa({ clientLabel: "Natura" })).toBe("Cliente · Natura");
    expect(origemDaTarefa({ project: "Implantação Natura" })).toBe("Planner · Implantação Natura");
    expect(origemDaTarefa({ opportunityId: "opp-1" })).toBe("CRM · oportunidade");
    expect(origemDaTarefa({})).toBe("To Do");
  });
});
