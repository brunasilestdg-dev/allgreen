// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "u1", name: "Renata", email: "renata@example.com" };
const business = { id: "b1", name: "Empresa", segment: "Serviços" };
const database = () => ({
  user,
  onboarding: false,
  selectedBusinessId: "b1",
  businesses: [business],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  quotes: [],
  contacts: [],
  timeEntries: [],
  transactions: [],
  documents: [],
  databases: [],
  pricingModels: [],
  pricingScenarios: [],
  impactFactors: [],
  impactEntries: [],
  conversations: [],
  preferences: { theme: "light", mode: "business", modeChosen: true },
});
const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("precificação e impacto integrados", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("seu-funcionario-auth-token", "token");
    localStorage.setItem("seu-funcionario-active-user", user.id);
    localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(database()));
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

  it("cria modelo, calcula cenário e gera orçamento vinculado", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Precificação e Impacto" }),
    );
    fireEvent.change(await screen.findByLabelText("Nome do modelo"), {
      target: { value: "Serviço recorrente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar modelo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Modelo de custos" }));
    fireEvent.change(screen.getByLabelText("Valor de Mão de obra"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Calcular" }));
    fireEvent.change(screen.getByLabelText("Nome do cenário"), {
      target: { value: "Contrato mensal" },
    });
    fireEvent.change(screen.getByLabelText("Horas"), {
      target: { value: "10" },
    });
    expect(
      (await screen.findAllByText("R$ 1.250,00")).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: /Criar orçamento/ }));
    expect(
      await screen.findByText("Orçamento criado com memória de cálculo vinculada"),
    ).toBeInTheDocument();
  });
});
