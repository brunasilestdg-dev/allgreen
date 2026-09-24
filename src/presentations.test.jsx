// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-pres", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-pres-1",
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

const deckJson = JSON.stringify([
  { title: "Capa da proposta", bullets: ["Organização residencial"], notes: "Abra com energia" },
  { title: "O problema", bullets: ["Falta de tempo", "Casa desorganizada"] },
  { title: "Próximos passos", bullets: ["Agende uma visita"] },
]);

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-pres");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Apresentações", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (url === "/api/ai") return response({ content: deckJson });
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

  it("gera uma apresentação por IA e abre o modo apresentação", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Apresentações" }));
    await screen.findByRole("heading", { name: "Apresentações" });

    const tema = screen.getByPlaceholderText(/organização residencial/i);
    fireEvent.change(tema, {
      target: { value: "Serviço de organização residencial" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Gerar apresentação/ }));

    // O modo apresentação abre no primeiro slide.
    await screen.findByRole("dialog");
    const presenter = screen.getByRole("dialog");
    expect(within(presenter).getByRole("heading", { name: "Capa da proposta" })).toBeInTheDocument();
    expect(within(presenter).getByText("1 / 3")).toBeInTheDocument();

    // Navega para o próximo slide.
    fireEvent.click(within(presenter).getByRole("button", { name: /Próximo/ }));
    expect(within(presenter).getByRole("heading", { name: "O problema" })).toBeInTheDocument();
    expect(within(presenter).getByText("Falta de tempo")).toBeInTheDocument();

    // Fecha e volta para a grade, onde a apresentação salva aparece como card.
    fireEvent.click(within(presenter).getByRole("button", { name: /Fechar/ }));
    expect(
      screen.getByRole("heading", { name: "Serviço de organização residencial" }),
    ).toBeInTheDocument();
  });
});
