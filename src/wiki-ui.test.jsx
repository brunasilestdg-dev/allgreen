// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-wk", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-wk-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-wk");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Base de conhecimento (wiki)", () => {
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

  it("cria página, edita título/conteúdo e lê no modo leitura", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Base de conhecimento" }));
    await screen.findByRole("heading", { name: "Base de conhecimento" });

    // Estado vazio → criar primeira página.
    fireEvent.click(screen.getByRole("button", { name: /Criar primeira página/ }));

    // Renomeia o título e escreve conteúdo em markdown.
    const title = await screen.findByLabelText("Título da página");
    fireEvent.change(title, { target: { value: "Manual de vendas" } });
    const editor = screen.getByPlaceholderText(/Aceita Markdown/);
    fireEvent.change(editor, { target: { value: "# Passo 1\nAtenda com atenção." } });

    // Aparece na árvore lateral.
    const tree = document.querySelector(".wiki-tree");
    expect(within(tree).getByText("Manual de vendas")).toBeInTheDocument();

    // Modo leitura renderiza o markdown (título vira heading).
    fireEvent.click(screen.getByRole("button", { name: "Ler" }));
    const preview = document.querySelector(".wiki-preview");
    expect(within(preview).getByText("Passo 1")).toBeInTheDocument();
  });
});
