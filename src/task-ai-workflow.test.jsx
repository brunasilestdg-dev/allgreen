// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-task-ai",
  name: "Renata Silva",
  email: "renata@example.com",
};

const business = {
  id: "business-task-ai",
  name: "Padaria Sol",
  stage: "Estou estruturando o negócio",
  segment: "Alimentação",
};

const db = {
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
};

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("tarefas aprofundadas pela IA", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    localStorage.setItem("seu-funcionario-auth-token", "token-task-ai");
    localStorage.setItem("seu-funcionario-active-user", user.id);
    localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT" ? response({ ok: true }) : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (String(url).startsWith("/api/collab"))
          return response({ members: [], invites: [], spaces: [] });
        if (url === "/api/ai")
          return response({
            content: JSON.stringify({
              title: "Enviar proposta comercial revisada",
              description: "Preparar a proposta com escopo e preço informados.",
              priority: "Alta",
              area: "Vendas",
              estimatedDays: 2,
              subtasks: ["Revisar briefing", "Montar proposta"],
              acceptanceCriteria: ["Proposta aprovada para envio"],
              risks: ["Preço ainda precisa de conferência"],
              questions: [],
              suggestedSpecialist: "",
            }),
          });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("estrutura o rascunho e exige a confirmação das etapas antes de concluir", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "fazer proposta" },
    });
    fireEvent.change(within(dialog).getByLabelText("Descrição"), {
      target: { value: "usar o briefing recebido" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Estruturar" }),
    );

    expect(await within(dialog).findByText("Revisar briefing")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Proposta aprovada para envio"),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Título")).toHaveValue(
      "Enviar proposta comercial revisada",
    );

    fireEvent.change(within(dialog).getByLabelText("Status"), {
      target: { value: "Concluído" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar tarefa" }));
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText(/Ainda não pode concluir/)).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Revisar briefing" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Montar proposta" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Proposta aprovada para envio" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar tarefa" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText("Enviar proposta comercial revisada")).toBeInTheDocument();
  });
});
