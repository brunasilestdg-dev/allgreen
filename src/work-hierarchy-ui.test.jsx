// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "u1", name: "Renata", email: "renata@example.com" };
const business = { id: "b1", name: "Empresa Central", segment: "Serviços" };
const database = () => ({
  user,
  onboarding: false,
  selectedBusinessId: "b1",
  businesses: [business],
  workNodes: [],
  tasks: [],
  projects: [],
  leads: [],
  contacts: [],
  appointments: [],
  products: [],
  orders: [],
  timeEntries: [],
  transactions: [],
  documents: [],
  conversations: [],
  preferences: { theme: "light", mode: "business", modeChosen: true },
});
const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("interface da hierarquia de trabalho", () => {
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

  it("cria workspace, espaço e pasta respeitando a hierarquia", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Estrutura de trabalho" }),
    );
    fireEvent.change(await screen.findByLabelText("Nome da estrutura"), {
      target: { value: "Workspace principal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar estrutura" }));
    expect(await screen.findByRole("heading", { name: "Workspace principal" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Novo espaço/i }));
    fireEvent.change(screen.getByLabelText("Nome da estrutura"), {
      target: { value: "Operações" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar estrutura" }));
    fireEvent.click(screen.getByRole("button", { name: /Nova pasta/i }));
    fireEvent.change(screen.getByLabelText("Nome da estrutura"), {
      target: { value: "Clientes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar estrutura" }));
    expect(await screen.findByRole("heading", { name: "Clientes" })).toBeInTheDocument();
  });
});
