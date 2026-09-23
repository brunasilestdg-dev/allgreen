// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-pipe", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-pipe-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const HOJE = new Date().toISOString().slice(0, 10);
const diasAtras = (dias) =>
  new Date(Date.parse(`${HOJE}T00:00:00Z`) - dias * 86400000).toISOString();

const opp = (extra = {}) => ({
  id: "op-1",
  title: "Bolo de casamento",
  contactName: "Cliente A",
  company: "",
  value: 1000,
  stageId: "proposta",
  probability: "",
  expectedCloseDate: "",
  origin: "",
  notes: "",
  lossReason: "",
  closedAt: "",
  stageHistory: [],
  businessId: business.id,
  ownerId: user.id,
  createdAt: diasAtras(10),
  ...extra,
});

const businessDb = (opportunities = []) => ({
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
  bills: [],
  opportunities,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-pipe");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirFunil = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Funil de vendas" }));
  return screen.findByRole("heading", { name: /^Funil de vendas$/ });
};

const resumoTexto = (rotulo) => {
  const article = [...document.querySelectorAll(".pipe-summary article")].find(
    (a) => a.querySelector("small")?.textContent === rotulo,
  );
  return article?.querySelector("strong")?.textContent;
};

describe("Funil de vendas", () => {
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

  it("mostra o estado vazio explicando o valor do funil", async () => {
    seedLoggedIn(businessDb([]));
    await abrirFunil();
    expect(
      await screen.findByText("Nenhuma oportunidade no funil"),
    ).toBeInTheDocument();
  });

  it("mostra a previsão ponderada, não só a soma otimista", async () => {
    seedLoggedIn(
      businessDb([
        opp({ id: "a", stageId: "proposta", value: 1000 }),
        opp({ id: "b", stageId: "negociacao", value: 2000 }),
      ]),
    );
    await abrirFunil();

    // Soma otimista: 3.000. Ponderado: 1000×50% + 2000×75% = 2.000.
    expect(resumoTexto("em negociação")).toContain("3.000");
    expect(resumoTexto("previsão ponderada")).toContain("2.000");
  });

  it("calcula taxa de fechamento, ticket médio e ciclo de venda", async () => {
    seedLoggedIn(
      businessDb([
        opp({
          id: "ganha",
          stageId: "ganho",
          value: 3000,
          createdAt: diasAtras(20),
          closedAt: diasAtras(10),
        }),
        opp({ id: "perdida", stageId: "perdido", value: 500 }),
      ]),
    );
    await abrirFunil();

    expect(resumoTexto("taxa de fechamento")).toBe("50%");
    expect(resumoTexto("ticket médio")).toContain("3.000");
    expect(resumoTexto("ciclo médio de venda")).toBe("10 dias");
  });

  it("avisa sobre oportunidades paradas há mais de 14 dias", async () => {
    seedLoggedIn(
      businessDb([
        opp({
          id: "esquecida",
          title: "Encomenda da padaria",
          stageHistory: [{ stageId: "proposta", at: diasAtras(30) }],
        }),
      ]),
    );
    await abrirFunil();

    expect(
      await screen.findByText(/Paradas há mais de 14 dias/),
    ).toBeInTheDocument();
    expect(screen.getByText(/30 dias sem mexer/)).toBeInTheDocument();
  });

  it("move a oportunidade de etapa e recalcula a previsão", async () => {
    seedLoggedIn(businessDb([opp({ value: 1000, stageId: "proposta" })]));
    await abrirFunil();

    expect(resumoTexto("previsão ponderada")).toContain("500");

    fireEvent.change(screen.getByLabelText("Mover Bolo de casamento"), {
      target: { value: "negociacao" },
    });

    // 1000 × 75% = 750
    expect(resumoTexto("previsão ponderada")).toContain("750");
  });

  it("pede o motivo ao marcar como perdida e mostra o agrupamento", async () => {
    seedLoggedIn(businessDb([opp()]));
    await abrirFunil();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Etapa"), {
      target: { value: "perdido" },
    });
    // O campo de motivo só aparece quando a etapa é de perda.
    fireEvent.change(within(dialog).getByLabelText("Motivo da perda"), {
      target: { value: "Preço" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Por que perdemos")).toBeInTheDocument();
    const perdas = document.querySelector(".pipe-loss");
    expect(within(perdas).getByText("Preço")).toBeInTheDocument();
  });

  it("cria oportunidade nova com data prevista e ela entra na previsão do mês", async () => {
    seedLoggedIn(businessDb([]));
    await abrirFunil();

    fireEvent.click(screen.getByRole("button", { name: /Criar a primeira/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(
      within(dialog).getByLabelText("O que está sendo vendido"),
      { target: { value: "Consultoria" } },
    );
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), {
      target: { value: "4.000,00" },
    });
    fireEvent.change(within(dialog).getByLabelText("Etapa"), {
      target: { value: "negociacao" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Consultoria")).toBeInTheDocument();
    // 4000 × 75% = 3.000
    expect(resumoTexto("previsão ponderada")).toContain("3.000");
  });
});
