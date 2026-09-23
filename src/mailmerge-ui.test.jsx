// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-mm", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-mm-1",
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
  contacts: [
    { id: "c1", name: "Ana Souza", phone: "81999", businessId: business.id },
    { id: "c2", name: "Bruno Lima", phone: "81888", businessId: business.id },
  ],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-mm");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Mala direta", () => {
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

  it("gera um documento por contato a partir de um modelo", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
    await screen.findByRole("heading", {
      name: "Crie, edite e leve seu trabalho com você",
    });

    fireEvent.click(screen.getByRole("button", { name: "Mala direta" }));
    const dialog = await screen.findByRole("dialog");
    // Fonte "Contatos" é o padrão; a prévia mostra o 1º de 2 registros.
    expect(within(dialog).getByText(/1º de 2 registros/)).toBeInTheDocument();
    // Gera os documentos.
    fireEvent.click(within(dialog).getByRole("button", { name: /Gerar 2 documentos/ }));

    // Aparecem na lista de documentos, personalizados por contato.
    expect(await screen.findByText("Carta — Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Carta — Bruno Lima")).toBeInTheDocument();
  });
});
