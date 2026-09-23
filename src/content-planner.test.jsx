// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-cp", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-cp-1",
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

const planJson = JSON.stringify([
  {
    channel: "Instagram",
    format: "Reels",
    hook: "3 erros ao organizar a casa",
    caption: "Você comete algum destes três erros?",
    cta: "Chame no WhatsApp",
    hashtags: ["organizacao", "dicas"],
  },
  {
    channel: "Instagram",
    format: "Carrossel",
    hook: "Antes e depois",
    caption: "Veja a transformação de uma cozinha.",
    cta: "Agende sua visita",
    hashtags: ["antesedepois"],
  },
]);

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-cp");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Calendário de conteúdo", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (url === "/api/ai") return response({ content: planJson });
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

  it("gera um calendário editorial por IA e lista os posts", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Calendário de conteúdo" }));
    await screen.findByRole("heading", { name: "Calendário de conteúdo" });

    const tema = screen.getByPlaceholderText(/Confeitaria artesanal/i);
    fireEvent.change(tema, {
      target: { value: "Organização residencial para famílias ocupadas" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Gerar calendário/ }));

    // Os posts gerados aparecem na lista.
    expect(
      await screen.findByRole("heading", { name: "3 erros ao organizar a casa" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Antes e depois")).toBeInTheDocument();
    expect(screen.getByText(/#organizacao/)).toBeInTheDocument();

    // Situação inicial é "Ideia"; clicar avança para "Pronto".
    const statusBtns = screen.getAllByTitle("Mudar situação");
    expect(statusBtns[0]).toHaveTextContent("Ideia");
    fireEvent.click(statusBtns[0]);
    expect(statusBtns[0]).toHaveTextContent("Pronto");
  });
});
