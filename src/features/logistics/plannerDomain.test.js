import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUCKET,
  agruparTarefas,
  checklistCompleto,
  minhasTarefas,
  normalizarBaldes,
  normalizarPrioridade,
  normalizarProgresso,
  normalizarVisibilidade,
  ordenarTarefas,
  podeEditarPlano,
  podeVerPlano,
  progressoNumerico,
  resumoPlano,
  tarefaAtendeBusca,
  validarPlano,
  validarTarefa,
} from "./plannerDomain.js";

describe("normalização de enums", () => {
  it("visibilidade desconhecida vira privado — o padrão seguro", () => {
    expect(normalizarVisibilidade("shared")).toBe("shared");
    expect(normalizarVisibilidade("qualquer")).toBe("private");
    expect(normalizarVisibilidade("")).toBe("private");
  });

  it("progresso inválido cai em não iniciada", () => {
    expect(normalizarProgresso("concluida")).toBe("concluida");
    expect(normalizarProgresso("done")).toBe("nao_iniciada");
  });

  it("prioridade inválida cai em média", () => {
    expect(normalizarPrioridade("urgente")).toBe("urgente");
    expect(normalizarPrioridade("altíssima")).toBe("media");
  });
});

describe("baldes", () => {
  it("plano sem balde ganha o balde padrão em vez de ficar sem lugar", () => {
    expect(normalizarBaldes([])).toEqual([{ ...DEFAULT_BUCKET }]);
    expect(normalizarBaldes(null)).toEqual([{ ...DEFAULT_BUCKET }]);
  });

  it("id repetido é descartado — o id é âncora, tem de ser único", () => {
    const baldes = normalizarBaldes([
      { id: "a", nome: "A" },
      { id: "a", nome: "A de novo" },
      { id: "b", nome: "B" },
    ]);
    expect(baldes).toEqual([
      { id: "a", nome: "A" },
      { id: "b", nome: "B" },
    ]);
  });

  it("balde só com nome herda o nome como id; sem id e sem nome é descartado", () => {
    expect(normalizarBaldes([{ nome: "Revisão" }])).toEqual([
      { id: "Revisão", nome: "Revisão" },
    ]);
    expect(normalizarBaldes([{ id: "", nome: "" }])).toEqual([{ ...DEFAULT_BUCKET }]);
  });
});

describe("visibilidade: pode ser compartilhado ou não", () => {
  const privado = { visibility: "private", ownerUserId: "u1" };
  const compartilhado = { visibility: "shared", ownerUserId: "u1" };

  it("plano compartilhado, todo o espaço vê", () => {
    expect(podeVerPlano(compartilhado, { userId: "u2", role: "vendedor" })).toBe(true);
  });

  it("plano privado, só quem criou vê", () => {
    expect(podeVerPlano(privado, { userId: "u1", role: "vendedor" })).toBe(true);
    expect(podeVerPlano(privado, { userId: "u2", role: "vendedor" })).toBe(false);
  });

  it("admin e owner enxergam o próprio espaço inteiro", () => {
    expect(podeVerPlano(privado, { userId: "u9", role: "admin" })).toBe(true);
    expect(podeVerPlano(privado, { userId: "u9", role: "owner" })).toBe(true);
  });

  it("editar a estrutura do plano é do criador, mesmo quando compartilhado", () => {
    expect(podeEditarPlano(compartilhado, { userId: "u1", role: "vendedor" })).toBe(true);
    expect(podeEditarPlano(compartilhado, { userId: "u2", role: "vendedor" })).toBe(false);
    expect(podeEditarPlano(compartilhado, { userId: "u2", role: "admin" })).toBe(true);
  });
});

describe("progresso é derivado, nunca digitado", () => {
  it("concluída é 100, não iniciada é 0", () => {
    expect(progressoNumerico({ progress: "concluida" })).toBe(100);
    expect(progressoNumerico({ progress: "nao_iniciada" })).toBe(0);
  });

  it("em andamento sem checklist é 50 — saiu do zero, não terminou", () => {
    expect(progressoNumerico({ progress: "em_andamento" })).toBe(50);
  });

  it("em andamento com checklist usa a fração concluída", () => {
    expect(
      progressoNumerico({
        progress: "em_andamento",
        checklist: [{ feito: true }, { feito: true }, { feito: false }, { feito: false }],
      }),
    ).toBe(50);
  });

  it("checklist inteiro marcado é sinal, não conclusão automática", () => {
    const t = { progress: "em_andamento", checklist: [{ feito: true }, { feito: true }] };
    expect(checklistCompleto(t)).toBe(true);
    // Progresso pelo checklist é 100%, mas o status continua em andamento até
    // alguém concluir de fato.
    expect(progressoNumerico(t)).toBe(100);
    expect(normalizarProgresso(t.progress)).toBe("em_andamento");
  });
});

