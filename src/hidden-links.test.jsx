// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { navForMode } from "./App";
import { SEARCHABLE_SOURCES, searchWorkspace } from "./features/knowledge/searchDomain.js";

// Três links internos que levavam a lugar nenhum: o valor existia, mas o
// clique não chegava lá. Cada teste trava um deles.

const user = { id: "user-links", name: "Renata Silva", email: "renata@example.com" };
const business = { id: "biz-links", name: "Padaria Teste", stage: "Já vendo", segment: "Alimentação" };

const baseDb = (extra = {}) => ({
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
  preferences: { theme: "light", specialist: "Diretor", mode: "business", modeChosen: true },
  ...extra,
});

const response = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const entrar = async (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-links");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
};

const abrirNoMenu = (rotulo) => {
  const menu = document.querySelector("aside nav");
  fireEvent.click(within(menu).getByRole("button", { name: rotulo }));
};

describe("links internos que levavam a lugar nenhum", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT" ? response({ ok: true }) : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Dashboards: “Ver detalhes” abre o módulo do indicador", async () => {
    await entrar(baseDb());
    abrirNoMenu("Dashboards");
    const titulo = await screen.findByRole("heading", { name: /Decisões em um painel/ });
    expect(titulo).toBeInTheDocument();
    // O App não passava `go` ao painel: todo clique aqui era um TypeError.
    fireEvent.click(screen.getAllByRole("button", { name: "Ver detalhes" })[0]);
    expect(screen.queryByRole("heading", { name: /Decisões em um painel/ })).toBeNull();
  });

  it("Histórico: “Continuar no chat” leva à conversa, não ao Início", async () => {
    await entrar(
      baseDb({
        history: [
          {
            id: "h1",
            title: "Plano de divulgação da padaria",
            request: "Monte um plano de divulgação",
            result: "Plano pronto com três ações.",
            specialist: "Marketing",
            type: "Plano",
            businessId: business.id,
            createdAt: "2026-09-20T12:00:00.000Z",
          },
        ],
      }),
    );
    abrirNoMenu("Histórico");
    fireEvent.click(await screen.findByRole("button", { name: /Plano de divulgação da padaria/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getAllByRole("button", { name: "Continuar no chat" })[0]);
    expect(await screen.findByRole("heading", { name: "Peça o que precisar" })).toBeInTheDocument();
  });

  it("Memória e busca: cada fonte abre uma tela que existe", () => {
    const telas = new Set(navForMode().map(([id]) => id));
    for (const fonte of SEARCHABLE_SOURCES)
      expect(telas.has(fonte.page), `${fonte.id} → ${fonte.page}`).toBe(true);
    const { results } = searchWorkspace(
      { tasks: [{ id: "t1", title: "Proposta para a Padaria Alfa" }] },
      "proposta",
    );
    expect(results[0].sourcePage).toBe("operacao");
  });
});
