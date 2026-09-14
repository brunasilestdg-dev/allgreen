import { describe, expect, it } from "vitest";
import {
  LEGAL_TEMPLATES,
  accessLevelFor,
  appendLegalEvent,
  approvalActionsFor,
  buildLegalAiPrompt,
  buildLegalNotifications,
  buildPlannerItemsFromLegal,
  canAccessRequest,
  canRead,
  complianceGaps,
  complianceScore,
  contractStatusIsClosed,
  createContract,
  createLegalRequest,
  createMatter,
  createProcess,
  createPowerOfAttorney,
  daysUntil,
  deadlineUrgency,
  exportContractsCsv,
  exportMattersCsv,
  filterOwnOrLegal,
  filterVisible,
  fillLegalTemplate,
  formatMoneyBR,
  isLegalStaff,
  labelContractStatus,
  labelMatterType,
  legalAlerts,
  legalDashboard,
  legalReports,
  legalTemplateFields,
  matterStatusIsClosed,
  normalizeConfidentiality,
  normalizeRisk,
  parseLegalAiResponse,
  parseMoney,
  processStatusIsClosed,
  resolveApprovalAction,
  riskExposureSeries,
  riskMatrix,
  searchLegal,
  templateToDocument,
  validateContract,
  validateDeadline,
  validateFee,
  validateMatter,
  validateProcess,
  validatePowerOfAttorney,
} from "./features/legal/legalHubDomain.js";

const FIXED_NOW = Date.parse("2026-09-14T12:00:00Z");

describe("normalização e rótulos", () => {
  it("normaliza risco para o padrão quando inválido", () => {
    expect(normalizeRisk("catastrofico")).toBe("medio");
    expect(normalizeRisk("alto")).toBe("alto");
  });

  it("normaliza confidencialidade para 'interno' quando desconhecido", () => {
    expect(normalizeConfidentiality("top-secret")).toBe("interno");
    expect(normalizeConfidentiality("restrito")).toBe("restrito");
  });

  it("devolve rótulos legíveis para IDs conhecidos", () => {
    expect(labelMatterType("consultivo")).toBe("Consultivo");
    expect(labelContractStatus("vigente")).toBe("Vigente (assinado)");
  });
});

describe("daysUntil e deadlineUrgency", () => {
  it("conta dias em UTC, ignorando fuso", () => {
    expect(daysUntil("2026-09-21", FIXED_NOW)).toBe(7);
    expect(daysUntil("2026-09-14", FIXED_NOW)).toBe(0);
    expect(daysUntil("2026-09-13", FIXED_NOW)).toBe(-1);
    expect(daysUntil("data-invalida", FIXED_NOW)).toBeNull();
  });

  it("mapeia dias em níveis de urgência", () => {
    expect(deadlineUrgency(-3).level).toBe("vencido");
    expect(deadlineUrgency(0).level).toBe("vencido");
    expect(deadlineUrgency(1).level).toBe("urgente");
    expect(deadlineUrgency(6).level).toBe("urgente");
    expect(deadlineUrgency(15).level).toBe("atencao");
    expect(deadlineUrgency(60).level).toBe("programado");
    expect(deadlineUrgency(180).level).toBe("tranquilo");
    expect(deadlineUrgency(null).level).toBe("indefinido");
  });
});

describe("parseMoney e formatMoneyBR", () => {
  it("aceita formato BR e USD sem quebrar", () => {
    expect(parseMoney("R$ 1.250,50")).toBeCloseTo(1250.5);
    expect(parseMoney("2000")).toBe(2000);
    expect(parseMoney(123.4)).toBeCloseTo(123.4);
    expect(parseMoney("abacaxi")).toBe(0);
    expect(parseMoney("")).toBe(0);
  });

  it("formata em pt-BR com símbolo", () => {
    const s = formatMoneyBR(1250.5);
    // A localização do runtime pode inserir NBSP; só garante que o número aparece.
    expect(s.replace(/\s+/g, "")).toContain("1.250,50");
  });
});

