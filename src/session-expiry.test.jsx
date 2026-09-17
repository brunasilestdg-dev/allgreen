// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-session-expiry",
  name: "Pessoa Teste",
  email: "pessoa-expiry@example.com",
};

function response(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

const seedLoggedIn = () => {
  localStorage.setItem("seu-funcionario-auth-token", "token-expiry");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(
    `seu-funcionario-v2:${user.id}`,
    JSON.stringify({
      user,
      updatedAt: "2026-01-01T00:00:00.000Z",
      preferences: {
        theme: "light",
        specialist: "Diretor",
        mode: "business",
        modeChosen: true,
      },
    }),
  );
};

describe("sincronização falha de forma visível, não silenciosa", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("avisa quando a sessão expira (401) e permite entrar novamente sem perder os dados locais", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (url === "/api/workspace" && options.method === "PUT")
        return response({ error: "Sua sessão expirou." }, 401);
      if (url === "/api/workspace")
        return response({
          data: {
            preferences: {
              theme: "light",
              specialist: "Diretor",
              mode: "business",
              modeChosen: true,
            },
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 1,
        });
      if (url === "/api/config") return response({ videoEnabled: false });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn();

    render(<App />);
    await waitFor(() =>
      expect(localStorage.getItem(`sf-workspace-revision:${user.id}`)).toBe(
        "1",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Modo escuro" }));

    const alertBox = await screen.findByRole(
      "alert",
      {},
      { timeout: 5_000 },
    );
    expect(alertBox).toHaveTextContent("Sua sessão expirou");
    expect(alertBox).toHaveTextContent("continuam salvas neste navegador");

    // Os dados editados continuam salvos localmente, mesmo com a sessão expirada.
    expect(
      JSON.parse(localStorage.getItem(`seu-funcionario-v2:${user.id}`))
        .preferences.theme,
    ).toBe("dark");

    fireEvent.click(
      screen.getByRole("button", { name: "Entrar novamente" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("seu-funcionario-auth-token")).toBeNull();
  });

  it("erro passageiro (429/5xx) na checagem de sessão não desloga quem já estava logado", async () => {
    // Um limite de tentativas por IP (ou um 500 passageiro) não prova que o
    // token é inválido — só um 401 explícito prova isso. Antes desta
    // checagem, qualquer resposta que não fosse 2xx derrubava a sessão na
    // hora, o que em produção significaria deslogar todo mundo atrás do
    // mesmo IP (escritório, rede móvel) assim que o limite de tentativas
    // fosse atingido por qualquer um deles.
    const fetchMock = vi.fn((url) => {
      if (url === "/api/auth/session") return response({ error: "Muitas tentativas." }, 429);
      if (url === "/api/workspace")
        return response({
          data: {
            preferences: {
              theme: "light",
              specialist: "Diretor",
              mode: "business",
              modeChosen: true,
            },
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 1,
        });
      if (url === "/api/config") return response({ videoEnabled: false });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn();

    render(<App />);
    await waitFor(() =>
      expect(localStorage.getItem(`sf-workspace-revision:${user.id}`)).toBe(
        "1",
      ),
    );

    // A tela continua sendo a do produto, não a de login — e o token some
    // apenas na resposta 401, não num 429.
    expect(screen.queryByRole("heading", { name: "Entre no ambiente To Do Green" })).not.toBeInTheDocument();
    expect(localStorage.getItem("seu-funcionario-auth-token")).toBe("token-expiry");
  });

  it("avisa sobre falha de sincronização (erro de servidor) e permite tentar de novo", async () => {
    let putShouldFail = true;
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (url === "/api/workspace" && options.method === "PUT") {
        if (putShouldFail) return response({ error: "Falha interna" }, 500);
        return response({ ok: true, revision: 2 });
      }
      if (url === "/api/workspace")
        return response({
          data: {
            preferences: {
              theme: "light",
              specialist: "Diretor",
              mode: "business",
              modeChosen: true,
            },
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 1,
        });
      if (url === "/api/config") return response({ videoEnabled: false });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn();

    render(<App />);
    await waitFor(() =>
      expect(localStorage.getItem(`sf-workspace-revision:${user.id}`)).toBe(
        "1",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Modo escuro" }));

    const alertBox = await screen.findByRole(
      "alert",
      {},
      { timeout: 5_000 },
    );
    expect(alertBox).toHaveTextContent("Suas alterações não foram salvas");

    putShouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar agora" }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
