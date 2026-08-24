import { describe, expect, it } from "vitest";
import {
  adicionarMeses,
  agruparPorGrupo,
  caminhoCritico,
  cargaPorResponsavel,
  detectarCiclo,
  diasEntre,
  duracaoDoItem,
  expandirRecorrencia,
  isConcluido,
  itensNoCalendario,
  montarGantt,
  ordenarPorDependencia,
  progressoChecklist,
  resumoDoTrabalho,
  rollupDeSubitens,
  validarItemDeTrabalho,
} from "./workManagementDomain.js";

describe("datas", () => {
  it("conta dias entre datas", () => {
    expect(diasEntre("2026-01-01", "2026-01-08")).toBe(7);
    expect(diasEntre("2026-01-08", "2026-01-01")).toBe(-7);
  });

  it("soma meses sem estourar o fim do mês", () => {
    // 31 de janeiro + 1 mês não vira 31 de fevereiro.
    expect(adicionarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(adicionarMeses("2026-01-15", 2)).toBe("2026-03-15");
  });
});

describe("recorrência", () => {
  it("expande recorrência semanal até uma data limite", () => {
    const datas = expandirRecorrencia(
      { frequencia: "semanal", intervalo: 1, inicio: "2026-01-05", ate: "2026-02-02" },
    );
    expect(datas).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"]);
  });

  it("respeita a contagem máxima de ocorrências", () => {
    const datas = expandirRecorrencia({ frequencia: "diaria", intervalo: 2, inicio: "2026-01-01", contagem: 3 });
    expect(datas).toEqual(["2026-01-01", "2026-01-03", "2026-01-05"]);
  });

  it("recorrência mensal preserva o dia e trata fim de mês", () => {
    const datas = expandirRecorrencia({ frequencia: "mensal", intervalo: 1, inicio: "2026-01-31", contagem: 3 });
    expect(datas).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("frequência inválida devolve lista vazia", () => {
    expect(expandirRecorrencia({ frequencia: "quinzenal", inicio: "2026-01-01" })).toEqual([]);
  });
});

describe("checklist", () => {
  it("calcula o percentual concluído", () => {
    expect(progressoChecklist([{ feito: true }, { feito: false }, { feito: true }, { feito: false }]))
      .toEqual({ total: 4, feitos: 2, percentual: 50 });
  });

  it("checklist vazio é 0%, não NaN", () => {
    expect(progressoChecklist([]).percentual).toBe(0);
  });
});

describe("rollup de subitens", () => {
  it("o progresso do pai vem da conclusão dos filhos", () => {
    const r = rollupDeSubitens([
      { status: "concluido" },
      { status: "novo" },
      { status: "concluido" },
      { status: "em_execucao" },
    ]);
    expect(r.progresso).toBe(50);
    expect(r.concluidos).toBe(2);
    expect(r.statusDerivado).toBe("em_execucao");
  });

  it("todos concluídos derivam status concluído", () => {
    const r = rollupDeSubitens([{ status: "concluido" }, { status: "done" }]);
    expect(r.progresso).toBe(100);
    expect(r.statusDerivado).toBe("concluido");
  });

  it("o prazo do pai é o do filho que termina por último", () => {
    const r = rollupDeSubitens([{ dueDate: "2026-03-01" }, { dueDate: "2026-05-10" }, { dueDate: "2026-04-01" }]);
    expect(r.prazo).toBe("2026-05-10");
  });

  it("sem filhos, zero — não quebra", () => {
    expect(rollupDeSubitens([]).total).toBe(0);
  });
});

describe("dependências", () => {
  const cadeia = [
    { id: "a", dependencies: [] },
    { id: "b", dependencies: ["a"] },
    { id: "c", dependencies: ["b"] },
  ];

  it("ordena respeitando as dependências", () => {
    const ordem = ordenarPorDependencia(cadeia);
    expect(ordem.indexOf("a")).toBeLessThan(ordem.indexOf("b"));
    expect(ordem.indexOf("b")).toBeLessThan(ordem.indexOf("c"));
  });

  it("detecta ciclo em vez de girar para sempre", () => {
    const ciclo = [
      { id: "x", dependencies: ["z"] },
      { id: "y", dependencies: ["x"] },
      { id: "z", dependencies: ["y"] },
    ];
    expect(detectarCiclo(ciclo)).not.toBeNull();
    expect(() => ordenarPorDependencia(ciclo)).toThrow(/ciclo/i);
  });

  it("sem ciclo, detectarCiclo devolve null", () => {
    expect(detectarCiclo(cadeia)).toBeNull();
  });
});

describe("duração e caminho crítico", () => {
  it("marco tem duração zero; item com início e fim conta os dias inclusive", () => {
    expect(duracaoDoItem({ isMilestone: true, dueDate: "2026-01-10" })).toBe(0);
    expect(duracaoDoItem({ startDate: "2026-01-01", dueDate: "2026-01-05" })).toBe(5);
  });

  it("o caminho crítico é a cadeia de maior duração acumulada", () => {
    const itens = [
      { id: "a", startDate: "2026-01-01", dueDate: "2026-01-02", dependencies: [] }, // 2d
      { id: "b", startDate: "2026-01-01", dueDate: "2026-01-10", dependencies: ["a"] }, // 10d
      { id: "c", startDate: "2026-01-01", dueDate: "2026-01-02", dependencies: ["b"] }, // 2d
      { id: "d", startDate: "2026-01-01", dueDate: "2026-01-03", dependencies: ["a"] }, // 3d (ramo curto)
    ];
    const { itensCriticos } = caminhoCritico(itens);
    expect(itensCriticos).toEqual(["a", "b", "c"]);
  });
});

describe("gantt", () => {
  it("calcula offset e duração a partir da menor data", () => {
    const g = montarGantt([
      { id: "a", startDate: "2026-01-01", dueDate: "2026-01-05" },
      { id: "b", startDate: "2026-01-06", dueDate: "2026-01-10" },
    ]);
    expect(g.inicio).toBe("2026-01-01");
    expect(g.fim).toBe("2026-01-10");
    expect(g.barras.find((x) => x.id === "a").offsetDias).toBe(0);
    expect(g.barras.find((x) => x.id === "b").offsetDias).toBe(5);
  });

  it("sem datas, gantt vazio", () => {
    expect(montarGantt([{ id: "a" }]).barras).toEqual([]);
  });
});

describe("calendário", () => {
  it("agrupa itens por dia de vencimento dentro da janela", () => {
    const cal = itensNoCalendario(
      [
        { id: "a", dueDate: "2026-02-10" },
        { id: "b", dueDate: "2026-02-10" },
        { id: "c", dueDate: "2026-03-01" },
        { id: "d", dueDate: "2026-01-01" },
      ],
      { de: "2026-02-01", ate: "2026-02-28" },
    );
    expect(cal["2026-02-10"].length).toBe(2);
    expect(cal["2026-03-01"]).toBeUndefined();
    expect(cal["2026-01-01"]).toBeUndefined();
  });
});

describe("workload", () => {
  it("soma horas por responsável e sinaliza sobrecarga", () => {
    const carga = cargaPorResponsavel(
      [
        { responsibleUserId: "u1", responsible: "Ana", status: "novo", estimatedHours: 30 },
        { responsibleUserId: "u1", responsible: "Ana", status: "em_execucao", estimatedHours: 20 },
        { responsibleUserId: "u2", responsible: "Beto", status: "novo", estimatedHours: 10 },
        { responsibleUserId: "u1", responsible: "Ana", status: "concluido", estimatedHours: 99 },
      ],
      { capacidades: { u1: 40, u2: 40 } },
    );
    const ana = carga.find((c) => c.chave === "u1");
    // Concluído não conta: 30 + 20 = 50 > 40.
    expect(ana.horas).toBe(50);
    expect(ana.sobrecarregado).toBe(true);
    expect(ana.utilizacao).toBe(125);
    const beto = carga.find((c) => c.chave === "u2");
    expect(beto.sobrecarregado).toBe(false);
  });

  it("item sem horas usa o padrão", () => {
    const carga = cargaPorResponsavel([{ responsible: "X", status: "novo" }], { horasPorItemPadrao: 4 });
    expect(carga[0].horas).toBe(4);
  });
});

describe("agrupamento por grupo", () => {
  it("distribui itens nos grupos por ordem e junta os sem grupo", () => {
    const grupos = [
      { id: "g2", name: "Depois", displayOrder: 2 },
      { id: "g1", name: "Antes", displayOrder: 1 },
    ];
    const itens = [
      { id: "a", groupId: "g1" },
      { id: "b", groupId: "g2" },
      { id: "c", groupId: "g1" },
      { id: "d" },
    ];
    const blocos = agruparPorGrupo(itens, grupos);
    expect(blocos[0].grupo.id).toBe("g1");
    expect(blocos[0].itens.map((i) => i.id)).toEqual(["a", "c"]);
    expect(blocos[blocos.length - 1].grupo.name).toBe("Sem grupo");
    expect(blocos[blocos.length - 1].itens.map((i) => i.id)).toEqual(["d"]);
  });
});

describe("validação", () => {
  it("recusa início depois do prazo", () => {
    expect(validarItemDeTrabalho({ startDate: "2026-02-10", dueDate: "2026-02-01" }))
      .toContain("A data de início não pode ser depois do prazo.");
  });

  it("marco exige data", () => {
    expect(validarItemDeTrabalho({ isMilestone: true })).toContain("Um marco precisa de uma data.");
  });

  it("item válido não tem erro", () => {
    expect(validarItemDeTrabalho({ startDate: "2026-01-01", dueDate: "2026-01-10" })).toEqual([]);
  });
});

describe("resumo", () => {
  it("conta abertos, concluídos e marcos", () => {
    const r = resumoDoTrabalho([
      { status: "novo", dueDate: "2026-01-10" },
      { status: "concluido" },
      { status: "em_execucao", isMilestone: true, dueDate: "2026-02-01" },
    ]);
    expect(r.total).toBe(3);
    expect(r.abertos).toBe(2);
    expect(r.concluidos).toBe(1);
    expect(r.marcos).toBe(1);
    expect(r.comPrazo).toBe(2);
  });
});

describe("isConcluido", () => {
  it("reconhece as variações de concluído", () => {
    expect(isConcluido("Concluído")).toBe(true);
    expect(isConcluido("done")).toBe(true);
    expect(isConcluido("novo")).toBe(false);
  });
});
