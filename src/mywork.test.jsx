import { describe, expect, it } from "vitest";
import {
  MYDAY_FILTERS,
  applyMyDayFilter,
  computeMyWork,
  isMyDayTaskDone,
  taskOriginLabel,
  updateCanonicalTask,
} from "./App";

const business = { id: "b1" };
const mk = (over) => ({
  id: Math.random().toString(36).slice(2),
  businessId: "b1",
  status: "A fazer",
  ...over,
});

describe("computeMyWork", () => {
  const db = {
    tasks: [
      mk({ assigneeId: "u1", status: "Em andamento" }),
      mk({ assigneeId: "u1", status: "A fazer", due: "2000-01-01" }),
      mk({ assignees: [{ userId: "u1" }], missionStatus: "enviada_para_revisao" }),
      mk({ assigneeId: "u1", missionStatus: "correcao_solicitada" }),
      mk({ assigneeId: "u1", status: "Concluído" }),
      mk({ assigneeId: "u2" }), // outra pessoa
    ],
    developmentPlans: [],
  };

  it("conta só as tarefas atribuídas à pessoa", () => {
    const w = computeMyWork(db, "u1", business, "2026-07-24");
    expect(w.all).toHaveLength(5);
    expect(w.done).toBe(1);
    // ativas = não concluídas
    expect(w.active).toHaveLength(4);
  });

  it("computa revisão, correções e atrasadas", () => {
    const w = computeMyWork(db, "u1", business, "2026-07-24");
    expect(w.inReview).toBe(1);
    expect(w.corrections).toBe(1);
    expect(w.overdue).toBe(1); // due 2000-01-01 e não concluída
  });

  it("respeita o filtro de negócio", () => {
    const other = { tasks: [mk({ assigneeId: "u1", businessId: "outro" })] };
    expect(computeMyWork(other, "u1", business).all).toHaveLength(0);
  });

  it("ordena as ativas por prazo mais próximo", () => {
    const w = computeMyWork(db, "u1", business, "2026-07-24");
    expect(w.active[0].due).toBe("2000-01-01");
  });
});

describe("Meu Dia", () => {
  const hoje = "2026-09-04";
  const tarefas = [
    { id: "atrasada", due: "2026-09-03" },
    { id: "hoje", due: hoje },
    { id: "semana", due: "2026-09-05" },
    { id: "proxima", due: "2026-09-15" },
    { id: "sem-prazo" },
  ];

  it("separa todas as tarefas pelos filtros de prazo sem limitar a lista", () => {
    expect(applyMyDayFilter(tarefas, "all", hoje)).toHaveLength(5);
    expect(applyMyDayFilter(tarefas, "overdue", hoje).map((item) => item.id)).toEqual(["atrasada"]);
    expect(applyMyDayFilter(tarefas, "today", hoje).map((item) => item.id)).toEqual(["hoje"]);
    expect(applyMyDayFilter(tarefas, "week", hoje).map((item) => item.id)).toEqual(["semana"]);
    expect(applyMyDayFilter(tarefas, "next", hoje).map((item) => item.id)).toEqual(["proxima"]);
    expect(applyMyDayFilter(tarefas, "undated", hoje).map((item) => item.id)).toEqual(["sem-prazo"]);
    expect(MYDAY_FILTERS).toHaveLength(6);
  });

  it("conclui e reabre a mesma entidade sem duplicar", () => {
    const concluida = updateCanonicalTask(tarefas, "hoje", { status: "Concluído" }, "agora");
    expect(concluida).toHaveLength(tarefas.length);
    expect(concluida.find((item) => item.id === "hoje").status).toBe("Concluído");
    const reaberta = updateCanonicalTask(concluida, "hoje", { status: "A fazer" }, "depois");
    expect(reaberta.filter((item) => item.id === "hoje")).toHaveLength(1);
    expect(reaberta.find((item) => item.id === "hoje").status).toBe("A fazer");
  });

  it("reconhece conclusão canônica e legada e informa a origem", () => {
    expect(isMyDayTaskDone("Concluído")).toBe(true);
    expect(isMyDayTaskDone("concluida")).toBe(true);
    expect(taskOriginLabel({ source: "greenon-crm-followup" })).toBe("Green On");
    expect(taskOriginLabel({ opportunityId: "o1" })).toBe("CRM");
    expect(taskOriginLabel({ projectId: "p1" })).toBe("Planner");
  });
});
