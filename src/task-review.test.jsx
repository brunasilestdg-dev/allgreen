// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-review",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-review-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-review");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("revisão de entrega em tarefas comuns (não missão)", () => {
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

  it("permite enviar entrega e aprovar uma tarefa comum atribuída a si mesmo, sem marcar como missão", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-common-1",
            title: "Atualizar planilha de custos",
            description: "",
            priority: "Média",
            status: "Em andamento",
            due: "",
            area: "Operação",
            businessId: business.id,
            assigneeType: "real",
            assignee: "Renata Silva",
            assigneeId: user.id,
            project: "",
            isMission: false,
            ownerId: user.id,
            visibility: "privado",
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
    await screen.findByText("Atualizar planilha de custos");
    fireEvent.click(screen.getByRole("button", { name: "Editar tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });

    fireEvent.change(within(dialog).getByLabelText("Comentário da entrega"), {
      target: { value: "Planilha atualizada com os custos de junho." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar entrega" }),
    );

    expect(
      await within(dialog).findByText("Planilha atualizada com os custos de junho."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Aprovar entrega" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Aprovar entrega" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));

    expect(
      within(
        screen.getByText("Atualizar planilha de custos").closest("article"),
      ).getByDisplayValue("Concluído"),
    ).toBeInTheDocument();
  });

  it("não mostra a revisão de entrega para quem não é o dono da tarefa", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-common-2",
            title: "Responder clientes pendentes",
            description: "",
            priority: "Média",
            status: "Em andamento",
            due: "",
            area: "Operação",
            businessId: business.id,
            assigneeType: "real",
            assignee: "Renata Silva",
            assigneeId: user.id,
            project: "",
            isMission: false,
            ownerId: "another-owner",
            visibility: "espaco_todo",
            missionStatus: "enviada_para_revisao",
            deliveries: [
              {
                id: "delivery-1",
                comment: "Já respondi todos os clientes da fila.",
                authorId: user.id,
                authorName: user.name,
                createdAt: new Date().toISOString(),
                status: "enviada",
              },
            ],
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
    await screen.findByText("Responder clientes pendentes");
    fireEvent.click(screen.getByRole("button", { name: "Editar tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });

    expect(
      within(dialog).queryByRole("button", { name: "Aprovar entrega" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Já respondi todos os clientes da fila."),
    ).not.toBeInTheDocument();
  });
});
