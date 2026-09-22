// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { nextRecurrenceDue } from "./App";

describe("nextRecurrenceDue (função pura)", () => {
  it("avança um dia para tarefas diárias, virando o mês quando necessário", () => {
    expect(nextRecurrenceDue("2026-07-31", "daily")).toBe("2026-08-01");
  });

  it("avança uma semana para tarefas semanais", () => {
    expect(nextRecurrenceDue("2026-07-18", "weekly")).toBe("2026-07-25");
  });

  it("avança um mês para tarefas mensais, virando o ano quando necessário", () => {
    expect(nextRecurrenceDue("2026-12-20", "monthly")).toBe("2027-01-20");
  });

  it("retorna a mesma data quando a frequência não é reconhecida", () => {
    expect(nextRecurrenceDue("2026-07-18", "none")).toBe("2026-07-18");
  });

  it("retorna vazio quando não há data de prazo", () => {
    expect(nextRecurrenceDue("", "weekly")).toBe("");
  });
});

const user = {
  id: "user-recurring",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-recurring-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-recurring");
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

describe("tarefas recorrentes na interface", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cria a próxima ocorrência ao concluir uma tarefa semanal", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-rec-1",
            title: "Enviar relatório semanal",
            status: "A fazer",
            priority: "Média",
            due: "2026-07-18",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            recurrence: { frequency: "weekly" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Enviar relatório semanal");

    fireEvent.change(screen.getByDisplayValue("A fazer"), {
      target: { value: "Concluído" },
    });

    expect(await screen.findByText(/próxima ocorrência criada/i)).toBeInTheDocument();
    const cards = await screen.findAllByText("Enviar relatório semanal");
    expect(cards).toHaveLength(2);

    const doneSelect = screen.getByDisplayValue("Concluído");
    expect(
      within(doneSelect.closest("article")).getByText(
        "Enviar relatório semanal",
      ),
    ).toBeInTheDocument();
  });

  it("não cria nova ocorrência ao concluir uma tarefa sem recorrência", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-rec-2",
            title: "Tarefa avulsa",
            status: "A fazer",
            priority: "Média",
            due: "2026-07-18",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            recurrence: { frequency: "none" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Tarefa avulsa");

    fireEvent.change(screen.getByDisplayValue("A fazer"), {
      target: { value: "Concluído" },
    });

    await screen.findByDisplayValue("Concluído");
    expect(screen.getAllByText("Tarefa avulsa")).toHaveLength(1);
  });

  it("permite escolher a repetição ao criar uma tarefa", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Fechar caixa" },
    });
    fireEvent.change(within(dialog).getByLabelText("Repetir"), {
      target: { value: "monthly" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );

    await screen.findByText("Fechar caixa");
    expect(screen.getByTitle("Todo mês")).toBeInTheDocument();
  });

  it("mostra que a tarefa faz parte de uma série e permite cancelar a recorrência", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    let dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Regar as plantas" },
    });
    fireEvent.change(within(dialog).getByLabelText("Repetir"), {
      target: { value: "daily" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );
    await screen.findByText("Regar as plantas");

    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    expect(
      within(dialog).getByText(/Parte de uma série recorrente \(1 no total\)/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancelar recorrência" }),
    );
    expect(within(dialog).getByLabelText("Repetir")).toHaveValue("none");
    expect(
      within(dialog).queryByText(/Parte de uma série recorrente/),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar alterações" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    fireEvent.change(screen.getByDisplayValue("A fazer"), {
      target: { value: "Concluído" },
    });
    await screen.findByDisplayValue("Concluído");
    expect(screen.getAllByText("Regar as plantas")).toHaveLength(1);
  });

  it("mantém o vínculo de série entre as ocorrências ao concluir uma tarefa recorrente", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-series-1",
            title: "Backup do sistema",
            status: "A fazer",
            priority: "Média",
            due: "2026-07-18",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            recurrence: { frequency: "weekly", seriesId: "serie-backup" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await screen.findByText("Backup do sistema");

    fireEvent.change(screen.getByDisplayValue("A fazer"), {
      target: { value: "Concluído" },
    });
    await screen.findByText(/próxima ocorrência criada/i);

    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    expect(
      within(dialog).getByText(/Parte de uma série recorrente \(2 no total\)/),
    ).toBeInTheDocument();
  });
});
