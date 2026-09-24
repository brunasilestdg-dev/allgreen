// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-legal",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-legal-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  contacts: [],
  timeEntries: [],
  transactions: [],
  financeSettings: {},
  documents: [],
  sites: [],
  history: [],
  certificates: [],
  conversations: [],
  media: [],
  emailDrafts: [],
  customSpecialists: [],
  pluggedTools: [],
  selectedConversationId: null,
  journeys: {},
  preferences: {
    theme: "light",
    specialist: "Diretor",
    mode: "business",
    modeChosen: true,
  },
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-legal");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("termos de uso, política de privacidade e exclusão de conta", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mostra os Termos de Uso e Política de Privacidade a partir da tela de login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Termos de Uso e Política de Privacidade",
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Termos de Uso e Política de Privacidade",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lei Geral de Proteção de Dados/)).toBeInTheDocument();
  });

  it("abre a página de termos a partir de Configurações e volta para a conta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Termos de Uso e Política de Privacidade",
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Termos de Uso e Política de Privacidade",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Voltar para Configurações" }),
    );
    expect(
      screen.getByRole("heading", { name: "Seu espaço, do seu jeito" }),
    ).toBeInTheDocument();
  });

  it("exclusão de conta exige digitar EXCLUIR e encerra a sessão ao confirmar", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/auth/account" && options.method === "DELETE")
        return response({ ok: true });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Excluir minha conta" }),
    );
    const confirmButton = screen.getByRole("button", {
      name: "Excluir permanentemente",
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Para confirmar, digite "EXCLUIR"'), {
      target: { value: "EXCLUIR" },
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/account",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(localStorage.getItem("seu-funcionario-auth-token")).toBeNull();
    expect(
      localStorage.getItem(`seu-funcionario-v2:${user.id}`),
    ).toBeNull();
  });
});
