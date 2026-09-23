// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { buildTaskCalendar, shiftYearMonth } from "./App";

describe("buildTaskCalendar / shiftYearMonth (funções puras)", () => {
  it("monta as células do mês com os espaços em branco antes do dia 1", () => {
    const cells = buildTaskCalendar("2026-07-01".slice(0, 7), []);
    expect(cells.length).toBeGreaterThan(30);
    const firstRealCell = cells.find((c) => c !== null);
    expect(firstRealCell).toMatchObject({ day: 1, ymd: "2026-07-01" });
  });

  it("agrupa as tarefas pelo prazo (due) no dia certo", () => {
    const tasks = [
      { id: "t1", title: "A", due: "2026-07-15", priority: "Alta" },
      { id: "t2", title: "B", due: "2026-07-15", priority: "Baixa" },
      { id: "t3", title: "C", due: "2026-07-20", priority: "Média" },
      { id: "t4", title: "Sem prazo", due: "", priority: "Média" },
    ];
    const cells = buildTaskCalendar("2026-07", tasks);
    const day15 = cells.find((c) => c && c.ymd === "2026-07-15");
    const day20 = cells.find((c) => c && c.ymd === "2026-07-20");
    expect(day15.tasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(day20.tasks.map((t) => t.id)).toEqual(["t3"]);
  });

  it("avança e recua meses, virando o ano", () => {
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
  });
});

const user = {
  id: "user-cal",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-cal-1",
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
  contacts: [],
  deliveryZones: [],
  vehicles: [],
  trips: [],
  developmentPlans: [],
  notifications: [],
  teams: [],
  projects: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-cal");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      return response({});
    }),
  );

describe("visão de calendário de tarefas", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mostra a tarefa no dia do prazo e abre a edição ao clicar", async () => {
    stubFetch();
    const dueYmd = new Date().toISOString().slice(0, 10);
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-cal-1",
            title: "Renovar contrato",
            status: "A fazer",
            priority: "Alta",
            due: dueYmd,
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Calendário" }));

    const chip = await screen.findByRole("button", { name: "Renovar contrato" });
    fireEvent.click(chip);

    const dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    expect(dialog).toBeInTheDocument();
  });

  it("navega para o mês seguinte e volta para hoje", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-cal-2",
            title: "Tarefa qualquer",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Calendário" }));

    const currentLabel = document.querySelector(".task-calendar-header strong")
      .textContent;
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    const nextLabel = document.querySelector(".task-calendar-header strong")
      .textContent;
    expect(nextLabel).not.toBe(currentLabel);

    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    const backLabel = document.querySelector(".task-calendar-header strong")
      .textContent;
    expect(backLabel).toBe(currentLabel);
  });
});
