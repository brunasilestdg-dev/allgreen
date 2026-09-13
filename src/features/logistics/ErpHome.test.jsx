/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErpHome from "./ErpHome.jsx";

afterEach(cleanup);

const baseProps = {
  role: "operacoes",
  user: { name: "Ana Souza" },
  data: { operations: [], pricingScenarios: [], clients: [] },
  dashboard: {},
  tasks: [],
  products: [],
  preferences: undefined,
};

describe("tela inicial do ERP", () => {
  it("tem a entrada para o Portal TMS, apontando para a rota de topo", () => {
    // O Portal TMS vive em /portal-tms, fora de /todogreen — antes não havia
    // entrada nenhuma na tela inicial e só dava para chegar digitando a URL.
    render(<ErpHome {...baseProps} />);
    const link = screen.getByRole("link", { name: /Abrir Portal TMS/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/portal-tms");
  });

  describe("Minha fila", () => {
    const comPendencia = {
      ...baseProps,
      role: "owner",
      data: { operations: [], pricingScenarios: [], clients: [{ id: "c1", name: "Rede Alfa", crm: { nextActionAt: "2020-01-01" } }] },
    };

    it("separa pendência de tarefa e avisa que o quadro abre vazio mesmo", () => {
      // A queixa da titular: a fila mostrava "2 clientes com ação atrasada"
      // como se fosse tarefa, o contador dizia "0 tarefa(s)" e o quadro de
      // tarefas abria vazio. Agora a tela diz as duas coisas, separadas.
      render(<ErpHome {...comPendencia} />);
      expect(screen.getByText("Nenhuma tarefa no seu quadro")).toBeInTheDocument();
      expect(screen.getByText(/O quadro abre vazio mesmo/)).toBeInTheDocument();
      expect(screen.getByText("PENDÊNCIAS DA OPERAÇÃO")).toBeInTheDocument();
      expect(screen.getByText(/não são cartões do quadro de tarefas/)).toBeInTheDocument();
      expect(screen.getByText("0 tarefa(s) no filtro · 1 pendência(s)")).toBeInTheDocument();
    });

    it("a pendência nomeia a conta e leva ao CRM filtrado nela", () => {
      const onNavigate = vi.fn();
      render(<ErpHome {...comPendencia} onNavigate={onNavigate} />);
      expect(screen.getByText("1 cliente com ação atrasada")).toBeInTheDocument();
      expect(screen.getByText(/Rede Alfa/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Abrir clientes/ }));
      expect(onNavigate).toHaveBeenCalledWith("/todogreen/clientes?client=c1");
    });

    it("tarefa atribuída continua abrindo o cartão dela no quadro", () => {
      const onNavigate = vi.fn();
      render(<ErpHome
        {...comPendencia}
        user={{ id: "u1", name: "Ana Souza" }}
        tasks={[{ id: "t1", title: "Enviar proposta", status: "Em andamento", assigneeId: "u1" }]}
        onNavigate={onNavigate}
      />);
      fireEvent.click(screen.getByRole("button", { name: /Enviar proposta/ }));
      expect(onNavigate).toHaveBeenCalledWith("/todogreen/espaco?ferramenta=tarefas&task=t1");
    });
  });
});
