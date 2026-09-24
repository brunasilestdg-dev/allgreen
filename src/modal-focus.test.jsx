// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-modal-focus",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-modal-focus-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (overrides = {}) => ({
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
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-modal-focus");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("modal com armadilha de foco (Modal component)", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("move o foco para dentro do modal ao abrir e o Tab não escapa para trás dele", async () => {
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
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Excluir minha conta" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Excluir minha conta" });
    expect(dialog).toBeInTheDocument();

    // A caixa de confirmação define seu próprio autoFocus; o modal deve
    // respeitar isso em vez de roubar o foco para o botão de fechar.
    const confirmInput = screen.getByLabelText(
      'Para confirmar, digite "EXCLUIR"',
    );
    expect(confirmInput).toHaveFocus();

    const focusable = Array.from(
      dialog.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(dialog.contains(first)).toBe(true);
    expect(dialog.contains(last)).toBe(true);

    // Tab a partir do último elemento focável do modal deve voltar para o
    // primeiro, sem escapar para o menu/tela de fundo.
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    // Shift+Tab a partir do primeiro elemento deve ir para o último.
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("devolve o foco para quem abriu o modal depois que ele é fechado", async () => {
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
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const openButton = screen.getByRole("button", {
      name: "Excluir minha conta",
    });
    openButton.focus();
    fireEvent.click(openButton);

    const dialog = screen.getByRole("dialog", { name: "Excluir minha conta" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(dialog).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });
});
