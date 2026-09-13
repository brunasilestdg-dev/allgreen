import { describe, expect, it } from "vitest";
import {
  aplicarEdicaoPlannerNaTarefa,
  contextoComercialDaTarefa,
  desvincularTarefaDoPlanner,
  listaDependenciasComRotulo,
  rotuloBaseDependencia,
  statusTarefaAoEspelhar,
  tarefaCanonicaPertenceAoPlano,
  importarTarefaLegadaPlanner,
  tarefaTodoParaPlanner,
} from "./plannerIntegrationDomain.js";

describe("status legado é importado sem perder nuance", () => {
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
    const todo = importarTarefaLegadaPlanner(
      { id: "t1", planId: "p1", title: "X", progress: "em_andamento", priority: "media", revision: 2, campos: {} },
      { id: "p1", name: "Plano" },
      { id: "planner-t1", status: "Aguardando" },
    );
    expect(todo.status).toBe("Aguardando");
  });
});

describe("integração universal do Planner", () => {
  it("mantém tarefas comuns sem exigir CRM", () => {
    const todo = importarTarefaLegadaPlanner({
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
    expect(importarTarefaLegadaPlanner(tarefa, { name: "Comercial" })).toMatchObject({
      status: "Em andamento",
      clientId: "cli-1",
      opportunityId: "opp-1",
      plannerRevision: 3,
    });
  });

});


  it("marca a tarefa espelhada com id canônico e links de origem", () => {
    const todo = importarTarefaLegadaPlanner(
      {
        id: "task-crm",
        planId: "plan-comercial",
        title: "Enviar proposta",
        progress: "em_andamento",
        priority: "alta",
        revision: 3,
        campos: { clientId: "cli-1", opportunityId: "opp-1" },
      },
      { id: "plan-comercial", name: "Comercial" },
    );

    expect(todo).toMatchObject({
      canonicalTaskId: "planner:plan-comercial:task-crm",
      canonicalSource: "planner",
      plannerPlanId: "plan-comercial",
      plannerTaskId: "task-crm",
      sourceLinks: {
        todo: { taskId: "planner-task-crm" },
        planner: { planId: "plan-comercial", taskId: "task-crm" },
        crm: { clientId: "cli-1", opportunityId: "opp-1" },
      },
    });
  });

  it("preserva o id canônico existente no reespelhamento", () => {
    const todo = importarTarefaLegadaPlanner(
      { id: "task-1", planId: "plan-1", title: "X", progress: "nao_iniciada", campos: {} },
      { id: "plan-1", name: "Plano" },
      { id: "todo-local", canonicalTaskId: "task:canonica:1" },
    );
    expect(todo.canonicalTaskId).toBe("task:canonica:1");
    expect(todo.sourceLinks.todo.taskId).toBe("todo-local");
  });

describe("task canônica como fonte única do Planner", () => {
  it("projeta a task canônica para o formato visual do Planner sem criar outra entidade", () => {
    const planner = tarefaTodoParaPlanner({
      id: "task-1",
      canonicalTaskId: "task-1",
      plannerPlanId: "plan-1",
      plannerBucketId: "bucket-1",
      title: "Enviar proposta",
      description: "Versão final",
      status: "Aguardando",
      priority: "Alta",
      due: "2026-09-15",
      assigneeId: "u1",
      assignee: "Ana",
      clientId: "cli-1",
      opportunityId: "opp-1",
      plannerChecklist: [{ texto: "Revisar", feito: true }],
    });

    expect(planner).toMatchObject({
      id: "task-1",
      rawTaskId: "task-1",
      planId: "plan-1",
      bucketId: "bucket-1",
      progress: "em_andamento",
      priority: "alta",
      campos: { clientId: "cli-1", opportunityId: "opp-1" },
    });
  });

  it("arquivar um plano só remove a visão Planner, sem apagar a task", () => {
    const original = {
      id: "task-1",
      canonicalTaskId: "task-1",
      plannerPlanId: "plan-1",
      plannerTaskId: "legacy-1",
      plannerBucketId: "bucket-1",
      sourceLinks: {
        todo: { taskId: "task-1" },
        planner: { planId: "plan-1", taskId: "task-1" },
        crm: { clientId: "cli-1", opportunityId: "opp-1" },
      },
    };
    const desvinculada = desvincularTarefaDoPlanner(original, "plan-1");
    expect(desvinculada).toMatchObject({
      id: "task-1",
      canonicalTaskId: "task-1",
      plannerPlanId: "",
      plannerTaskId: "",
      sourceLinks: {
        todo: { taskId: "task-1" },
        crm: { clientId: "cli-1", opportunityId: "opp-1" },
      },
    });
    expect(desvinculada.sourceLinks.planner).toBeUndefined();
  });

  it("edita pelo Planner a mesma task canônica, preservando o id", () => {
    const atualizada = aplicarEdicaoPlannerNaTarefa({
      id: "task-1",
      rawTaskId: "task-1",
      canonicalTaskId: "task-1",
      planId: "plan-1",
      title: "Enviar proposta revisada",
      notes: "Nova descrição",
      progress: "concluida",
      priority: "urgente",
      dueDate: "2026-09-14",
      bucketId: "bucket-b",
      checklist: [{ texto: "Aprovar", feito: true }],
      campos: { clientId: "cli-1", opportunityId: "opp-1" },
    }, { id: "plan-1", name: "Comercial" }, {
      id: "task-1",
      canonicalTaskId: "task-1",
      businessId: "todogreen",
      status: "Em andamento",
      createdAt: "2026-09-10T10:00:00.000Z",
    }, { clientLabel: "DHL" });

    expect(atualizada).toMatchObject({
      id: "task-1",
      canonicalTaskId: "task-1",
      status: "Concluído",
      priority: "Urgente",
      plannerPlanId: "plan-1",
      plannerBucketId: "bucket-b",
      clientId: "cli-1",
      opportunityId: "opp-1",
      clientLabel: "DHL",
    });
    expect(tarefaCanonicaPertenceAoPlano(atualizada, "plan-1")).toBe(true);
  });
});

describe("rótulo da dependência sem confundir clientes (#142)", () => {
  it("carrega o nome do cliente para o rótulo humano, não só o nome do plano", () => {
    const todo = importarTarefaLegadaPlanner(
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
