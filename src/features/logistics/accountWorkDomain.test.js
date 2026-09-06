import { describe, expect, it } from "vitest";
import { accountWorkTasks, estruturarNotasDaConta, suggestionContext, taskWorkRoute } from "./accountWorkDomain.js";

describe("estruturarNotasDaConta — fim da parede de texto", () => {
  it("quebra o bloco do pipeline importado em campos e updates", () => {
    const notes = "[Pipeline Novos Negócios — Em andamento] Funil: Prospecção | Prioridade: Média | Status: Não iniciado Faturamento anual esperado: R$ 3.600.000 Responsável: JEBERSON, Bruna Últimos updates: - 2026-08-26 (JEBERSON): irá fazer FUP com o Ricardo. - 2026-08-20 (Bruna): primeiro contato.";
    const { linhas, updates } = estruturarNotasDaConta(notes);
    expect(linhas.some((l) => /^Funil: Prospecção$/.test(l))).toBe(true);
    expect(linhas.some((l) => /^Prioridade: Média$/.test(l))).toBe(true);
    expect(linhas.some((l) => /^Faturamento anual esperado: R\$ 3\.600\.000$/.test(l))).toBe(true);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain("2026-08-26 (JEBERSON)");
    expect(updates[0]).not.toMatch(/^-/);
  });

  it("nota vazia não quebra e não inventa nada", () => {
    expect(estruturarNotasDaConta("")).toEqual({ linhas: [], updates: [] });
    expect(estruturarNotasDaConta(null).linhas).toEqual([]);
  });

  it("nota sem 'últimos updates' vira só campos", () => {
    const r = estruturarNotasDaConta("Segmento: Varejo | Prazo: Q4");
    expect(r.updates).toEqual([]);
    expect(r.linhas).toContain("Segmento: Varejo");
    expect(r.linhas).toContain("Prazo: Q4");
  });
});

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
