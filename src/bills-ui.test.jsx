// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-bill", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-bill-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const HOJE = new Date().toISOString().slice(0, 10);
const emDias = (dias) =>
  new Date(Date.parse(`${HOJE}T00:00:00Z`) + dias * 86400000)
    .toISOString()
    .slice(0, 10);

const conta = (extra = {}) => ({
  id: "bill-1",
  direction: "receber",
  description: "Bolo de casamento",
  contactName: "Cliente A",
  value: 1000,
  dueDate: HOJE,
  category: "Serviços",
  notes: "",
  recurring: false,
  payments: [],
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...extra,
});

const businessDb = (bills = []) => ({
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
  bills,
  financeSettings: {},
  taxProfile: { isMEI: false, dueDay: 20, cnpj: "", dasHistory: {} },
  documents: [],
  objectives: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-bill");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirContas = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(
    screen.getByRole("button", { name: "Contas a receber e pagar" }),
  );
  return screen.findByRole("heading", { name: /Contas a receber e a pagar/ });
};

const cartaoDaConta = (descricao) =>
  [...document.querySelectorAll(".bill-card")].find((card) =>
    card.querySelector("strong")?.textContent === descricao,
  );

describe("Contas a receber e a pagar", () => {
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

  it("mostra estado vazio e explica a diferença para o livro-caixa", async () => {
    seedLoggedIn(businessDb([]));
    await abrirContas();
    expect(await screen.findByText("Nenhuma conta a receber")).toBeInTheDocument();
    expect(screen.getByText(/o que foi combinado e ainda não caiu/i)).toBeInTheDocument();
  });

  it("soma o que há a receber e destaca o que está atrasado", async () => {
    seedLoggedIn(
      businessDb([
        conta({ id: "a", value: 1000, dueDate: emDias(5) }),
        conta({
          id: "b",
          description: "Doces para festa",
          value: 500,
          dueDate: emDias(-10),
        }),
      ]),
    );
    await abrirContas();

    expect(await screen.findByText("a receber")).toBeInTheDocument();
    const resumo = document.querySelector(".bills-summary .in");
    expect(resumo.querySelector("strong").textContent).toContain("1.500,00");
    expect(resumo.querySelector(".bills-late").textContent).toContain("500,00");
    expect(screen.getAllByText("Atrasada 10 dias").length).toBeGreaterThan(0);
  });

  it("separa a inadimplência por faixa de atraso", async () => {
    seedLoggedIn(
      businessDb([
        conta({ id: "a", value: 300, dueDate: emDias(-20) }),
        conta({ id: "b", value: 700, dueDate: emDias(-70) }),
      ]),
    );
    await abrirContas();

    const aging = document.querySelector(".bills-aging");
    expect(within(aging).getByText("Atraso de 16 a 30 dias")).toBeInTheDocument();
    expect(within(aging).getByText(/300,00/)).toBeInTheDocument();
    expect(within(aging).getByText(/700,00/)).toBeInTheDocument();
  });

  it("dá baixa parcial e lança a diferença no livro-caixa", async () => {
    seedLoggedIn(businessDb([conta({ value: 1000, dueDate: emDias(3) })]));
    await abrirContas();

    const cartao = cartaoDaConta("Bolo de casamento");
    fireEvent.click(within(cartao).getByRole("button", { name: "Dar baixa" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Valor recebido/pago"), {
      target: { value: "400" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    // A conta continua aberta, agora mostrando o que já foi pago e o que falta.
    expect(
      await screen.findByText(/pago R\$\s*400,00 · falta R\$\s*600,00/),
    ).toBeInTheDocument();

    // E o valor virou Receita no Financeiro.
    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    expect(
      await screen.findByText("Bolo de casamento — Cliente A"),
    ).toBeInTheDocument();
  });

  it("quitar uma conta mensal já cria a do mês seguinte", async () => {
    seedLoggedIn(
      businessDb([
        conta({
          direction: "pagar",
          description: "Aluguel da loja",
          contactName: "",
          value: 800,
          dueDate: emDias(2),
          recurring: true,
        }),
      ]),
    );
    await abrirContas();

    fireEvent.click(screen.getByRole("button", { name: "A pagar" }));
    const cartao = cartaoDaConta("Aluguel da loja");
    fireEvent.click(within(cartao).getByRole("button", { name: "Dar baixa" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    // Sobra exatamente uma conta em aberto: a do mês seguinte.
    const abertas = await screen.findAllByText("Aluguel da loja");
    expect(abertas.length).toBe(1);
    expect(document.querySelector(".bill-rec")).toBeInTheDocument();
  });

  it("cadastra uma conta nova pelo formulário", async () => {
    seedLoggedIn(businessDb([]));
    await abrirContas();

    fireEvent.click(screen.getByRole("button", { name: /Cadastrar a primeira/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Descrição"), {
      target: { value: "Consultoria de agosto" },
    });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), {
      target: { value: "2.500,00" },
    });
    fireEvent.change(within(dialog).getByLabelText("Vencimento"), {
      target: { value: emDias(10) },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar conta" }));

    expect(await screen.findByText("Consultoria de agosto")).toBeInTheDocument();
    const resumo = document.querySelector(".bills-summary .in strong");
    expect(resumo.textContent).toContain("2.500,00");
  });
});
