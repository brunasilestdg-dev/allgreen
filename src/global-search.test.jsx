// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-search",
  name: "Renata Silva",
  email: "renata@example.com",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: null,
  businesses: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-search");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("busca global", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it("abre a busca, filtra por texto (sem acento) e navega até a seção", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Buscar em tudo" }));
    const dialog = await screen.findByRole("dialog", { name: "Buscar em tudo" });
    const input = dialog.querySelector("input");
    fireEvent.change(input, { target: { value: "estudio" } });

    const match = await within(dialog).findByRole("button", {
      name: "Estúdio de IA",
    });
    fireEvent.click(match);

    await screen.findByRole("heading", {
      name: "Crie materiais visuais com IA",
    });
    expect(
      screen.queryByRole("dialog", { name: "Buscar em tudo" }),
    ).not.toBeInTheDocument();
  });

  it("busca dados reais (tarefas) e navega até a tela com o filtro já aplicado", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-x",
            title: "Preparar proposta para Ana Souza",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "task-y",
            title: "Organizar estoque",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Buscar em tudo" }));
    const dialog = await screen.findByRole("dialog", { name: "Buscar em tudo" });
    const input = dialog.querySelector("input");
    fireEvent.change(input, { target: { value: "Ana Souza" } });

    within(dialog).getByText("Resultados");
    const match = await within(dialog).findByRole("button", {
      name: /Preparar proposta para Ana Souza/,
    });
    fireEvent.click(match);

    await screen.findByText("Preparar proposta para Ana Souza");
    expect(screen.queryByText("Organizar estoque")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Pesquisar tarefas")).toHaveValue(
      "Preparar proposta para Ana Souza",
    );
  });

  it("abre a busca com o atalho Ctrl+K", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Buscar em tudo" }),
    ).toBeInTheDocument();
  });
});