describe("validações", () => {
  it("exige título nas entidades principais", () => {
    expect(validateMatter({})).toMatch(/título/i);
    expect(validateContract({})).toMatch(/título/i);
    expect(validateProcess({})).toMatch(/título/i);
    expect(validateMatter({ title: "Análise" })).toBe("");
  });

  it("procuração aceita quando há outorgante", () => {
    expect(validatePowerOfAttorney({ grantor: "ACME" })).toBe("");
    expect(validatePowerOfAttorney({})).toMatch(/outorgante|título/i);
  });

  it("prazo exige data válida", () => {
    expect(validateDeadline({ title: "Contestação", dueDate: "2026-09-20" })).toBe("");
    expect(validateDeadline({ title: "X" })).toMatch(/data/i);
  });

  it("lançamento exige valor diferente de zero", () => {
    expect(validateFee({ title: "Honorário", amount: 100 })).toBe("");
    expect(validateFee({ title: "Honorário", amount: 0 })).toMatch(/valor/i);
  });
});

describe("createMatter / createContract / createProcess", () => {
  it("cria demanda com padrões seguros", () => {
    const m = createMatter({ title: "Análise NDA" });
    expect(m.status).toBe("aberto");
    expect(m.type).toBe("consultivo");
    expect(m.risk).toBe("medio");
    expect(m.confidentiality).toBe("interno");
    expect(m.amountAtRisk).toBe(0);
    expect(m.provision).toBe("remota");
    expect(m.id).toBeDefined();
  });

  it("normaliza campos inválidos ao criar contrato", () => {
    const c = createContract({
      title: "X",
      type: "algo",
      status: "outro",
      risk: "ridiculo",
      renewalNoticeDays: 999,
      amount: "R$ 1.000,00",
    });
    expect(c.type).toBe("prestacao_servicos");
    expect(c.status).toBe("rascunho");
    expect(c.risk).toBe("medio");
    expect(c.renewalNoticeDays).toBe(365);
    expect(c.amount).toBeCloseTo(1000);
    expect(c.currency).toBe("BRL");
  });

  it("processo tem instância e papel válidos", () => {
    const p = createProcess({ title: "Ação", instance: "xxxx", role: "yyyy", nature: "trabalhista" });
    expect(p.instance).toBe("primeira");
    expect(p.role).toBe("autor");
    expect(p.nature).toBe("trabalhista");
    expect(p.status).toBe("em_andamento");
  });

  it("procuração ganha título automático quando ausente", () => {
    const p = createPowerOfAttorney({ attorney: "Advogado" });
    expect(p.title).toContain("Advogado");
  });
});

