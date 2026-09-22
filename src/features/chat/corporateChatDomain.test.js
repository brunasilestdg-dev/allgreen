import { describe, expect, it } from "vitest";
import {
  buildChatSummaryPrompt,
  channelDisplayName,
  channelUnreadCount,
  createChatChannel,
  createChatMessage,
  createTaskFromChatMessage,
  fallbackChatSummary,
  findDirectChannel,
  resolveMentionUserIds,
  searchChatMessages,
  threadMessages,
  toggleMessagePin,
  toggleMessageReaction,
} from "./corporateChatDomain.js";

const now = "2026-07-29T18:00:00.000Z";
const members = [
  { id: "u1", name: "Renata Silva" },
  { id: "u2", name: "João Silva" },
  { id: "u3", name: "Ana Souza" },
];

describe("domínio do chat corporativo", () => {
  it("cria canal aberto e grupo restrito com audiências diferentes", () => {
    const channel = createChatChannel(
      {
        type: "channel",
        name: "  comercial ",
        ownerId: "u1",
        businessId: "b1",
      },
      { id: "c1", now },
    );
    const group = createChatChannel(
      {
        type: "group",
        name: "Projeto Alfa",
        ownerId: "u1",
        memberIds: ["u2", "u2"],
      },
      { id: "g1", now },
    );

    expect(channel).toMatchObject({
      name: "comercial",
      visibility: "espaco_todo",
      sharedWith: [],
    });
    expect(group).toMatchObject({
      visibility: "compartilhado",
      memberIds: ["u1", "u2"],
      sharedWith: ["u1", "u2"],
    });
  });

  it("reconhece e nomeia uma conversa direta existente", () => {
    const direct = createChatChannel(
      {
        type: "direct",
        ownerId: "u1",
        memberIds: ["u2"],
      },
      { id: "d1", now },
    );
    expect(findDirectChannel([direct], "u2", "u1")).toBe(direct);
    expect(channelDisplayName(direct, members, "u1")).toBe("João Silva");
  });

  it("registra menções por nome completo ou primeiro nome", () => {
    expect(
      resolveMentionUserIds(
        "Peço revisão para @joao.silva e depois @ana.",
        members,
      ),
    ).toEqual(["u2", "u3"]);
  });

  it("cria mensagem com acesso herdado do canal e anexos", () => {
    const group = createChatChannel(
      {
        type: "group",
        name: "Projeto",
        ownerId: "u1",
        memberIds: ["u2"],
      },
      { id: "g1", now },
    );
    const message = createChatMessage(
      {
        channel: group,
        body: "@joao.silva confira o arquivo",
        authorId: "u1",
        authorName: "Renata",
        members,
        attachments: [{ id: "a1", name: "brief.pdf" }],
      },
      { id: "m1", now },
    );
    expect(message).toMatchObject({
      id: "m1",
      channelId: "g1",
      visibility: "compartilhado",
      sharedWith: ["u1", "u2"],
      mentionUserIds: ["u2"],
      attachments: [{ id: "a1", name: "brief.pdf" }],
    });
  });

  it("não cria mensagem vazia", () => {
    const channel = createChatChannel(
      { type: "channel", ownerId: "u1" },
      { id: "c1", now },
    );
    expect(createChatMessage({ channel, body: "   " })).toBeNull();
  });

  it("alterna reações sem apagar reações de outras pessoas", () => {
    const message = {
      id: "m1",
      reactions: { "👍": ["u2"], "❤️": ["u3"] },
    };
    const added = toggleMessageReaction(message, "👍", "u1");
    expect(added.reactions).toEqual({ "👍": ["u2", "u1"], "❤️": ["u3"] });
    const removed = toggleMessageReaction(added, "👍", "u1");
    expect(removed.reactions).toEqual({ "👍": ["u2"], "❤️": ["u3"] });
  });

  it("fixa e desafixa uma mensagem", () => {
    const pinned = toggleMessagePin({ id: "m1" }, "u1", now);
    expect(pinned).toMatchObject({ pinnedAt: now, pinnedBy: "u1" });
    expect(toggleMessagePin(pinned, "u1", now)).toMatchObject({
      pinnedAt: null,
      pinnedBy: null,
    });
  });

  it("ordena uma thread e busca também por autor e arquivo", () => {
    const messages = [
      {
        id: "r2",
        channelId: "c1",
        parentMessageId: "root",
        body: "segunda",
        authorName: "Ana",
        createdAt: "2026-07-29T18:03:00.000Z",
      },
      {
        id: "root",
        channelId: "c1",
        body: "início",
        authorName: "Renata",
        createdAt: "2026-07-29T18:01:00.000Z",
      },
      {
        id: "r1",
        channelId: "c1",
        parentMessageId: "root",
        body: "primeira",
        authorName: "João",
        attachments: [{ name: "contrato.pdf" }],
        createdAt: "2026-07-29T18:02:00.000Z",
      },
    ];
    expect(threadMessages(messages, "root").map((item) => item.id)).toEqual([
      "root",
      "r1",
      "r2",
    ]);
    expect(searchChatMessages(messages, "contrato", "c1")).toHaveLength(1);
    expect(searchChatMessages(messages, "ana", "c1")[0].id).toBe("r2");
  });

  it("calcula não lidas sem contar mensagens próprias e respostas", () => {
    const messages = [
      {
        id: "m1",
        authorId: "u2",
        createdAt: "2026-07-29T18:01:00.000Z",
      },
      {
        id: "m2",
        authorId: "u1",
        createdAt: "2026-07-29T18:02:00.000Z",
      },
      {
        id: "m3",
        authorId: "u2",
        parentMessageId: "m1",
        createdAt: "2026-07-29T18:03:00.000Z",
      },
    ];
    expect(
      channelUnreadCount(
        messages,
        { lastReadAt: "2026-07-29T18:00:00.000Z" },
        "u1",
      ),
    ).toBe(1);
  });

  it("converte mensagem em tarefa rastreável e com a mesma audiência", () => {
    const task = createTaskFromChatMessage(
      {
        id: "m1",
        channelId: "c1",
        body: "Preparar proposta comercial até sexta",
        authorName: "João",
        visibility: "compartilhado",
        sharedWith: ["u1", "u2"],
        attachments: [{ id: "a1", name: "brief.pdf" }],
      },
      { id: "t1", ownerId: "u1", businessId: "b1" },
    );
    expect(task).toMatchObject({
      id: "t1",
      title: "Preparar proposta comercial até sexta",
      status: "A fazer",
      sourceChatMessageId: "m1",
      sourceChatChannelId: "c1",
      visibility: "compartilhado",
      sharedWith: ["u1", "u2"],
    });
    expect(task.attachments).toHaveLength(1);
  });

  it("produz resumo local e prompt sem inventar dados", () => {
    const messages = [
      {
        authorName: "Renata",
        body: "Decidimos aprovar a proposta.",
        createdAt: now,
      },
      {
        authorName: "João",
        body: "Preciso entregar a revisão na sexta.",
        createdAt: "2026-07-29T18:01:00.000Z",
      },
    ];
    expect(fallbackChatSummary(messages)).toContain("Decisões detectadas");
    const prompt = buildChatSummaryPrompt({ name: "comercial" }, messages);
    expect(prompt).toContain("Canal: comercial");
    expect(prompt).toContain("Não invente fatos");
  });
});
