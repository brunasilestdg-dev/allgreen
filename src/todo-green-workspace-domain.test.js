import { describe, expect, it } from "vitest";
import {
  buildTodoGreenTaskBoard,
  buildTodoGreenCanonicalTask,
  buildTodoGreenWorkspaceIntelligence,
  buildTodoGreenWorkspaceSummary,
  normalizeTodoGreenTaskStatus,
  findLinkedDocument,
  findLinkedNote,
  linkedEntityFor,
} from "./features/logistics/todoGreenWorkspaceDomain.js";

describe("espaço de trabalho To Do Green", () => {
  it("reúne notícias, RFQs e contatos reais sem aceitar contato web não comprovado", () => {
    const intelligence = buildTodoGreenWorkspaceIntelligence({
      clients: [{
        id: "cli-1",
        name: "Empresa Alfa",
        crm: {
          contacts: [
            { id: "c1", name: "Ana", email: "ana@alfa.com", source: "Cadastro manual" },
            { id: "c2", name: "Ex-contato", employmentStatus: "former" },
            { id: "c3", name: "Sem prova", source: "Pesquisa web", country: "Brasil" },
            { id: "c4", name: "Bruno", source: "Pesquisa web", country: "Brasil", verifiedBrazil: true, currentEmploymentVerified: true, researchVersion: 9 },
          ],
          intelligence: {
            version: 9,
            checkedAt: "2026-08-14T10:00:00Z",
            companyNews: [{ title: "Alfa amplia operação", url: "https://fonte.example/noticia" }],
            segmentNews: [{ title: "Logística elétrica cresce", url: "https://setor.example/tendencia" }],
            openRfqs: [{ title: "RFQ de transporte", url: "https://compras.example/rfq" }],
            supplierLinks: [{ title: "Portal de fornecedores", url: "https://alfa.example/fornecedores" }],
          },
        },
      }],
    });

    expect(intelligence.contacts.map((item) => item.name)).toEqual(["Ana", "Bruno"]);
    expect(intelligence.news).toHaveLength(2);
    expect(intelligence.news[0]).toMatchObject({ clientId: "cli-1", clientName: "Empresa Alfa" });
    expect(intelligence.rfqs[0].title).toBe("RFQ de transporte");
    expect(intelligence.supplierLinks[0].title).toBe("Portal de fornecedores");
  });

  it("resume apenas o trabalho da vertical sem inventar registros", () => {
    const summary = buildTodoGreenWorkspaceSummary({
      today: "2026-08-13",
      db: {
        tasks: [
          { id: "t1", source: "todogreen-crm", status: "A fazer", due: "2026-08-10" },
          { id: "t2", businessId: "outro", status: "A fazer", due: "2026-08-01" },
        ],
        notes: [{ id: "n1", businessId: "todogreen" }, { id: "n2", businessId: "outro" }],
        documents: [{ id: "d1", businessId: "todogreen" }, { id: "d2", businessId: "outro" }],
        databases: [],
        processes: [{ id: "p1", businessId: "todogreen" }],
        processCases: [{ id: "c1", processId: "p1", status: "review" }],
        workNodes: [],
        resourceProfiles: [],
        boards: [],
      },
      verticalData: {
        clients: [{ id: "cli-1" }],
        opportunities: [
          { id: "op-1", status: "open" },
          { id: "op-2", status: "won" },
        ],
      },
    });

    expect(summary).toMatchObject({
      clients: 1,
      contacts: 0,
      news: 0,
      rfqs: 0,
      openOpportunities: 1,
      openTasks: 1,
      overdueTasks: 1,
      notes: 1,
      pages: 1,
      processes: 1,
      openCases: 1,
      bases: 0,
      boards: 0,
    });
  });


  it("monta a task canônica para Hoje sem duplicar Planner, CRM e implantação", () => {
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-13",
      currentUserId: "u1",
      db: {
        tasks: [
          {
            id: "planner-t1",
            canonicalTaskId: "planner:plan-1:t1",
            businessId: "todogreen",
            source: "todogreen-planner",
            plannerPlanId: "plan-1",
            plannerTaskId: "t1",
            title: "Liberar proposta",
            status: "Aguardando",
            priority: "alta",
            due: "2026-09-12",
            assigneeId: "u1",
            clientId: "cli-1",
            opportunityId: "op-1",
            dependsOn: ["dep-1"],
          },
          { id: "dep-1", businessId: "todogreen", title: "Precificação", status: "A fazer" },
          {
            id: "imp-1",
            businessId: "todogreen",
            source: "todogreen-implantation",
            implantationId: "implant-1",
            title: "Agendar treinamento",
            status: "A fazer",
            priority: "Média",
            due: "2026-09-13",
          },
        ],
      },
      verticalData: {
        clients: [{ id: "cli-1", name: "DHL" }],
        opportunities: [{ id: "op-1", clientId: "cli-1", title: "Frete dedicado" }],
      },
    });

    expect(board.metrics).toMatchObject({ open: 3, overdue: 1, blocked: 1, highPriority: 1 });
    expect(board.today.overdue[0]).toMatchObject({
      id: "planner:plan-1:t1",
      rawId: "planner-t1",
      clientLabel: "DHL",
      priority: "Alta",
      blocked: true,
      sourceLinks: {
        planner: { planId: "plan-1", taskId: "t1" },
        crm: { clientId: "cli-1", opportunityId: "op-1" },
      },
    });
    expect(board.today.mine.map((task) => task.id)).toContain("planner:plan-1:t1");
    expect(board.today.dueToday[0]).toMatchObject({
      title: "Agendar treinamento",
      sourceLinks: { implantation: { implantationId: "implant-1", taskId: "imp-1" } },
    });
  });

  it("deduplica uma projeção legada quando a task canônica já existe", () => {
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-13",
      db: {
        tasks: [
          {
            id: "task-real",
            canonicalTaskId: "task:1",
            canonicalSource: "task",
            businessId: "todogreen",
            title: "Versão canônica",
            status: "A fazer",
            updatedAt: "2026-09-13T04:00:00.000Z",
          },
          {
            id: "planner-old",
            canonicalTaskId: "task:1",
            canonicalSource: "planner",
            businessId: "todogreen",
            title: "Cópia antiga",
            status: "Em andamento",
            updatedAt: "2026-09-13T05:00:00.000Z",
          },
        ],
      },
    });

    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]).toMatchObject({ id: "task:1", rawId: "task-real", title: "Versão canônica" });
  });

  it("resolve dependência por id canônico para não ressuscitar duas tarefas", () => {
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-13",
      db: {
        tasks: [
          { id: "todo-a", canonicalTaskId: "task:a", businessId: "todogreen", title: "A", status: "A fazer", dependsOn: ["task:b"] },
          { id: "todo-b", canonicalTaskId: "task:b", businessId: "todogreen", title: "B", status: "Concluído" },
        ],
      },
    });

    expect(board.today.blocked).toHaveLength(0);
    expect(board.tasks.find((task) => task.id === "task:a")).toMatchObject({
      rawId: "todo-a",
      dependsOn: ["task:b"],
      dependencyLabels: ["B"],
    });
  });

  it("normaliza status e mantém uma saída canônica para qualquer visão", () => {
    expect(normalizeTodoGreenTaskStatus("completed")).toBe("Concluído");
    expect(normalizeTodoGreenTaskStatus("blocked")).toBe("Aguardando");
    expect(buildTodoGreenCanonicalTask({ id: "t1", title: "Contato", source: "todogreen-crm", clientId: "cli-1" }, {
      clients: [{ id: "cli-1", company: "Vivara" }],
    })).toMatchObject({
      canonicalId: "t1",
      clientLabel: "Vivara",
      sourceLinks: { todo: { taskId: "t1" }, crm: { clientId: "cli-1", opportunityId: "" } },
    });
  });

  it("marca 'minha' pelo responsável — o criador (ownerId) não conta quando existe assigneeId", () => {
    // Cenário do CRM: Renata registra a interação e escolhe João como responsável
    // pelo follow-up. Antes do ajuste, o Meu Dia da Renata contava a tarefa como
    // dela porque o ownerId (criador) coincidia com o usuário logado.
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-14",
      currentUserId: "renata",
      db: {
        tasks: [
          {
            id: "crm-follow-1",
            businessId: "todogreen",
            source: "todogreen-crm",
            title: "Enviar proposta",
            status: "A fazer",
            due: "2026-09-18",
            assigneeId: "joao",
            ownerId: "renata",
          },
        ],
      },
    });
    expect(board.today.mine.map((task) => task.id)).not.toContain("crm-follow-1");
    expect(board.tasks[0]).toMatchObject({ assigneeId: "joao", flags: { mine: false } });

    const boardJoao = buildTodoGreenTaskBoard({
      today: "2026-09-14",
      currentUserId: "joao",
      db: {
        tasks: [{
          id: "crm-follow-1",
          businessId: "todogreen",
          source: "todogreen-crm",
          title: "Enviar proposta",
          status: "A fazer",
          due: "2026-09-18",
          assigneeId: "joao",
          ownerId: "renata",
        }],
      },
    });
    expect(boardJoao.today.mine.map((task) => task.id)).toContain("crm-follow-1");
  });

  it("cai no ownerId como fallback só quando não existe responsável", () => {
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-14",
      currentUserId: "renata",
      db: {
        tasks: [
          {
            id: "sem-responsavel",
            businessId: "todogreen",
            source: "todogreen-crm",
            title: "Definir escopo",
            status: "A fazer",
            due: "2026-09-15",
            ownerId: "renata",
          },
        ],
      },
    });
    expect(board.today.mine.map((task) => task.id)).toContain("sem-responsavel");
  });

  it("respeita assignees[] quando a tarefa lista vários responsáveis, mesmo com ownerId diferente", () => {
    const board = buildTodoGreenTaskBoard({
      today: "2026-09-14",
      currentUserId: "renata",
      db: {
        tasks: [
          {
            id: "multi",
            businessId: "todogreen",
            source: "todogreen-crm",
            title: "Preparar reunião",
            status: "A fazer",
            due: "2026-09-16",
            ownerId: "outro",
            assignees: [{ id: "renata", name: "Renata" }, { id: "joao", name: "João" }],
          },
        ],
      },
    });
    expect(board.today.mine.map((task) => task.id)).toContain("multi");
  });

  it("liga uma nota ao registro canônico do CRM", () => {
    const entity = linkedEntityFor("client", { id: "cli 1", name: "Mercado Real" });
    expect(entity).toEqual({
      type: "client",
      id: "cli 1",
      name: "Mercado Real",
      route: "/todogreen/clientes?client=cli%201",
    });
    expect(findLinkedNote([
      { id: "n1", linkedEntities: [{ type: "client", id: "cli 1" }] },
    ], entity)?.id).toBe("n1");
    expect(findLinkedDocument([
      { id: "d1", linkedEntities: [{ type: "client", id: "cli 1" }] },
    ], entity)?.id).toBe("d1");
  });
});
