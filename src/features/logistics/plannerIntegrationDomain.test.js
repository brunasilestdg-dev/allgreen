import { describe, expect, it } from "vitest";
import {
  contextoComercialDaTarefa,
  patchPlannerDaTarefa,
  tarefaPlannerParaTodo,
  tarefaVinculadaAoPlanner,
} from "./plannerIntegrationDomain.js";

describe("integração universal do Planner", () => {
  it("mantém tarefas comuns sem exigir CRM", () => {
    const todo = tarefaPlannerParaTodo({
      id: "task-marketing", planId: "plan-marketing", title: "Criar campanha",
      notes: "Campanha institucional", progress: "nao_iniciada", priority: "media",
      revision: 1, campos: {},
    }, { id: "plan-marketing", name: "Marketing" });

    expect(todo).toMatchObject({
      title: "Criar campanha",
      project: "Marketing",
      clientId: "",
      opportunityId: "",
      source: "todogreen-planner",
    });
  });

  it("preserva vínculos opcionais com cliente e oportunidade", () => {
    const tarefa = {
      id: "task-crm", planId: "plan-comercial", title: "Enviar proposta",
      progress: "em_andamento", priority: "alta", revision: 3,
      campos: { clientId: "cli-1", opportunityId: "opp-1" },
    };
    expect(contextoComercialDaTarefa(tarefa)).toEqual({
      clientId: "cli-1",
      opportunityId: "opp-1",
    });
    expect(tarefaPlannerParaTodo(tarefa, { name: "Comercial" })).toMatchObject({
      status: "Em andamento",
      clientId: "cli-1",
      opportunityId: "opp-1",
      plannerRevision: 3,
    });
  });

  it("converte alterações da To-do para o Planner", () => {
    const tarefa = {
      plannerPlanId: "plan-1", plannerTaskId: "task-1", plannerRevision: 4,
      title: "Antes", description: "", status: "A fazer", priority: "Média",
      clientId: "cli-1", opportunityId: "opp-1",
    };
    expect(tarefaVinculadaAoPlanner(tarefa)).toBe(true);
    expect(patchPlannerDaTarefa(tarefa, {
      title: "Depois", status: "Concluído", due: "2026-09-10",
    })).toMatchObject({
      revision: 4,
      title: "Depois",
      progress: "concluida",
      dueDate: "2026-09-10",
      campos: { clientId: "cli-1", opportunityId: "opp-1" },
    });
  });
});
