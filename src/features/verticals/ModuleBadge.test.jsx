/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ModuleBadge, {
  ALL_GREEN_MODULES,
  moduleByKey,
  moduleByNumber,
} from "./ModuleBadge.jsx";

describe("catálogo dos 9 módulos All Green", () => {
  it("expõe exatamente os 9 blocos do material institucional na ordem correta", () => {
    expect(ALL_GREEN_MODULES.map((m) => m.number)).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09",
    ]);
    expect(ALL_GREEN_MODULES.find((m) => m.number === "05").name).toContain("Green On");
    expect(ALL_GREEN_MODULES.find((m) => m.number === "07").name).toContain("GreenPay");
  });

  it("busca por número aceita 5 e '05', devolve o mesmo módulo", () => {
    expect(moduleByNumber(5)).toBe(moduleByNumber("05"));
    expect(moduleByNumber(999)).toBeNull();
  });

  it("busca por chave é útil para as verticais que já usam a chave interna", () => {
    expect(moduleByKey("charging").number).toBe("05");
    expect(moduleByKey("fleet").number).toBe("02");
    expect(moduleByKey("desconhecido")).toBeNull();
  });
});

describe("ModuleBadge", () => {
  it("renderiza o número e o nome curto do módulo", () => {
    render(<ModuleBadge number="05" />);
    expect(screen.getByText("05")).toBeInTheDocument();
    expect(screen.getByText("Recarga")).toBeInTheDocument();
  });

  it("quando recebe href vira um link acessível para a tela inicial", () => {
    render(<ModuleBadge number="05" href="/greenon" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/greenon");
    expect(link).toHaveAttribute("aria-label", expect.stringContaining("Voltar à tela inicial"));
  });

  it("não renderiza nada se o módulo não existir", () => {
    const { container } = render(<ModuleBadge number="42" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("aceita omitir o título e ainda mostrar o disco numerado", () => {
    render(<ModuleBadge number="04" showTitle={false} />);
    expect(screen.getByText("04")).toBeInTheDocument();
    expect(screen.queryByText("Operação")).toBeNull();
  });
});
