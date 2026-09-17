// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("acesso à conta", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("abre primeiro na página de login e entra com uma conta existente", async () => {
    const fetchMock = vi.fn(() =>
      response({
        token: "session-token",
        user: { id: "user-1", name: "Bruna", email: "bruna@example.com" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "BRUNA@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "senha-segura" },
    });
    fireEvent.submit(
      screen
        .getByRole("heading", { name: "Entre no ambiente To Do Green" })
        .closest(".auth-card")
        .querySelector("form"),
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/todogreen"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem("seu-funcionario-auth-token")).toBe(
      "session-token",
    );
  });

  it("permite alternar para criação de conta no acesso geral", async () => {
    history.replaceState({}, "", "/acesso-geral");
    const fetchMock = vi.fn(() =>
      response({
        token: "new-session-token",
        user: { id: "user-2", name: "Maria Silva", email: "maria@example.com" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    expect(
      screen.getByRole("heading", { name: "Crie seu espaço de trabalho" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Seu nome"), {
      target: { value: "Maria Silva" },
    });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "maria@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Senha/), {
      target: { value: "outra-senha-segura" },
    });
    fireEvent.submit(
      screen
        .getByRole("heading", { name: "Crie seu espaço de trabalho" })
        .closest(".auth-card")
        .querySelector("form"),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Para administrar meu negócio",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Onde seu negócio está hoje?" }),
    ).toBeInTheDocument();
  });
});
