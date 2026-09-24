// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-ex", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-ex-1",
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

const TOKEN = "token-abcdef-1234567890";
const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", TOKEN);
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Configurações — Extensão do navegador", () => {
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

  it("mostra o token da extensão só ao clicar em Mostrar", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const card = (await screen.findByRole("heading", {
      name: "Extensão do navegador",
    })).closest(".settings-card");

    // Começa mascarado (não mostra o token inteiro).
    const input = within(card).getByLabelText("Token de acesso");
    expect(input.value).not.toBe(TOKEN);
    expect(input.value).toContain("token-");

    // Revela o token completo.
    fireEvent.click(within(card).getByRole("button", { name: "Mostrar" }));
    expect(within(card).getByLabelText("Token de acesso").value).toBe(TOKEN);
  });

  it("entrega o pacote pelo próprio app e avisa quanto tempo o token vale", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const card = (await screen.findByRole("heading", {
      name: "Extensão do navegador",
    })).closest(".settings-card");

    // Antes a tela mandava carregar "a pasta extension/ do projeto", que
    // nenhuma pessoa usuária tem.
    const baixar = within(card).getByRole("link", { name: /Baixar a extensão/ });
    expect(baixar).toHaveAttribute("href", "/extensao-todogreen.zip");
    expect(baixar).toHaveAttribute("download");
    expect(within(card).queryByText(/do projeto/)).not.toBeInTheDocument();
    expect(within(card).getByText(/vale por 24 horas/)).toBeInTheDocument();
  });
});
