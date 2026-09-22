// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-mission",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-mission-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (overrides = {}) => ({
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
  deliveryZones: [],
  vehicles: [],
  trips: [],
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
  preferences: {
    theme: "light",
    specialist: "Diretor",
    mode: "business",
    modeChosen: true,
  },
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-mission");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("tarefas tratadas como missão", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publica uma missão disponível, assume a vaga, entrega e aprova", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (url === "/api/collab")
          return response({ members: [], invites: [], spaces: [] });
        return response({});
      }),
    );
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    let dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Organizar estoque" },
    });
    fireEvent.click(
      within(dialog).getByLabelText(
        "Tratar como missão (vagas, pontos, recompensa, subtarefas e entregas)",
      ),
    );
    fireEvent.change(within(dialog).getByLabelText("Distribuição"), {
      target: { value: "disponivel" },
    });
    fireEvent.change(within(dialog).getByLabelText("Vagas"), {
      target: { value: "1" },
    });
    fireEvent.change(within(dialog).getByLabelText("Pontos"), {
      target: { value: "10" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Recompensa financeira (opcional)"),
      { target: { value: "50" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Disponíveis" }));
    expect(await screen.findByText("Organizar estoque")).toBeInTheDocument();
    expect(screen.getByText(/10 pontos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assumir missão" }));

    expect(
      await screen.findByText("Nenhuma missão disponível no momento"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar tarefa" }));
    dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });
    fireEvent.change(
      within(dialog).getByLabelText("Comentário da entrega"),
      { target: { value: "Estoque organizado e etiquetado." } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar entrega" }),
    );

    expect(
      await within(dialog).findByText("Estoque organizado e etiquetado."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Aprovar entrega" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(
      within(screen.getByText("Organizar estoque").closest("article")).getByDisplayValue(
        "Concluído",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    await screen.findByText("Valores de missões e tarefas");
    expect(screen.getByText(/Aprovada\s·\sR\$\s50,00/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar como paga" }),
    );
    expect(await screen.findByText(/Paga\s·\sR\$\s50,00/)).toBeInTheDocument();
  });
});
