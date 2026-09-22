// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-sb", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-sb-1",
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

const sheetJson = JSON.stringify({
  title: "Controle de estoque",
  columns: ["Produto", "Quantidade", "Preço"],
  rows: [
    ["Camiseta", "10", "R$ 39,90"],
    ["Calça", "5", "R$ 89,90"],
  ],
});

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-sb");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Gerador de planilhas", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (url === "/api/ai") return response({ content: sheetJson });
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

  it("gera uma planilha por IA, edita e salva", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Planilhas" }));
    await screen.findByRole("heading", { name: "Planilhas" });

    const desc = screen.getByPlaceholderText(/Controle de estoque com produto/i);
    fireEvent.change(desc, { target: { value: "Controle de estoque simples" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar planilha/ }));

    // A planilha aparece com cabeçalhos e valores de exemplo editáveis.
    await screen.findByDisplayValue("Controle de estoque");
    expect(screen.getByDisplayValue("Produto")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Camiseta")).toBeInTheDocument();

    // Editar uma célula.
    const cell = screen.getByLabelText("Linha 1, Produto");
    fireEvent.change(cell, { target: { value: "Blusa" } });
    expect(screen.getByDisplayValue("Blusa")).toBeInTheDocument();

    // Adicionar linha aumenta a contagem de células editáveis.
    fireEvent.click(screen.getByRole("button", { name: /Linha/ }));
    expect(screen.getByLabelText("Linha 3, Produto")).toBeInTheDocument();

    // Salvar cria um card na lista de planilhas salvas.
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const savedSection = screen.getByRole("heading", { name: "Planilhas salvas" })
      .parentElement;
    expect(
      within(savedSection).getByRole("heading", { name: "Controle de estoque" }),
    ).toBeInTheDocument();
  });
});
