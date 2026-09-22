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

const user = { id: "user-nt", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-nt-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const nota = (id, title, content) => ({
  id,
  title,
  content,
  kind: "nota",
  date: "",
  tags: [],
  businessId: business.id,
  createdAt: "2026-07-01T10:00:00Z",
  updatedAt: "2026-07-01T10:00:00Z",
});

const businessDb = (extra = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-nt");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const salvo = () =>
  JSON.parse(localStorage.getItem(`seu-funcionario-v2:${user.id}`));

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Conhecimento conectado" }));
  await waitFor(() => expect(document.querySelector(".nt")).toBeTruthy());
};

const irPara = (aba) => fireEvent.click(screen.getByRole("tab", { name: aba }));

describe("Conhecimento conectado", () => {
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

  it("convida a começar quando não há nota nenhuma", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    expect(
      await screen.findByText(/Ainda não há notas/),
    ).toBeInTheDocument();
  });

  it("cria a nota do dia com o roteiro de journaling", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Nota de hoje/ }));

    await waitFor(() => {
      const n = salvo().notes[0];
      expect(n.kind).toBe("diaria");
      expect(n.content).toContain("O foco de hoje");
    });
  });

  it("não cria duas notas do mesmo dia", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Nota de hoje/ }));
    await waitFor(() => expect(salvo().notes).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Nota de hoje/ }));
    await waitFor(() => expect(salvo().notes).toHaveLength(1));
  });

  it("mostra quem cita a nota aberta, com o trecho limpo", async () => {
    seedLoggedIn(
      businessDb({
        notes: [
          nota("a", "Contrato padrão", "corpo da nota"),
          nota("b", "Reunião com Ana", "revisamos o [[Contrato padrão]] junto"),
        ],
      }),
    );
    await abrir();

    const painel = await waitFor(() => {
      const el = [...document.querySelectorAll(".nt-panels section")].find((s) =>
        s.textContent.includes("Citada em"),
      );
      expect(el).toBeTruthy();
      return el;
    });
    expect(painel.textContent).toContain("Reunião com Ana");
    expect(painel.textContent).not.toContain("[[");
  });

  it("acha a citação em texto corrido e transforma em ligação", async () => {
    seedLoggedIn(
      businessDb({
        notes: [
          nota("a", "Contrato padrão", "corpo"),
          nota("b", "Reunião", "falamos do contrato padrão na segunda"),
        ],
      }),
    );
    await abrir();

    const painel = await waitFor(() => {
      const el = [...document.querySelectorAll(".nt-panels section")].find((s) =>
        s.textContent.includes("Citada sem ligação"),
      );
      expect(el.textContent).toContain("Reunião");
      return el;
    });

    fireEvent.click([...painel.querySelectorAll("button")].find((b) => b.textContent === "Ligar"));
    await waitFor(() => {
      const b = salvo().notes.find((n) => n.id === "b");
      expect(b.content).toContain("[[contrato padrão]]");
    });
  });

  it("avisa quando duas notas se embutem uma na outra em vez de travar", async () => {
    seedLoggedIn(
      businessDb({
        notes: [
          nota("a", "Nota A", "começo ![[Nota B]]"),
          nota("b", "Nota B", "volta ![[Nota A]]"),
        ],
      }),
    );
    await abrir();

    await waitFor(() =>
      expect(document.querySelector(".nt-warn")?.textContent || "").toMatch(
        /embute a si mesma/,
      ),
    );
  });

  it("desenha a rede em volta da nota e permite pular para a vizinha", async () => {
    seedLoggedIn(
      businessDb({
        notes: [
          nota("a", "Nota A", "liga para [[Nota B]]"),
          nota("b", "Nota B", "fim"),
        ],
      }),
    );
    await abrir();
    irPara("Rede de ideias");

    const svg = await waitFor(() => {
      const el = document.querySelector(".nt-graph");
      expect(el).toBeTruthy();
      return el;
    });
    expect(svg.querySelectorAll(".nt-node").length).toBe(2);
  });

  it("gera cartões da nota e conta os que vencem hoje", async () => {
    seedLoggedIn(
      businessDb({
        notes: [
          nota("a", "Fiscal", "MEI :: microempreendedor individual\nDAS :: imposto do mês"),
        ],
      }),
    );
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Gerar cartões desta nota/ }));

    await waitFor(() => expect(salvo().flashcards).toHaveLength(2));

    irPara("Revisão");
    await waitFor(() => {
      const stats = document.querySelector(".nt-cards-stats");
      expect(stats.textContent).toContain("2");
    });
  });

  it("responder um cartão adia a próxima volta dele", async () => {
    seedLoggedIn(
      businessDb({
        flashcards: [
          {
            id: "c1",
            front: "O que é MEI?",
            back: "Microempreendedor individual",
            noteId: "a",
            businessId: business.id,
            ease: 2.5,
            interval: 0,
            reps: 0,
            lapses: 0,
            due: "",
            lastReviewed: "",
            createdAt: "2026-07-01T10:00:00Z",
          },
        ],
      }),
    );
    await abrir();
    irPara("Revisão");

    fireEvent.click(await screen.findByRole("button", { name: /Revisar 1 cartão/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar resposta" }));
    expect(screen.getByText("Microempreendedor individual")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lembrei" }));

    await waitFor(() => {
      const c = salvo().flashcards[0];
      expect(c.reps).toBe(1);
      expect(c.due).not.toBe("");
    });
  });

  it("lista a nota citada que ainda não existe e permite criá-la", async () => {
    seedLoggedIn(
      businessDb({
        notes: [nota("a", "Nota A", "preciso escrever sobre [[Proposta 2027]]")],
      }),
    );
    await abrir();
    irPara("Saúde da rede");

    const secao = await waitFor(() => {
      const el = [...document.querySelectorAll(".nt-health section")].find((s) =>
        s.textContent.includes("ainda não escritas"),
      );
      expect(el.textContent).toContain("Proposta 2027");
      return el;
    });

    fireEvent.click([...secao.querySelectorAll("button")].find((b) => b.textContent === "Criar"));
    await waitFor(() =>
      expect(salvo().notes.some((n) => n.title === "Proposta 2027")).toBe(true),
    );
  });

  it("acusa título repetido, que deixa a ligação ambígua", async () => {
    seedLoggedIn(
      businessDb({
        notes: [nota("a", "Contrato", "x"), nota("b", "contrato", "y")],
      }),
    );
    await abrir();
    irPara("Saúde da rede");

    await waitFor(() =>
      expect(document.querySelector(".nt-health").textContent).toMatch(
        /Títulos repetidos \(1\)/,
      ),
    );
  });

  it("editar a nota salva o texto e as etiquetas", async () => {
    seedLoggedIn(businessDb({ notes: [nota("a", "Minha nota", "texto")] }));
    await abrir();

    const corpo = await screen.findByLabelText("Conteúdo da nota");
    fireEvent.change(corpo, { target: { value: "novo texto #fiscal" } });
    fireEvent.blur(corpo);

    await waitFor(() => {
      const n = salvo().notes[0];
      expect(n.content).toBe("novo texto #fiscal");
      expect(n.tags).toEqual(["fiscal"]);
    });
  });
});
