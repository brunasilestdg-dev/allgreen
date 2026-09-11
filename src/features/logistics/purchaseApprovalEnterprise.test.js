import { describe, expect, it } from "vitest";
import {
  normalizarBandas,
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

describe("régua de alçadas versionada (normalizarBandas)", () => {
  const reguaValida = {
    bands: [
      { max: 100000, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] },
      { max: 2000, steps: [{ id: "gestor", label: "Gestor", permission: "purchase:manage" }] },
      { max: null, steps: [
        { id: "gestor", label: "Gestor", permission: "purchase:manage" },
        { id: "diretoria", label: "Diretoria", ownerOnly: true },
      ] },
    ],
  };

  it("ordena por teto e força a última faixa a ser o catch-all", () => {
    const bandas = normalizarBandas(reguaValida);
    expect(bandas.map((b) => b.max)).toEqual([2000, 100000, null]);
    // a faixa configurada muda o plano do servidor
    expect(purchaseApprovalPlan(1500, bandas).steps.map((s) => s.id)).toEqual(["gestor"]);
    expect(purchaseApprovalPlan(500000, bandas).steps.map((s) => s.id)).toEqual(["gestor", "diretoria"]);
  });

  it("recusa régua malformada (retorna null)", () => {
    expect(normalizarBandas({ bands: [] })).toBeNull();
    expect(normalizarBandas({ bands: [{ max: -1, steps: [{ id: "g", label: "G", permission: "purchase:manage" }] }] })).toBeNull();
    expect(normalizarBandas({ bands: [{ max: 100, steps: [] }] })).toBeNull();
    // permissão fora do catálogo não pode virar etapa
    expect(normalizarBandas({ bands: [{ max: null, steps: [{ id: "x", label: "X", permission: "qualquer:coisa" }] }] })).toBeNull();
    expect(normalizarBandas(null)).toBeNull();
  });

  it("purchaseApprovalPlan cai na régua de fábrica quando bands é inválido", () => {
    expect(purchaseApprovalPlan(5000, null).steps.map((s) => s.id)).toEqual(["gestor"]);
    expect(purchaseApprovalPlan(5000, []).steps.map((s) => s.id)).toEqual(["gestor"]);
  });
});
