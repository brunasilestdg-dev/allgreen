import { describe, expect, it } from "vitest";
import {
  normalizedPurchaseApprovalFlow,
  purchaseApprovalPlan,
} from "../../../worker/services/todogreen-purchasing-enterprise.js";

describe("alçadas de compras To Do Green", () => {
  it("sobe a aprovação conforme o valor", () => {
    expect(purchaseApprovalPlan(5000).steps.map((item) => item.id)).toEqual(["gestor"]);
    expect(purchaseApprovalPlan(5000.01).steps.map((item) => item.id)).toEqual(["gestor", "financeiro"]);
    expect(purchaseApprovalPlan(25000.01).steps.map((item) => item.id)).toEqual(["gestor", "financeiro", "head"]);
    expect(purchaseApprovalPlan(100000.01).steps.map((item) => item.id)).toEqual(["gestor", "financeiro", "head", "diretoria"]);
  });

  it("preserva etapas já aprovadas e aponta a próxima", () => {
    const flow = normalizedPurchaseApprovalFlow(50000, {
      purchaseApprovalFlow: {
        approvals: [
          { stepId: "gestor", decision: "approved", actorUserId: "u1" },
          { stepId: "financeiro", decision: "approved", actorUserId: "u2" },
        ],
      },
    });
    expect(flow.approvals).toHaveLength(2);
    expect(flow.next?.id).toBe("head");
    expect(flow.complete).toBe(false);
  });

  it("recalcula a régua sem apagar aprovações compatíveis", () => {
    const flow = normalizedPurchaseApprovalFlow(150000, {
      purchaseApprovalFlow: {
        approvals: [
          { stepId: "gestor", decision: "approved" },
          { stepId: "financeiro", decision: "approved" },
        ],
      },
    });
    expect(flow.steps.map((item) => item.id)).toEqual(["gestor", "financeiro", "head", "diretoria"]);
    expect(flow.next?.id).toBe("head");
  });

  it("considera concluída somente depois da última etapa", () => {
    const flow = normalizedPurchaseApprovalFlow(20000, {
      purchaseApprovalFlow: {
        approvals: [
          { stepId: "gestor", decision: "approved" },
          { stepId: "financeiro", decision: "approved" },
        ],
      },
    });
    expect(flow.complete).toBe(true);
    expect(flow.next).toBeNull();
  });
});