describe("ordenação do quadro", () => {
  it("prioridade primeiro, depois prazo, depois ordem manual", () => {
    const ordenadas = ordenarTarefas([
      { id: "a", priority: "media", dueDate: "2026-09-10" },
      { id: "b", priority: "urgente", dueDate: "2026-12-01" },
      { id: "c", priority: "media", dueDate: "2026-09-01" },
      { id: "d", priority: "baixa" },
    ]);
    expect(ordenadas.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("tarefa sem prazo vai para o fim do seu nível de prioridade", () => {
    const ordenadas = ordenarTarefas([
      { id: "sem", priority: "alta" },
      { id: "com", priority: "alta", dueDate: "2026-09-01" },
    ]);
    expect(ordenadas.map((t) => t.id)).toEqual(["com", "sem"]);
  });
});

describe("agrupamento do quadro", () => {
  const tarefas = [
    { id: "1", bucketId: "a_fazer", assigneeUserId: "u1", assigneeLabel: "Ana", progress: "nao_iniciada" },
    { id: "2", bucketId: "fazendo", assigneeUserId: "u2", assigneeLabel: "Bia", progress: "em_andamento" },
    { id: "3", bucketId: "fazendo", progress: "concluida" },
  ];
  const baldes = [
    { id: "a_fazer", nome: "A fazer" },
    { id: "fazendo", nome: "Fazendo" },
    { id: "feito", nome: "Feito" },
  ];

  it("por balde preserva a ordem e mostra até o balde vazio", () => {
    const colunas = agruparTarefas(tarefas, "balde", { baldes });
    expect(colunas.map((c) => c.titulo)).toEqual(["A fazer", "Fazendo", "Feito"]);
    expect(colunas[1].tarefas.map((t) => t.id).sort()).toEqual(["2", "3"]);
    expect(colunas[2].tarefas).toEqual([]);
  });

  it("tarefa em balde que não existe mais não some: cai em 'Sem balde'", () => {
    const colunas = agruparTarefas(
      [...tarefas, { id: "4", bucketId: "fantasma" }],
      "balde",
      { baldes },
    );
    const sem = colunas.find((c) => c.chave === "__sem__");
    expect(sem.tarefas.map((t) => t.id)).toEqual(["4"]);
  });

  it("por progresso sai nas três colunas fixas, sempre", () => {
    const colunas = agruparTarefas(tarefas, "progresso");
    expect(colunas.map((c) => c.chave)).toEqual([
      "nao_iniciada",
      "em_andamento",
      "concluida",
    ]);
  });

  it("por responsável agrupa quem tem, e junta os sem responsável", () => {
    const colunas = agruparTarefas(tarefas, "responsavel");
    const semDono = colunas.find((c) => c.chave === "__sem__");
    expect(semDono.titulo).toBe("Sem responsável");
    expect(semDono.tarefas.map((t) => t.id)).toEqual(["3"]);
  });
});

describe("minhas tarefas", () => {
  const tarefas = [
    { id: "1", assigneeUserId: "u1", progress: "em_andamento", dueDate: "2026-09-10" },
    { id: "2", assigneeUserId: "u1", progress: "concluida", dueDate: "2026-09-01" },
    { id: "3", assigneeUserId: "u2", progress: "nao_iniciada" },
  ];

  it("traz só o que é meu e esconde as concluídas por padrão", () => {
    expect(minhasTarefas(tarefas, "u1").map((t) => t.id)).toEqual(["1"]);
  });

  it("mostra concluídas quando pedido", () => {
    expect(
      minhasTarefas(tarefas, "u1", { incluirConcluidas: true }).map((t) => t.id).sort(),
    ).toEqual(["1", "2"]);
  });

  it("sem usuário, nada é meu", () => {
    expect(minhasTarefas(tarefas, "")).toEqual([]);
  });
});

describe("resumo do plano", () => {
  it("plano vazio é 0%, nunca 100%", () => {
    const r = resumoPlano([]);
    expect(r.total).toBe(0);
    expect(r.progressoMedio).toBe(0);
  });

  it("conta concluídas, em andamento e a média", () => {
    const r = resumoPlano([
      { progress: "concluida" },
      { progress: "em_andamento" },
      { progress: "nao_iniciada" },
    ]);
    expect(r.total).toBe(3);
    expect(r.concluidas).toBe(1);
    expect(r.emAndamento).toBe(1);
    expect(r.naoIniciadas).toBe(1);
    expect(r.progressoMedio).toBe(Math.round((100 + 50 + 0) / 3));
  });

  it("atrasadas: com prazo vencido e não concluídas", () => {
    const r = resumoPlano([
      { progress: "em_andamento", dueDate: "2026-01-01" },
      { progress: "concluida", dueDate: "2026-01-01" },
      { progress: "nao_iniciada", dueDate: "2026-12-01" },
    ]);
    expect(r.atrasadas("2026-08-25")).toBe(1);
  });
});

describe("busca em tarefa", () => {
  const tarefa = {
    title: "Renovar contrato",
    notes: "Falar com o jurídico",
    assigneeLabel: "Ana",
    labels: ["Fiscal", "Urgente"],
  };

  it("acha por título, nota, responsável ou rótulo", () => {
    expect(tarefaAtendeBusca(tarefa, "contrato")).toBe(true);
    expect(tarefaAtendeBusca(tarefa, "juridico")).toBe(true);
    expect(tarefaAtendeBusca(tarefa, "ana")).toBe(true);
    expect(tarefaAtendeBusca(tarefa, "fiscal")).toBe(true);
  });

  it("acento e caixa não atrapalham; busca vazia mostra tudo", () => {
    expect(tarefaAtendeBusca(tarefa, "JURÍDICO")).toBe(true);
    expect(tarefaAtendeBusca(tarefa, "")).toBe(true);
  });

  it("o que não existe não aparece", () => {
    expect(tarefaAtendeBusca(tarefa, "estoque")).toBe(false);
  });
});

describe("validação", () => {
  it("plano sem nome não passa", () => {
    expect(validarPlano({ name: "" })).toContain("Dê um nome ao plano.");
    expect(validarPlano({ name: "Lançamentos" })).toEqual([]);
  });

  it("tarefa sem título não passa; início depois do prazo é erro", () => {
    expect(validarTarefa({ title: "" })).toContain("Dê um título à tarefa.");
    expect(
      validarTarefa({ title: "X", startDate: "2026-09-10", dueDate: "2026-09-01" }),
    ).toContain("A data de início não pode ser depois do prazo.");
    expect(
      validarTarefa({ title: "X", startDate: "2026-09-01", dueDate: "2026-09-10" }),
    ).toEqual([]);
  });
});
