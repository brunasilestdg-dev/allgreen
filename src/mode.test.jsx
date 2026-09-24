// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-mode",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-mode-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const baseDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: null,
  businesses: [],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
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
  preferences: { theme: "light", specialist: "Diretor" },
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const stubFetch = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT" ? response({ ok: true }) : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      return response({});
    }),
  );
};

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-mode");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  if (db)
    localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

// O modo employee personaliza sugestões e rótulos, mas nunca restringe
// acesso: os dois modos têm o mesmo conjunto completo de páginas.
const ALL_NAV = [
  "Início",
  "Começar do zero",
  "Estratégia",
  "Marca e Marketing",
  "Vendas e Clientes",
  "Contatos",
  "Agendamentos",
  "Produtos e Pedidos",
  "Frota e Fretes",
  "Horas e Faturamento",
  "Financeiro",
  "Operação",
  "Desenvolvimento",
  "Sites e Materiais",
  "Documentos",
  "Ferramentas",
  "Estúdio de IA",
  "Histórico",
  "Certificações",
];

const employeeDb = (overrides = {}) =>
  baseDb({
    preferences: {
      theme: "light",
      specialist: "Diretor",
      mode: "employee",
      modeChosen: true,
    },
    ...overrides,
  });

const businessDb = (overrides = {}) =>
  baseDb({
    selectedBusinessId: business.id,
    businesses: [business],
    preferences: {
      theme: "light",
      specialist: "Diretor",
      mode: "business",
      modeChosen: true,
    },
    ...overrides,
  });

describe("modos de uso: business e employee", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("1. usuário antigo (dados sem preferences.mode) permanece em business sem ver a pergunta", async () => {
    const legacyDb = baseDb({
      selectedBusinessId: business.id,
      businesses: [business],
      // preferences sem mode/modeChosen simula conta anterior à funcionalidade
    });
    seedLoggedIn(legacyDb);
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Vamos fazer acontecer/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Como você pretende usar o Seu Funcionário?"),
    ).not.toBeInTheDocument();
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("2. conta nova mostra a pergunta de onboarding e o modo escolhido não restringe acesso", async () => {
    seedLoggedIn(baseDb()); // workspace recém-criado, sem nenhum dado ainda
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Como você pretende usar o Seu Funcionário?",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Para me ajudar no meu trabalho" }),
    );

    expect(
      await screen.findByRole("heading", { name: /Vamos fazer acontecer/ }),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".top-business")?.textContent,
    ).toContain("Meu trabalho");
    // modo funcionário tem todos os acessos: nenhum item de navegação some
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("3. alterar o modo em Configurações troca o rótulo do cabeçalho sem remover acessos", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    expect(screen.getByText("Negócio ativo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const modeCard = screen
      .getByRole("heading", { name: "Modo de uso" })
      .closest("section");
    fireEvent.click(
      within(modeCard).getByRole("button", {
        name: "Me ajudar no meu trabalho",
      }),
    );

    expect(
      document.querySelector(".top-business")?.textContent,
    ).toContain("Meu trabalho");
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("4. modo funcionário tem acesso total à navegação (nada é escondido)", async () => {
    seedLoggedIn(employeeDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("5. modo negócio preserva todos os módulos originais", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("6. campo Cliente é opcional em Agendamentos no modo funcionário", async () => {
    seedLoggedIn(employeeDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Agendamentos" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo agendamento" })[0],
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Novo agendamento",
    });
    expect(
      within(dialog).getByLabelText("Com quem (opcional)"),
    ).not.toBeRequired();
    fireEvent.change(within(dialog).getByLabelText("Serviço ou motivo"), {
      target: { value: "Bloco de foco" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar agendamento" }),
    );

    expect(await screen.findByText("Bloco de foco")).toBeInTheDocument();
  });

  it("7. campo Cliente continua obrigatório em Agendamentos no modo negócio", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Agendamentos" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo agendamento" })[0],
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Novo agendamento",
    });
    expect(within(dialog).getByLabelText("Cliente")).toBeRequired();
    fireEvent.change(within(dialog).getByLabelText("Serviço ou motivo"), {
      target: { value: "Consulta" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar agendamento" }),
    );

    // sem preencher Cliente, o agendamento não deve ser salvo (modal permanece aberto)
    expect(
      screen.getByRole("dialog", { name: "Novo agendamento" }),
    ).toBeInTheDocument();
  });

  it("8. a preferência de modo persiste entre recarregamentos", async () => {
    seedLoggedIn(employeeDb());
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    expect(
      document.querySelector(".top-business")?.textContent,
    ).toContain("Meu trabalho");
    unmount();

    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    expect(
      document.querySelector(".top-business")?.textContent,
    ).toContain("Meu trabalho");
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("9. a troca entre modos é reversível e nunca remove itens de navegação", async () => {
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    const goToModeCard = () =>
      screen.getByRole("heading", { name: "Modo de uso" }).closest("section");

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    fireEvent.click(
      within(goToModeCard()).getByRole("button", {
        name: "Me ajudar no meu trabalho",
      }),
    );
    expect(
      document.querySelector(".top-business")?.textContent,
    ).toContain("Meu trabalho");
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    fireEvent.click(
      within(goToModeCard()).getByRole("button", {
        name: "Administrar meu negócio",
      }),
    );
    expect(screen.getByText("Negócio ativo")).toBeInTheDocument();
    for (const label of ALL_NAV)
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("10. o menu mobile abre e mostra a navegação completa no modo funcionário", async () => {
    seedLoggedIn(employeeDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    const openMobile = document.querySelector(".mobile-menu");
    expect(openMobile).toBeTruthy();
    fireEvent.click(openMobile);

    const aside = document.querySelector("aside.open");
    expect(aside).toBeTruthy();
    for (const label of ALL_NAV)
      expect(
        within(aside).getByRole("button", { name: label }),
      ).toBeInTheDocument();
  });
});
