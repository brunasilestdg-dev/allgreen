import { describe, expect, it } from "vitest";
import {
  contextoComercialDaTarefa,
  listaDependenciasComRotulo,
  patchPlannerDaTarefa,
  rotuloBaseDependencia,
  statusTarefaAoEspelhar,
  tarefaPlannerParaTodo,
  tarefaVinculadaAoPlanner,
} from "./plannerIntegrationDomain.js";

describe("status não se perde no round-trip Planner<->To-Do", () => {
  it("preserva 'Aguardando' quando o Planner segue em em_andamento", () => {
    // Aguardando e Em andamento colapsam em em_andamento no Planner. Se o
    // Planner não saiu de em_andamento, a To-Do NÃO deve perder 'Aguardando'.
    expect(statusTarefaAoEspelhar("em_andamento", "Aguardando")).toBe("Aguardando");
    expect(statusTarefaAoEspelhar("em_andamento", "Em andamento")).toBe("Em andamento");
  });
  it("adota o novo status quando o Planner realmente mudou", () => {
    expect(statusTarefaAoEspelhar("concluida", "Aguardando")).toBe("Concluído");
    expect(statusTarefaAoEspelhar("nao_iniciada", "Em andamento")).toBe("A fazer");
  });
  it("sem status existente, usa o mapa do Planner", () => {
    expect(statusTarefaAoEspelhar("em_andamento", undefined)).toBe("Em andamento");
    expect(statusTarefaAoEspelhar("concluida", "")).toBe("Concluído");
  });
  it("no espelhamento completo, 'Aguardando' sobrevive", () => {
    const todo = tarefaPlannerParaTodo(
      { id: "t1", planId: "p1", title: "X", progress: "em_andamento", priority: "media", revision: 2, campos: {} },
      { id: "p1", name: "Plano" },
      { id: "planner-t1", status: "Aguardando" },
    );
    expect(todo.status).toBe("Aguardando");
  });
});

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

describe("rótulo da dependência sem confundir clientes (#142)", () => {
  it("carrega o nome do cliente para o rótulo humano, não só o nome do plano", () => {
    const todo = tarefaPlannerParaTodo(
      { id: "t1", title: "Precificação", campos: { clientId: "cli-dhl" } },
      { id: "plan-1", name: "To do List" },
      {},
      { clientLabel: "DHL" },
    );
    expect(todo.project).toBe("To do List");
    expect(todo.clientLabel).toBe("DHL");
    expect(rotuloBaseDependencia(todo)).toBe("Precificação · DHL");
  });

  it("distingue duas 'Precificação' pelo cliente", () => {
    const opcoes = listaDependenciasComRotulo([
      { id: "a", title: "Precificação", clientLabel: "DHL", status: "Concluído" },
      { id: "b", title: "Precificação", clientLabel: "Vivara", status: "A fazer" },
    ]);
    expect(opcoes.map((o) => o.rotulo)).toEqual([
      "Precificação · DHL (Concluído)",
      "Precificação · Vivara (A fazer)",
    ]);
  });

  it("quando o cliente não está resolvido, o sufixo do id garante rótulos distintos", () => {
    const opcoes = listaDependenciasComRotulo([
      { id: "planner-aaaa1111", title: "Precificação", status: "Concluído" },
      { id: "planner-bbbb2222", title: "Precificação", status: "Concluído" },
    ]);
    const rotulos = opcoes.map((o) => o.rotulo);
    expect(rotulos[0]).not.toBe(rotulos[1]);
    expect(rotulos[0]).toContain("#1111");
    expect(rotulos[1]).toContain("#2222");
  });

  it("rótulo único não recebe sufixo de id", () => {
    const opcoes = listaDependenciasComRotulo([
      { id: "x", title: "Precificação", clientLabel: "DHL", status: "Concluído" },
    ]);
    expect(opcoes[0].rotulo).toBe("Precificação · DHL (Concluído)");
  });
});
