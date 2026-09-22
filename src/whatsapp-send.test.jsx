// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-wa", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-wa-1",
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
  contacts: [
    {
      id: "c1",
      name: "Ana Cliente",
      phone: "5511999998888",
      email: "",
      businessId: business.id,
    },
  ],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-wa");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("envio de WhatsApp com modelo a partir de um contato", () => {
  let openMock;

  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    openMock = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", openMock);
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

  it("abre o modal com o modelo preenchido e envia para o wa.me com o texto certo", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Contatos" }));
    await screen.findByRole("heading", {
      name: "Todas as pessoas em um só lugar",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Enviar WhatsApp para Ana Cliente" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Enviar pelo WhatsApp",
    });
    const textarea = within(dialog).getByRole("textbox");
    // O modelo padrão de contato ("Boas-vindas") vem preenchido com o nome do
    // cliente e o nome do negócio — sem sobrar variáveis entre chaves.
    expect(textarea.value).toContain("Ana Cliente");
    expect(textarea.value).toContain("Negócio Teste");
    expect(textarea.value).not.toMatch(/\{\{|\}\}/);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Abrir no WhatsApp" }),
    );

    expect(openMock).toHaveBeenCalledTimes(1);
    const url = openMock.mock.calls[0][0];
    expect(url).toContain("https://wa.me/5511999998888");
    expect(decodeURIComponent(url)).toContain("Ana Cliente");
  });
});
