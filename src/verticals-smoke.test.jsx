// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-verticals",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-verticals-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-verticals");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("fluxos básicos das ferramentas por vertical", () => {
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

  it("cadastra um veículo em Frota e Fretes", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Frota e Fretes" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo veículo" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Novo veículo" });
    fireEvent.change(within(dialog).getByLabelText("Placa"), {
      target: { value: "abc1234" },
    });
    fireEvent.change(within(dialog).getByLabelText("Modelo"), {
      target: { value: "Volvo FH" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar veículo" }),
    );

    expect(await screen.findByText(/ABC1234/)).toBeInTheDocument();
  });

  it("cria um agendamento em Agendamentos", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Agendamentos" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo agendamento" })[0]);
    const dialog = await screen.findByRole("dialog", {
      name: "Novo agendamento",
    });
    fireEvent.change(within(dialog).getByLabelText("Serviço ou motivo"), {
      target: { value: "Corte de cabelo" },
    });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Ana Paula" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar agendamento" }),
    );

    expect(await screen.findByText("Corte de cabelo")).toBeInTheDocument();
  });

  it("cadastra um produto em Produtos e Pedidos", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Produtos e Pedidos" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo produto" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Novo produto" });
    fireEvent.change(within(dialog).getByLabelText("Nome do produto"), {
      target: { value: "Camiseta P" },
    });
    fireEvent.change(within(dialog).getByLabelText("Preço de venda"), {
      target: { value: "49.9" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar produto" }),
    );

    expect(await screen.findByText("Camiseta P")).toBeInTheDocument();
  });
});
