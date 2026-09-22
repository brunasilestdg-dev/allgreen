import { describe, expect, it } from "vitest";
import {
  alertsForArea,
  blocosDaHome,
  moverBloco,
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
      widgetOrder: ["metrics", "painel", "queue", "shortcuts", "portais"],
      shortcutIds: ["billing"],
    });
  });

  it("liga um bloco novo para quem salvou a home antes de ele existir", () => {
    // Home salva ANTES do "painel" (gráficos) existir: a ordem gravada não o
    // tem. Ele deve nascer LIGADO — senão a pessoa "não vê gráfico nenhum".
    const perfil = normalizeHomePreferences("admin", {
      widgetIds: ["metrics", "queue"],
      widgetOrder: ["metrics", "queue", "shortcuts", "portais"],
    });
    expect(perfil.widgetIds).toContain("painel");
    expect(blocosDaHome(perfil)).toContain("painel");
    // ...sem religar o que ela desligou de propósito (shortcuts/portais ficaram fora).
    expect(perfil.widgetIds).not.toContain("shortcuts");
    expect(perfil.widgetIds).not.toContain("portais");
  });

  it("respeita a ordem salva dos blocos e acrescenta bloco novo no fim", () => {
    const perfil = normalizeHomePreferences("admin", {
      widgetOrder: ["portais", "metrics"],
    });
    // A ordem salva vem primeiro; os blocos que faltavam entram na ordem padrão.
    expect(perfil.widgetOrder).toEqual(["portais", "metrics", "painel", "queue", "shortcuts"]);
  });

  it("monta a home só com os blocos ligados, na ordem escolhida", () => {
    const perfil = normalizeHomePreferences("admin", {
      widgetIds: ["queue", "metrics"],
      widgetOrder: ["portais", "queue", "metrics", "painel", "shortcuts"],
    });
    // Só os ligados (metrics, queue), na ordem salva (queue antes de metrics).
    expect(blocosDaHome(perfil)).toEqual(["queue", "metrics"]);
  });

  it("move um bloco para cima/baixo sem mutar e sem sair da lista", () => {
    const ordem = ["metrics", "painel", "queue"];
    expect(moverBloco(ordem, "painel", "cima")).toEqual(["painel", "metrics", "queue"]);
    expect(moverBloco(ordem, "painel", "baixo")).toEqual(["metrics", "queue", "painel"]);
    // Nas bordas, não sai da lista.
    expect(moverBloco(ordem, "metrics", "cima")).toEqual(ordem);
    expect(moverBloco(ordem, "queue", "baixo")).toEqual(ordem);
    // Não mutou o original.
    expect(ordem).toEqual(["metrics", "painel", "queue"]);
  });

  it("mostra somente tarefas abertas atribuídas ao colaborador", () => {
    const tasks = [
      { id: "1", title: "Minha tarefa", assigneeId: "u1", status: "Pendente", due: "2026-08-25" },
      { id: "2", title: "Já feita", assigneeId: "u1", status: "Concluído", due: "2026-08-24" },
      { id: "3", title: "De outra pessoa", assigneeId: "u2", status: "Pendente" },
      { id: "4", title: "Também minha", responsible: "Renata", status: "Em andamento", due: "2026-08-26" },
    ];

    expect(tasksForCollaborator(tasks, { id: "u1", name: "Renata" }).map((task) => task.id)).toEqual(["1", "4"]);
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
