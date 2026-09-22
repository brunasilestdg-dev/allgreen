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

const user = { id: "user-mn", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-mn-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (preferences = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  agents: [],
  agentRuns: [],
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
    ...preferences,
  },
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-mn");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const salvo = () =>
  JSON.parse(localStorage.getItem(`seu-funcionario-v2:${user.id}`));

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
};

const botoesDoMenu = () =>
  [...document.querySelectorAll("aside nav button")].map((b) =>
    b.textContent.trim(),
  );

describe("Menu escolhido pelo usuário", () => {
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
        if (url === "/api/plan")
          return response({
            plan: { id: "lancamento", name: "Lançamento", price: 0, pitch: "" },
            period: "2026-07",
            usage: [],
            suggestion: null,
          });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("o que a pessoa escolheu aparece primeiro, antes do resto", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();
    const nomes = botoesDoMenu();
    // Os escolhidos vêm antes do separador "Todas as ferramentas".
    const separador = nomes.findIndex((x) => x.includes("Todas as ferramentas"));
    expect(nomes.indexOf("Agentes")).toBeLessThan(separador);
  });

  it("fechar a lista completa deixa só o menu escolhido, e a escolha fica guardada", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();
    expect(botoesDoMenu()).toContain("Diagramas");

    fireEvent.click(screen.getByRole("button", { name: /Todas as ferramentas/ }));
    await waitFor(() => expect(botoesDoMenu()).not.toContain("Diagramas"));
    await waitFor(() =>
      expect(salvo().preferences.menuExpanded).toBe(false),
    );
  });

  it("quem já fechou antes continua com a visão enxuta ao voltar", async () => {
    seedLoggedIn(
      businessDb({ mainMenu: ["inicio", "agentes"], menuExpanded: false }),
    );
    await abrir();
    expect(botoesDoMenu()).toContain("Agentes");
    expect(botoesDoMenu()).not.toContain("Diagramas");
  });

  it("respeita o menu que a pessoa escolheu", async () => {
    seedLoggedIn(
      businessDb({ mainMenu: ["inicio", "agentes"], menuExpanded: false }),
    );
    await abrir();
    const nomes = botoesDoMenu();
    expect(nomes).toContain("Agentes");
    expect(nomes).not.toContain("Diagramas");
  });

  it("o que ficou de fora continua acessível em Todas as ferramentas", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio"], menuExpanded: false }));
    await abrir();

    expect(botoesDoMenu()).not.toContain("Diagramas");
    fireEvent.click(screen.getByRole("button", { name: /Todas as ferramentas/ }));
    await waitFor(() => expect(botoesDoMenu()).toContain("Diagramas"));
  });

  it("dá para abrir de verdade uma tela que está fora do menu", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio"] }));
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Agentes" }));
    await waitFor(() => expect(document.querySelector(".ag")).toBeTruthy());
  });

  it("tirar do menu não tira o acesso", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Personalizar menu" }));
    await waitFor(() => expect(document.querySelector(".ms")).toBeTruthy());

    const linha = [...document.querySelectorAll(".ms-escolhidos li")].find((li) =>
      li.textContent.includes("Agentes"),
    );
    fireEvent.click([...linha.querySelectorAll("button")].find((b) => b.textContent === "Tirar"));

    await waitFor(() =>
      expect(salvo().preferences.mainMenu).not.toContain("agentes"),
    );
    // Saiu do menu escolhido, mas continua alcançável na lista completa.
    await waitFor(() => expect(botoesDoMenu()).toContain("Agentes"));
  });

  it("adiciona uma ferramenta ao menu pela tela de personalização", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio"] }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Personalizar menu" }));

    // A lista vem agrupada por tema, então há vários .ms-todos; a busca
    // precisa varrer todos, não só o primeiro grupo.
    const alvo = await waitFor(() => {
      const el = [...document.querySelectorAll(".ms-todos li")].find((li) =>
        li.textContent.includes("Diagramas"),
      );
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(alvo.querySelector("button"));

    await waitFor(() =>
      expect(salvo().preferences.mainMenu).toContain("diagramas"),
    );
  });

  it("o Início é fixo e não pode ser tirado", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Personalizar menu" }));

    const linha = await waitFor(() => {
      const el = [...document.querySelectorAll(".ms-escolhidos li")].find((li) =>
        li.textContent.includes("Início"),
      );
      expect(el).toBeTruthy();
      return el;
    });
    expect(linha.textContent).toContain("fixo");
    expect([...linha.querySelectorAll("button")].some((b) => b.textContent === "Tirar")).toBe(false);
  });

  it("dá para reordenar o menu", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes", "diagramas"] }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Personalizar menu" }));

    fireEvent.click(await screen.findByLabelText("Subir Diagramas"));
    // "conversar" é fixo (é a porta de entrada do app), então entra no menu
    // junto com o "inicio". O que este teste prova é a troca de ordem entre os
    // itens que a pessoa escolheu.
    await waitFor(() => {
      const menu = salvo().preferences.mainMenu;
      expect(menu.filter((id) => id === "diagramas" || id === "agentes")).toEqual([
        "diagramas",
        "agentes",
      ]);
    });
  });

  it("voltar ao padrão restaura o menu inicial", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Personalizar menu" }));
    fireEvent.click(await screen.findByRole("button", { name: /Voltar ao padrão/ }));

    await waitFor(() => {
      const m = salvo().preferences.mainMenu;
      expect(m).toContain("inicio");
      expect(m).not.toContain("agentes");
    });
  });

  it("menu salvo com tela que não existe mais não quebra a navegação", async () => {
    seedLoggedIn(
      businessDb({ mainMenu: ["inicio", "tela_que_foi_removida", "agentes"] }),
    );
    await abrir();
    const nomes = botoesDoMenu();
    expect(nomes).toContain("Agentes");
    expect(nomes.join(" ")).not.toContain("tela_que_foi_removida");
  });

  it("conta o que a pessoa abre, no aparelho, sem gravar o workspace", async () => {
    seedLoggedIn(businessDb({ mainMenu: ["inicio", "agentes"] }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Agentes" }));
    await waitFor(() => {
      const v = JSON.parse(
        localStorage.getItem("seu-funcionario-menu-visits") || "{}",
      );
      expect(v.agentes).toBeGreaterThan(0);
    });
    // Contar visita não pode virar escrita no workspace: fazia isso atropelar
    // o estado de telas abertas.
    expect(salvo().preferences.menuVisits).toBeUndefined();
  });
});
