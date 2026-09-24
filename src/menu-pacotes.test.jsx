// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { navForMode } from "./App";
import { filterNavigationForBusiness } from "./features/business-profile/businessProfileDomain.js";
import {
  HIDDEN_BY_PACKS_LABEL,
  buildNavigationForBusiness,
} from "./features/navigation/menuDomain.js";

// Os pacotes do negócio organizam o menu, nunca tiram acesso (decisão da
// titular em 31/07/2026). O modo "custom" fazia tela fora dos pacotes sumir do
// menu, da lista completa e da busca.

const criador = { id: "biz-criador", name: "Canal da Renata", businessTypeId: "criador", menuMode: "custom" };
const alcancaveis = ({ main, rest }) =>
  new Set([...main.map((i) => i[0]), ...rest.flatMap((g) => g.items.map((i) => i[0]))]);

describe("menu com pacotes do negócio — regras", () => {
  const completo = navForMode();
  const visivel = filterNavigationForBusiness(completo, criador);
  const grupos = [{ label: null, items: completo.map((i) => i[0]) }];

  it("o modo personalizado de fato esconde telas do destaque", () => {
    expect(visivel.length).toBeLessThan(completo.length);
    expect(visivel.some(([id]) => id === "operacao")).toBe(false);
  });

  it("nenhuma tela fica inalcançável, com ou sem menu salvo", () => {
    for (const menu of [undefined, [], ["inicio", "conteudo"], ["operacao"]]) {
      const navegacao = buildNavigationForBusiness(completo, visivel, menu, grupos);
      const ids = alcancaveis(navegacao);
      for (const [id] of completo) expect(ids.has(id), `${id} com menu ${JSON.stringify(menu)}`).toBe(true);
    }
  });

  it("o que os pacotes escondem vai para um grupo próprio", () => {
    const { rest } = buildNavigationForBusiness(completo, visivel, undefined, grupos);
    const ocultos = rest.find((g) => g.label === HIDDEN_BY_PACKS_LABEL);
    expect(ocultos.items.map((i) => i[0])).toContain("operacao");
  });

  it("escolha salva no menu principal vence os pacotes", () => {
    const { main } = buildNavigationForBusiness(completo, visivel, ["inicio", "operacao"], grupos);
    expect(main.map((i) => i[0])).toContain("operacao");
  });

  it("menu padrão sem escolha salva segue filtrado pelos pacotes", () => {
    const { main } = buildNavigationForBusiness(completo, visivel, undefined, grupos);
    expect(main.map((i) => i[0])).not.toContain("operacao");
  });
});

describe("menu com pacotes do negócio — na tela", () => {
  const user = { id: "user-pacotes", name: "Renata Silva", email: "renata@example.com" };
  const response = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT" ? response({ ok: true }) : response({});
      return response({});
    }));
    const db = {
      user,
      onboarding: false,
      selectedBusinessId: criador.id,
      businesses: [criador],
      tasks: [], leads: [], contacts: [], documents: [], history: [], conversations: [],
      preferences: { theme: "light", specialist: "Diretor", mode: "business", modeChosen: true },
    };
    localStorage.setItem("seu-funcionario-auth-token", "token-pacotes");
    localStorage.setItem("seu-funcionario-active-user", user.id);
    localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Operação continua no menu lateral, num grupo à parte", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    const menu = document.querySelector("aside nav");
    expect(within(menu).getByText(HIDDEN_BY_PACKS_LABEL)).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "Operação" }));
    expect(within(menu).getByRole("button", { name: "Operação" })).toHaveClass("active");
  });
});
