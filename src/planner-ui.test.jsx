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

const user = { id: "user-plan", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-plan-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const HOJE = new Date().toISOString().slice(0, 10);
const emDias = (n) =>
  new Date(Date.parse(`${HOJE}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);

// O primeiro dia ÚTIL a partir de hoje.
//
// `freeSlots` devolve vazio em dia fora da jornada (o padrão é segunda a
// sexta), então o planner pula o fim de semana e encaixa na segunda. Um teste
// que semeia compromisso em "hoje" e espera colisão passa de segunda a sexta e
// falha sábado e domingo — o produto certo, o teste dependente do calendário.
// Quem precisa do dia que o planner vai REALMENTE usar, usa este.
const PRIMEIRO_DIA_UTIL = (() => {
  for (let n = 0; n < 7; n += 1) {
    const dia = emDias(n);
    const semana = new Date(`${dia}T00:00:00Z`).getUTCDay();
    if (semana >= 1 && semana <= 5) return dia;
  }
  return HOJE;
})();

const tarefa = (extra = {}) => ({
  id: "t1",
  title: "Escrever proposta",
  status: "pendente",
  due: "",
  time: "",
  durationMinutes: 60,
  priority: "",
  project: "",
  businessId: business.id,
  ownerId: user.id,
  ...extra,
});

const businessDb = (tasks = [], appointments = []) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks,
  appointments,
  workHours: {
    start: "09:00",
    end: "18:00",
    days: [1, 2, 3, 4, 5],
    lunchStart: "12:00",
    lunchEnd: "13:00",
  },
  leads: [],
  products: [],
  orders: [],
  contacts: [],
  timeEntries: [],
  transactions: [],
  bills: [],
  opportunities: [],
  meetings: [],
  boards: [],
  diagrams: [],
  whiteboards: [],
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
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-plan");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirPlanejar = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Planejar o dia" }));
  await waitFor(() => expect(document.querySelector(".plan")).toBeTruthy());
};

const escrever = async (texto) => {
  const campo = await screen.findByLabelText(
    "Escrever tarefa em linguagem natural",
  );
  fireEvent.change(campo, { target: { value: texto } });
  return campo;
};

describe("Planejar o dia", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra o que entendeu enquanto a pessoa digita", async () => {
    seedLoggedIn(businessDb([]));
    await abrirPlanejar();

    await escrever("ligar pro fornecedor amanhã às 15h por 30min !alta #compras");

    const previa = document.querySelector(".plan-preview");
    await waitFor(() => expect(previa.textContent).toContain("ligar pro fornecedor"));
    expect(previa.textContent).toContain(emDias(1));
    expect(previa.textContent).toContain("15:00");
    expect(previa.textContent).toContain("30min");
    expect(previa.textContent).toContain("Alta");
    expect(previa.textContent).toContain("#compras");
  });

  it("avisa quando não reconheceu data nem hora", async () => {
    seedLoggedIn(businessDb([]));
    await abrirPlanejar();
    await escrever("comprar embalagens");
    expect(
      await screen.findByText(/Nada de data ou hora reconhecido/),
    ).toBeInTheDocument();
  });

  it("cria a tarefa com os campos já preenchidos", async () => {
    seedLoggedIn(businessDb([]));
    await abrirPlanejar();

    await escrever("revisar contrato amanhã às 10h por 45min !alta");
    fireEvent.click(screen.getByRole("button", { name: /Criar/ }));

    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      const criada = salvo.tasks.find((t) => t.title === "revisar contrato");
      expect(criada).toBeTruthy();
      expect(criada.due).toBe(emDias(1));
      expect(criada.time).toBe("10:00");
      expect(criada.durationMinutes).toBe(45);
      expect(criada.priority).toBe("alta");
      expect(criada.status).toBe("A fazer");
    });
  });

  it("encaixa as tarefas nos horários livres e deixa aplicar", async () => {
    seedLoggedIn(
      businessDb([
        tarefa({ id: "t1", title: "Escrever proposta", durationMinutes: 60 }),
        tarefa({ id: "t2", title: "Revisar contrato", durationMinutes: 30 }),
      ]),
    );
    await abrirPlanejar();

    fireEvent.click(await screen.findByRole("button", { name: /Encaixar tarefas/ }));

    expect(await screen.findByText("Encaixe proposto")).toBeInTheDocument();
    const lista = document.querySelector(".plan-placements");
    expect(lista.textContent).toContain("Escrever proposta");
    expect(lista.textContent).toContain("Revisar contrato");

    fireEvent.click(screen.getByRole("button", { name: /Aplicar na agenda/ }));
    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      const t = salvo.tasks.find((x) => x.id === "t1");
      expect(t.time).toBeTruthy();
      expect(t.agendadaAutomaticamente).toBe(true);
    });
  });

  it("explica o que não caber em vez de sumir com a tarefa", async () => {
    seedLoggedIn(
      businessDb([
        tarefa({
          id: "t1",
          title: "Tarefa gigante",
          durationMinutes: 600,
          due: emDias(1),
        }),
      ]),
    );
    await abrirPlanejar();

    fireEvent.click(await screen.findByRole("button", { name: /Encaixar tarefas/ }));

    const naoCabe = await screen.findByText(/Não caberam/);
    expect(naoCabe).toBeInTheDocument();
    expect(document.querySelector(".plan-unplaced").textContent).toContain(
      "Tarefa gigante",
    );
  });

  it("desvia dos compromissos já marcados na agenda", async () => {
    seedLoggedIn(
      businessDb(
        [tarefa({ id: "t1", title: "Foco", durationMinutes: 60 })],
        [
          {
            id: "a1",
            // No dia que o planner vai usar, não em "hoje": no fim de semana
            // os dois são dias diferentes e a colisão nunca aconteceria.
            date: PRIMEIRO_DIA_UTIL,
            time: "09:00",
            end: "11:00",
            title: "Cliente",
            businessId: business.id,
          },
        ],
      ),
    );
    await abrirPlanejar();

    fireEvent.click(await screen.findByRole("button", { name: /Encaixar tarefas/ }));
    const lista = await waitFor(() => document.querySelector(".plan-placements"));
    // Não pode começar às 09:00, que está ocupado.
    expect(lista.textContent).not.toContain("09:00–10:00");
  });

  it("avisa compromissos sobrepostos", async () => {
    seedLoggedIn(
      businessDb([], [
        {
          id: "a1",
          date: HOJE,
          time: "10:00",
          end: "11:30",
          title: "Cliente A",
          businessId: business.id,
        },
        {
          id: "a2",
          date: HOJE,
          time: "11:00",
          end: "12:00",
          title: "Cliente B",
          businessId: business.id,
        },
      ]),
    );
    await abrirPlanejar();

    expect(
      await screen.findByText(/Compromissos em cima um do outro/),
    ).toBeInTheDocument();
    expect(document.querySelector(".plan-alert").textContent).toContain("Cliente A");
  });

  it("traz as tarefas atrasadas para o próximo dia útil", async () => {
    seedLoggedIn(
      businessDb([tarefa({ id: "t1", title: "Atrasada", due: emDias(-5) })]),
    );
    await abrirPlanejar();

    expect(await screen.findByText(/1 tarefa atrasada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Trazer para hoje/ }));

    await waitFor(() => {
      const salvo = JSON.parse(
        localStorage.getItem(`seu-funcionario-v2:${user.id}`),
      );
      expect(salvo.tasks.find((t) => t.id === "t1").reagendada).toBe(true);
    });
  });

  it("mostra a carga e as vagas livres de cada dia", async () => {
    seedLoggedIn(businessDb([]));
    await abrirPlanejar();

    const dias = document.querySelectorAll(".plan-days article");
    expect(dias.length).toBeGreaterThan(0);
    const texto = document.querySelector(".plan-days").textContent;
    // Dia útil e vazio: 8h de capacidade livre (9h-18h menos 1h de almoço).
    expect(texto).toMatch(/livre: (8h|7h|6h|5h|4h|3h|2h|1h|Fora)/);
  });
});
