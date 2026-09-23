// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-pt",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-pt-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-pt");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("projetos, equipes e subtarefas", () => {
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

  it("cria um projeto antes de qualquer tarefa em Operação", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Gerenciar projetos" }),
    );
    fireEvent.change(screen.getByLabelText("Nome do projeto"), {
      target: { value: "Lançamento de julho" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(
      (await screen.findAllByText("Lançamento de julho")).length,
    ).toBeGreaterThan(0);
  });

  it("adiciona e conclui subtarefas dentro de uma missão", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Planejar campanha" },
    });
    fireEvent.click(
      within(dialog).getByLabelText(
        "Tratar como missão (vagas, pontos, recompensa, subtarefas e entregas)",
      ),
    );
    fireEvent.change(within(dialog).getByLabelText("Nova subtarefa"), {
      target: { value: "Definir orçamento" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    fireEvent.change(within(dialog).getByLabelText("Nova subtarefa"), {
      target: { value: "Escolher canais" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));

    expect(within(dialog).getByText("Definir orçamento")).toBeInTheDocument();
    expect(within(dialog).getByText("Escolher canais")).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Definir orçamento" }),
    );
    expect(
      within(dialog).getByText("Definir orçamento").className,
    ).toContain("subtask-done");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar tarefa" }));
    const editDialog = await screen.findByRole("dialog", {
      name: "Editar tarefa",
    });
    expect(
      within(editDialog).getByText("Definir orçamento"),
    ).toBeInTheDocument();
    expect(
      within(editDialog).getByText("Escolher canais"),
    ).toBeInTheDocument();
  });

  it("cria uma equipe em Meu Time com os colaboradores do espaço", async () => {
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
          return response({
            members: [{ id: "member-1", name: "Carlos Souza", status: "ativo", role: "colaborador" }],
            invites: [],
            spaces: [],
          });
        return response({});
      }),
    );
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Meu Time" }));
    await screen.findByText("Convidar colaborador");
    fireEvent.click(screen.getByRole("button", { name: "Equipes" }));
    await screen.findByLabelText("Nome da equipe");
    fireEvent.change(screen.getByLabelText("Nome da equipe"), {
      target: { value: "Vendas" },
    });
    fireEvent.click(await screen.findByLabelText("Carlos Souza"));
    fireEvent.click(screen.getByRole("button", { name: "Criar equipe" }));

    expect(await screen.findByText("1 integrante")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Vendas")).length,
    ).toBeGreaterThan(0);
  });

  it("monta Gantt real com caminho crítico e dependências", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        projects: [
          {
            id: "project-gantt",
            name: "Implantação",
            startDate: "2026-08-03",
            milestones: [
              {
                id: "m1",
                title: "Go-live",
                type: "Lançamento",
                plannedDate: "2026-08-07",
              },
            ],
          },
        ],
        tasks: [
          {
            id: "t1",
            title: "Planejar",
            project: "Implantação",
            projectId: "project-gantt",
            estimatedDays: 2,
            status: "A fazer",
            priority: "Alta",
            businessId: business.id,
            dependsOn: [],
          },
          {
            id: "t2",
            title: "Executar",
            project: "Implantação",
            projectId: "project-gantt",
            estimatedDays: 3,
            status: "A fazer",
            priority: "Alta",
            businessId: business.id,
            dependsOn: ["t1"],
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.change(screen.getByLabelText("Filtrar por projeto"), {
      target: { value: "Implantação" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gantt" }));

    expect(await screen.findByText(/2 tarefa\(s\) crítica\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("Go-live · 2026-08-07")).toBeInTheDocument();
    expect(document.querySelectorAll(".gantt-bar.critical")).toHaveLength(2);
  });
});
