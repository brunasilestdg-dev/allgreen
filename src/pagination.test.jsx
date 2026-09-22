// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-page",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-page-1",
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
  deliveryZones: [],
  vehicles: [],
  trips: [],
  developmentPlans: [],
  notifications: [],
  teams: [],
  projects: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-page");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      return response({});
    }),
  );

const makeTask = (i) => ({
  id: `task-page-${i}`,
  title: `Tarefa número ${String(i).padStart(2, "0")}`,
  status: "A fazer",
  priority: "Média",
  due: "",
  area: "Operação",
  businessId: business.id,
  ownerId: user.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("paginação em listas longas", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mostra só as 30 primeiras tarefas na Lista e carrega o resto ao clicar em Carregar mais", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: Array.from({ length: 35 }, (_, i) => makeTask(i + 1)),
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa número 01");

    expect(screen.getAllByRole("article")).toHaveLength(30);
    expect(screen.queryByText("Tarefa número 35")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Carregar mais (5 restantes)" }),
    );

    expect(await screen.findByText("Tarefa número 35")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(35);
    expect(
      screen.queryByRole("button", { name: /Carregar mais/ }),
    ).not.toBeInTheDocument();
  });

  it("reseta a paginação ao filtrar por texto", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: Array.from({ length: 35 }, (_, i) => makeTask(i + 1)),
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa número 01");

    fireEvent.change(screen.getByPlaceholderText("Pesquisar tarefas"), {
      target: { value: "número 35" },
    });

    const results = await screen.findAllByRole("article");
    expect(results).toHaveLength(1);
    expect(within(results[0]).getByText("Tarefa número 35")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Carregar mais/ }),
    ).not.toBeInTheDocument();
  });
});
