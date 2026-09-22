import { describe, expect, it } from "vitest";
import {
  applyPersonalInboxState,
  buildPersonalInboxItems,
  commentMentionsViewer,
  groupPersonalInboxItems,
  personalInboxSummary,
} from "./personalInboxDomain.js";

const viewer = {
  id: "user-1",
  name: "Renata Silva",
  email: "renata@example.com",
  isWorkspaceOwner: true,
};

describe("caixa de entrada pessoal", () => {
  it("reúne todas as categorias pedidas sem duplicar fontes", () => {
    const items = buildPersonalInboxItems(
      {
        notifications: [
          {
            id: "n1",
            assigneeId: viewer.id,
            kind: "mention",
            message: "Você foi mencionada em um documento",
            link: "documentos",
            createdAt: "2026-07-29T12:00:00.000Z",
          },
          {
            id: "n-outro",
            assigneeId: "outra-pessoa",
            message: "Não deve aparecer",
            createdAt: "2026-07-29T12:00:00.000Z",
          },
        ],
        tasks: [
          {
            id: "task-1",
            title: "Preparar proposta",
            ownerId: "gestor",
            assigneeId: viewer.id,
            status: "A fazer",
            due: "2026-08-01",
            createdAt: "2026-07-28T12:00:00.000Z",
          },
          {
            id: "task-2",
            title: "Revisar entrega",
            ownerId: viewer.id,
            missionStatus: "enviada_para_revisao",
            deliveries: [
              {
                id: "delivery-1",
                authorId: "member",
                authorName: "Maria",
                comment: "Pronto",
                createdAt: "2026-07-29T11:00:00.000Z",
              },
            ],
            createdAt: "2026-07-27T12:00:00.000Z",
          },
        ],
        databases: [
          {
            id: "base-1",
            name: "Clientes",
            ownerId: viewer.id,
            rows: [
              {
                id: "row-1",
                cells: { name: "Empresa Verde" },
                comments: [
                  {
                    id: "comment-1",
                    authorId: "member",
                    authorName: "Maria",
                    text: "Revise este cadastro",
                    createdAt: "2026-07-29T10:00:00.000Z",
                  },
                ],
              },
            ],
          },
        ],
        projects: [
          {
            id: "project-1",
            name: "Expansão",
            ownerId: viewer.id,
            changeRequests: [
              {
                id: "change-1",
                title: "Alterar escopo",
                status: "Solicitada",
                createdAt: "2026-07-29T09:00:00.000Z",
              },
            ],
          },
        ],
      },
      viewer,
      "2026-07-29T13:00:00.000Z",
    );

    expect(items.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "mention",
        "task",
        "comment",
        "approval",
        "change",
      ]),
    );
    expect(items.find((item) => item.id === "task-assigned:task-1")).toMatchObject(
      {
        dueAt: "2026-08-01",
        link: "operacao",
      },
    );
    expect(items.some((item) => item.sourceId === "n-outro")).toBe(false);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("detecta menção por nome, e-mail ou lista explícita", () => {
    expect(
      commentMentionsViewer({ text: "Pode olhar, @Renata Silva?" }, viewer),
    ).toBe(true);
    expect(
      commentMentionsViewer({ text: "Veja com @renata@example.com" }, viewer),
    ).toBe(true);
    expect(
      commentMentionsViewer({ text: "Sem arroba", mentions: [viewer.id] }, viewer),
    ).toBe(true);
    expect(commentMentionsViewer({ text: "Olá, Renata" }, viewer)).toBe(false);
  });

  it("persiste leitura e adiamento por item e resume apenas o que está ativo", () => {
    const items = [
      {
        id: "one",
        kind: "mention",
        title: "Menção",
        groupKey: "mentions",
        createdAt: "2026-07-29T12:00:00.000Z",
        nativeReadAt: null,
      },
      {
        id: "two",
        kind: "approval",
        title: "Aprovação",
        groupKey: "approvals",
        createdAt: "2026-07-29T11:00:00.000Z",
        nativeReadAt: null,
      },
    ];
    const withState = applyPersonalInboxState(
      items,
      [
        { itemKey: "one", readAt: "2026-07-29T12:30:00.000Z" },
        { itemKey: "two", snoozedUntil: "2026-07-31T08:00:00.000Z" },
      ],
      "2026-07-29T13:00:00.000Z",
    );
    expect(withState[0].readAt).toBe("2026-07-29T12:30:00.000Z");
    expect(withState[1].snoozed).toBe(true);
    expect(
      personalInboxSummary(withState, "2026-07-29T13:00:00.000Z"),
    ).toMatchObject({
      total: 1,
      unread: 0,
      mentions: 1,
      approvals: 0,
      snoozed: 1,
    });
  });

  it("agrupa notificações relacionadas e conta não lidas", () => {
    const groups = groupPersonalInboxItems([
      {
        id: "a",
        kind: "task",
        title: "Tarefa atribuída",
        groupKey: "tasks:assigned",
        createdAt: "2026-07-29T10:00:00.000Z",
        readAt: null,
      },
      {
        id: "b",
        kind: "task",
        title: "Tarefa atribuída",
        groupKey: "tasks:assigned",
        createdAt: "2026-07-29T11:00:00.000Z",
        readAt: "2026-07-29T11:30:00.000Z",
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "tasks:assigned",
      unread: 1,
    });
    expect(groups[0].items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
