// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-dt", name: "Bruna Silva", email: "bruna@example.com" };
const business = {
  id: "business-dt-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-dt");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("Modelos prontos de documentos", () => {
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

  it("abre um modelo, preenche o negócio e cria o documento", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    // O modelo é preenchido com o nome do negócio ATIVO. Sem esperar o negócio
    // aparecer na casca, um runner lento chega a abrir o modelo antes de o
    // espaço terminar de carregar — e aí o documento nasce com "{{empresa}}"
    // no lugar do nome, que é justamente o que este teste existe para impedir.
    expect((await screen.findAllByText("Doces da Ana")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
    await screen.findByRole("heading", {
      name: "Crie, edite e leve seu trabalho com você",
    });

    // Abrir o seletor de modelos e escolher "Recibo de pagamento".
    fireEvent.click(screen.getByRole("button", { name: "Modelos prontos" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Recibo de pagamento/ }),
    );

    // O formulário de novo documento abre com o conteúdo do modelo já
    // preenchido com o nome do negócio.
    const title = await screen.findByDisplayValue("Recibo de pagamento");
    expect(title).toBeInTheDocument();
    // O editor de blocos monta o corpo num segundo passo de render; em máquina
    // lenta o padrão de 1s da testing-library estoura antes disso. A asserção
    // é a mesma — só a paciência muda.
    const content = await screen.findByDisplayValue(/Doces da Ana/, {}, { timeout: 5000 });
    expect(content).toBeInTheDocument();
    expect(content.value).not.toContain("{{empresa}}");
  });
});
