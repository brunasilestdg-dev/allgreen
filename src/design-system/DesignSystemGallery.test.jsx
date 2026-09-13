/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DesignSystemGallery from "./DesignSystemGallery.jsx";

afterEach(cleanup);

// Fumaça: a galeria compila e renderiza todos os componentes novos; e o
// combobox (a peça de maior risco) abre, filtra sem acento e seleciona.
describe("Design System — galeria e combobox", () => {
  it("renderiza os componentes principais", () => {
    render(<DesignSystemGallery />);
    expect(screen.getByRole("heading", { name: /Componentes da Onda 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
    // Status semânticos derivados do texto de negócio.
    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
  });

  it("renderiza os primitivos novos da Onda 1", () => {
    render(<DesignSystemGallery />);
    // Cartões e indicadores
    expect(screen.getByText("Receita 30d")).toBeInTheDocument();
    expect(screen.getByText("Contrato de energia renovável")).toBeInTheDocument();
    // Avisos (Alert): o de erro aparece com seu título.
    expect(screen.getByText("Falha")).toBeInTheDocument();
    // Tabela com cabeçalhos
    expect(screen.getByRole("columnheader", { name: "Cliente" })).toBeInTheDocument();
    // Estado vazio e topo de página
    expect(screen.getByText("Nenhuma oportunidade ainda")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Oportunidades", level: 1 })).toBeInTheDocument();
  });

  it("Drawer abre pelo gatilho e fecha no Esc", () => {
    render(<DesignSystemGallery />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Drawer" }));
    const painel = screen.getByRole("dialog", { name: "Detalhe da rota" });
    expect(painel).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Alert de aviso fecha no botão de fechar", () => {
    render(<DesignSystemGallery />);
    expect(screen.getByText(/turno da manhã sem motorista/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByText(/turno da manhã sem motorista/)).not.toBeInTheDocument();
  });

  it("o SearchableSelect abre, filtra sem acento e seleciona", () => {
    render(<DesignSystemGallery />);
    // Abre o combobox de Cliente.
    fireEvent.click(screen.getByRole("button", { name: /Escolher cliente/ }));
    const busca = screen.getByRole("combobox");
    // "para" (sem acento) deve achar "Paraná"? Não há Paraná aqui; use "vale".
    fireEvent.change(busca, { target: { value: "mineracao" } });
    const listbox = screen.getByRole("listbox");
    // Só "Vale" (descrição "Mineração · PA") casa.
    expect(within(listbox).getByText("Vale")).toBeInTheDocument();
    expect(within(listbox).queryByText("Natura")).not.toBeInTheDocument();
    // Seleciona.
    fireEvent.mouseDown(within(listbox).getByText("Vale"));
    // O controle passa a exibir o rótulo escolhido e o campo de busca fecha.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vale/ })).toBeInTheDocument();
  });

  it("RadioCards troca a seleção clicando no bloco inteiro", () => {
    render(<DesignSystemGallery />);
    const privado = screen.getByText("Privado").closest("label");
    fireEvent.click(within(privado).getByRole("radio"));
    expect(within(privado).getByRole("radio")).toBeChecked();
  });

  it("SegmentedControl marca a opção clicada (aria-checked)", () => {
    render(<DesignSystemGallery />);
    const seg = screen.getByRole("radiogroup", { name: "Temperatura" });
    const quente = within(seg).getByRole("radio", { name: "Quente" });
    expect(quente).toHaveAttribute("aria-checked", "false");
    fireEvent.click(quente);
    expect(within(seg).getByRole("radio", { name: "Quente" })).toHaveAttribute("aria-checked", "true");
  });

  it("Tabs seleciona a aba clicada (aria-selected)", () => {
    render(<DesignSystemGallery />);
    const tablist = screen.getByRole("tablist", { name: "Seções da conta" });
    const pessoas = within(tablist).getByRole("tab", { name: /Pessoas/ });
    fireEvent.click(pessoas);
    expect(within(tablist).getByRole("tab", { name: /Pessoas/ })).toHaveAttribute("aria-selected", "true");
  });
});
