// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-panel",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-panel-1",
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
  localStorage.setItem("seu-funcionario-auth-token", "token-panel");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("painéis dedicados no início", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("painel do gestor mostra colaboradores, convites, entregas e atrasos", async () => {
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
          return response({
            members: [
              { id: "m1", name: "Ana", status: "ativo" },
              { id: "m2", name: "Bia", status: "suspenso" },
            ],
            invites: [{ id: "i1", status: "enviado" }],
            spaces: [],
          });
        return response({});
      }),
    );
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "t1",
            title: "Atrasada",
            due: "2020-01-01",
            status: "A fazer",
            businessId: business.id,
          },
          {
            id: "t2",
            title: "Em revisão",
            isMission: true,
            missionStatus: "enviada_para_revisao",
            businessId: business.id,
          },
        ],
      }),
    );
    render(<App />);

    await screen.findByText("Visão geral da equipe");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("1 colaboradores ativos"),
    );
    expect(document.body.textContent).toContain(
      "1 convites aguardando ativação",
    );
    expect(document.body.textContent).toContain(
      "1 entregas aguardando revisão",
    );
    expect(document.body.textContent).toContain("1 tarefas atrasadas");
  });

  it("painel do colaborador mostra tarefas, entregas e correções da própria pessoa", async () => {
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
    seedLoggedIn(
      businessDb({
        preferences: {
          theme: "light",
          specialist: "Diretor",
          mode: "employee",
          modeChosen: true,
        },
        tasks: [
          {
            id: "t1",
            title: "Minha tarefa",
            status: "Em andamento",
            assigneeId: user.id,
            businessId: business.id,
          },
          {
            id: "t2",
            title: "Correção pendente",
            isMission: true,
            missionStatus: "correcao_solicitada",
            assigneeId: user.id,
            status: "Em andamento",
            businessId: business.id,
          },
        ],
        developmentPlans: [
          {
            id: "p1",
            title: "Meu plano",
            status: "Em andamento",
            assigneeId: user.id,
          },
        ],
      }),
    );
    render(<App />);

    await screen.findByText("Meu resumo");
    expect(document.body.textContent).toContain("2 tarefas em andamento comigo");
    expect(document.body.textContent).toContain("1 correções pendentes");
    expect(document.body.textContent).toContain("Meu plano de desenvolvimento:");
  });
});
