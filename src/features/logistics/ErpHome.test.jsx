/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
