/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodoGreenAutomations from "./TodoGreenAutomations.jsx";

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
}));

describe("automações da To Do Green", () => {
  beforeEach(() => {
    localStorage.setItem("seu-funcionario-auth-token", "teste");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("lista regras reais do servidor e cria uma automação por atalho", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).endsWith("/automations") && options.method === "POST") {
        const sent = JSON.parse(options.body);
        return json({
          automationRule: {
            id: "r2",
            ...sent,
            condition: {
              field: sent.conditionField,
              operator: sent.conditionOperator,
              value: sent.conditionValue,
            },
            action: { type: sent.actionType, value: sent.actionValue },
            enabled: true,
            revision: 1,
          },
        }, 201);
      }
      return json({
        boards: [{ id: "board-1", name: "Comercial e aprovações" }],
        automationRules: [{
          id: "r1",
          boardId: "board-1",
          name: "Priorizar bloqueios",
          trigger: "status-changed",
          condition: { field: "status", operator: "equals", value: "bloqueado" },
          action: { type: "change-priority", value: "critica" },
          enabled: true,
          revision: 1,
          lastRunAt: "2026-08-14T10:00:00.000Z",
        }],
        access: { canWrite: true },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TodoGreenAutomations setToast={vi.fn()} onNavigate={vi.fn()} />);

    expect(await screen.findByText("Priorizar bloqueios")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Escalar prazo vencido/ }));
    expect(screen.getByDisplayValue("Escalar prazo vencido")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ativar automação" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/todogreen/work-center/automations",
      expect.objectContaining({ method: "POST" }),
    ));
    const request = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith("/automations") && options?.method === "POST");
    expect(JSON.parse(request[1].body)).toMatchObject({
      trigger: "date-overdue",
      actionType: "change-priority",
      actionValue: "critica",
    });
    expect((await screen.findAllByText("Escalar prazo vencido")).length).toBeGreaterThan(1);
  });
});
