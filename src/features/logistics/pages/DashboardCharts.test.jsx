/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import WidgetChart from "./DashboardCharts.jsx";

const data = {
  financial: [
    { tipo: "revenue", valor: 1000, mesReferencia: "2026-06", clientId: "c1" },
    { tipo: "revenue", valor: 2000, mesReferencia: "2026-07", clientId: "c2" },
  ],
  opportunities: [{ estagio: "Mapeamento" }, { estagio: "Proposta" }, { estagio: "Mapeamento" }],
};

describe("WidgetChart escolhe o desenho pelo tipo", () => {
  it("barras desenham colunas, não um número solto", () => {
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "bar" }} data={data} valorEscalar={3000} />);
    expect(container.querySelectorAll(".tdgc-bar").length).toBe(2);
  });

  it("evolução desenha uma linha (polyline) quando há dois ou mais pontos", () => {
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "line" }} data={data} valorEscalar={3000} />);
    expect(container.querySelector("polyline.tdgc-stroke")).toBeTruthy();
  });

  it("distribuição desenha a rosca em SVG, com total no centro e legenda por estágio", () => {
    const { container } = render(<WidgetChart widget={{ metric: "pipeline", type: "donut" }} data={data} valorEscalar={3} />);
    // Anel em SVG (arcos), não mais conic-gradient chapado.
    expect(container.querySelectorAll("svg.tdgc-donut2-svg .tdgc-donut2-arco").length).toBe(2);
    // O buraco deixou de ser vazio: mostra o total.
    expect(container.querySelector(".tdgc-donut2-centro strong")).toBeTruthy();
    expect(container.querySelectorAll(".tdgc-legend li").length).toBe(2);
  });

  it("tabela lista rótulo e valor", () => {
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "table" }} data={data} valorEscalar={3000} />);
    expect(container.querySelectorAll(".tdgc-table tr").length).toBe(2);
  });

  it("número mostra o valor do resumo", () => {
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "metric" }} data={data} valorEscalar={3000} />);
    expect(container.querySelector(".tdgc-metric")).toBeTruthy();
  });

  it("indicador sem dados não quebra: mostra estado vazio", () => {
    const { container, getByText } = render(<WidgetChart widget={{ metric: "receita", type: "bar" }} data={{}} valorEscalar={0} />);
    expect(container.querySelectorAll(".tdgc-bar").length).toBe(0);
    expect(getByText(/sem dados ainda/i)).toBeTruthy();
  });

  it("sem onSelecionar, a barra não é botão (não clicável)", () => {
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "bar" }} data={data} valorEscalar={3000} />);
    expect(container.querySelector("button.tdgc-bar-col")).toBeNull();
  });

  it("com onSelecionar, clicar numa barra devolve o item tocado", () => {
    const aoSelecionar = vi.fn();
    const { container } = render(<WidgetChart widget={{ metric: "receita", type: "bar" }} data={data} valorEscalar={3000} onSelecionar={aoSelecionar} />);
    const botoes = container.querySelectorAll("button.tdgc-bar-col");
    expect(botoes.length).toBe(2);
    fireEvent.click(botoes[0]);
    expect(aoSelecionar).toHaveBeenCalledTimes(1);
    expect(aoSelecionar.mock.calls[0][0]).toHaveProperty("valor");
  });

  it("com onSelecionar, a legenda da rosca vira botão clicável", () => {
    const aoSelecionar = vi.fn();
    const { container } = render(<WidgetChart widget={{ metric: "pipeline", type: "donut" }} data={data} valorEscalar={3} onSelecionar={aoSelecionar} />);
    const botoes = container.querySelectorAll("button.tdgc-legend-btn");
    expect(botoes.length).toBe(2);
    fireEvent.click(botoes[0]);
    expect(aoSelecionar).toHaveBeenCalledTimes(1);
  });
});
