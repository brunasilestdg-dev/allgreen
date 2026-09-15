import { describe, expect, it } from "vitest";
import {
  contractToTdgLegal,
  isTdgLegalAvailable,
  tdgLegalToContract,
} from "./features/legal/tdgLegalBridge.js";

describe("isTdgLegalAvailable", () => {
  it("é falso para db vazio", () => {
    expect(isTdgLegalAvailable(null)).toBe(false);
    expect(isTdgLegalAvailable({})).toBe(false);
  });

  it("aceita sinais em campos diferentes (compatibilidade com o app existente)", () => {
    expect(isTdgLegalAvailable({ verticals: { todogreen: true } })).toBe(true);
    expect(isTdgLegalAvailable({ todogreen: { enabled: true } })).toBe(true);
    expect(isTdgLegalAvailable({ user: { verticals: ["todogreen"] } })).toBe(true);
    expect(isTdgLegalAvailable({ preferences: { vertical: "todogreen" } })).toBe(true);
    expect(isTdgLegalAvailable({ user: { todogreenRole: "juridico" } })).toBe(true);
  });

  it("é falso quando o sinal é de outra vertical", () => {
    expect(isTdgLegalAvailable({ preferences: { vertical: "outra" } })).toBe(false);
    expect(isTdgLegalAvailable({ user: { verticals: [] } })).toBe(false);
  });
});

describe("tdgLegalToContract", () => {
  const row = {
    id: "r1",
    titulo: "Contrato ACME",
    contraparte: "ACME S/A",
    clientId: "c-100",
    tipo: "contrato",
    risco: "alto",
    inicioVigencia: "2026-01-01",
    fimVigencia: "2026-12-31",
    responsavelId: "u-42",
    observacoes: "Ok",
    situacao: "aprovado",
    campos: {
      contractId: "ctr-1",
      proposalId: "prop-1",
      cnpj: "12345678000199",
      amount: 12500.5,
      currency: "BRL",
      renewalMode: "automatic",
      renewalNoticeDays: 45,
      approvalStatus: "aprovado",
      originalType: "franquia",
      uiRisk: "critico",
      confidentiality: "restrito",
      externalOfficeId: "esc-1",
      links: ["l-1"],
    },
    revision: 3,
    criadoEm: "2026-01-01T10:00:00Z",
    atualizadoEm: "2026-02-02T11:11:11Z",
  };

  it("traduz para o shape da nova UI", () => {
    const c = tdgLegalToContract(row);
    expect(c.id).toBe("r1");
    expect(c.source).toBe("tdg");
    expect(c.title).toBe("Contrato ACME");
    expect(c.counterparty).toBe("ACME S/A");
    expect(c.status).toBe("aprovado");
    expect(c.type).toBe("franquia"); // originalType restaurado
    expect(c.risk).toBe("critico"); // uiRisk restaurado
    expect(c.amount).toBeCloseTo(12500.5);
    expect(c.renewalMode).toBe("automatic");
    expect(c.renewalNoticeDays).toBe(45);
    expect(c.contractId).toBe("ctr-1");
    expect(c.proposalId).toBe("prop-1");
    expect(c.externalOfficeId).toBe("esc-1");
  });

  it("mapeia situação TDG 'assinado' → nova UI 'vigente'", () => {
    expect(tdgLegalToContract({ ...row, situacao: "assinado" }).status).toBe("vigente");
  });

  it("mapeia risco TDG 'alto' quando não há uiRisk (crítico não existe no TDG)", () => {
    const c = tdgLegalToContract({ ...row, campos: { ...row.campos, uiRisk: "" }, risco: "alto" });
    expect(c.risk).toBe("alto");
  });

  it("tipo TDG desconhecido cai em 'prestacao_servicos' na UI", () => {
    const c = tdgLegalToContract({ ...row, tipo: "outro", campos: {} });
    expect(c.type).toBe("outro");
    const c2 = tdgLegalToContract({ ...row, tipo: "aditivo", campos: {} });
    expect(c2.type).toBe("prestacao_servicos");
  });
});

