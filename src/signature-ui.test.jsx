// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-sg", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-sg-1",
  name: "Doces da Ana",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-sg");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Assinatura de e-mail", () => {
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

  it("prefill do perfil, atualiza a prévia e salva", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Assinatura de e-mail" }));
    await screen.findByRole("heading", { name: "Assinatura de e-mail" });

    // Nome e negócio vêm pré-preenchidos do perfil/negócio.
    expect(screen.getByDisplayValue("Renata Silva")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Doces da Ana")).toBeInTheDocument();

    // Ao digitar o cargo, a prévia reflete a linha "cargo — negócio".
    const preview = document.querySelector(".signature-preview");
    fireEvent.change(screen.getByLabelText("Cargo / função"), {
      target: { value: "Fundadora" },
    });
    expect(within(preview).getByText("Fundadora — Doces da Ana")).toBeInTheDocument();

    // Salvar cria um card em "Assinaturas salvas".
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const savedSection = screen
      .getByRole("heading", { name: "Assinaturas salvas" })
      .parentElement;
    expect(within(savedSection).getByRole("heading", { name: "Renata Silva" })).toBeInTheDocument();
  });
});
