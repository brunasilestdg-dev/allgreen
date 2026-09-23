// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-process",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-process",
  name: "Empresa Teste",
  segment: "Serviços",
};

const db = () => ({
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
  documents: [],
  presentations: [],
  contentPlan: [],
  sheets: [],
  analyses: [],
  brainstorms: [],
  signatures: [],
  pixCharges: [],
  databases: [],
  processes: [],
  processCases: [],
  formResponses: [],
  sites: [],
  history: [],
  certificates: [],
  conversations: [],
  media: [],
  emailDrafts: [],
  customSpecialists: [],
  pluggedTools: [],
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

describe("processos e formulários operacionais", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    localStorage.setItem("seu-funcionario-auth-token", "token-process");
    localStorage.setItem("seu-funcionario-active-user", user.id);
    localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db()));
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

  it("cria processo, recebe formulário e movimenta o caso pelo quadro", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Processos e Solicitações" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Criar processo" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome do processo"), {
      target: { value: "Aprovação de compras" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar processo" }));

    expect(
      await screen.findByRole("heading", { name: "Aprovação de compras" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Formulário" }));
    const form = document.querySelector(".process-form");
    fireEvent.change(within(form).getByLabelText("Solicitação *"), {
      target: { value: "Comprar notebooks" },
    });
    fireEvent.change(within(form).getByLabelText("Descrição *"), {
      target: { value: "Equipamentos para o novo time comercial" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar solicitação" }));

    fireEvent.click(screen.getByRole("button", { name: "Casos" }));
    const card = document.querySelector(".process-case");
    expect(within(card).getByText("Comprar notebooks")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Avançar etapa" }));
    expect(
      screen.getByText("Em análise", { selector: ".process-column header strong" }),
    ).toBeInTheDocument();
  });

  it("configura conexões como escolhas opcionais", async () => {
    const initial = db();
    initial.processes = [
      {
        id: "p1",
        name: "Atendimento",
        description: "",
        businessId: business.id,
        ownerId: user.id,
        active: true,
        visibility: "espaco_todo",
        fields: [{ id: "subject", name: "Assunto", type: "text", required: true }],
        stages: [
          { id: "new", name: "Novo", slaHours: 4, requiredFieldIds: [] },
          {
            id: "done",
            name: "Concluído",
            slaHours: 0,
            requiredFieldIds: [],
            terminal: true,
          },
        ],
        connections: { baseId: "", createTask: false },
      },
    ];
    initial.databases = [
      {
        id: "tickets",
        name: "Solicitações",
        businessId: business.id,
        fields: [{ id: "subject", name: "Assunto", type: "text" }],
        rows: [],
      },
    ];
    localStorage.setItem(
      `seu-funcionario-v2:${user.id}`,
      JSON.stringify(initial),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Processos e Solicitações" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Configurar" }));
    fireEvent.change(screen.getByLabelText("Base para receber as respostas"), {
      target: { value: "tickets" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Criar uma tarefa para cada solicitação",
      }),
    );
    expect(screen.getByLabelText("Base para receber as respostas")).toHaveValue(
      "tickets",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Criar uma tarefa para cada solicitação",
      }),
    ).toBeChecked();
  });
});