describe("contractToTdgLegal", () => {
  const contract = {
    id: "c1",
    title: "Locação de galpão",
    counterparty: "Imobiliária Beta",
    counterpartyDocument: "99887766000155",
    type: "locacao",
    status: "vigente",
    risk: "critico",
    confidentiality: "restrito",
    amount: 8000,
    currency: "BRL",
    startDate: "2026-02-01",
    endDate: "2027-01-31",
    renewalMode: "automatic",
    renewalNoticeDays: 60,
    approvalStatus: "aprovado",
    externalOfficeId: "esc-2",
    contractId: "ctr-9",
    proposalId: "prop-9",
    clientId: "cli-9",
    responsibleId: "u-1",
    notes: "Cláusula LGPD adicional",
    links: ["m-1"],
  };

  it("gera payload no vocabulário TDG (situação/tipo/risco)", () => {
    const payload = contractToTdgLegal(contract);
    expect(payload.titulo).toBe("Locação de galpão");
    // vigente → assinado (TDG só tem 7 situações)
    expect(payload.situacao).toBe("assinado");
    // locação (não existe no TDG) → contrato
    expect(payload.tipo).toBe("contrato");
    // critico (não existe no TDG) → alto, mas uiRisk preserva o original
    expect(payload.risco).toBe("alto");
    expect(payload.campos.uiRisk).toBe("critico");
    expect(payload.campos.originalType).toBe("locacao");
  });

  it("preserva os vínculos que os GATES operacionais leem", () => {
    const payload = contractToTdgLegal(contract);
    expect(payload.campos.contractId).toBe("ctr-9");
    expect(payload.campos.proposalId).toBe("prop-9");
  });

  it("clampa `renewalNoticeDays` no range [0, 365]", () => {
    expect(contractToTdgLegal({ renewalNoticeDays: 9999 }).campos.renewalNoticeDays).toBe(365);
    expect(contractToTdgLegal({ renewalNoticeDays: -5 }).campos.renewalNoticeDays).toBe(0);
  });

  it("carrega `revision` no payload quando a nova UI já leu (optimistic lock)", () => {
    const payload = contractToTdgLegal({ ...contract, revision: 7 });
    expect(payload.revision).toBe(7);
    // Sem revision, o campo não aparece — evita gravar 0/NaN no primeiro POST.
    const first = contractToTdgLegal(contract);
    expect(first.revision).toBeUndefined();
  });

  it("ida e volta preserva os campos que a UI já mostrava", () => {
    const payload = contractToTdgLegal(contract);
    // Simula uma linha vinda do backend depois do POST — em teste unitário
    // reproduzimos o formato "daLinha" (com `campos` já parseado).
    const row = {
      id: "novo",
      titulo: payload.titulo,
      contraparte: payload.contraparte,
      clientId: payload.clientId,
      tipo: payload.tipo,
      risco: payload.risco,
      inicioVigencia: payload.inicioVigencia,
      fimVigencia: payload.fimVigencia,
      responsavelId: payload.responsavelId,
      observacoes: payload.observacoes,
      situacao: payload.situacao,
      campos: payload.campos,
      revision: 1,
      criadoEm: "2026-02-01T00:00:00Z",
      atualizadoEm: "2026-02-01T00:00:00Z",
    };
    const restored = tdgLegalToContract(row);
    // Tipo original (locação) volta certinho por causa do `originalType`.
    expect(restored.type).toBe("locacao");
    expect(restored.risk).toBe("critico");
    expect(restored.status).toBe("vigente");
    expect(restored.renewalMode).toBe("automatic");
    expect(restored.contractId).toBe("ctr-9");
    expect(restored.proposalId).toBe("prop-9");
  });
});
