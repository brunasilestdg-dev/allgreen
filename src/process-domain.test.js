import { describe, expect, it } from "vitest";
import {
  buildProcessConnections,
  createProcessCase,
  createProcessDefinition,
  fieldIsVisible,
  processMetrics,
  processSla,
  transitionProcessCase,
  validateProcessValues,
} from "./features/processes/processDomain.js";

const process = createProcessDefinition(
  {
    id: "purchase",
    name: "Compras",
    serviceCode: "CMP",
    fields: [
      { id: "request", name: "Solicitação", type: "text", required: true },
      { id: "value", name: "Valor", type: "currency" },
      {
        id: "reason",
        name: "Justificativa",
        type: "longtext",
        condition: { fieldId: "value", operator: "not_equals", value: "" },
      },
    ],
    stages: [
      { id: "new", name: "Novo", slaHours: 4 },
      {
        id: "approval",
        name: "Aprovação",
        slaHours: 8,
        approvalRequired: true,
        requiredFieldIds: ["value"],
      },
      { id: "done", name: "Concluído", terminal: true },
    ],
    connections: { baseId: "requests", createTask: true },
  },
  { ownerId: "u1", businessId: "b1" },
  "2026-07-29T10:00:00.000Z",
);

describe("motor de processos", () => {
  it("aplica validação e campos condicionais", () => {
    expect(validateProcessValues(process, {}).errors.request).toBeTruthy();
    expect(fieldIsVisible(process.fields[2], { value: "" })).toBe(false);
    expect(fieldIsVisible(process.fields[2], { value: 100 })).toBe(true);
  });

  it("cria caso com protocolo, histórico e primeira etapa", () => {
    const result = createProcessCase(
      process,
      { request: "Comprar notebooks", value: 5000 },
      { sequence: 7, requesterId: "u1", requesterName: "Renata" },
      "2026-07-29T11:00:00.000Z",
    );
    expect(result.errors).toEqual({});
    expect(result.caseRecord).toMatchObject({
      protocol: "CMP-20260729-0007",
      stageId: "new",
      requesterName: "Renata",
    });
    expect(result.caseRecord.history[0].type).toBe("created");
  });

  it("bloqueia salto, campo obrigatório e aprovação ausente", () => {
    const { caseRecord } = createProcessCase(
      process,
      { request: "Comprar notebooks" },
      { sequence: 1 },
    );
    expect(transitionProcessCase(process, caseRecord, "done").error).toContain(
      "sequência",
    );
    expect(
      transitionProcessCase(process, caseRecord, "approval").error,
    ).toContain("campos obrigatórios");
    const withValue = { ...caseRecord, values: { ...caseRecord.values, value: 5000 } };
    expect(
      transitionProcessCase(process, withValue, "approval").error,
    ).toContain("aprovação");
  });

  it("move com aprovação e conclui preservando auditoria", () => {
    const { caseRecord } = createProcessCase(
      process,
      { request: "Comprar notebooks", value: 5000 },
      { sequence: 1 },
      "2026-07-29T11:00:00.000Z",
    );
    const approved = transitionProcessCase(process, caseRecord, "approval", {
      approved: true,
      actorId: "manager",
      actorName: "Gestora",
    }).caseRecord;
    const completed = transitionProcessCase(process, approved, "done", {
      actorId: "manager",
    }).caseRecord;
    expect(approved.approvals).toHaveLength(1);
    expect(completed.status).toBe("concluido");
    expect(completed.history.map((item) => item.type)).toEqual([
      "created",
      "transition",
      "completed",
    ]);
  });

  it("calcula SLA e indicadores do processo", () => {
    const { caseRecord } = createProcessCase(
      process,
      { request: "Comprar notebooks", value: 5000 },
      { sequence: 1 },
      "2026-07-29T10:00:00.000Z",
    );
    expect(processSla(process, caseRecord, Date.parse("2026-07-29T15:00:00.000Z")).status)
      .toBe("atrasado");
    expect(
      processMetrics(process, [caseRecord], Date.parse("2026-07-29T15:00:00.000Z")),
    ).toMatchObject({ total: 1, active: 1, delayed: 1 });
  });

  it("gera conexões opcionais com base e tarefa", () => {
    const { caseRecord } = createProcessCase(
      process,
      { request: "Comprar notebooks", value: 5000 },
      { sequence: 1 },
      "2026-07-29T11:00:00.000Z",
    );
    const databases = [
      {
        id: "requests",
        fields: [
          { id: "title", name: "Solicitação", type: "text" },
          { id: "amount", name: "Valor", type: "currency" },
        ],
        rows: [],
      },
    ];
    const linked = buildProcessConnections(process, caseRecord, databases, {
      recordId: "r1",
      taskId: "t1",
      ownerId: "u1",
      businessId: "b1",
    });
    expect(linked.databases[0].rows[0].cells).toEqual({
      title: "Comprar notebooks",
      amount: 5000,
    });
    expect(linked.task).toMatchObject({
      id: "t1",
      sourceCaseId: caseRecord.id,
    });
  });
});
