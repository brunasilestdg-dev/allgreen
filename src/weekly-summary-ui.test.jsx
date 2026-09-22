// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-ws", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-ws-1",
  name: "Ateliê",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = () => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [
    { id: "k1", title: "Feita", status: "Concluído", updatedAt: "2026-07-15T09:00:00Z", businessId: business.id, reward: 50 },
  ],
  leads: [
    { id: "l1", name: "Novo", createdAt: "2026-07-14T09:00:00Z", businessId: business.id, status: "Novo" },
  ],
  appointments: [],
  products: [],
  orders: [
    { id: "o1", status: "Entregue", total: 120, createdAt: "2026-07-15T10:00:00Z", businessId: business.id },
  ],
  contacts: [],
  timeEntries: [],
  transactions: [
    { id: "t1", type: "Receita", value: 200, date: "2026-07-16", businessId: business.id },
  ],
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
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-ws");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("card 'Sua semana' no Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    // Congela a data numa quarta-feira: semana 13–19/07/2026.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (String(url).startsWith("/api/collab"))
          return response({ members: [], invites: [], spaces: [] });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mostra vendas, caixa, tarefas e contatos da semana atual", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    const card = document.getElementById("week-summary");
    expect(card).toBeInTheDocument();
    expect(within(card).getByText("Resumo de 13/07 a 19/07")).toBeInTheDocument();

    // Vendas: 1 pedido de R$ 120,00
    expect(within(card).getByText("Vendas")).toBeInTheDocument();
    expect(within(card).getByText("R$ 120,00")).toBeInTheDocument();
    // Entrou em caixa: R$ 200,00
    expect(within(card).getByText("R$ 200,00")).toBeInTheDocument();
    // Tarefas concluídas mostram também o valor (recompensa) somado
    expect(within(card).getByText("Tarefas concluídas")).toBeInTheDocument();
    expect(within(card).getByText("R$ 50,00")).toBeInTheDocument();
    expect(within(card).getByText("Novos contatos")).toBeInTheDocument();
  });

  it("mostra um estado vazio convidativo em vez de zeros quando a semana não tem movimento", async () => {
    const db = businessDb();
    db.tasks = [];
    db.leads = [];
    db.orders = [];
    db.transactions = [];
    seedLoggedIn(db);
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    const card = document.getElementById("week-summary");
    expect(card).toBeInTheDocument();
    expect(
      within(card).getByText(/Sem movimento registrado nesta semana/),
    ).toBeInTheDocument();
    // Nenhuma parede de zeros: os cartões de métrica não são renderizados.
    expect(within(card).queryByText("Vendas")).not.toBeInTheDocument();
  });
});
