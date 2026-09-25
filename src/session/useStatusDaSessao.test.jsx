/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusInicialDaSessao, useStatusDaSessao } from "./useStatusDaSessao.js";

// O usuário salvo no navegador nunca é prova de sessão: só o Worker decide.
// E só 401 derruba a sessão — 429/5xx/rede fora não provam nada sobre o token.

const TOKEN_KEY = "seu-funcionario-auth-token";
const ACTIVE_KEY = "seu-funcionario-active-user";
const resposta = (status, data = {}) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOKEN_KEY, "tok");
  localStorage.setItem(ACTIVE_KEY, "u1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("status da sessão", () => {
  it("começa conferindo quando há token e usuário, e anônimo sem um deles", () => {
    expect(statusInicialDaSessao("u1")).toBe("checking");
    expect(statusInicialDaSessao(undefined)).toBe("anonymous");
    localStorage.removeItem(TOKEN_KEY);
    expect(statusInicialDaSessao("u1")).toBe("anonymous");
  });

  it("sessão confirmada abre o produto com o usuário que o servidor devolveu", async () => {
    const fetchMock = vi.fn(() => resposta(200, { user: { id: "u1", name: "Ana (servidor)" } }));
    vi.stubGlobal("fetch", fetchMock);
    const setDb = vi.fn();
    const { result } = renderHook(() => useStatusDaSessao("u1", setDb));
    await waitFor(() => expect(result.current.sessionStatus).toBe("authenticated"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", { headers: { authorization: "Bearer tok" } });
    expect(setDb.mock.calls[0][0]({ user: { id: "u1", name: "Ana" }, tasks: [1] })).toEqual({
      user: { id: "u1", name: "Ana (servidor)" },
      tasks: [1],
    });
  });

  it("401 limpa token, usuário ativo e o banco local", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resposta(401, { error: "Sessão expirada." })));
    const setDb = vi.fn();
    const { result } = renderHook(() => useStatusDaSessao("u1", setDb));
    await waitFor(() => expect(result.current.sessionStatus).toBe("anonymous"));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    expect(setDb).toHaveBeenCalledWith(expect.objectContaining({ user: null }));
  });

  it("429, 5xx e rede fora não derrubam o token (só não abrem o produto)", async () => {
    for (const falha of [() => resposta(429), () => resposta(503), () => Promise.reject(new TypeError("Failed to fetch"))]) {
      localStorage.setItem(TOKEN_KEY, "tok");
      vi.stubGlobal("fetch", vi.fn(falha));
      const setDb = vi.fn();
      const { result, unmount } = renderHook(() => useStatusDaSessao("u1", setDb));
      await waitFor(() => expect(result.current.sessionStatus).toBe("anonymous"));
      expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
      expect(setDb).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("sem usuário não consulta o servidor", async () => {
    const fetchMock = vi.fn(() => resposta(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStatusDaSessao(undefined, vi.fn()));
    expect(result.current.sessionStatus).toBe("anonymous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("login recém-feito marca a sessão sem esperar a revalidação", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    // Identidade nova do setter a cada render não pode reabrir a conferência.
    const { result } = renderHook(() => useStatusDaSessao("u1", vi.fn()));
    expect(result.current.sessionStatus).toBe("checking");
    act(() => result.current.markSessionAuthenticated());
    expect(result.current.sessionStatus).toBe("authenticated");
  });
});
