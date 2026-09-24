import { describe, expect, it } from "vitest";
import {
  FILTROS_VAZIOS,
  adicionarBalde,
  corDoRotulo,
  dataCurta,
  deslocarDias,
  diasDaJanela,
  duracaoDaTarefa,
  filtrarTarefas,
  filtrosAtivos,
  graficosDoPlano,
  iniciais,
  linhaDoTempo,
  moverBalde,
  normalizarRotulos,
  removerBalde,
  renomearBalde,
  rotulosDoPlano,
  segundaDaSemana,
  separarConcluidas,
} from "./plannerDomain.js";

const HOJE = "2026-09-24";

describe("baldes editáveis do quadro", () => {
  const baldes = [{ id: "a_fazer", nome: "A fazer" }, { id: "feito", nome: "Feito" }];

  it("adiciona um balde com id legível e único, sem mexer nos existentes", () => {
    const novos = adicionarBalde(baldes, "Em Revisão");
    expect(novos).toHaveLength(3);
    expect(novos[2]).toEqual({ id: "em_revisao", nome: "Em Revisão" });
    expect(adicionarBalde(novos, "em revisão")[3].id).toBe("em_revisao_2");
  });

  it("ignora nome vazio e não deixa o plano sem balde", () => {
    expect(adicionarBalde(baldes, "   ")).toEqual(baldes);
    expect(removerBalde([{ id: "unico", nome: "Único" }], "unico")).toHaveLength(1);
    expect(removerBalde(baldes, "feito")).toEqual([{ id: "a_fazer", nome: "A fazer" }]);
  });

  it("renomear preserva o id (a tarefa aponta para ele) e mover troca a ordem", () => {
    expect(renomearBalde(baldes, "feito", "Concluído")[1]).toEqual({ id: "feito", nome: "Concluído" });
    expect(renomearBalde(baldes, "feito", "")).toEqual(baldes);
    expect(moverBalde(baldes, "feito", -1).map((b) => b.id)).toEqual(["feito", "a_fazer"]);
    expect(moverBalde(baldes, "a_fazer", -1).map((b) => b.id)).toEqual(["a_fazer", "feito"]);
  });
});

