// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-stmt", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-stmt-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const MES = new Date().toISOString().slice(0, 7);
const mesAnterior = () => {
  const [ano, mes] = MES.split("-").map(Number);
  return mes === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(mes - 1).padStart(2, "0")}`;
};

const tx = (extra = {}) => ({
  id: "t1",
  type: "Receita",
  description: "Venda",
  value: 1000,
  date: `${MES}-10`,
  category: "Serviços",
  businessId: business.id,
  ownerId: user.id,
  ...extra,
});

const businessDb = (transactions = [], bills = []) => ({
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
  transactions,
  bills,
  opportunities: [],
  salesPipeline: null,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-stmt");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirResultado = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Resultado do mês" }));
  return screen.findByRole("heading", { name: /^Resultado do mês$/ });
};

const cartao = (rotulo) => {
  const article = [...document.querySelectorAll(".stmt-cards article")].find(
    (a) => a.querySelector("small")?.textContent === rotulo,
  );
  return article?.querySelector("strong")?.textContent;
};

describe("Resultado do mês", () => {
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

  it("mostra estado vazio quando o mês não tem lançamento", async () => {
    seedLoggedIn(businessDb([]));
    await abrirResultado();
    expect(await screen.findByText(/Nenhum lançamento em/)).toBeInTheDocument();
  });

  it("calcula entrou, saiu, sobrou e margem", async () => {
    seedLoggedIn(
      businessDb([
        tx({ id: "a", value: 5000 }),
        tx({ id: "b", type: "Despesa", value: 1500, category: "Aluguel" }),
      ]),
    );
    await abrirResultado();

    expect(cartao("Entrou")).toContain("5.000");
    expect(cartao("Saiu")).toContain("1.500");
    expect(cartao("Sobrou")).toContain("3.500");
    expect(cartao("Margem")).toBe("70%");
  });

  it("mostra a margem como travessão quando não houve receita", async () => {
    seedLoggedIn(businessDb([tx({ type: "Despesa", value: 800 })]));
    await abrirResultado();
    expect(cartao("Margem")).toBe("—");
    expect(screen.getByText("sem receita no mês")).toBeInTheDocument();
  });

  it("compara com o mês anterior e avisa quando não há base", async () => {
    seedLoggedIn(businessDb([tx({ value: 2000 })]));
    await abrirResultado();
    expect(screen.getAllByText("sem base anterior").length).toBeGreaterThan(0);
  });

  it("mostra a variação percentual quando existe mês anterior", async () => {
    seedLoggedIn(
      businessDb([
        tx({ id: "atual", value: 5000 }),
        tx({ id: "antigo", value: 4000, date: `${mesAnterior()}-10` }),
      ]),
    );
    await abrirResultado();
    // Receita e resultado sobem os mesmos 25%, por isso há mais de um.
    expect(
      screen.getAllByText(/25% vs\. mês anterior/).length,
    ).toBeGreaterThan(0);
  });

  it("agrupa as saídas por categoria com a fatia de cada uma", async () => {
    seedLoggedIn(
      businessDb([
        tx({ id: "r", value: 5000 }),
        tx({ id: "a", type: "Despesa", value: 800, category: "Aluguel" }),
        tx({ id: "b", type: "Despesa", value: 200, category: "Insumos" }),
      ]),
    );
    await abrirResultado();

    const cats = document.querySelector(".stmt-cats");
    expect(cats.textContent).toContain("Aluguel");
    expect(cats.textContent).toContain("80% das saídas");
    expect(cats.textContent).toContain("Insumos");
  });

  it("compara o que moveu no caixa com o que venceu no mês", async () => {
    seedLoggedIn(
      businessDb(
        [tx({ id: "r", value: 5000 })],
        [
          {
            id: "c1",
            direction: "receber",
            value: 6000,
            dueDate: `${MES}-15`,
            payments: [],
            businessId: business.id,
          },
        ],
      ),
    );
    await abrirResultado();

    const regimes = document.querySelector(".stmt-regimes");
    expect(regimes.textContent).toContain("6.000");
    expect(
      screen.getByText(/a mais do que entrou de fato/),
    ).toBeInTheDocument();
  });

  it("navega para o mês anterior", async () => {
    seedLoggedIn(
      businessDb([tx({ id: "antigo", value: 999, date: `${mesAnterior()}-10` })]),
    );
    await abrirResultado();

    // No mês atual não há lançamento.
    expect(await screen.findByText(/Nenhum lançamento em/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Mês anterior"));
    expect(cartao("Entrou")).toContain("999");
  });
});
