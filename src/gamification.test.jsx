// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, {
  computeAchievements,
  computeUserPoints,
  levelForPoints,
  levelProgress,
} from "./App";

describe("cálculo puro de pontos, níveis e conquistas", () => {
  const userId = "user-1";
  const approvedMission = (overrides = {}) => ({
    id: "t1",
    isMission: true,
    points: 20,
    missionStatus: "aprovada",
    assigneeId: userId,
    ...overrides,
  });

  it("soma pontos apenas de missões aprovadas atribuídas ao usuário", () => {
    const tasks = [
      approvedMission({ id: "t1", points: 20 }),
      approvedMission({ id: "t2", points: 30 }),
      approvedMission({ id: "t3", points: 50, missionStatus: "enviada_para_revisao" }),
      approvedMission({ id: "t4", points: 100, assigneeId: "other-user" }),
    ];
    expect(computeUserPoints(tasks, userId)).toBe(50);
  });

  it("calcula o nível a partir dos pontos e dos limiares configurados", () => {
    expect(levelForPoints(0).name).toBe("Iniciante");
    expect(levelForPoints(50).name).toBe("Assistente");
    expect(levelForPoints(149).name).toBe("Assistente");
    expect(levelForPoints(150).name).toBe("Colaborador");
    expect(levelForPoints(600).name).toBe("Especialista");
    expect(levelForPoints(5000).name).toBe("Especialista");
  });

  it("permite níveis personalizados", () => {
    const custom = [
      { name: "Novato", minPoints: 0 },
      { name: "Veterano", minPoints: 10 },
    ];
    expect(levelForPoints(15, custom).name).toBe("Veterano");
  });

  it("calcula o progresso até o próximo nível", () => {
    const midway = levelProgress(25);
    expect(midway.next.name).toBe("Assistente");
    expect(midway.pct).toBe(50);
    expect(midway.pointsToNext).toBe(25);

    const atThreshold = levelProgress(600);
    expect(atThreshold.next).toBeNull();
    expect(atThreshold.pct).toBe(100);

    const beyondMax = levelProgress(9999);
    expect(beyondMax.next).toBeNull();
    expect(beyondMax.pct).toBe(100);
  });

  it("libera conquistas com base no histórico de missões aprovadas", () => {
    expect(computeAchievements([], userId)).toEqual([]);
    const oneApproved = [approvedMission()];
    const ids = computeAchievements(oneApproved, userId).map((a) => a.id);
    expect(ids).toContain("primeira-entrega");
    expect(ids).not.toContain("cinco-tarefas");

    const five = Array.from({ length: 5 }, (_, i) =>
      approvedMission({ id: `m${i}` }),
    );
    const fiveIds = computeAchievements(five, userId).map((a) => a.id);
    expect(fiveIds).toContain("cinco-tarefas");
  });
});

const user = {
  id: "user-gami",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-gami-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-gami");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("cartão de progresso no painel", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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
        return response({});
      }),
    );

  it("mostra pontos, nível e conquistas quando há missões aprovadas", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "t1",
            title: "Missão feita",
            isMission: true,
            points: 60,
            missionStatus: "aprovada",
            assigneeId: user.id,
            businessId: business.id,
          },
        ],
      }),
    );
    render(<App />);

    expect(
      await screen.findByText("Assistente · 60 pontos"),
    ).toBeInTheDocument();
    expect(screen.getByText("Primeira entrega")).toBeInTheDocument();
    expect(
      screen.getByText("Faltam 90 pontos para Colaborador"),
    ).toBeInTheDocument();
  });

  it("some quando a gamificação é desativada em Configurações", async () => {
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "t1",
            title: "Missão feita",
            isMission: true,
            points: 60,
            missionStatus: "aprovada",
            assigneeId: user.id,
            businessId: business.id,
          },
        ],
        preferences: {
          theme: "light",
          specialist: "Diretor",
          mode: "business",
          modeChosen: true,
          gamificationEnabled: false,
        },
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    expect(screen.queryByText(/pontos/)).not.toBeInTheDocument();
  });

  it("notifica ao desbloquear uma conquista pela primeira vez, mas não de novo depois", async () => {
    stubFetch();
    const dbWithAchievement = businessDb({
      tasks: [
        {
          id: "t1",
          title: "Missão feita",
          isMission: true,
          points: 60,
          missionStatus: "aprovada",
          assigneeId: user.id,
          businessId: business.id,
        },
      ],
    });
    seedLoggedIn(dbWithAchievement);
    const { unmount } = render(<App />);
    await screen.findByText("Primeira entrega");

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(
      await screen.findByText(/Conquista desbloqueada: Primeira entrega/),
    ).toBeInTheDocument();
    unmount();
    cleanup();

    // Reabre o app com o mesmo estado persistido (já contendo a notificação
    // da primeira vez) para confirmar que a conquista não é notificada de novo.
    render(<App />);
    await screen.findByText("Primeira entrega");
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(
      await screen.findAllByText(/Conquista desbloqueada: Primeira entrega/),
    ).toHaveLength(1);
  });
});
