// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "user-mtg", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-mtg-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const TRANSCRICAO =
  "Renata: bom dia, vamos falar do orçamento\nCliente: quero saber o preço do bolo\nRenata: fecho em quatro mil";

const reuniao = (extra = {}) => ({
  id: "mt-1",
  title: "Alinhamento com a cliente",
  date: "2026-07-29",
  participants: ["Renata", "Cliente"],
  client: "Padaria X",
  project: "",
  tags: ["vendas"],
  transcript: TRANSCRICAO,
  minutes: null,
  consent: false,
  durationSeconds: 0,
  businessId: business.id,
  ownerId: user.id,
  createdAt: "2026-07-29T10:00:00.000Z",
  ...extra,
});

const businessDb = (meetings = []) => ({
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
  bills: [],
  opportunities: [],
  meetings,
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

const response = (data, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(data) });

const ATA_IA = `Resumo
Conversamos sobre o orçamento do bolo.

Decisões
- Fechar em quatro mil reais

Tarefas
- Enviar contrato — Renata — 05/08
- Confirmar sabor — Cliente

Riscos
- Data do salão pode mudar

Perguntas pendentes
- Quantos convidados?

Temas
- orçamento
- contrato`;

let aiRespondeu = ATA_IA;

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-mtg");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirReunioes = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Reuniões" }));
  return screen.findByRole("heading", { name: /^Reuniões$/ });
};

describe("Reuniões", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    aiRespondeu = ATA_IA;
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        if (url === "/api/ai") return response({ text: aiRespondeu });
        if (url === "/api/transcribe")
          return response({ text: "Renata: transcrito pelo Whisper" });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra o estado vazio convidando a criar a primeira reunião", async () => {
    seedLoggedIn(businessDb([]));
    await abrirReunioes();
    expect(
      await screen.findByText("Nenhuma reunião registrada"),
    ).toBeInTheDocument();
  });

  it("estrutura a transcrição em falas e mostra quem falou quanto", async () => {
    seedLoggedIn(businessDb([reuniao()]));
    await abrirReunioes();

    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));

    const speakers = document.querySelector(".mtg-speakers");
    await waitFor(() => expect(speakers.textContent).toContain("Renata"));
    expect(speakers.textContent).toContain("2 falas");
    expect(speakers.textContent).toContain("Cliente");
  });

  it("busca dentro da transcrição", async () => {
    seedLoggedIn(businessDb([reuniao()]));
    await abrirReunioes();
    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));

    fireEvent.change(screen.getByLabelText("Buscar na transcrição"), {
      target: { value: "preço" },
    });

    expect(await screen.findByText("1 fala encontrada")).toBeInTheDocument();
    const hits = document.querySelector(".mtg-hits");
    expect(hits.textContent).toContain("quero saber o preço");
  });

  it("exige consentimento antes de gravar", async () => {
    seedLoggedIn(businessDb([reuniao({ consent: false })]));
    await abrirReunioes();
    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));

    fireEvent.click(screen.getByRole("button", { name: /Gravar pelo navegador/ }));

    expect(
      await screen.findByText(/Marque o consentimento de gravação/),
    ).toBeInTheDocument();
  });

  it("gera a ata pela IA e a mostra em seções", async () => {
    seedLoggedIn(businessDb([reuniao()]));
    await abrirReunioes();
    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));

    fireEvent.click(screen.getByRole("button", { name: /Gerar ata com IA/ }));

    expect(await screen.findByText("Ata")).toBeInTheDocument();
    const ata = document.querySelector(".mtg-minutes");
    expect(ata.textContent).toContain("orçamento do bolo");
    expect(ata.textContent).toContain("Fechar em quatro mil reais");
    expect(ata.textContent).toContain("Quantos convidados?");
    expect(within(ata).getByText("contrato")).toBeInTheDocument();
  });

  it("transforma as tarefas da ata em tarefas de verdade com prazo", async () => {
    seedLoggedIn(businessDb([reuniao()]));
    await abrirReunioes();
    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar ata com IA/ }));
    await screen.findByText("Ata");

    fireEvent.click(
      screen.getByRole("button", { name: /Criar as tarefas da ata/ }),
    );

    expect(await screen.findByText(/2 tarefas criadas/)).toBeInTheDocument();

    // A tarefa existe de fato no módulo de tarefas, com o prazo resolvido.
    const salvo = JSON.parse(
      localStorage.getItem(`seu-funcionario-v2:${user.id}`),
    );
    const criadas = salvo.tasks.filter((t) => t.meetingId === "mt-1");
    expect(criadas).toHaveLength(2);
    const contrato = criadas.find((t) => t.title === "Enviar contrato");
    expect(contrato.due).toBe("2026-08-05");
    expect(contrato.notes).toContain("Renata");
  });

  it("avisa quando a IA não devolve ata", async () => {
    aiRespondeu = "";
    seedLoggedIn(businessDb([reuniao()]));
    await abrirReunioes();
    fireEvent.click(screen.getByRole("button", { name: /Alinhamento com a cliente/ }));

    fireEvent.click(screen.getByRole("button", { name: /Gerar ata com IA/ }));

    expect(
      await screen.findByText(/não conseguiu gerar a ata/i),
    ).toBeInTheDocument();
  });

  it("filtra a biblioteca por texto do que foi dito", async () => {
    seedLoggedIn(
      businessDb([
        reuniao(),
        reuniao({
          id: "mt-2",
          title: "Retrospectiva interna",
          transcript: "Renata: vamos melhorar o processo",
          tags: ["interno"],
        }),
      ]),
    );
    await abrirReunioes();

    fireEvent.change(
      screen.getByPlaceholderText(/Buscar por título, participante/),
      { target: { value: "processo" } },
    );

    expect(
      await screen.findByRole("button", { name: /Retrospectiva interna/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Alinhamento com a cliente/ }),
    ).not.toBeInTheDocument();
  });
});
