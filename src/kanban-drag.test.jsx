// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-kanban",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-kanban-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-kanban");
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

const getColumnSection = (columnLabel) => {
  const headerSpan = screen
    .getAllByText(columnLabel)
    .find((el) => el.tagName === "SPAN" && el.closest("header"));
  return headerSpan.closest("section");
};

const dragTaskTo = (taskTitle, columnLabel) => {
  const card = screen.getByText(taskTitle).closest("article");
  const column = getColumnSection(columnLabel);
  fireEvent.dragStart(card);
  fireEvent.dragOver(column);
  fireEvent.drop(column);
  fireEvent.dragEnd(card);
  return { card, column };
};

describe("arrastar e soltar tarefas no quadro Kanban", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("move uma tarefa para outra coluna ao soltar sobre ela", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-drag-1",
            title: "Revisar contrato",
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
    await screen.findByText("Revisar contrato");

    dragTaskTo("Revisar contrato", "Em andamento");

    const card = await screen.findByText("Revisar contrato");
    expect(card.closest("article").closest("section")).toHaveTextContent(
      "Em andamento",
    );
  });

  it("respeita o bloqueio por dependência ao soltar uma tarefa bloqueada em Concluído", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-drag-base",
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
          {
            id: "task-drag-dependent",
            title: "Contratar fornecedor",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            dependsOn: ["task-drag-base"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    await screen.findByText("Contratar fornecedor");

    dragTaskTo("Contratar fornecedor", "Concluído");

    expect(
      await screen.findByText(/Bloqueada: conclua antes/),
    ).toBeInTheDocument();
    const card = screen.getByText("Contratar fornecedor");
    expect(card.closest("article").closest("section")).toHaveTextContent(
      "A fazer",
    );
  });

  it("move uma tarefa por toque (long-press) no celular, sem depender de drag-and-drop de mouse", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-touch-1",
            title: "Enviar proposta",
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
    await screen.findByText("Enviar proposta");

    const card = screen.getByText("Enviar proposta").closest("article");
    const targetColumn = getColumnSection("Em andamento");
    document.elementFromPoint = vi.fn(() => targetColumn);

    fireEvent.touchStart(card, { touches: [{ clientX: 50, clientY: 50 }] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    fireEvent.touchMove(card, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchEnd(card);

    const updated = await screen.findByText("Enviar proposta");
    expect(updated.closest("article").closest("section")).toHaveTextContent(
      "Em andamento",
    );
  });

  it("não arrasta por toque se o dedo se mover antes do tempo de pressionar (evita atrapalhar rolagem)", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-touch-2",
            title: "Organizar planilha",
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
    await screen.findByText("Organizar planilha");

    const card = screen.getByText("Organizar planilha").closest("article");
    const targetColumn = getColumnSection("Em andamento");
    document.elementFromPoint = vi.fn(() => targetColumn);

    fireEvent.touchStart(card, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchMove(card, { touches: [{ clientX: 90, clientY: 90 }] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    fireEvent.touchEnd(card);

    const stillThere = screen.getByText("Organizar planilha");
    expect(stillThere.closest("article").closest("section")).toHaveTextContent(
      "A fazer",
    );
  });
});
