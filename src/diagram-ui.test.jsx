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

const user = { id: "user-dgm", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-dgm-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const no = (id, shape, x, y, text = "", extra = {}) => ({
  id,
  shape,
  x,
  y,
  w: 160,
  h: 70,
  text,
  layer: 0,
  dataBaseId: "",
  dataRowId: "",
  dataField: "",
  ...extra,
});

const diagrama = (extra = {}) => ({
  id: "dg-1",
  name: "Fluxo do pedido",
  nodes: [],
  edges: [],
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-29T10:00:00.000Z",
  ...extra,
});

const businessDb = (diagrams = [], databases = []) => ({
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
  diagrams,
  databases,
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
  localStorage.setItem("seu-funcionario-auth-token", "token-dgm");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirDiagramas = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Diagramas" }));
  await waitFor(() => expect(document.querySelector(".dgm")).toBeTruthy());
};

describe("Diagramas técnicos", () => {
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

  it("mostra o estado vazio", async () => {
    seedLoggedIn(businessDb([]));
    await abrirDiagramas();
    expect(await screen.findByText("Nenhum diagrama ainda")).toBeInTheDocument();
  });

  it("oferece as formas da categoria escolhida", async () => {
    seedLoggedIn(businessDb([diagrama()]));
    await abrirDiagramas();

    const paleta = document.querySelector(".dgm-shapes");
    expect(within(paleta).getByText("Decisão")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Categoria de formas"), {
      target: { value: "bpmn" },
    });
    expect(within(paleta).getByText("Gateway")).toBeInTheDocument();
    expect(within(paleta).getByText("Evento inicial")).toBeInTheDocument();
  });

  it("adiciona uma forma e permite escrever nela", async () => {
    seedLoggedIn(businessDb([diagrama()]));
    await abrirDiagramas();

    const paleta = document.querySelector(".dgm-shapes");
    fireEvent.click(within(paleta).getByText("Processo"));

    const campo = await screen.findByLabelText("Texto de Processo");
    fireEvent.change(campo, { target: { value: "Receber pedido" } });
    expect(screen.getByDisplayValue("Receber pedido")).toBeInTheDocument();
  });

  it("desenha um conector entre duas formas", async () => {
    seedLoggedIn(
      businessDb([
        diagrama({
          nodes: [no("a", "processo", 0, 0, "Um"), no("b", "processo", 400, 0, "Dois")],
        }),
      ]),
    );
    await abrirDiagramas();

    expect(document.querySelectorAll(".dgm-edges path")).toHaveLength(0);

    fireEvent.click(await screen.findByRole("button", { name: /Conectar formas/ }));
    fireEvent.click(screen.getByDisplayValue("Um").closest(".dgm-node"));
    fireEvent.click(screen.getByDisplayValue("Dois").closest(".dgm-node"));

    await waitFor(() =>
      expect(document.querySelectorAll(".dgm-edges path")).toHaveLength(1),
    );
  });

  it("acusa forma solta e conector inválido na validação", async () => {
    seedLoggedIn(
      businessDb([
        diagrama({
          nodes: [no("a", "processo", 0, 0, "Ligada"), no("solta", "processo", 0, 300, "Sozinha")],
          edges: [{ id: "e1", from: "a", to: "fantasma", label: "", kind: "seta" }],
        }),
      ]),
    );
    await abrirDiagramas();

    const botao = await screen.findByRole("button", { name: /erro\(s\)/ });
    fireEvent.click(botao);

    const painel = document.querySelector(".dgm-validation");
    expect(painel.textContent).toContain("Conector inválido");
    expect(painel.textContent).toContain("Sozinha");
  });

  it("valida as regras de BPMN", async () => {
    seedLoggedIn(
      businessDb([
        diagrama({
          nodes: [
            { ...no("i", "bpmn-inicio", 0, 0, "Começo"), w: 60, h: 60 },
            { ...no("g", "bpmn-gateway", 200, 0, "Decide"), w: 80, h: 80 },
            { ...no("f", "bpmn-fim", 400, 0, "Fim"), w: 60, h: 60 },
          ],
          edges: [
            { id: "e1", from: "i", to: "g", label: "", kind: "seta" },
            { id: "e2", from: "g", to: "f", label: "", kind: "seta" },
          ],
        }),
      ]),
    );
    await abrirDiagramas();

    fireEvent.click(await screen.findByRole("button", { name: /erro\(s\)/ }));
    const painel = document.querySelector(".dgm-validation");
    expect(painel.textContent).toContain("gateway");
    expect(painel.textContent).toContain("dois caminhos de saída");
  });

  it("mostra diagrama válido quando está tudo certo", async () => {
    seedLoggedIn(
      businessDb([
        diagrama({
          nodes: [no("a", "processo", 0, 0, "Um"), no("b", "processo", 400, 0, "Dois")],
          edges: [{ id: "e1", from: "a", to: "b", label: "", kind: "seta" }],
        }),
      ]),
    );
    await abrirDiagramas();

    expect(
      await screen.findByRole("button", { name: /Diagrama válido/ }),
    ).toBeInTheDocument();
  });

  it("importa de Mermaid substituindo o conteúdo", async () => {
    seedLoggedIn(businessDb([diagrama()]));
    await abrirDiagramas();

    fireEvent.click(await screen.findByRole("button", { name: /Importar/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Cole o conteúdo"), {
      target: {
        value: "flowchart TD\n  A[Pedido] --> B{Tem estoque?}",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Importar" }));

    expect(await screen.findByText(/2 formas importadas/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pedido")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Tem estoque?")).toBeInTheDocument();
  });

  it("avisa quando o conteúdo importado não tem forma", async () => {
    seedLoggedIn(businessDb([diagrama()]));
    await abrirDiagramas();

    fireEvent.click(await screen.findByRole("button", { name: /Importar/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Cole o conteúdo"), {
      target: { value: "isso não é um diagrama" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Importar" }));

    expect(
      await screen.findByText(/não encontrei formas/i),
    ).toBeInTheDocument();
  });

  it("gera organograma a partir de uma base de dados", async () => {
    const base = {
      id: "base-1",
      name: "Equipe",
      businessId: business.id,
      fields: [
        { id: "f1", name: "Pessoa", type: "text" },
        { id: "f2", name: "Responde a", type: "text" },
      ],
      rows: [
        { id: "r1", cells: { f1: "Renata", f2: "" } },
        { id: "r2", cells: { f1: "Ana", f2: "Renata" } },
      ],
    };
    seedLoggedIn(businessDb([diagrama()], [base]));
    await abrirDiagramas();

    fireEvent.change(
      await screen.findByLabelText("Gerar organograma de uma base"),
      { target: { value: "base-1" } },
    );

    expect(await screen.findByText(/2 formas/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Renata")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ana")).toBeInTheDocument();
  });

  it("pinta a forma conforme a situação informada", async () => {
    seedLoggedIn(
      businessDb([diagrama({ nodes: [no("a", "processo", 0, 0, "Etapa")] })]),
    );
    await abrirDiagramas();

    fireEvent.click(screen.getByDisplayValue("Etapa").closest(".dgm-node"));
    fireEvent.change(await screen.findByLabelText(/Situação/), {
      target: { value: "atrasado" },
    });

    const forma = screen.getByDisplayValue("Etapa").closest(".dgm-node");
    expect(forma.style.background).toContain("220, 38, 38");
  });

  it("exclui a forma junto com os conectores dela", async () => {
    seedLoggedIn(
      businessDb([
        diagrama({
          nodes: [no("a", "processo", 0, 0, "Um"), no("b", "processo", 400, 0, "Dois")],
          edges: [{ id: "e1", from: "a", to: "b", label: "", kind: "seta" }],
        }),
      ]),
    );
    await abrirDiagramas();

    fireEvent.click(screen.getByDisplayValue("Um").closest(".dgm-node"));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir forma/ }));

    expect(screen.queryByDisplayValue("Um")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".dgm-edges path")).toHaveLength(0);
  });
});
