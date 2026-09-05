import { describe, expect, it } from "vitest";
import { accountWorkTasks, suggestionContext, taskWorkRoute } from "./accountWorkDomain.js";

describe("trabalho da conta", () => {
  it("mantém a tarefa canônica e não mistura contas nem arquivadas", () => {
    const tasks = [
      { id: "a", clientId: "c", status: "Concluído" },
      { id: "b", clientId: "c", status: "Em andamento", plannerTaskId: "p" },
      { id: "x", clientId: "outra" },
      { id: "d", clientId: "c", archived: true },
    ];
    expect(accountWorkTasks(tasks, "c")).toEqual([tasks[1], tasks[0]]);
    expect(accountWorkTasks(tasks, "c")[0]).toBe(tasks[1]);
    expect(accountWorkTasks(tasks, "")).toEqual([]);
  });

  it("abre pelo id e explica a origem da sugestão", () => {
    expect(taskWorkRoute({ id: "a&b" })).toBe("/todogreen/espaco?ferramenta=tarefas&task=a%26b");
    expect(suggestionContext("interaction-next-step:1")).toMatch(/conversa/);
    expect(suggestionContext("map-first-contact")).toMatch(/não comprova/i);
    expect(suggestionContext("")).toMatch(/pista/);
  });
});
