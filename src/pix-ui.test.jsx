// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-px", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-px-1",
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
  pixCharges: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-px");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Cobrança Pix", () => {
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

  it("gera o Pix copia e cola ao informar a chave e salva a cobrança", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Cobrança Pix" }));
    await screen.findByRole("heading", { name: "Cobrança Pix" });

    // Sem chave, pede a chave.
    expect(screen.getByRole("heading", { name: "Informe sua chave Pix" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Sua chave Pix"), {
      target: { value: "ana@doces.com" },
    });
    fireEvent.change(screen.getByLabelText("Valor (opcional)"), {
      target: { value: "25" },
    });

    // O código Pix aparece, começando com 000201 e terminando com CRC.
    const codeBox = await screen.findByDisplayValue(/^000201/);
    expect(codeBox.value).toContain("br.gov.bcb.pix");
    expect(codeBox.value).toContain("ana@doces.com");
    expect(codeBox.value).toContain("25.00");

    // O mesmo código vira QR Code (lib `qrcode` de verdade, que também roda
    // no jsdom) para o cliente pagar pela câmera do app do banco.
    const qr = await screen.findByRole("img", { name: /QR Code do Pix/ });
    expect(qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole("link", { name: "Baixar QR Code" })).toHaveAttribute(
      "download",
      "cobranca-pix.png",
    );

    // Salvar cria um card em "Cobranças salvas".
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const savedSection = screen
      .getByRole("heading", { name: "Cobranças salvas" })
      .parentElement;
    expect(within(savedSection).getByText("R$ 25,00")).toBeInTheDocument();
  });
});
