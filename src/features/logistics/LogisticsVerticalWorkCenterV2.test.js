// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const board = {
  id: "board-1",
  name: "Novos Negócios",
  description: "Fluxo comercial",
  specialist: "commercial",
  types: ["tarefa", "rfq"],
  config: {
    statuses: [{ id: "novo", label: "Novo", color: "#64748b" }, { id: "concluido", label: "Concluído", color: "#15803d" }],
    groups: [{ id: "rfqs", name: "RFQs", color: "#176a4a" }],
    fields: [{ id: "margem", label: "Margem", type: "percentage" }],
    views: ["table", "kanban", "gantt", "dashboard", "workload", "map", "pivot"],
    defaultView: "table",
  },
};

const item = {
  id: "item-1", boardId: board.id, type: "rfq", title: "RFQ Mercado Livre", description: "Precificar operação",
  status: "novo", priority: "alta", responsible: "Renata", client: "Mercado Livre", dueDate: "2026-08-30",
  fields: { groupId: "rfqs", startDate: "2026-08-24", estimatedHours: 8, location: "Cajamar, SP", custom: { margem: 18 } },
  dependencies: [], relations: [], revision: 1,
};

describe("Central de Implantação To Do Green", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    history.replaceState({}, "", "/todogreen/central-trabalho");
    document.body.innerHTML = '<nav data-tdg-management-tools></nav><main class="tdg"><div data-tdg-page-content></div></main>';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith(`/item-1/detail`)) return new Response(JSON.stringify({ item, comments: [], events: [], subitems: [], access: { canWrite: true } }));
      return new Response(JSON.stringify({ boards: [board], items: [item], automationRules: [], clients: [], access: { canWrite: true } }));
    });
  });

  it("expõe o quadro configurável, as visualizações ERP e o detalhe colaborativo", async () => {
    await import("./LogisticsVerticalWorkCenterV2.js");
    await waitFor(() => expect(document.querySelector("[data-tdg-work-center-root]")?.textContent).toContain("Novos Negócios"));

    expect(document.body.textContent).toContain("Configurar quadro");
    expect(document.body.textContent).toContain("Carga");
    expect(document.body.textContent).toContain("Mapa");
    expect(document.body.textContent).toContain("Pivô");

    fireEvent.click([...document.querySelectorAll("[data-work-view]")].find((button) => button.textContent === "Gantt"));
    expect(document.querySelector(".tdg-work-gantt")?.textContent).toContain("RFQ Mercado Livre");

    fireEvent.click([...document.querySelectorAll("[data-work-view]")].find((button) => button.textContent === "Gráficos"));
    expect(document.querySelector(".tdg-work-dashboard")?.textContent).toContain("BI multi-board");

    fireEvent.click([...document.querySelectorAll("[data-work-view]")].find((button) => button.textContent === "Pivô"));
    expect(document.querySelector(".tdg-work-pivot")?.textContent).toContain("Renata");

    fireEvent.click([...document.querySelectorAll("[data-work-view]")].find((button) => button.textContent === "Tabela"));
    fireEvent.click(document.querySelector("[data-work-open]"));
    await waitFor(() => expect(document.querySelector(".tdg-work-drawer")?.textContent).toContain("Atualizações (0)"));
    expect(document.querySelector(".tdg-work-drawer")?.textContent).toContain("Dependências");
    expect(document.querySelector(".tdg-work-drawer")?.textContent).toContain("Subitens");
  });
});
