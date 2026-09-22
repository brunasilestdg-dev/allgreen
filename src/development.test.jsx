// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-dev",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-dev-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-dev");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("planos de desenvolvimento", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cria um plano com competência e mostra o progresso agregado", async () => {
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
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Desenvolvimento" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo plano" })[0]);
    const dialog = await screen.findByRole("dialog", {
      name: "Novo plano de desenvolvimento",
    });
    fireEvent.change(within(dialog).getByLabelText("Título do plano"), {
      target: { value: "Evolução em atendimento" },
    });
    fireEvent.change(within(dialog).getByLabelText("Colaborador"), {
      target: { value: "Carla Souza" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar competência" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Nome da competência"), {
      target: { value: "Atendimento" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Progresso da competência Atendimento"),
      { target: { value: "40" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar plano" }),
    );

    expect(
      await screen.findByText("Evolução em atendimento"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Carla Souza · Planejado · 40% concluído/),
    ).toBeInTheDocument();
  });
});
