// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-deps",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-deps-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-deps");
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

describe("tarefas que dependem de outras", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cria uma tarefa dependente de outra e bloqueia marcar como concluída antes da hora", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-base",
            title: "Aprovar orçamento",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Contratar fornecedor" },
    });
    fireEvent.click(
      within(dialog).getByLabelText("Aprovar orçamento (A fazer)"),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Bloqueada");

    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[0]);
    let editDialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    fireEvent.change(within(editDialog).getByLabelText("Status"), {
      target: { value: "Concluído" },
    });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Salvar alterações" }),
    );

    expect(
      within(
        screen.getByText("Contratar fornecedor").closest("article"),
      ).getByDisplayValue("A fazer"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[1]);
    editDialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    fireEvent.change(within(editDialog).getByLabelText("Status"), {
      target: { value: "Concluído" },
    });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Salvar alterações" }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[0]);
    editDialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    fireEvent.change(within(editDialog).getByLabelText("Status"), {
      target: { value: "Concluído" },
    });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Salvar alterações" }),
    );

    expect(
      within(
        screen.getByText("Contratar fornecedor").closest("article"),
      ).getByDisplayValue("Concluído"),
    ).toBeInTheDocument();
  });
});
