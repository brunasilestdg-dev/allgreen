// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-an", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-an-1",
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

const analysisJson = JSON.stringify({
  summary: "Contrato de prestação de serviço por 12 meses.",
  keyPoints: ["Valor mensal de R$ 500", "Reajuste anual pelo IPCA"],
  risks: ["Multa de 3 mensalidades em caso de rescisão"],
  actions: ["Confirmar a data de início"],
  answer: "O prazo do contrato é de 12 meses.",
});

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-an");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Análise de textos", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (url === "/api/ai") return response({ content: analysisJson });
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

  it("analisa um texto colado e mostra a estrutura", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Análise de textos" }));
    await screen.findByRole("heading", { name: "Análise de textos" });

    const textarea = screen.getByPlaceholderText(/Cole aqui um contrato/i);
    fireEvent.change(textarea, {
      target: {
        value:
          "Contrato de prestação de serviço com prazo de doze meses, valor mensal de quinhentos reais e multa por rescisão.",
      },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Quais são os prazos/i),
      { target: { value: "Qual é o prazo?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Analisar" }));

    // O resultado estruturado aparece.
    const resultCard = (await screen.findByRole("heading", { name: "Resultado" }))
      .closest(".analysis-current");
    expect(within(resultCard).getByText("O prazo do contrato é de 12 meses.")).toBeInTheDocument();
    expect(within(resultCard).getByText("Valor mensal de R$ 500")).toBeInTheDocument();
    expect(
      within(resultCard).getByText("Multa de 3 mensalidades em caso de rescisão"),
    ).toBeInTheDocument();

    // A análise fica salva em "Análises anteriores".
    expect(
      screen.getByRole("heading", { name: "Análises anteriores" }),
    ).toBeInTheDocument();
  });
});
