/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountWorkOverview from "./AccountWorkOverview.jsx";

afterEach(cleanup);

describe("resumo de trabalho da conta", () => {
  it("separa pessoas, conversas e próximos passos e abre a tarefa canônica", () => {
    const onTab = vi.fn();
    const onNavigate = vi.fn();
    render(<AccountWorkOverview
      client={{ id: "c1", notes: "Conheci no evento; interesse em frota elétrica." }}
      contacts={[{ id: "p1" }]}
      interactions={[{ id: "i1", clientId: "c1" }, { id: "i2", clientId: "outra" }]}
      tasks={[{ id: "t1", clientId: "c1", title: "Descobrir decisor", status: "Em andamento", assignee: "Ana" }]}
      onTab={onTab}
      onNavigate={onNavigate}
    />);
    expect(screen.getByText("O que já sabemos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pessoas.*1 no mapa ativo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conversas realizadas.*1 registro/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Próximos passos.*1 em aberto/ }));
    expect(onTab).toHaveBeenCalledWith("next");
    fireEvent.click(screen.getByRole("button", { name: /Descobrir decisor/ }));
    expect(onNavigate).toHaveBeenCalledWith("/todogreen/espaco?ferramenta=tarefas&task=t1");
  });
});
