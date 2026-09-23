// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-kc", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-kc-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (extra = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [
    {
      id: "t1",
      title: "Emitir nota fiscal do cliente",
      notes: "urgente",
      status: "pendente",
      businessId: business.id,
    },
    { id: "t2", title: "Comprar embalagens", status: "pendente", businessId: business.id },
  ],
  documents: [
    {
      id: "d1",
      title: "Contrato padrão",
      content: "O pagamento do cliente ocorre em 30 dias após a nota fiscal.",
      businessId: business.id,
      updatedAt: "2025-01-10T10:00:00Z",
    },
  ],
  memories: [],
  glossary: [],
  appointments: [],
  leads: [],
  products: [],
  orders: [],
  contacts: [],
  timeEntries: [],
  transactions: [],
  bills: [],
  opportunities: [],
  meetings: [],
  boards: [],
  diagrams: [],
  whiteboards: [],
  workHours: null,
  salesPipeline: null,
  financeSettings: {},
  taxProfile: { isMEI: false, dueDay: 20, cnpj: "", dasHistory: {} },
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

let respostaIa = "O cliente paga em 30 dias após a nota fiscal [1].";

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-kc");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Memória e busca" }));
  await waitFor(() => expect(document.querySelector(".kc")).toBeTruthy());
};

const buscar = async (termo) => {
  const campo = await screen.findByLabelText("Buscar no workspace");
  fireEvent.change(campo, { target: { value: termo } });
};

describe("Memória e busca", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    respostaIa = "O cliente paga em 30 dias após a nota fiscal [1].";
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (url === "/api/ai") return response({ text: respostaIa });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("busca no workspace e mostra a fonte de cada resultado", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    await buscar("nota fiscal");

    const resultados = await waitFor(() => {
      const el = document.querySelector(".kc-results");
      expect(el.children.length).toBeGreaterThan(0);
      return el;
    });
    expect(resultados.textContent).toContain("Emitir nota fiscal do cliente");
    expect(resultados.textContent).toContain("Tarefas");
    expect(resultados.textContent).toContain("Documentos");
  });

  it("acha o plural pelo singular", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    await buscar("clientes");
    await waitFor(() =>
      expect(document.querySelector(".kc-results").children.length).toBeGreaterThan(0),
    );
  });

  it("filtra por área", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    await buscar("nota fiscal");
    fireEvent.change(screen.getByLabelText("Filtrar por área"), {
      target: { value: "documents" },
    });
    await waitFor(() => {
      const texto = document.querySelector(".kc-results").textContent;
      expect(texto).toContain("Contrato padrão");
      expect(texto).not.toContain("Emitir nota fiscal do cliente");
    });
  });

  it("o glossário faz a sigla encontrar o termo por extenso", async () => {
    seedLoggedIn(businessDb());
    await abrir();

    fireEvent.change(screen.getByLabelText("Termo"), {
      target: { value: "nota fiscal" },
    });
    fireEvent.change(screen.getByLabelText("Sinônimos separados por vírgula"), {
      target: { value: "NF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));

    await buscar("NF");
    await waitFor(() =>
      expect(document.querySelector(".kc-results").textContent).toContain(
        "Emitir nota fiscal",
      ),
    );
  });

  it("responde com citações clicáveis das fontes", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    await buscar("nota fiscal");

    fireEvent.click(
      await screen.findByRole("button", { name: /Responder com citações/ }),
    );

    const resposta = await waitFor(() => {
      const el = document.querySelector(".kc-answer");
      expect(el).toBeTruthy();
      return el;
    });
    expect(resposta.textContent).toContain("30 dias");
    expect(within(resposta).getAllByRole("button").length).toBeGreaterThan(0);
    expect(resposta.textContent).toMatch(/em vez de inventar/);
  });

  it("avisa quando não encontra nada", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    await buscar("girafa astronauta");
    expect(
      await screen.findByText("Nada encontrado no seu workspace."),
    ).toBeInTheDocument();
  });

  it("guarda uma memória e a lista aparece", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Memória da IA" }));

    fireEvent.change(await screen.findByLabelText("Nova memória"), {
      target: { value: "Entregamos bolos somente pela manhã" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));

    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      const m = salvo.memories[0];
      expect(m.text).toBe("Entregamos bolos somente pela manhã");
      expect(m.approved).toBe(true);
    });
  });

  it("dado sensível fica pendente de aprovação e é avisado antes", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Memória da IA" }));

    fireEvent.change(await screen.findByLabelText("Nova memória"), {
      target: { value: "O CPF da cliente é 123.456.789-00" },
    });
    expect(await screen.findByText(/contém CPF/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      expect(salvo.memories[0].approved).toBe(false);
    });
    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });

  it("acusa memórias que se contradizem", async () => {
    seedLoggedIn(
      businessDb({
        memories: [
          {
            id: "m1",
            text: "Atendemos aos sábados pela manhã",
            scope: "empresa",
            scopeRef: "",
            source: "manual",
            approved: true,
            required: false,
            createdAt: "2026-07-01T10:00:00Z",
            reviewAt: "",
            businessId: business.id,
          },
          {
            id: "m2",
            text: "Não atendemos aos sábados pela manhã",
            scope: "empresa",
            scopeRef: "",
            source: "manual",
            approved: true,
            required: false,
            createdAt: "2026-07-02T10:00:00Z",
            reviewAt: "",
            businessId: business.id,
          },
        ],
      }),
    );
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Memória da IA" }));

    expect(await screen.findByText(/Memórias que se batem/)).toBeInTheDocument();
    expect(document.querySelector(".kc-conflicts").textContent).toContain(
      "Contradição",
    );
  });

  it("apaga a memória quando confirmado", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    seedLoggedIn(
      businessDb({
        memories: [
          {
            id: "m1",
            text: "Uma memória qualquer para apagar",
            scope: "empresa",
            scopeRef: "",
            source: "manual",
            approved: true,
            required: false,
            createdAt: "2026-07-01T10:00:00Z",
            reviewAt: "",
            businessId: business.id,
          },
        ],
      }),
    );
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Memória da IA" }));

    fireEvent.click(await screen.findByLabelText(/Apagar memória/));
    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      expect(salvo.memories).toHaveLength(0);
    });
  });

  it("mostra conteúdo repetido e conteúdo velho na saúde", async () => {
    const db = businessDb();
    db.tasks.push({
      id: "t9",
      title: "Emitir nota fiscal do cliente",
      status: "pendente",
      businessId: business.id,
    });
    seedLoggedIn(db);
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Saúde do conteúdo" }));

    const saude = await waitFor(() => {
      const el = document.querySelector(".kc-health");
      expect(el).toBeTruthy();
      return el;
    });
    expect(saude.textContent).toContain("parecido");
    expect(saude.textContent).toContain("Contrato padrão");
    expect(saude.textContent).toMatch(/Nada é apagado por conta própria/);
  });
});
