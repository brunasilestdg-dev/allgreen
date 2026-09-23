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

const user = { id: "user-pf", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-pf-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const projeto = (id, name, startDate, dueDate, extra = {}) => ({
  id,
  name,
  description: "",
  startDate,
  dueDate,
  status: "Em andamento",
  priority: "Média",
  budgetPlanned: 0,
  costActual: 0,
  hoursPlanned: 0,
  hoursActual: 0,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  milestones: [],
  risks: [],
  issues: [],
  decisions: [],
  changeRequests: [],
  businessId: business.id,
  ...extra,
});

const businessDb = (extra = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  projects: [],
  projectLinks: [],
  portfolioRisks: [],
  raci: [],
  notes: [],
  flashcards: [],
  transactions: [],
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
  ...extra,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-pf");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const salvo = () =>
  JSON.parse(localStorage.getItem(`seu-funcionario-v2:${user.id}`));

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Portfólio de projetos" }));
  await waitFor(() => expect(document.querySelector(".pf")).toBeTruthy());
};

const irPara = (aba) => fireEvent.click(screen.getByRole("tab", { name: aba }));

describe("Portfólio de projetos", () => {
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

  it("avisa quando ainda não há projeto", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    expect(
      await screen.findByText(/Nenhum projeto cadastrado ainda/),
    ).toBeInTheDocument();
  });

  it("resume o portfólio em português", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "Reforma", "2026-01-01", "2026-02-01"),
          projeto("b", "Site novo", "2026-01-01", "2027-12-01"),
        ],
      }),
    );
    await abrir();

    const resumo = await waitFor(() => {
      const el = document.querySelector(".pf-summary");
      expect(el).toBeTruthy();
      return el;
    });
    expect(resumo.textContent).toContain("2 projeto(s)");
    expect(resumo.textContent).toContain("Reforma");
  });

  it("empurra o projeto dependente e mostra por quem", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "Reforma", "2026-01-01", "2026-01-10"),
          projeto("b", "Inauguração", "2026-01-01", "2026-01-05"),
        ],
        projectLinks: [
          { id: "l1", fromId: "a", toId: "b", lagDays: 0, note: "", businessId: business.id },
        ],
      }),
    );
    await abrir();

    const linha = await waitFor(() => {
      const el = [...document.querySelectorAll(".pf-table tbody tr")].find((tr) =>
        tr.textContent.includes("Inauguração"),
      );
      expect(el).toBeTruthy();
      return el;
    });
    expect(linha.textContent).toContain("11/01/2026");
    expect(linha.textContent).toContain("Reforma");
  });

  it("recusa dependência que fecha um círculo, explicando o motivo", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "A", "2026-01-01", "2026-01-10"),
          projeto("b", "B", "2026-01-01", "2026-01-20"),
        ],
        projectLinks: [
          { id: "l1", fromId: "a", toId: "b", lagDays: 0, note: "", businessId: business.id },
        ],
      }),
    );
    await abrir();
    irPara("Dependências");

    fireEvent.change(await screen.findByLabelText("Projeto que vem antes"), {
      target: { value: "b" },
    });
    fireEvent.change(screen.getByLabelText("Projeto que vem depois"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ligar/ }));

    expect(await screen.findByText(/cria um círculo/)).toBeInTheDocument();
    expect(salvo().projectLinks).toHaveLength(1);
  });

  it("simula o atraso e mostra quem escorrega junto", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "Reforma", "2026-01-01", "2026-01-10"),
          projeto("b", "Inauguração", "2026-01-11", "2026-01-20"),
        ],
        projectLinks: [
          { id: "l1", fromId: "a", toId: "b", lagDays: 0, note: "", businessId: business.id },
        ],
      }),
    );
    await abrir();

    fireEvent.change(await screen.findByLabelText("Projeto que vai atrasar"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("Dias de atraso"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      const el = document.querySelector(".pf-effect");
      expect(el.textContent).toContain("Inauguração");
      expect(el.textContent).toContain("5 dia(s)");
    });
  });

  it("diz quando o atraso não espalha para ninguém", async () => {
    seedLoggedIn(
      businessDb({ projects: [projeto("a", "Sozinho", "2026-01-01", "2026-12-10")] }),
    );
    await abrir();

    fireEvent.change(await screen.findByLabelText("Projeto que vai atrasar"), {
      target: { value: "a" },
    });
    expect(await screen.findByText(/não espalha/)).toBeInTheDocument();
  });

  it("registra risco e classifica o nível dele", async () => {
    seedLoggedIn(
      businessDb({ projects: [projeto("a", "A", "2026-01-01", "2026-12-01")] }),
    );
    await abrir();
    irPara("Riscos");

    fireEvent.change(await screen.findByLabelText("Nome do risco"), {
      target: { value: "Fornecedor atrasar" },
    });
    fireEvent.change(screen.getByLabelText("Chance de acontecer"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Impacto se acontecer"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Registrar/ }));

    await waitFor(() => expect(salvo().portfolioRisks).toHaveLength(1));
    await waitFor(() =>
      expect(document.querySelector(".pf-risk-level.critico")).toBeTruthy(),
    );
  });

  it("avisa sobre risco grave sem dono nem plano", async () => {
    seedLoggedIn(
      businessDb({
        portfolioRisks: [
          {
            id: "r1",
            title: "Sem ninguém cuidando",
            projectId: "",
            probability: 4,
            impact: 4,
            response: "mitigar",
            ownerName: "",
            plan: "",
            status: "aberto",
            businessId: business.id,
            createdAt: "2026-07-01T10:00:00Z",
          },
        ],
        projects: [projeto("a", "A", "2026-01-01", "2026-12-01")],
      }),
    );
    await abrir();
    irPara("Riscos");

    expect(
      await screen.findByText(/sem dono ou sem plano/),
    ).toBeInTheDocument();
  });

  it("acusa duas pessoas respondendo pela mesma atividade", async () => {
    seedLoggedIn(
      businessDb({
        projects: [projeto("a", "A", "2026-01-01", "2026-12-01", { manager: "Ana" })],
        raci: [
          {
            id: "ra1",
            activity: "Aprovar orçamento",
            projectId: "a",
            assignments: { Ana: "A", João: "A" },
            businessId: business.id,
          },
        ],
      }),
    );
    await abrir();
    irPara("Quem responde");

    const problemas = await waitFor(() => {
      const el = document.querySelector(".pf-raci-problems");
      expect(el).toBeTruthy();
      return el;
    });
    expect(problemas.textContent).toMatch(/Só uma pessoa pode responder/);
  });

  it("aponta trabalho que aparece em dois projetos", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "Projeto A", "2026-01-01", "2026-12-01"),
          projeto("b", "Projeto B", "2026-01-01", "2026-12-01"),
        ],
        tasks: [
          {
            id: "t1",
            projectId: "a",
            title: "Contratar fotógrafo",
            status: "pendente",
            businessId: business.id,
          },
          {
            id: "t2",
            projectId: "b",
            title: "Contratar fotógrafo",
            status: "pendente",
            businessId: business.id,
          },
        ],
      }),
    );
    await abrir();

    await waitFor(() =>
      expect(document.body.textContent).toMatch(/feito duas vezes/),
    );
    expect(document.body.textContent).toContain("Contratar fotógrafo");
  });

  it("explica por que o projeto atrasou", async () => {
    seedLoggedIn(
      businessDb({
        projects: [projeto("a", "Atrasadinho", "2026-01-01", "2026-02-01")],
        tasks: [
          {
            id: "t1",
            projectId: "a",
            title: "Tarefa travada",
            status: "pendente",
            blocked: true,
            businessId: business.id,
          },
        ],
      }),
    );
    await abrir();

    const causas = await waitFor(() => {
      const el = document.querySelector(".pf-causes");
      expect(el).toBeTruthy();
      return el;
    });
    expect(causas.textContent).toContain("Atrasadinho");
    expect(causas.textContent).toMatch(/travada/);
  });

  it("cria dependência entre dois projetos", async () => {
    seedLoggedIn(
      businessDb({
        projects: [
          projeto("a", "Primeiro", "2026-01-01", "2026-01-10"),
          projeto("b", "Segundo", "2026-01-01", "2026-01-20"),
        ],
      }),
    );
    await abrir();
    irPara("Dependências");

    fireEvent.change(await screen.findByLabelText("Projeto que vem antes"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("Projeto que vem depois"), {
      target: { value: "b" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ligar/ }));

    await waitFor(() => expect(salvo().projectLinks).toHaveLength(1));
  });
});
