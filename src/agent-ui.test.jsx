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

const user = { id: "user-ag", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-ag-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const agente = (extra = {}) => ({
  id: "ag1",
  name: "Assistente",
  goal: "Organizar a semana",
  autonomy: "escrever",
  maxSteps: 8,
  schedule: "manual",
  acceptance: [],
  memory: [],
  businessId: business.id,
  createdAt: "2026-07-01T10:00:00Z",
  ...extra,
});

const passo = (id, toolId, extra = {}) => ({
  id,
  title: `Passo ${id}`,
  toolId,
  args: {},
  dependsOn: [],
  status: "pendente",
  result: "",
  error: "",
  approvedAt: "",
  doneAt: "",
  ...extra,
});

const execucao = (steps, extra = {}) => ({
  id: "run1",
  agentId: "ag1",
  goal: "Organizar a semana",
  steps,
  status: "aguardando",
  log: [],
  startedAt: "2026-07-30T10:00:00Z",
  finishedAt: "",
  businessId: business.id,
  ...extra,
});

const businessDb = (extra = {}) => ({
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
  },
  ...extra,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

let respostaIa = "1. Ler o financeiro | ler_financeiro |\n2. Criar tarefa de cobrança | criar_tarefa | titulo=Cobrar Ana";

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-ag");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const salvo = () =>
  JSON.parse(localStorage.getItem(`seu-funcionario-v2:${user.id}`));

const abrir = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Agentes" }));
  await waitFor(() => expect(document.querySelector(".ag")).toBeTruthy());
};

const irPara = (aba) => fireEvent.click(screen.getByRole("tab", { name: aba }));

// O nome do agente aparece em mais de um lugar da tela; o cartão dele é o
// único `.ag-pick`, então a escolha vai por ele.
const escolherAgente = async () => {
  const cartao = await waitFor(() => {
    const el = document.querySelector(".ag-pick");
    expect(el).toBeTruthy();
    return el;
  });
  fireEvent.click(cartao);
};

describe("Agentes", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    respostaIa =
      "1. Ler o financeiro | ler_financeiro |\n2. Criar tarefa de cobrança | criar_tarefa | titulo=Cobrar Ana";
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (url === "/api/ai") return response({ text: respostaIa });
        if (String(url).startsWith("/api/outbox/send"))
          return response({ ok: true, channel: "email", delivery: { provider: "brevo" } });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("avisa em toda tela que a IA pode errar", async () => {
    seedLoggedIn(businessDb());
    await abrir();
    const aviso = await waitFor(() => {
      const el = document.querySelector(".ag-disclaimer");
      expect(el).toBeTruthy();
      return el;
    });
    expect(aviso.textContent).toMatch(/A IA pode errar/);
    expect(aviso.textContent).toMatch(/não dá para desfazer/);
  });

  it("cria um agente com o nível de autonomia escolhido", async () => {
    seedLoggedIn(businessDb());
    await abrir();

    fireEvent.change(screen.getByLabelText("Nome do agente"), {
      target: { value: "Cobrador" },
    });
    fireEvent.change(screen.getByLabelText("Objetivo do agente"), {
      target: { value: "Ver quem está devendo" },
    });
    fireEvent.change(screen.getByLabelText("Nível de autonomia"), {
      target: { value: "ler" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Criar agente/ }));

    await waitFor(() => {
      const a = salvo().agents[0];
      expect(a.name).toBe("Cobrador");
      expect(a.autonomy).toBe("ler");
    });
  });

  it("avisa o que significa liberar tudo antes de a titular escolher", async () => {
    seedLoggedIn(businessDb());
    await abrir();

    fireEvent.change(screen.getByLabelText("Nível de autonomia"), {
      target: { value: "tudo" },
    });
    const aviso = await waitFor(() => {
      const el = document.querySelector(".ag-hint.warn");
      expect(el).toBeTruthy();
      return el;
    });
    expect(aviso.textContent).toMatch(/não volta|quem responde é você/i);
  });

  it("monta o plano com a IA antes de fazer qualquer coisa", async () => {
    seedLoggedIn(businessDb({ agents: [agente()] }));
    await abrir();

    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: "Montar plano" }));

    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps).toHaveLength(2);
      expect(run.steps[0].toolId).toBe("ler_financeiro");
    });
  });

  it("avisa quando a IA responde sem um plano em passos", async () => {
    respostaIa = "Desculpe, não entendi o que você quer.";
    seedLoggedIn(businessDb({ agents: [agente()] }));
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: "Montar plano" }));

    expect(await screen.findByText(/não veio um plano em passos/)).toBeInTheDocument();
  });

  it("executa os passos permitidos e cria a tarefa de verdade", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "escrever" })],
        agentRuns: [
          execucao([
            passo("p1", "ler_financeiro"),
            passo("p2", "criar_tarefa", { args: { titulo: "Cobrar Ana" } }),
          ]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: /Executar/ }));

    await waitFor(() => {
      expect(salvo().tasks.some((t) => t.title === "Cobrar Ana")).toBe(true);
    });
    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.status).toBe("concluido");
    });
  });

  it("para e pede aprovação no passo que sai para fora", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "escrever" })],
        agentRuns: [execucao([passo("p1", "enviar_email", { args: { para: "ana@x.com" } })])],
      }),
    );
    await abrir();
    await escolherAgente();

    await waitFor(() =>
      expect(document.querySelector(".ag-ext")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeInTheDocument();
  });

  it("no nível 'tudo' o envio não fica esperando aprovação", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "tudo" })],
        agentRuns: [execucao([passo("p1", "enviar_email", { args: { para: "ana@x.com" } })])],
      }),
    );
    await abrir();
    await escolherAgente();

    await waitFor(() => expect(document.querySelector(".ag-steps")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
  });

  it("recusar um passo pula quem dependia dele", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "ler" })],
        agentRuns: [
          execucao([
            passo("p1", "criar_tarefa"),
            passo("p2", "criar_nota", { dependsOn: ["p1"] }),
          ]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();

    fireEvent.click(await screen.findByRole("button", { name: /Recusar/ }));
    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps[0].status).toBe("recusado");
      expect(run.steps[1].status).toBe("pulado");
    });
  });

  it("envia automaticamente quando a conta de envio está conectada", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "tudo" })],
        agentRuns: [
          execucao([
            passo("p1", "enviar_email", {
              args: { para: "ana@x.com", texto: "Olá, Ana." },
            }),
          ]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: /Executar/ }));

    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps[0].status).toBe("feito");
      expect(run.steps[0].result).toMatch(/enviei o e-mail/);
    });
  });

  it("registra falha quando o envio automático é recusado pelo servidor", async () => {
    const okFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (String(url).startsWith("/api/outbox/send"))
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({
                error: "O envio automático de e-mail não está configurado.",
              }),
          });
        return okFetch(url, options);
      }),
    );
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "tudo" })],
        agentRuns: [
          execucao([
            passo("p1", "enviar_email", {
              args: { para: "ana@x.com", texto: "Olá, Ana." },
            }),
          ]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: /Executar/ }));

    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps[0].status).toBe("erro");
      expect(run.steps[0].error).toMatch(/envio automático de e-mail/);
    });
  });

  it("mostra o histórico do que a IA decidiu", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "ler" })],
        agentRuns: [execucao([passo("p1", "ler_agenda")])],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: /Executar/ }));

    await waitFor(() => {
      const log = document.querySelector(".ag-log");
      expect(log).toBeTruthy();
      expect(log.textContent).toMatch(/compromisso/);
    });
  });

  it("respeita o limite de passos que a titular definiu", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "ler", maxSteps: 1 })],
        agentRuns: [
          execucao([passo("p1", "ler_agenda"), passo("p2", "ler_financeiro")]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: /Executar/ }));

    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps[0].status).toBe("feito");
      expect(run.steps[1].status).toBe("pendente");
      expect(run.log.some((l) => l.text.includes("limite"))).toBe(true);
    });
  });

  it("junta na fila o que está esperando aprovação", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "escrever" })],
        agentRuns: [execucao([passo("p1", "enviar_whatsapp", { args: { para: "Ana" } })])],
      }),
    );
    await abrir();
    irPara("Aprovações (1)");

    const fila = await waitFor(() => {
      const el = document.querySelector(".ag-approvals");
      expect(el).toBeTruthy();
      return el;
    });
    expect(fila.textContent).toContain("Assistente");
  });

  it("retomar não refaz o passo que já tinha sido feito", async () => {
    seedLoggedIn(
      businessDb({
        agents: [agente({ autonomy: "ler" })],
        agentRuns: [
          execucao([
            passo("p1", "ler_agenda", { status: "feito", result: "3 compromissos" }),
            passo("p2", "ler_financeiro"),
          ]),
        ],
      }),
    );
    await abrir();
    await escolherAgente();
    fireEvent.click(await screen.findByRole("button", { name: "Retomar" }));

    await waitFor(() => {
      const run = salvo().agentRuns[0];
      expect(run.steps[0].status).toBe("feito");
      expect(run.steps[0].result).toBe("3 compromissos");
    });
  });
});
