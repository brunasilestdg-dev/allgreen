// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-okr", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-okr-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const objetivo = (extra = {}) => ({
  id: "obj-1",
  title: "Faturar com previsibilidade",
  description: "",
  cycle: "anual",
  reference: "2026-01-01",
  businessId: business.id,
  ownerId: user.id,
  keyResults: [
    {
      id: "kr-1",
      title: "Fechar 10 contratos",
      type: "numero",
      start: 0,
      target: 10,
      current: 5,
      unit: "contratos",
      weight: 1,
    },
  ],
  history: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const businessDb = (objectives = []) => ({
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
  objectives,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-okr");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirMetas = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Metas e OKRs" }));
  return screen.findByRole("heading", { name: /Metas e OKRs/ });
};

// O mesmo "50%" pode aparecer no cartão e no resumo do topo, por isso as
// asserções de progresso são escopadas ao cartão da meta.
const progressoDoCartao = (titulo) => {
  const cartao = [...document.querySelectorAll(".goal-card")].find((card) =>
    card.querySelector("h3")?.textContent === titulo,
  );
  return cartao?.querySelector(".goal-numbers strong")?.textContent;
};

describe("Metas e OKRs", () => {
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

  it("mostra o estado vazio convidando a criar a primeira meta", async () => {
    seedLoggedIn(businessDb([]));
    await abrirMetas();
    expect(await screen.findByText("Nenhuma meta ainda")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Criar a primeira meta/ }),
    ).toBeInTheDocument();
  });

  it("exibe o progresso calculado e o resumo das metas existentes", async () => {
    seedLoggedIn(businessDb([objetivo()]));
    await abrirMetas();

    expect(
      await screen.findByRole("heading", { name: "Faturar com previsibilidade" }),
    ).toBeInTheDocument();
    // 5 de 10 contratos = 50% de progresso.
    expect(progressoDoCartao("Faturar com previsibilidade")).toBe("50%");
    expect(screen.getByText("5 contratos de 10 contratos")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("progresso médio")).toBeInTheDocument();
  });

  it("cria uma meta nova com resultado-chave percentual", async () => {
    seedLoggedIn(businessDb([]));
    await abrirMetas();

    fireEvent.click(screen.getByRole("button", { name: /Criar a primeira meta/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(
      within(dialog).getByPlaceholderText("O que você quer alcançar?"),
      { target: { value: "Organizar a operação" } },
    );
    fireEvent.change(
      within(dialog).getByPlaceholderText(/Resultado-chave/),
      { target: { value: "Documentar os processos" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText("Tipo do resultado-chave"),
      { target: { value: "percentual" } },
    );
    fireEvent.change(within(dialog).getByLabelText("Progresso (%)"), {
      target: { value: "40" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar meta" }));

    expect(
      await screen.findByRole("heading", { name: "Organizar a operação" }),
    ).toBeInTheDocument();
    expect(progressoDoCartao("Organizar a operação")).toBe("40%");
  });

  it("filtra por ciclo", async () => {
    seedLoggedIn(
      businessDb([
        objetivo(),
        objetivo({
          id: "obj-2",
          title: "Meta do mês",
          cycle: "mensal",
          reference: "2026-07-01",
        }),
      ]),
    );
    await abrirMetas();

    expect(
      await screen.findByRole("heading", { name: "Meta do mês" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filtrar por ciclo"), {
      target: { value: "anual" },
    });

    expect(
      screen.queryByRole("heading", { name: "Meta do mês" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Faturar com previsibilidade" }),
    ).toBeInTheDocument();
  });

  it("calcula progresso automático a partir das tarefas do projeto ligado", async () => {
    const db = businessDb([
      objetivo({
        id: "obj-auto",
        title: "Entregar o lançamento",
        keyResults: [
          {
            id: "kr-auto",
            title: "Concluir as tarefas do lançamento",
            type: "tarefas",
            linkedProject: "Lançamento",
            weight: 1,
          },
        ],
      }),
    ]);
    db.tasks = [
      {
        id: "t1",
        businessId: business.id,
        project: "Lançamento",
        status: "concluida",
        title: "A",
      },
      {
        id: "t2",
        businessId: business.id,
        project: "Lançamento",
        status: "fazendo",
        title: "B",
      },
    ];
    seedLoggedIn(db);
    await abrirMetas();

    expect(await screen.findByText("1 de 2 tarefas")).toBeInTheDocument();
    expect(progressoDoCartao("Entregar o lançamento")).toBe("50%");
  });
});
