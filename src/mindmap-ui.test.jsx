// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-mm", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-mm-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = () => ({
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
  taxProfile: { isMEI: false, dueDay: 20, cnpj: "", dasHistory: {} },
  documents: [],
  presentations: [],
  contentPlan: [],
  sheets: [],
  analyses: [],
  brainstorms: [],
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
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const mapJson = JSON.stringify({
  title: "Atrair clientes",
  branches: [
    { title: "Redes sociais", ideas: ["Postar todo dia", "Fazer reels"] },
    { title: "Indicações", ideas: ["Programa de indicação"] },
  ],
});

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-mm");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Mapa de ideias", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (url === "/api/ai") return response({ content: mapJson });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("gera um mapa por IA e transforma uma ideia em tarefa", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Mapa de ideias" }));
    await screen.findByRole("heading", { name: "Mapa de ideias" });

    const theme = screen.getByPlaceholderText(/primeiros 10 clientes/i);
    fireEvent.change(theme, { target: { value: "Como atrair clientes" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar mapa de ideias/ }));

    // Os ramos e ideias aparecem editáveis.
    expect(await screen.findByDisplayValue("Redes sociais")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Postar todo dia")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Programa de indicação")).toBeInTheDocument();

    // Virar uma ideia em tarefa (primeira ideia do primeiro ramo).
    fireEvent.click(screen.getAllByTitle("Virar tarefa")[0]);
    // Ir para Operação (item do menu lateral) e conferir a tarefa criada.
    fireEvent.click(screen.getAllByRole("button", { name: "Operação" })[0]);
    expect(await screen.findByText("Postar todo dia")).toBeInTheDocument();
  });
});
