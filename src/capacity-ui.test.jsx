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
  contacts: [],
  timeEntries: [],
  transactions: [],
  documents: [],
  databases: [],
  processes: [],
  processCases: [],
  resourceProfiles: [],
  resourceAbsences: [],
  resourceAllocations: [],
  projects: [],
  conversations: [],
  history: [],
  sites: [],
  preferences: { theme: "light", mode: "business", modeChosen: true },
});
const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("interface de capacidade e recursos", () => {
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

  it("cria recurso, alocação e apresenta utilização", async () => {
    render(<App />);
    // A tela de Capacidade é carregada de forma lazy; sob carga do runner de CI
    // o findBy padrão (1s) chega a estourar antes do chunk montar. Damos folga.
    fireEvent.click(await screen.findByRole("button", { name: "Capacidade e Recursos" }, { timeout: 8000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar primeiro recurso" }, { timeout: 8000 }));
    fireEvent.change(screen.getByLabelText("Nome do recurso"), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText("Horas semanais"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar recurso" }));
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nova alocação" }));
    fireEvent.change(screen.getByLabelText("Recurso da alocação"), {
      target: { value: screen.getByLabelText("Recurso da alocação").options[1].value },
    });
    fireEvent.change(screen.getByLabelText("Percentual de alocação"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alocação" }));
    expect((await screen.findAllByText("50%")).length).toBeGreaterThanOrEqual(1);
  });
});
