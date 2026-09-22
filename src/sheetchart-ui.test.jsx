// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-sc", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-sc-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const sheet = {
  id: "sh1",
  title: "Vendas",
  columns: ["Produto", "Venda"],
  rows: [
    ["Bolo", "120"],
    ["Torta", "80"],
    ["Doce", "50"],
  ],
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const businessDb = () => ({
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
  timeEntries: [],
  transactions: [],
  financeSettings: {},
  taxProfile: { isMEI: false, dueDay: 20, cnpj: "", dasHistory: {} },
  documents: [],
  presentations: [],
  contentPlan: [],
  sheets: [sheet],
  analyses: [],
  brainstorms: [],
  signatures: [],
  pixCharges: [],
  databases: [],
  wikiPages: [],
  automations: [],
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
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-sc");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Planilhas — gráfico", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("abre uma planilha salva e renderiza um gráfico de barras", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Planilhas" }));
    await screen.findByRole("heading", { name: "Planilhas" });

    // Abre a planilha salva "Vendas".
    fireEvent.click(screen.getByRole("button", { name: /Abrir/ }));
    await screen.findByDisplayValue("Vendas");

    // Abre o painel de gráfico.
    fireEvent.click(screen.getByRole("button", { name: /Gráfico/ }));

    // Um SVG de gráfico é renderizado com 3 barras.
    const svg = document.querySelector(".sheet-chart-svg");
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll("rect").length).toBe(3);
  });

  it("restaura automaticamente um gráfico salvo", async () => {
    const db = businessDb();
    db.sheets[0] = {
      ...db.sheets[0],
      chart: { enabled: true, type: "linha", labelCol: 0, valueCol: 1 },
    };
    seedLoggedIn(db);
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Planilhas" }));
    await screen.findByRole("heading", { name: "Planilhas" });
    expect(screen.getByText(/gráfico salvo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Abrir/ }));
    await screen.findByDisplayValue("Vendas");

    const svg = document.querySelector(".sheet-chart-svg");
    expect(svg).toBeTruthy();
    expect(svg.querySelector("polyline")).toBeTruthy();
  });
});
