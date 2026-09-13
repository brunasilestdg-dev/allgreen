/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RouteErrorBoundary from "./RouteErrorBoundary.jsx";

const Explode = ({ erro }) => { if (erro) throw erro; return <p>tela viva</p>; };

describe("falha contida na tela", () => {
  afterEach(cleanup);

  it("mostra o aviso da tela sem derrubar o que está em volta", () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <nav>menu do app</nav>
        <RouteErrorBoundary chave="todogreen"><Explode erro={new Error("quebrou")} /></RouteErrorBoundary>
      </div>,
    );
    expect(screen.getByText("Esta tela não abriu")).toBeInTheDocument();
    // O resto do app continua montado — era isto que a proteção só na raiz
    // destruía: qualquer erro virava tela cheia de "Algo deu errado".
    expect(screen.getByText("menu do app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    aviso.mockRestore();
  });

  it("'Tentar de novo' volta a renderizar a tela", () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <RouteErrorBoundary chave="todogreen"><Explode erro={new Error("quebrou")} /></RouteErrorBoundary>,
    );
    rerender(<RouteErrorBoundary chave="todogreen"><Explode erro={null} /></RouteErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(screen.getByText("tela viva")).toBeInTheDocument();
    aviso.mockRestore();
  });

  it("erro de versão trocada NÃO para aqui: sobe para a recuperação da raiz", () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    // Este erro tem uma cura própria (recarregar uma vez na versão nova). Contê-lo
    // numa tela deixaria a pessoa presa num aviso que "Tentar de novo" não resolve.
    expect(() => render(
      <RouteErrorBoundary chave="todogreen">
        <Explode erro={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
      </RouteErrorBoundary>,
    )).toThrow(/dynamically imported module/);
    aviso.mockRestore();
  });
});
