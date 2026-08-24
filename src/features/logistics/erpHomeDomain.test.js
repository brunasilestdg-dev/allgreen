import { describe, expect, it } from "vitest";
import {
  alertsForArea,
  normalizeHomePreferences,
  tasksForCollaborator,
} from "./erpHomeDomain.js";

describe("erpHomeDomain", () => {
  it("inicia administradores na rotina comercial e aceita personalização individual", () => {
    expect(normalizeHomePreferences("admin")).toMatchObject({
      areaId: "commercial",
      functionLabel: "Novos Negócios e Comercial",
    });

    expect(normalizeHomePreferences("admin", {
      areaId: "finance",
      functionLabel: "Controladoria",
      widgetIds: ["metrics", "desconhecido"],
      shortcutIds: ["billing", "desconhecido"],
    })).toEqual({
      areaId: "finance",
      functionLabel: "Controladoria",
      widgetIds: ["metrics"],
      shortcutIds: ["billing"],
    });
  });

  it("mostra somente tarefas abertas atribuídas ao colaborador", () => {
    const tasks = [
      { id: "1", title: "Minha tarefa", assigneeId: "u1", status: "Pendente", due: "2026-08-25" },
      { id: "2", title: "Já feita", assigneeId: "u1", status: "Concluído", due: "2026-08-24" },
      { id: "3", title: "De outra pessoa", assigneeId: "u2", status: "Pendente" },
      { id: "4", title: "Também minha", responsible: "Bruna", status: "Em andamento", due: "2026-08-26" },
    ];

    expect(tasksForCollaborator(tasks, { id: "u1", name: "Bruna" }).map((task) => task.id)).toEqual(["1", "4"]);
  });

  it("limita alertas à área escolhida, mantendo visão ampla para gestão", () => {
    const alerts = [
      { id: "a", route: "/todogreen/precificacao" },
      { id: "b", route: "/todogreen/faturamento" },
    ];

    expect(alertsForArea(alerts, "commercial")).toEqual([alerts[0]]);
    expect(alertsForArea(alerts, "management")).toEqual(alerts);
  });
});
