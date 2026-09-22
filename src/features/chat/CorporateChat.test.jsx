// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CorporateChat from "./CorporateChat.jsx";
import { createChatChannel, createChatMessage } from "./corporateChatDomain.js";

const authHeaders = () => ({ authorization: "Bearer token" });
const response = (data, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(data) });

const user = { id: "u1", name: "Renata" };
const member = { id: "u2", name: "João Silva", role: "colaborador" };

const blankDb = {
  user,
  chatChannels: [],
  chatMessages: [],
  chatReadStates: [],
  tasks: [],
};

function Harness({ initial = blankDb, onChange = () => {} }) {
  const [db, setDb] = useState(initial);
  const update = (action) =>
    setDb((current) => {
      const next = typeof action === "function" ? action(current) : action;
      onChange(next);
      return next;
    });
  return (
    <CorporateChat
      db={db}
      update={update}
      business={{ id: "b1" }}
      go={vi.fn()}
      setToast={vi.fn()}
      authHeaders={authHeaders}
    />
  );
}

const channel = createChatChannel(
  {
    type: "channel",
    name: "geral",
    ownerId: "u1",
    businessId: "b1",
  },
  { id: "c1", now: "2026-07-29T18:00:00.000Z" },
);

const rootMessage = createChatMessage(
  {
    channel,
    body: "Precisamos aprovar a proposta até sexta",
    authorId: "u2",
    authorName: "João Silva",
    members: [user, member],
  },
  { id: "m1", now: "2026-07-29T18:01:00.000Z" },
);

describe("interface do chat corporativo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response({ members: [member], owner: user })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cria um canal aberto e envia mensagem com menção", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Novo canal" }));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "comercial" },
    });
    fireEvent.change(screen.getByLabelText("Assunto ou descrição"), {
      target: { value: "Negociações em andamento" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar conversa" }));

    expect(
      await screen.findByRole("heading", { name: "# comercial" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "@joao.silva revisar a proposta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(
      await screen.findByText("@joao.silva revisar a proposta"),
    ).toBeInTheDocument();
  });

  it("responde em thread, reage, fixa e converte mensagem em tarefa", async () => {
    let latest = null;
    render(
      <Harness
        initial={{
          ...blankDb,
          chatChannels: [channel],
          chatMessages: [rootMessage],
        }}
        onChange={(db) => {
          latest = db;
        }}
      />,
    );
    expect(
      screen.getByText("Precisamos aprovar a proposta até sexta"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar reação 👍" }));
    expect(
      screen.getByRole("button", { name: "Remover reação 👍" }),
    ).toHaveClass("active");

    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    fireEvent.change(screen.getByLabelText("Responder na thread"), {
      target: { value: "Eu faço a revisão." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar resposta na thread" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Eu faço a revisão.")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Fixar" }));
    expect((await screen.findAllByText("Fixada")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Virar tarefa" }));
    await waitFor(() => expect(latest.tasks).toHaveLength(1));
    expect(latest.tasks[0]).toMatchObject({
      sourceChatMessageId: "m1",
      title: "Precisamos aprovar a proposta até sexta",
    });
  });

  it("busca mensagens pelo texto e oculta o restante", () => {
    const other = {
      ...rootMessage,
      id: "m2",
      body: "Atualização do estoque",
      createdAt: "2026-07-29T18:02:00.000Z",
    };
    render(
      <Harness
        initial={{
          ...blankDb,
          chatChannels: [channel],
          chatMessages: [rootMessage, other],
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Buscar mensagens"), {
      target: { value: "estoque" },
    });
    expect(screen.getByText("Atualização do estoque")).toBeInTheDocument();
    expect(
      screen.queryByText("Precisamos aprovar a proposta até sexta"),
    ).not.toBeInTheDocument();
  });

  it("gera e preserva o resumo da conversa por IA", async () => {
    fetch.mockImplementation((url) =>
      url === "/api/ai"
        ? response({ content: "Resumo executivo\nDecisão: proposta aprovada." })
        : response({ members: [member], owner: user }),
    );
    render(
      <Harness
        initial={{
          ...blankDb,
          chatChannels: [channel],
          chatMessages: [rootMessage],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resumir com IA" }));
    expect(
      await screen.findByText(/Resumo executivo/),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/ai",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"specialist":"Diretor"'),
      }),
    );
  });
});