describe("rótulos e avatar", () => {
  it("dá a mesma cor ao mesmo rótulo, ignorando acento e caixa", () => {
    expect(corDoRotulo("Blog")).toEqual(corDoRotulo("blog"));
    expect(corDoRotulo("Ação")).toEqual(corDoRotulo("acao"));
    expect(corDoRotulo("Blog").fundo).toMatch(/^#/);
  });

  it("normaliza rótulos (dedupe, corte) e lista os do plano por frequência", () => {
    expect(normalizarRotulos(["Blog", "Blog", "", "  Social "])).toEqual(["Blog", "Social"]);
    const tarefas = [{ labels: ["Social"] }, { labels: ["Blog", "Social"] }, { labels: ["Marketing"] }];
    expect(rotulosDoPlano(tarefas)).toEqual(["Social", "Blog", "Marketing"]);
  });

  it("gera iniciais para o avatar", () => {
    expect(iniciais("Bruna Siles")).toBe("BS");
    expect(iniciais("Ana Paula de Souza")).toBe("AS");
    expect(iniciais("bruna")).toBe("BR");
    expect(iniciais("")).toBe("?");
  });
});

describe("filtros do quadro", () => {
  const tarefas = [
    { id: "1", title: "Post", progress: "nao_iniciada", priority: "urgente", dueDate: "2026-09-20", assigneeUserId: "u1", labels: ["Social"] },
    { id: "2", title: "Blog", progress: "em_andamento", priority: "media", dueDate: "2026-09-30", assigneeUserId: "", labels: ["Blog"] },
    { id: "3", title: "Feito", progress: "concluida", priority: "baixa", dueDate: "2026-09-01", assigneeUserId: "u1" },
  ];

  it("sem filtros devolve tudo e conta zero filtros ativos", () => {
    expect(filtrarTarefas(tarefas, FILTROS_VAZIOS, { hoje: HOJE })).toHaveLength(3);
    expect(filtrosAtivos(FILTROS_VAZIOS)).toBe(0);
  });

  it("combina status, prioridade, rótulo, minhas, sem responsável e atrasadas", () => {
    expect(filtrarTarefas(tarefas, { status: ["em_andamento"] }).map((t) => t.id)).toEqual(["2"]);
    expect(filtrarTarefas(tarefas, { prioridades: ["urgente", "baixa"] }).map((t) => t.id)).toEqual(["1", "3"]);
    expect(filtrarTarefas(tarefas, { rotulos: ["blog"] }).map((t) => t.id)).toEqual(["2"]);
    expect(filtrarTarefas(tarefas, { minhas: true }, { userId: "u1" }).map((t) => t.id)).toEqual(["1", "3"]);
    expect(filtrarTarefas(tarefas, { semResponsavel: true }).map((t) => t.id)).toEqual(["2"]);
    // Concluída atrasada não é atraso — ela saiu da fila.
    expect(filtrarTarefas(tarefas, { atrasadas: true }, { hoje: HOJE }).map((t) => t.id)).toEqual(["1"]);
    expect(filtrarTarefas(tarefas, { busca: "blog", status: ["em_andamento"] })).toHaveLength(1);
    expect(filtrosAtivos({ status: ["em_andamento"], minhas: true, atrasadas: true })).toBe(3);
    // Todos os status marcados = nenhum filtro de status.
    expect(filtrosAtivos({ status: ["nao_iniciada", "em_andamento", "concluida"] })).toBe(0);
  });

  it("separa concluídas das abertas", () => {
    const { abertas, concluidas } = separarConcluidas(tarefas);
    expect(abertas.map((t) => t.id)).toEqual(["1", "2"]);
    expect(concluidas.map((t) => t.id)).toEqual(["3"]);
  });
});

describe("duração e data curta do cartão", () => {
  it("conta dias inclusivos entre início e prazo; só prazo vale 1 dia; sem prazo é nulo", () => {
    expect(duracaoDaTarefa({ startDate: "2026-09-01", dueDate: "2026-09-11" })).toBe(11);
    expect(duracaoDaTarefa({ dueDate: "2026-09-11" })).toBe(1);
    expect(duracaoDaTarefa({ startDate: "2026-09-11", dueDate: "2026-09-11" })).toBe(1);
    expect(duracaoDaTarefa({})).toBeNull();
  });

  it("mostra dia/mês no mesmo ano e acrescenta o ano quando muda", () => {
    expect(dataCurta("2026-06-06", { hoje: HOJE })).toBe("06/06");
    expect(dataCurta("2025-03-03", { hoje: HOJE })).toBe("03/03/25");
    expect(dataCurta("", { hoje: HOJE })).toBe("");
  });
});

describe("linha do tempo", () => {
  it("posiciona barras em dias a partir do início da janela e corta nas bordas", () => {
    const tarefas = [
      { id: "a", title: "Dentro", startDate: "2026-09-22", dueDate: "2026-09-25", progress: "nao_iniciada" },
      { id: "b", title: "Só prazo", dueDate: "2026-09-21", progress: "nao_iniciada" },
      { id: "c", title: "Começa antes", startDate: "2026-09-10", dueDate: "2026-09-22", progress: "nao_iniciada" },
      { id: "d", title: "Termina depois", startDate: "2026-10-10", dueDate: "2026-11-30", progress: "nao_iniciada" },
      { id: "e", title: "Sem data", progress: "nao_iniciada" },
      { id: "f", title: "Fora e antes", startDate: "2026-08-01", dueDate: "2026-08-10", progress: "nao_iniciada" },
    ];
    const { barras, semData, janela } = linhaDoTempo(tarefas, { inicio: "2026-09-21", dias: 28 });
    expect(janela).toBe(28);
    expect(semData.map((t) => t.id)).toEqual(["e"]);
    const por = Object.fromEntries(barras.map((b) => [b.tarefa.id, b]));
    expect(por.a).toMatchObject({ inicio: 1, largura: 4, cortadaAntes: false, cortadaDepois: false });
    expect(por.b).toMatchObject({ inicio: 0, largura: 1 });
    expect(por.c).toMatchObject({ inicio: 0, largura: 2, cortadaAntes: true });
    expect(por.d).toMatchObject({ inicio: 19, largura: 9, cortadaDepois: true });
    expect(por.f).toBeUndefined();
  });

  it("tolera início depois do prazo (dado ruim) sem barra negativa", () => {
    const { barras } = linhaDoTempo([{ id: "x", startDate: "2026-09-25", dueDate: "2026-09-22", progress: "nao_iniciada" }], { inicio: "2026-09-21", dias: 10 });
    expect(barras[0]).toMatchObject({ inicio: 1, largura: 4 });
  });

  it("gera a régua de dias com segunda, fim de semana e hoje marcados", () => {
    const dias = diasDaJanela("2026-09-21", 7, { hoje: "2026-09-24" });
    expect(dias).toHaveLength(7);
    expect(dias[0]).toMatchObject({ ymd: "2026-09-21", inicioDeSemana: true, primeiroDoMes: true });
    expect(dias[3]).toMatchObject({ ymd: "2026-09-24", hoje: true });
    expect(dias[5].fimDeSemana).toBe(true);
    expect(segundaDaSemana("2026-09-24")).toBe("2026-09-21");
    expect(segundaDaSemana("2026-09-21")).toBe("2026-09-21");
    expect(deslocarDias("2026-09-30", 7)).toBe("2026-10-07");
    expect(deslocarDias("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("gráficos do plano", () => {
  it("conta por status, balde, prioridade e responsável, tudo derivado", () => {
    const baldes = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const tarefas = [
      { bucketId: "a", progress: "concluida", priority: "alta", assigneeUserId: "u1", assigneeLabel: "Ana", dueDate: "2026-09-01" },
      { bucketId: "a", progress: "nao_iniciada", priority: "urgente", assigneeUserId: "u1", assigneeLabel: "Ana", dueDate: "2026-09-01" },
      { bucketId: "b", progress: "em_andamento", priority: "media", assigneeUserId: "", dueDate: "2026-12-01" },
    ];
    const g = graficosDoPlano(tarefas, { baldes, hoje: HOJE });
    expect(g.total).toBe(3);
    expect(g.atrasadas).toBe(1);
    expect(g.porStatus.map((s) => s.total)).toEqual([1, 1, 1]);
    expect(g.porBalde[0]).toMatchObject({ label: "A", total: 2 });
    expect(g.porBalde[0].porStatus.find((s) => s.id === "concluida").total).toBe(1);
    // Prioridade só conta abertas: a alta concluída não aparece.
    expect(g.porPrioridade.find((p) => p.id === "alta").total).toBe(0);
    expect(g.porPrioridade.find((p) => p.id === "urgente").total).toBe(1);
    expect(g.porResponsavel[0]).toMatchObject({ label: "Ana", total: 2, concluidas: 1, atrasadas: 1 });
    expect(g.porResponsavel[1]).toMatchObject({ id: "__sem__", label: "Sem responsável", total: 1 });
  });
});