describe("controle de acesso por confidencialidade", () => {
  const restrito = { id: "1", title: "X", confidentiality: "restrito" };
  const interno = { id: "2", title: "Y", confidentiality: "interno" };
  const confidencial = { id: "3", title: "Z", confidentiality: "confidencial" };

  it("colaborador vê interno, mas não restrito nem confidencial", () => {
    const viewer = { role: "colaborador" };
    expect(canRead(interno, viewer)).toBe(true);
    expect(canRead(restrito, viewer)).toBe(false);
    expect(canRead(confidencial, viewer)).toBe(false);
  });

  it("jurídico vê restrito, mas confidencial só o dono ou admin", () => {
    expect(canRead(restrito, { role: "juridico" })).toBe(true);
    expect(canRead(confidencial, { role: "juridico" })).toBe(false);
    expect(canRead(confidencial, { role: "admin" })).toBe(true);
    expect(canRead(confidencial, { role: "colaborador", isOwner: true })).toBe(true);
  });

  it("filterVisible retira o que o usuário não pode ver", () => {
    const list = [restrito, interno, confidencial];
    expect(filterVisible(list, { role: "colaborador" })).toEqual([interno]);
    expect(filterVisible(list, { role: "juridico" }).map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("accessLevelFor mapeia papéis conhecidos", () => {
    expect(accessLevelFor({ role: "admin" })).toBe(3);
    expect(accessLevelFor({ role: "juridico" })).toBe(2);
    expect(accessLevelFor({ role: "colaborador" })).toBe(1);
    expect(accessLevelFor({ role: "convidado" })).toBe(0);
    expect(accessLevelFor({ isOwner: true })).toBe(3);
  });
});

describe("dashboard e alertas", () => {
  const records = {
    matters: [
      { id: "m1", title: "A", status: "em_andamento", risk: "alto", confidentiality: "interno", amountAtRisk: 50000, provision: "provavel" },
      { id: "m2", title: "B", status: "concluido", risk: "medio", confidentiality: "interno" },
    ],
    contracts: [
      { id: "c1", title: "Vigente", status: "vigente", risk: "medio", confidentiality: "interno", endDate: "2026-10-04", counterparty: "Alfa", renewalNoticeDays: 30 },
      { id: "c2", title: "Rascunho", status: "rascunho", risk: "alto", confidentiality: "interno" },
    ],
    processes: [
      { id: "p1", title: "Cível", status: "em_andamento", risk: "critico", confidentiality: "interno", amount: 100000, provision: "provavel", provisionAmount: 20000, nextHearing: "2026-10-01" },
    ],
    powersOfAttorney: [
      { id: "po1", title: "PoA", status: "vigente", confidentiality: "interno", expiresAt: "2026-10-10", attorney: "Adv." },
    ],
    deadlines: [
      { id: "d1", title: "Contestação", status: "pendente", dueDate: "2026-09-20" },
    ],
    fees: [
      { id: "f1", title: "Honor.", amount: 3000, paid: false },
    ],
  };

  it("dashboard resume contagens, exposição e riscos", () => {
    const dash = legalDashboard(records, FIXED_NOW);
    expect(dash.counts.openMatters).toBe(1);
    expect(dash.counts.activeContracts).toBe(1);
    expect(dash.counts.openProcesses).toBe(1);
    expect(dash.counts.powersOfAttorney).toBe(1);
    expect(dash.exposure.contingent).toBeCloseTo(100000);
    expect(dash.exposure.provisioned).toBeCloseTo(20000);
    expect(dash.exposure.fees).toBeCloseTo(3000);
    expect(dash.exposure.total).toBeCloseTo(123000);
    expect(dash.riskCounts.critico).toBe(1);
    expect(dash.expiringContracts).toHaveLength(1);
    expect(dash.expiringPowersOfAttorney).toHaveLength(1);
  });

  it("alertas trazem contrato, prazo, procuração e audiência ordenados", () => {
    const alerts = legalAlerts(records, FIXED_NOW);
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain("contract-end");
    expect(kinds).toContain("deadline");
    expect(kinds).toContain("power-of-attorney");
    expect(kinds).toContain("hearing");
    const first = alerts[0];
    expect(["vencido", "urgente", "atencao"].includes(first.level)).toBe(true);
  });

  it("riskMatrix agrupa por risco e faixa de valor", () => {
    const matrix = riskMatrix(records.matters, records.processes);
    // Só considera abertas — a matter em "concluido" fica de fora.
    expect(matrix.reduce((s, c) => s + c.count, 0)).toBe(2);
    const critico = matrix.find((c) => c.risk === "critico");
    expect(critico?.amount).toBeCloseTo(100000);
  });
});

describe("legalReports", () => {
  it("devolve null (não 0) quando não há série suficiente", () => {
    const empty = legalReports({}, FIXED_NOW);
    expect(empty.processWinRate).toBeNull();
    expect(empty.matterAverageAgeDays).toBeNull();
  });

  it("calcula taxa de vitória sobre processos decididos", () => {
    const reports = legalReports(
      {
        processes: [
          { id: "1", status: "ganho" },
          { id: "2", status: "ganho" },
          { id: "3", status: "perdido" },
          { id: "4", status: "em_andamento" },
        ],
      },
      FIXED_NOW,
    );
    expect(reports.processWinRate).toBeCloseTo(2 / 3);
  });
});

describe("compliance", () => {
  it("escore ignora 'não aplicável' e devolve null quando não há aplicável", () => {
    expect(complianceScore([])).toBeNull();
    expect(complianceScore([{ status: "nao_aplicavel" }])).toBeNull();
    expect(
      complianceScore([{ status: "conforme" }, { status: "nao_conforme" }, { status: "conforme" }]),
    ).toBeCloseTo(2 / 3);
  });

  it("gaps traz apenas pendentes e não conformes", () => {
    const gaps = complianceGaps([
      { id: 1, status: "conforme" },
      { id: 2, status: "pendente" },
      { id: 3, status: "nao_conforme" },
      { id: 4, status: "nao_aplicavel" },
    ]);
    expect(gaps.map((g) => g.id)).toEqual([2, 3]);
  });
});

describe("templates", () => {
  it("preserva placeholders desconhecidos como [chave]", () => {
    const body = "Assunto: {{tema}} — parte: {{parte}}";
    expect(fillLegalTemplate(body, { tema: "NDA" })).toBe("Assunto: NDA — parte: [parte]");
  });

  it("legalTemplateFields lista placeholders únicos", () => {
    const fields = legalTemplateFields("Olá {{nome}}, aqui {{nome}} e {{cidade}}");
    expect(fields.sort()).toEqual(["cidade", "nome"]);
  });

  it("todos os templates trazem aviso de que não substituem revisão", () => {
    for (const template of LEGAL_TEMPLATES) {
      expect(template.body.length).toBeGreaterThan(50);
    }
  });
});

describe("fluxo de aprovação", () => {
  it("submeter só aparece a partir de rascunho/ajuste, aprovar exige jurídico", () => {
    const juridico = { role: "juridico" };
    const colab = { role: "colaborador" };
    const rascunho = approvalActionsFor("rascunho", colab).map((a) => a.id);
    expect(rascunho).toContain("submeter");
    expect(rascunho).not.toContain("aprovar");
    const pendente = approvalActionsFor("pendente", juridico).map((a) => a.id);
    expect(pendente).toContain("aprovar");
    expect(pendente).toContain("solicitar_ajuste");
  });

  it("resolveApprovalAction recusa quando falta permissão ou conteúdo", () => {
    const colab = { role: "colaborador" };
    const juridico = { role: "juridico" };
    expect(resolveApprovalAction("pendente", "aprovar", { viewer: colab }).ok).toBe(false);
    expect(resolveApprovalAction("rascunho", "submeter", { viewer: colab }).ok).toBe(false);
    expect(
      resolveApprovalAction("rascunho", "submeter", { viewer: colab, hasMessage: true }).ok,
    ).toBe(true);
    expect(resolveApprovalAction("pendente", "solicitar_ajuste", { viewer: juridico }).ok).toBe(
      false,
    );
    expect(
      resolveApprovalAction("pendente", "solicitar_ajuste", { viewer: juridico, hasMessage: true })
        .ok,
    ).toBe(true);
  });
});

describe("busca centralizada", () => {
  const records = {
    matters: [
      { id: "m1", title: "Análise do contrato Alfa", confidentiality: "interno" },
      { id: "m2", title: "Contencioso Beta", confidentiality: "restrito" },
    ],
    contracts: [
      { id: "c1", title: "Contrato Gamma", counterparty: "Empresa Gamma", confidentiality: "interno" },
    ],
    processes: [],
    powersOfAttorney: [],
    deadlines: [],
    offices: [],
  };

  it("acha por trecho no título e ordena por relevância", () => {
    const r = searchLegal(records, "gamma", { role: "colaborador" });
    expect(r[0].id).toBe("c1");
  });

  it("respeita confidencialidade: colaborador não vê restrito", () => {
    const r = searchLegal(records, "beta", { role: "colaborador" });
    expect(r).toHaveLength(0);
    const rj = searchLegal(records, "beta", { role: "juridico" });
    expect(rj.map((x) => x.id)).toContain("m2");
  });

  it("busca vazia devolve lista vazia", () => {
    expect(searchLegal(records, "")).toEqual([]);
  });
});

describe("status encerrado", () => {
  it("identifica situações finais", () => {
    expect(matterStatusIsClosed("concluido")).toBe(true);
    expect(matterStatusIsClosed("em_andamento")).toBe(false);
    expect(contractStatusIsClosed("encerrado")).toBe(true);
    expect(contractStatusIsClosed("vigente")).toBe(false);
    expect(processStatusIsClosed("ganho")).toBe(true);
    expect(processStatusIsClosed("recurso")).toBe(false);
  });
});

describe("permissão de solicitações (Head Jurídico e adm veem tudo; solicitante só a própria)", () => {
  const alice = { userId: "u-alice", role: "colaborador" };
  const bob = { userId: "u-bob", role: "colaborador" };
  const juridico = { userId: "u-jur", role: "juridico" };
  const admin = { userId: "u-adm", role: "admin" };
  const head = { userId: "u-head", role: "head_juridico" };
  const owner = { userId: "u-owner", isOwner: true };

  const aliceMatter = { id: "1", title: "Análise", confidentiality: "interno", submitterId: "u-alice" };
  const bobMatter = { id: "2", title: "Outra", confidentiality: "interno", submitterId: "u-bob" };
  const restrito = { id: "3", title: "Restrito", confidentiality: "restrito" };

  it("isLegalStaff aceita jurídico, head_juridico, admin, diretor e owner", () => {
    expect(isLegalStaff(alice)).toBe(false);
    expect(isLegalStaff(juridico)).toBe(true);
    expect(isLegalStaff(head)).toBe(true);
    expect(isLegalStaff(admin)).toBe(true);
    expect(isLegalStaff({ role: "diretor" })).toBe(true);
    expect(isLegalStaff(owner)).toBe(true);
  });

  it("solicitante enxerga a própria demanda, não a de outros", () => {
    expect(canAccessRequest(aliceMatter, alice)).toBe(true);
    expect(canAccessRequest(bobMatter, alice)).toBe(false);
    expect(canAccessRequest(restrito, alice)).toBe(false);
  });

  it("jurídico, head e admin veem a fila inteira dentro da confidencialidade", () => {
    expect(canAccessRequest(aliceMatter, juridico)).toBe(true);
    expect(canAccessRequest(bobMatter, juridico)).toBe(true);
    expect(canAccessRequest(restrito, juridico)).toBe(true);
    expect(canAccessRequest(restrito, admin)).toBe(true);
    expect(canAccessRequest(restrito, head)).toBe(true);
  });

  it("filterOwnOrLegal filtra a lista pela visão do viewer", () => {
    const list = [aliceMatter, bobMatter, restrito];
    expect(filterOwnOrLegal(list, alice).map((m) => m.id)).toEqual(["1"]);
    expect(filterOwnOrLegal(list, admin).map((m) => m.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("createLegalRequest carimba submitter e nasce em 'aberto'/interno", () => {
    const req = createLegalRequest(
      { title: "Ajuda", description: "Preciso", area: "TI" },
      alice,
    );
    expect(req.submitterId).toBe("u-alice");
    expect(req.status).toBe("aberto");
    expect(req.confidentiality).toBe("interno");
    expect(req.submitterArea).toBe("TI");
  });
});

describe("eventos e timeline", () => {
  it("appendLegalEvent adiciona ao histórico sem alterar id do registro", () => {
    const record = { id: "m1", title: "X" };
    const updated = appendLegalEvent(record, { kind: "parecer", message: "Ok" });
    expect(updated.id).toBe("m1");
    expect(updated.events).toHaveLength(1);
    expect(updated.events[0].kind).toBe("parecer");
    expect(updated.events[0].message).toBe("Ok");
    expect(updated.events[0].createdAt).toBeDefined();
  });

  it("preserva eventos existentes", () => {
    const record = { id: "m1", events: [{ id: "e0", kind: "note", message: "a" }] };
    const updated = appendLegalEvent(record, { kind: "decisao", message: "b" });
    expect(updated.events).toHaveLength(2);
    expect(updated.events[0].id).toBe("e0");
  });
});

describe("exportação CSV", () => {
  it("gera cabeçalho e linhas com separador ';' e BOM UTF-8", () => {
    const csv = exportMattersCsv([
      { title: "Análise", type: "consultivo", status: "aberto", risk: "medio", confidentiality: "interno", amountAtRisk: 1250.5 },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain("Título;Tipo;Situação");
    expect(csv).toContain("Análise;Consultivo;Aberto");
    expect(csv).toContain("1250,50");
  });

  it("escapa aspas e ponto-e-vírgula no CSV", () => {
    const csv = exportContractsCsv([
      { title: 'Con "trato"; especial', type: "prestacao_servicos", status: "vigente", risk: "medio", confidentiality: "interno", counterparty: "ACME", amount: 100 },
    ]);
    expect(csv).toContain('"Con ""trato""; especial"');
  });
});

describe("templates → documento e séries do dashboard", () => {
  it("templateToDocument produz shape que o módulo Documents entende", () => {
    const template = LEGAL_TEMPLATES[0];
    const doc = templateToDocument(template, { parte_1: "ACME", parte_2: "XPTO" });
    expect(doc.type).toBe(template.kind);
    expect(doc.content).toContain("ACME");
    expect(doc.content).toContain("XPTO");
    expect(doc.templateId).toBe(template.id);
  });

  it("riskExposureSeries agrega valor por nível e mantém 4 níveis", () => {
    const series = riskExposureSeries({
      matters: [{ status: "em_andamento", risk: "alto", amountAtRisk: 500 }],
      processes: [{ status: "em_andamento", risk: "critico", amount: 1000 }],
    });
    expect(series).toHaveLength(4);
    expect(series.find((s) => s.id === "alto")?.value).toBe(500);
    expect(series.find((s) => s.id === "critico")?.value).toBe(1000);
    expect(series.find((s) => s.id === "baixo")?.value).toBe(0);
  });
});

describe("notificações e planner", () => {
  const FIXED = Date.parse("2026-09-14T12:00:00Z");
  const records = {
    contracts: [{ id: "c1", title: "V", status: "vigente", endDate: "2026-09-20", counterparty: "A", renewalNoticeDays: 30, confidentiality: "interno" }],
    deadlines: [{ id: "d1", title: "Contestação", status: "pendente", dueDate: "2026-09-16", fatal: true }],
    powersOfAttorney: [],
    processes: [{ id: "p1", title: "Ação", status: "em_andamento", nextHearing: "2026-09-25", nextDeadline: "2026-09-19", risk: "alto", confidentiality: "interno" }],
  };

  it("buildLegalNotifications carimba recipientId e link para 'juridico'", () => {
    const notifs = buildLegalNotifications(records, { userId: "u1", role: "juridico" }, FIXED);
    expect(notifs.length).toBeGreaterThan(0);
    for (const n of notifs) {
      expect(n.recipientId).toBe("u1");
      expect(n.link).toBe("juridico");
      expect(n.id.startsWith("legal-")).toBe(true);
    }
  });

  it("buildPlannerItemsFromLegal ordena por prazo e traz prazo, audiência e prazo processual", () => {
    const items = buildPlannerItemsFromLegal(records, { role: "juridico" }, FIXED);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("deadline");
    expect(kinds).toContain("hearing");
    expect(kinds).toContain("process-deadline");
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].dueDate <= items[i].dueDate).toBe(true);
    }
  });
});

describe("prompt e parser da IA", () => {
  it("prompt exige 'não invente' e limita tamanho", () => {
    const prompt = buildLegalAiPrompt("resumo", { text: "x".repeat(20000) });
    expect(prompt).toMatch(/não invente|não consta/i);
    expect(prompt.length).toBeLessThan(20000);
  });

  it("parser tolera ```json e devolve shape esperado", () => {
    const raw = "```json\n" + JSON.stringify({ clausulas: [{ titulo: "A", resumo: "B", riscos: ["r1"] }] }) + "\n```";
    const parsed = parseLegalAiResponse("clausulas", raw);
    expect(parsed).toEqual({ clauses: [{ titulo: "A", resumo: "B", riscos: ["r1"] }] });
  });

  it("parser devolve null quando resposta não é JSON válido", () => {
    expect(parseLegalAiResponse("clausulas", "texto sem estrutura")).toBeNull();
  });
});
