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

const user = { id: "user-cvs", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-cvs-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const postit = (id, x, y, text = "", votes = []) => ({
  id,
  type: "postit",
  x,
  y,
  w: 160,
  h: 120,
  text,
  color: "#fde68a",
  votes,
  locked: false,
});

const quadro = (extra = {}) => ({
  id: "b-1",
  name: "Ideias do mês",
  elements: [],
  view: { x: 0, y: 0, zoom: 1 },
  timerStartedAt: "",
  timerSeconds: 0,
  votingOpen: false,
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-29T10:00:00.000Z",
  ...extra,
});

const businessDb = (boards = []) => ({
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
  opportunities: [],
  meetings: [],
  boards,
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

const response = (data, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(data) });

let aiRespondeu = "Tema: Atendimento\n- responder mais rápido\n\nTema: Preço\n- revisar tabela";

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-cvs");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

// "Quadro" aparece no menu e no título, então esperamos pela seção em si.
const abrirQuadro = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Quadro visual" }));
  await waitFor(() => expect(document.querySelector(".cvs")).toBeTruthy());
};

describe("Quadro visual", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    aiRespondeu = "Tema: Atendimento\n- responder mais rápido\n\nTema: Preço\n- revisar tabela";
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (url === "/api/ai") return response({ text: aiRespondeu });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("oferece os modelos visuais quando não há quadro", async () => {
    seedLoggedIn(businessDb([]));
    await abrirQuadro();
    expect(await screen.findByText("Nenhum quadro ainda")).toBeInTheDocument();
    const templates = document.querySelector(".cvs-templates");
    expect(within(templates).getByText("SWOT")).toBeInTheDocument();
    expect(
      within(templates).getByText("Canvas de modelo de negócio"),
    ).toBeInTheDocument();
    expect(within(templates).getByText("Retrospectiva")).toBeInTheDocument();
  });

  it("cria um quadro a partir do modelo SWOT com as quatro áreas", async () => {
    seedLoggedIn(businessDb([]));
    await abrirQuadro();

    const templates = document.querySelector(".cvs-templates");
    fireEvent.click(within(templates).getByText("SWOT").closest("button"));

    // "SWOT" aparece no seletor e no campo de nome; conferimos o campo.
    const nome = await screen.findByLabelText("Nome do quadro");
    expect(nome).toHaveValue("SWOT");
    const areas = [...document.querySelectorAll(".cvs-frame-title")].map(
      (i) => i.value,
    );
    expect(areas).toEqual(["Forças", "Fraquezas", "Oportunidades", "Ameaças"]);
  });

  it("adiciona um post-it e permite escrever nele", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: "Post-it" }));
    const campo = await screen.findByLabelText("Texto do postit");
    fireEvent.change(campo, { target: { value: "Atender melhor" } });

    expect(screen.getByDisplayValue("Atender melhor")).toBeInTheDocument();
  });

  it("transforma os post-its escritos em tarefas de verdade", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          elements: [postit("p1", 0, 0, "Ligar para o fornecedor"), postit("p2", 0, 0, "")],
        }),
      ]),
    );
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /Tarefas/ }));

    expect(await screen.findByText(/1 tarefa criada/)).toBeInTheDocument();
    const salvo = JSON.parse(
      localStorage.getItem(`seu-funcionario-v2:${user.id}`),
    );
    const criadas = salvo.tasks.filter((t) => t.boardId === "b-1");
    expect(criadas).toHaveLength(1);
    expect(criadas[0].title).toBe("Ligar para o fornecedor");
  });

  it("abre a votação, registra voto e mostra os mais votados", async () => {
    seedLoggedIn(
      businessDb([quadro({ elements: [postit("p1", 0, 0, "Ideia boa")] })]),
    );
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /Votação/ }));
    fireEvent.click(await screen.findByLabelText("Votar em Ideia boa"));

    const top = document.querySelector(".cvs-top");
    expect(top.textContent).toContain("Ideia boa");
    expect(top.textContent).toContain("1");

    // Votar de novo desfaz o voto e o painel de mais votados desaparece.
    fireEvent.click(screen.getByLabelText("Votar em Ideia boa"));
    expect(document.querySelector(".cvs-top")).toBeNull();
  });

  it("inicia o cronômetro do facilitador", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /5 min/ }));

    expect(await screen.findByText(/0[45]:\d\d/)).toBeInTheDocument();
  });

  it("agrupa post-its próximos e reorganiza o quadro", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          elements: [
            postit("p1", 0, 0, "a"),
            postit("p2", 40, 30, "b"),
            postit("p3", 2000, 2000, "c"),
          ],
        }),
      ]),
    );
    await abrirQuadro();

    const acoes = screen.getByLabelText("Ações do quadro");
    fireEvent.click(within(acoes).getByRole("button", { name: /^Agrupar$/ }));

    expect(await screen.findByText(/2 grupos organizados/)).toBeInTheDocument();
  });

  it("agrupa as ideias por tema com a IA", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          elements: [postit("p1", 0, 0, "responder mais rápido")],
        }),
      ]),
    );
    await abrirQuadro();

    fireEvent.click(
      await screen.findByRole("button", { name: /Agrupar ideias por tema/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Atendimento")).toBeInTheDocument();
    expect(within(dialog).getByText("responder mais rápido")).toBeInTheDocument();
    expect(within(dialog).getByText("Preço")).toBeInTheDocument();
  });

  it("aproxima e afasta alterando o nível de zoom mostrado", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    expect(await screen.findByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Aproximar"));
    expect(screen.getByText("120%")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Afastar"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("exclui o elemento selecionado", async () => {
    seedLoggedIn(
      businessDb([quadro({ elements: [postit("p1", 0, 0, "some daqui")] })]),
    );
    await abrirQuadro();

    const campo = await screen.findByDisplayValue("some daqui");
    fireEvent.mouseDown(campo.closest(".cvs-el"));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir/ }));

    expect(screen.queryByDisplayValue("some daqui")).not.toBeInTheDocument();
  });
});
