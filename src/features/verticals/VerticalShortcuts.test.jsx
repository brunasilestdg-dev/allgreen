// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VerticalShortcuts from "./VerticalShortcuts.jsx";

const comSessao = () => ({ authorization: "Bearer teste" });
const resposta = (status, corpo) =>
  Promise.resolve(new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  }));

describe("atalhos de ambiente no menu do app geral", () => {
  let navigate;
  beforeEach(() => {
    localStorage.clear();
    navigate = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("com vínculo confirmado, leva às três verticais", async () => {
    localStorage.setItem("sf-space", "dona-1");
    const rede = vi.fn(() => resposta(200, { role: "vendedor", permissions: ["read"] }));
    vi.stubGlobal("fetch", rede);
    render(<VerticalShortcuts authHeaders={comSessao} navigate={navigate} />);
    const grupo = await screen.findByRole("group", { name: "Outros ambientes" });
    expect(grupo).toHaveTextContent("AMBIENTES");
    expect(rede).toHaveBeenCalledWith(
      "/api/todogreen/access?owner=dona-1",
      expect.objectContaining({ headers: comSessao() }),
    );
    for (const nome of ["To Do Green", "Green On", "Greenmob"])
      expect(screen.getByRole("button", { name: nome })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "To Do Green" }));
    expect(navigate).toHaveBeenCalledWith("/todogreen");
  });

  it("motorista vê o próprio portal, não o ERP", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resposta(200, { role: "motorista" })));
    render(<VerticalShortcuts authHeaders={comSessao} navigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Portal do motorista" }));
    expect(navigate).toHaveBeenCalledWith("/portal-motorista");
    expect(screen.queryByRole("button", { name: "To Do Green" })).toBeNull();
  });

  it("sem vínculo, o menu fica como era", async () => {
    const rede = vi.fn(() => resposta(403, { error: "Você não tem acesso à To Do Green." }));
    vi.stubGlobal("fetch", rede);
    const { container } = render(<VerticalShortcuts authHeaders={comSessao} navigate={navigate} />);
    await waitFor(() => expect(rede).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("sem sessão nem pergunta ao servidor; rede fora não quebra a tela", async () => {
    const rede = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", rede);
    const { container, unmount } = render(<VerticalShortcuts authHeaders={() => ({})} />);
    expect(rede).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    unmount();

    render(<VerticalShortcuts authHeaders={comSessao} navigate={navigate} />);
    await waitFor(() => expect(rede).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Outros ambientes" })).toBeNull();
  });

  it("no menu compacto, o nome fica na dica do botão", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resposta(200, { role: "admin" })));
    render(<VerticalShortcuts authHeaders={comSessao} collapsed />);
    const botao = await screen.findByRole("button", { name: "Green On" });
    expect(botao).toHaveAttribute("title", "Green On");
    expect(screen.queryByText("AMBIENTES")).toBeNull();
  });
});
