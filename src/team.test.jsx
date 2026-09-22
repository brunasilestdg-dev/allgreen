// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-team",
  name: "Renata Silva",
  email: "renata@example.com",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: null,
  businesses: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-team");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

describe("convites de equipe", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("envia um convite com nome, e-mail, função, vínculo e papel", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      if (url === "/api/collab/invite") return response({ id: "abc", expiresAt: "" });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Meu Time" }));
    await screen.findByText("Convidar colaborador");

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Novo Colaborador" },
    });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "novo@empresa.com" },
    });
    fireEvent.change(screen.getByLabelText("Função"), {
      target: { value: "Atendimento" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de vínculo"), {
      target: { value: "Freelancer" },
    });
    fireEvent.change(screen.getByLabelText("Papel inicial"), {
      target: { value: "gestor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/collab/invite",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Novo Colaborador",
            email: "novo@empresa.com",
            functionTitle: "Atendimento",
            bondType: "Freelancer",
            role: "gestor",
            directManagerId: "",
          }),
        }),
      ),
    );
  });

  it("mostra o formulário de criação de conta ao abrir um link de convite válido", async () => {
    history.replaceState({}, "", "/convite/token-123");
    const fetchMock = vi.fn((url) => {
      if (url === "/api/config") return response({ videoEnabled: false });
      if (String(url).startsWith("/api/collab/invite-info"))
        return response({
          name: "Convidado Teste",
          email: "convidado@empresa.com",
          role: "colaborador",
          ownerName: "Renata Silva",
          hasAccount: false,
        });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Você foi convidado(a) como Colaborador",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("convidado@empresa.com")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Crie uma senha/)).toBeInTheDocument();
  });

  it("aceita o convite e entra no espaço compartilhado ao criar a conta", async () => {
    history.replaceState({}, "", "/convite/token-456");
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/config") return response({ videoEnabled: false });
      if (String(url).startsWith("/api/collab/invite-info"))
        return response({
          name: "Convidado Teste",
          email: "convidado@empresa.com",
          role: "colaborador",
          ownerName: "Espaço da Renata",
          hasAccount: false,
        });
      if (url === "/api/collab/invite/accept" && options.method === "POST")
        return response({
          ok: true,
          ownerId: "owner-1",
          ownerName: "Espaço da Renata",
          user: { id: "new-user", name: "Convidado Teste", email: "convidado@empresa.com" },
          token: "session-token-new",
        });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByLabelText(/^Crie uma senha/);
    fireEvent.change(screen.getByLabelText(/^Crie uma senha/), {
      target: { value: "senha-segura-123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Criar conta e aceitar convite" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Bem-vindo(a) ao espaço de Espaço da Renata",
      }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("seu-funcionario-auth-token")).toBe(
      "session-token-new",
    );
  });

  it("mostra o histórico de ações administrativas ao clicar em Ver histórico", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      if (url === "/api/collab/audit" && options.method === "POST")
        return response({
          logs: [
            {
              id: "log-1",
              actorName: "Renata Silva",
              action: "papel_alterado",
              target: "member-1",
              details: "novo papel: gestor",
              createdAt: "2026-01-10T12:00:00.000Z",
            },
          ],
        });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Meu Time" }));
    await screen.findByText("Convidar colaborador");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Histórico" }).at(-1),
    );
    await screen.findByText("Histórico de ações");

    fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));

    expect(await screen.findByText(/Papel alterado/)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/collab/audit",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
