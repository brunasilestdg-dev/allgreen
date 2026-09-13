/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRoutePath } from "./useRoutePath.js";
import { resolvePrimaryRoute } from "./PrimaryAppRouter.jsx";

// O app escolhe o portal a montar com `resolvePrimaryRoute(rota)`. Se a rota
// não for reativa, trocar de URL por pushState (o que "Abrir Torre TMS" faz)
// muda o endereço e deixa a tela anterior montada — só o F5 resolvia.
function Portal() {
  const rota = useRoutePath();
  return <span>portal: {resolvePrimaryRoute(rota, true).kind}</span>;
}

const navegar = (rota) => act(() => {
  window.history.pushState({}, "", rota);
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("rota reativa do app", () => {
  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("troca o portal montado quando a navegação interna troca a URL", () => {
    window.history.replaceState({}, "", "/todogreen");
    render(<Portal />);
    expect(screen.getByText("portal: todogreen")).toBeInTheDocument();

    navegar("/portal-tms");
    expect(screen.getByText("portal: tms-portal")).toBeInTheDocument();

    navegar("/todogreen/clientes");
    expect(screen.getByText("portal: todogreen")).toBeInTheDocument();
  });

  it("acompanha voltar e avançar do navegador", () => {
    window.history.replaceState({}, "", "/todogreen");
    render(<Portal />);
    navegar("/portal-cliente");
    expect(screen.getByText("portal: customer-portal")).toBeInTheDocument();
    act(() => { window.history.back(); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByText(/^portal:/)).toBeInTheDocument();
  });

  it("filtro na query não remonta o portal (cada tela cuida da própria busca)", () => {
    window.history.replaceState({}, "", "/todogreen/clientes");
    render(<Portal />);
    navegar("/todogreen/clientes?filtro=acao-atrasada");
    expect(screen.getByText("portal: todogreen")).toBeInTheDocument();
  });
});
