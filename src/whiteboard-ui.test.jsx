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

const user = { id: "user-qwb", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-qwb-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const traco = (id, points, tool = "caneta") => ({
  id,
  tool,
  color: "#0f172a",
  width: 3,
  points,
});

const quadro = (extra = {}) => ({
  id: "wb-1",
  name: "Reunião de terça",
  strokes: [],
  notes: [],
  meetingId: "",
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z",
  ...extra,
});

const businessDb = (whiteboards = []) => ({
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
  boards: [],
  diagrams: [],
  whiteboards,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-qwb");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirQuadro = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Quadro rápido" }));
  await waitFor(() => expect(document.querySelector(".qwb")).toBeTruthy());
};

// jsdom não dá dimensões ao elemento, então o retângulo do quadro é zerado e as
// coordenadas do evento chegam como estão — o que serve para o teste.
const desenhar = (pontos) => {
  const area = document.querySelector(".qwb-area");
  fireEvent.mouseDown(area, { clientX: pontos[0].x, clientY: pontos[0].y });
  for (const ponto of pontos.slice(1))
    fireEvent.mouseMove(area, { clientX: ponto.x, clientY: ponto.y });
  fireEvent.mouseUp(area, {
    clientX: pontos[pontos.length - 1].x,
    clientY: pontos[pontos.length - 1].y,
  });
};

const caminhos = () => document.querySelectorAll(".qwb-canvas path");

describe("Quadro rápido", () => {
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

  it("mostra o estado vazio e explica a diferença do quadro visual", async () => {
    seedLoggedIn(businessDb([]));
    await abrirQuadro();
    expect(
      await screen.findByText("Nenhum quadro rápido ainda"),
    ).toBeInTheDocument();
    expect(screen.getByText(/desenhar à mão livre/)).toBeInTheDocument();
  });

  it("desenha um traço livre e o guarda", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    expect(caminhos()).toHaveLength(0);
    desenhar([
      { x: 10, y: 10 },
      { x: 30, y: 60 },
      { x: 12, y: 40 },
      { x: 70, y: 15 },
    ]);
    await waitFor(() => expect(caminhos().length).toBeGreaterThan(0));
  });

  it("endireita um retângulo desenhado torto", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    // Perímetro de um retângulo, com tremor.
    const pontos = [];
    for (let i = 0; i <= 10; i += 1) pontos.push({ x: i * 14, y: (i % 3) - 1 });
    for (let i = 1; i <= 10; i += 1) pontos.push({ x: 140 + ((i % 3) - 1), y: i * 9 });
    for (let i = 1; i <= 10; i += 1) pontos.push({ x: 140 - i * 14, y: 90 + ((i % 3) - 1) });
    for (let i = 1; i <= 10; i += 1) pontos.push({ x: (i % 3) - 1, y: 90 - i * 9 });
    desenhar(pontos);

    expect(await screen.findByText(/Virou retangulo/)).toBeInTheDocument();
  });

  it("a régua deixa a linha reta", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /Régua/ }));
    desenhar([
      { x: 0, y: 0 },
      { x: 50, y: 6 },
      { x: 100, y: 9 },
    ]);

    await waitFor(() => expect(caminhos()).toHaveLength(1));
    // Dois pontos e mesma altura: a linha foi encaixada na horizontal.
    const d = caminhos()[0].getAttribute("d");
    expect(d).toBe("M 0 0 L 100 0");
  });

  it("a borracha apaga o traço encostado", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          strokes: [
            traco("s1", [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ]),
          ],
        }),
      ]),
    );
    await abrirQuadro();

    await waitFor(() => expect(caminhos()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Borracha/ }));
    const area = document.querySelector(".qwb-area");
    fireEvent.mouseDown(area, { clientX: 50, clientY: 2 });
    fireEvent.mouseUp(area, { clientX: 50, clientY: 2 });

    await waitFor(() => expect(caminhos()).toHaveLength(0));
  });

  it("desfaz o último traço", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          strokes: [
            traco("s1", [{ x: 0, y: 0 }, { x: 10, y: 10 }]),
            traco("s2", [{ x: 20, y: 20 }, { x: 30, y: 30 }]),
          ],
        }),
      ]),
    );
    await abrirQuadro();

    await waitFor(() => expect(caminhos()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(caminhos()).toHaveLength(1));
  });

  it("adiciona nota, reage a ela e conta a reação", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /Nota/ }));
    const campo = await screen.findByLabelText("Nota do quadro");
    fireEvent.change(campo, { target: { value: "Cobrar o fornecedor" } });

    fireEvent.click(screen.getByLabelText("Reagir 👍"));
    const reacoes = document.querySelector(".qwb-reactions");
    await waitFor(() => expect(reacoes.textContent).toContain("1"));

    // Reagir de novo desfaz.
    fireEvent.click(screen.getByLabelText("Reagir 👍"));
    await waitFor(() =>
      expect(document.querySelector(".qwb-reactions em")).toBeNull(),
    );
  });

  it("transforma as notas escritas em tarefas", async () => {
    seedLoggedIn(
      businessDb([
        quadro({
          notes: [
            { id: "n1", x: 10, y: 10, text: "Ligar para a gráfica", reactions: {} },
            { id: "n2", x: 10, y: 90, text: "", reactions: {} },
          ],
        }),
      ]),
    );
    await abrirQuadro();

    fireEvent.click(await screen.findByRole("button", { name: /Virar tarefas/ }));

    expect(await screen.findByText(/1 tarefa criada/)).toBeInTheDocument();
    const salvo = JSON.parse(
      localStorage.getItem(`seu-funcionario-v2:${user.id}`),
    );
    const criadas = salvo.tasks.filter((t) => t.whiteboardId === "wb-1");
    expect(criadas).toHaveLength(1);
    expect(criadas[0].title).toBe("Ligar para a gráfica");
  });

  it("declara na tela os limites de escrita à mão e edição simultânea", async () => {
    seedLoggedIn(businessDb([quadro()]));
    await abrirQuadro();
    const aviso = document.querySelector(".qwb-hint");
    expect(aviso.textContent).toMatch(/escrita à mão não está incluíd/i);
    expect(aviso.textContent).toMatch(/simultânea/i);
  });
});
