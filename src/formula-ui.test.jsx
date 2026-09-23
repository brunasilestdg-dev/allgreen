// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-fx", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-fx-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
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
  sheets: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-fx");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Bases — campo de fórmula", () => {
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

  it("cria um campo de fórmula que calcula a partir de outros campos", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Meus dados" }));
    await screen.findByRole("heading", { name: "Meus dados" });

    // Base "Estoque" (Produto, Quantidade, Preço, Repor?).
    const grid = document.querySelector(".db-template-grid");
    fireEvent.click(within(grid).getByRole("button", { name: /Estoque/ }));
    await screen.findByRole("button", { name: "Quantidade" });

    // Adiciona um campo de fórmula "Total" = Quantidade * Preço.
    fireEvent.click(screen.getByRole("button", { name: /Campo/ }));
    const modal = await screen.findByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("Nome do campo"), {
      target: { value: "Total" },
    });
    fireEvent.change(within(modal).getByLabelText("Tipo"), {
      target: { value: "formula" },
    });
    fireEvent.change(within(modal).getByPlaceholderText(/Preço \* Quantidade/), {
      target: { value: "Quantidade * Preço" },
    });
    fireEvent.click(within(modal).getByRole("button", { name: "Salvar campo" }));

    // Adiciona um registro e preenche Quantidade e Preço.
    fireEvent.click(screen.getByRole("button", { name: /Registro/ }));
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Preço"), { target: { value: "10" } });

    // A célula de fórmula mostra o resultado 20.
    const cell = document.querySelector(".db-formula-cell");
    expect(cell).toBeTruthy();
    expect(cell.textContent).toBe("20");
  });
});
