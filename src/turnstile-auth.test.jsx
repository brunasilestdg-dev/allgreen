// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const resposta = (dados) => Promise.resolve({ ok: true, json: () => Promise.resolve(dados) });

// A API do widget, no lugar do script da Cloudflare: entrega um token logo
// depois de desenhado, como o modo gerenciado faz com quem não é robô.
const widgetFalso = () => ({
  render: vi.fn((_caixa, opcoes) => {
    setTimeout(() => opcoes.callback("token-do-widget"), 0);
    return "widget-1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
});

describe("Turnstile na tela de entrada", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.turnstile;
  });

  it("com a chave pública no /api/config, o login leva o token do widget", async () => {
    window.turnstile = widgetFalso();
    // Senha errada: a tela continua aberta e o widget precisa de outro token.
    const fetchMock = vi.fn((url) =>
      url === "/api/config"
        ? resposta({ turnstileSiteKey: "1x00000000000000000000AA" })
        : Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "E-mail ou senha incorretos." }),
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled());
    const [, opcoes] = window.turnstile.render.mock.calls[0];
    expect(opcoes).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "entrada",
      language: "pt-br",
      appearance: "interaction-only",
    });

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "renata@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.submit(screen.getByLabelText("E-mail").closest("form"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" })),
    );
    const login = fetchMock.mock.calls.find(([url]) => url === "/api/auth/login");
    expect(JSON.parse(login[1].body)).toMatchObject({
      email: "renata@example.com",
      turnstileToken: "token-do-widget",
    });
    expect(await screen.findByText("E-mail ou senha incorretos.")).toBeInTheDocument();
    // Token vale uma vez: depois do envio, o widget é renovado.
    await waitFor(() => expect(window.turnstile.reset).toHaveBeenCalledWith("widget-1"));
  });

  it("sem chave no servidor, nada é carregado e o login segue como antes", async () => {
    window.turnstile = widgetFalso();
    const fetchMock = vi.fn(() =>
      resposta({
        token: "session-token",
        user: { id: "user-2", name: "Maria", email: "maria@example.com" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "maria@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.submit(screen.getByLabelText("E-mail").closest("form"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" })),
    );
    expect(window.turnstile.render).not.toHaveBeenCalled();
    const login = fetchMock.mock.calls.find(([url]) => url === "/api/auth/login");
    expect(JSON.parse(login[1].body).turnstileToken).toBe("");
  });
});
