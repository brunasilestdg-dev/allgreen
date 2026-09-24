// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-das", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-das-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-das");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("painel do DAS na página Financeiro", () => {
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

  it("ativa 'Sou MEI', revela o controle e marca o mês atual como pago", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    await screen.findByRole("heading", {
      name: "Números claros para decisões melhores",
    });

    // Antes de ativar, o controle mostra só o convite.
    expect(screen.getByText(/Ative "Sou MEI"/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Sou MEI"));

    // Depois de ativar, aparece o status do mês atual e a ação de pagamento.
    const dasPanel = document.getElementById("finance-das");
    expect(within(dasPanel).getByText(/vence dia/)).toBeInTheDocument();

    const markPaid = within(dasPanel).getByLabelText("Marcar como pago");
    expect(markPaid).not.toBeChecked();
    fireEvent.click(markPaid);
    expect(markPaid).toBeChecked();
    expect(within(dasPanel).getByText("Pago ✓")).toBeInTheDocument();
  });
});
