import { describe, expect, it } from "vitest";
import { assessAccount, gmailComposeUrl, outlookComposeUrl, whatsappUrl } from "./accountIntelligenceDomain.js";

// Protege recomendações comerciais baseadas em dados reais, não em texto genérico.
describe("inteligência e canais da conta", () => {
  it("prioriza procurement e sugere tarefa sem inventar contatos", () => {
    const result = assessAccount({ name: "Empresa logística", segment: "Transporte", crm: { contacts: [{ id: "1", name: "Fernanda", department: "Procurement de Logística e Transportes", email: "fernanda@example.com" }] } });
    expect(result.esgRelevance).toBe("Alta");
    expect(result.procurementContacts[0].name).toBe("Fernanda");
    expect(result.logisticsProcurementContacts[0].name).toBe("Fernanda");
    expect(result.nextTask).toMatch(/Confirmar com Fernanda/i);
  });

  it("não trata um contato genérico de compras como procurement logístico confirmado", () => {
    const result = assessAccount({ name: "Empresa", crm: { contacts: [{ id: "1", name: "Carlos", department: "Compras" }] } });
    expect(result.procurementContacts).toHaveLength(1);
    expect(result.logisticsProcurementContacts).toHaveLength(0);
    expect(result.nextTask).toMatch(/Confirmar com Carlos/i);
  });

  it("não trata vínculo pesquisado e não confirmado como procurement atual", () => {
    const result = assessAccount({ name: "Empresa", crm: { contacts: [{
      id: "1", name: "Contato antigo", department: "Procurement de Logística",
      employmentStatus: "unknown", employmentCheckedAt: "2026-08-13T00:00:00.000Z",
      currentEmploymentVerified: false, active: true,
    }] } });
    expect(result.procurementContacts).toHaveLength(0);
    expect(result.nextTask).toMatch(/indicação de quem responde por fretes/i);
  });

  it("usa o contato cadastrado e avança quando a ação sugerida é concluída", () => {
    const account = { name: "Empresa", crm: { contacts: [{ id: "1", name: "Marina", department: "Operações" }] } };
    const first = assessAccount(account);
    expect(first.nextTask).toMatch(/Pedir a Marina a indicação/i);
    expect(first.nextTaskKey).toBe("request-procurement-referral");

    const next = assessAccount({
      ...account,
      crm: { ...account.crm, completedSuggestedActions: [first.nextTaskKey] },
    });
    expect(next.nextTask).not.toBe(first.nextTask);
    expect(next.nextTask).toMatch(/Não há próxima ação confiável/i);
  });

  it("prioriza o próximo passo real da oportunidade", () => {
    const result = assessAccount(
      { id: "cli-1", name: "Empresa", crm: { contacts: [] } },
      [{ id: "opp-1", clientId: "cli-1", titulo: "Expansão SP", estagio: "Proposta", nextStep: "Enviar revisão de preço" }],
    );
    expect(result.nextTask).toContain("Enviar revisão de preço");
    expect(result.nextTask).toContain("Expansão SP");
    expect(result.nextTaskKey).toBe("opportunity-next-step:opp-1");
  });

  it("gera links apenas com os dados fornecidos", () => {
    expect(whatsappUrl("11 98839-5335")).toBe("https://wa.me/5511988395335");
    expect(gmailComposeUrl("fevasco@amazon.com", "Amazon")).toContain("fevasco%40amazon.com");
    expect(outlookComposeUrl("fevasco@amazon.com", "Amazon")).toContain("fevasco%40amazon.com");
  });
});
