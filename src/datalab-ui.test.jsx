// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-lab", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-lab-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const receita = (id, valor, data) => ({
  id,
  type: "Receita",
  description: `Venda ${id}`,
  value: valor,
  date: data,
  category: "Serviços",
  businessId: business.id,
});

const businessDb = (transactions = []) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  transactions,
  tasks: [],
  appointments: [],
  leads: [],
  products: [],
  orders: [],
  contacts: [],
  timeEntries: [],
  bills: [],
  opportunities: [],
  meetings: [],
  boards: [],
  diagrams: [],
  whiteboards: [],
  memories: [],
  glossary: [],
  workHours: null,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-lab");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Análise de dados" }));
  await waitFor(() => expect(document.querySelector(".lab")).toBeTruthy());
};

const cartao = (rotulo) => {
  const article = [...document.querySelectorAll(".lab-cards article")].find(
    (a) => a.querySelector("small")?.textContent === rotulo,
  );
  return article?.querySelector("strong")?.textContent;
};

describe("Análise de dados", () => {
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

  it("avisa quando não há dado nenhum", async () => {
    seedLoggedIn(businessDb([]));
    await abrir();
    expect(
      await screen.findByText("Ainda não há dados para analisar"),
    ).toBeInTheDocument();
  });

  it("calcula as medidas básicas da fonte escolhida", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 100, "2026-01-10"),
        receita("b", 200, "2026-02-10"),
        receita("c", 300, "2026-03-10"),
      ]),
    );
    await abrir();

    await waitFor(() => expect(cartao("Quantidade")).toBe("3"));
    expect(cartao("Soma")).toBe("600");
    expect(cartao("Média")).toBe("200");
    expect(cartao("Mediana")).toBe("200");
  });

  it("explica o resultado em português", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 100, "2026-01-10"),
        receita("b", 100, "2026-02-10"),
        receita("c", 100, "2026-03-10"),
        receita("d", 5000, "2026-04-10"),
      ]),
    );
    await abrir();

    const explicacao = await waitFor(() => {
      const el = document.querySelector(".lab-explain");
      expect(el).toBeTruthy();
      return el;
    });
    expect(explicacao.textContent).toMatch(/média está bem acima da mediana/);
  });

  it("aponta o valor fora do padrão", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 100, "2026-01-10"),
        receita("b", 105, "2026-02-10"),
        receita("c", 98, "2026-03-10"),
        receita("d", 102, "2026-04-10"),
        receita("e", 9000, "2026-05-10"),
      ]),
    );
    await abrir();

    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Valores fora do padrão/),
    );
    const painel = [...document.querySelectorAll(".lab-panels section")][0];
    expect(painel.textContent).toContain("acima");
    expect(painel.textContent).toContain("9.000");
  });

  it("projeta a tendência e avisa quando a confiança é baixa", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 10, "2026-01-10"),
        receita("b", 900, "2026-02-10"),
        receita("c", 50, "2026-03-10"),
      ]),
    );
    await abrir();

    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Para onde está indo/),
    );
    expect(document.querySelector(".lab-warn")?.textContent || "").toMatch(
      /palpite/,
    );
  });

  it("mostra tendência de subida numa série regular", async () => {
    const meses = Array.from({ length: 8 }, (_, i) =>
      receita(`m${i}`, 1000 + i * 100, `2026-0${i + 1}-10`.replace("010", "10")),
    );
    seedLoggedIn(
      businessDb(
        Array.from({ length: 8 }, (_, i) =>
          receita(`m${i}`, 1000 + i * 100, `2026-${String(i + 1).padStart(2, "0")}-10`),
        ),
      ),
    );
    await abrir();

    await waitFor(() =>
      expect(document.querySelector(".lab-trend")?.textContent || "").toContain(
        "subindo",
      ),
    );
    expect(meses.length).toBe(8);
  });

  it("acusa o mês fora do padrão na série", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 1000, "2026-01-10"),
        receita("b", 1010, "2026-02-10"),
        receita("c", 990, "2026-03-10"),
        receita("d", 1005, "2026-04-10"),
        receita("e", 995, "2026-05-10"),
        receita("f", 9000, "2026-06-10"),
      ]),
    );
    await abrir();

    await waitFor(() =>
      expect(document.body.textContent).toMatch(/período(s)? fora do padrão/),
    );
    expect(document.querySelector(".lab-bar.anomalo")).toBeTruthy();
  });

  it("mostra a qualidade dos dados e o gráfico indicado", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 100, "2026-01-10"),
        receita("b", "", "2026-02-10"),
        receita("c", 300, "2026-03-10"),
      ]),
    );
    await abrir();

    const qualidade = await waitFor(() => {
      const el = document.querySelector(".lab-quality");
      expect(el).toBeTruthy();
      return el;
    });
    expect(qualidade.textContent).toContain("Qualidade dos dados");
    expect(qualidade.textContent).toMatch(/linha|barras|pizza|dispersao/);
  });

  it("permite trocar a fonte de dados", async () => {
    seedLoggedIn(
      businessDb([
        receita("a", 100, "2026-01-10"),
        {
          id: "d1",
          type: "Despesa",
          description: "Aluguel",
          value: 800,
          date: "2026-01-05",
          category: "Fixo",
          businessId: business.id,
        },
      ]),
    );
    await abrir();

    const seletor = await screen.findByLabelText("Fonte de dados");
    fireEvent.change(seletor, { target: { value: "despesas" } });
    await waitFor(() => expect(cartao("Soma")).toBe("800"));
  });
});
