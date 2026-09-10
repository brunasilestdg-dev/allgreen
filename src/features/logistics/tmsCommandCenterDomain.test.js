import { describe, expect, it } from "vitest";
import {
  buildTmsActionQueue,
  filterTmsRecords,
  paginateTmsRecords,
  slaState,
  summarizeTms,
  tmsCsv,
} from "./tmsCommandCenterDomain.js";

const now = Date.parse("2026-09-10T15:00:00Z");

describe("comando operacional do TMS", () => {
  it("separa atraso, risco, vencimento no dia e ausência de prazo", () => {
    expect(slaState({ status: "in_progress", scheduledEndAt: "2026-09-10T14:00:00Z" }, now).level).toBe("late");
    expect(slaState({ status: "released", scheduledEndAt: "2026-09-10T16:00:00Z" }, now).level).toBe("risk");
    expect(slaState({ status: "released", scheduledEndAt: "2026-09-11T12:00:00Z" }, now).level).toBe("attention");
    expect(slaState({ status: "released" }, now).level).toBe("no_deadline");
  });

  it("não acusa atraso em carga concluída no prazo ou cancelada", () => {
    expect(slaState({ status: "completed", scheduledEndAt: "2026-09-10T16:00:00Z", completedAt: "2026-09-10T15:30:00Z" }, now).level).toBe("completed");
    expect(slaState({ status: "cancelled", scheduledEndAt: "2026-09-10T14:00:00Z" }, now).level).toBe("cancelled");
  });

  it("pesquisa campos aninhados, filtra e prioriza a fila crítica", () => {
    const rows = [
      { id: "2", number: "OS-2", status: "released", scheduledEndAt: "2026-09-11T12:00:00Z", destination: { city: "Campinas" } },
      { id: "1", number: "OS-1", status: "in_progress", scheduledEndAt: "2026-09-10T14:00:00Z", destination: { city: "Osasco" } },
    ];
    expect(filterTmsRecords(rows, {}, now).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterTmsRecords(rows, { query: "osasco" }, now).map((row) => row.id)).toEqual(["1"]);
    expect(filterTmsRecords(rows, { risk: "attention" }, now).map((row) => row.id)).toEqual(["2"]);
  });

  it("pagina sem deixar a página apontar para fora da lista", () => {
    const page = paginateTmsRecords([{ id: 1 }, { id: 2 }, { id: 3 }], 9, 2);
    expect(page.page).toBe(2);
    expect(page.rows).toEqual([{ id: 3 }]);
  });

  it("resume valor em risco e monta uma fila acionável", () => {
    const data = { all: { orders: [
      { id: "1", status: "in_progress", scheduledEndAt: "2026-09-10T14:00:00Z", netAmount: 300 },
      { id: "2", status: "released", scheduledEndAt: "2026-09-10T16:00:00Z", netAmount: 200 },
    ], operations: [{ id: "o1", status: "transito", clientId: "", operationId: "" }], fiscal: [], ciots: [], billing: [{ amount: 500 }] } };
    const summary = summarizeTms(data, now);
    expect(summary.revenueAtRisk).toBe(500);
    expect(summary.billingValue).toBe(500);
    expect(buildTmsActionQueue(data, now)[0].section).toBe("cargas");
  });

  it("exporta CSV compatível com Excel em português", () => {
    const csv = tmsCsv([{ label: "OS", value: "number" }, { label: "Destino", value: (row) => row.destination.city }], [{ number: "OS-1", destination: { city: 'São "Paulo"' } }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"São ""Paulo"""');
    expect(csv).toContain("\r\n");
  });
});
