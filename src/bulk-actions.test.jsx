// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-bulk",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-bulk-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-bulk");
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

const makeTask = (id, title) => ({
  id,
  title,
  status: "A fazer",
  priority: "Média",
  due: "",
  area: "Operação",
  businessId: business.id,
  ownerId: user.id,
  assignee: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("ações em lote em tarefas", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("seleciona várias tarefas e arquiva todas de uma vez", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          makeTask("task-b1", "Tarefa Um"),
          makeTask("task-b2", "Tarefa Dois"),
          makeTask("task-b3", "Tarefa Três"),
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa Um");

    fireEvent.click(screen.getByLabelText('Selecionar "Tarefa Um"'));
    fireEvent.click(screen.getByLabelText('Selecionar "Tarefa Dois"'));

    expect(screen.getByText("2 selecionada(s)")).toBeInTheDocument();
    const bulkBar = screen.getByText("2 selecionada(s)").closest(".bulk-bar");
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Arquivar" }));

    expect(await screen.findByText(/2 tarefa\(s\) arquivada\(s\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar arquivamento"), {
      target: { value: "Todas" },
    });
    const archivedRow = screen.getByText("Tarefa Um").closest("article");
    expect(within(archivedRow).getByLabelText('Selecionar "Tarefa Um"')).not.toBeChecked();
  });

  it("reatribui as tarefas selecionadas para outra pessoa", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [makeTask("task-b4", "Tarefa Quatro"), makeTask("task-b5", "Tarefa Cinco")],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa Quatro");

    fireEvent.click(screen.getByLabelText('Selecionar "Tarefa Quatro"'));
    fireEvent.click(screen.getByLabelText('Selecionar "Tarefa Cinco"'));
    fireEvent.change(
      screen.getByLabelText("Reatribuir selecionadas para"),
      { target: { value: "Carlos Souza" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(
      await screen.findByText(/2 tarefa\(s\) reatribuída\(s\) para Carlos Souza/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Carlos Souza/).length).toBeGreaterThanOrEqual(2);
  });

  it("marca 'selecionar todas' e limpa a seleção", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [makeTask("task-b6", "Tarefa Seis"), makeTask("task-b7", "Tarefa Sete")],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa Seis");

    fireEvent.click(
      screen.getByLabelText("Selecionar todas as tarefas visíveis"),
    );
    expect(screen.getByText("2 selecionada(s)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.getByText("Selecionar todas")).toBeInTheDocument();
  });
});
