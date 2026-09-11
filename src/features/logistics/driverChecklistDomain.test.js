import { describe, expect, it } from "vitest";
import { avaliarChecklist, ITENS_CHECKLIST, GRUPOS_CHECKLIST } from "./driverChecklistDomain.js";

// Responde todos os itens com "ok" e sobrescreve os que o teste quiser.
const tudoOk = (over = {}) => {
  const r = {};
  for (const item of ITENS_CHECKLIST) r[item.id] = "ok";
  return { ...r, ...over };
};

describe("checklist de pré-viagem do motorista", () => {
  it("tudo conforme → aprovado e apto", () => {
    const r = avaliarChecklist(tudoOk());
    expect(r.status).toBe("aprovado");
    expect(r.apto).toBe(true);
    expect(r.completo).toBe(true);
    expect(r.respondidos).toBe(ITENS_CHECKLIST.length);
    expect(r.pendentes).toBe(0);
    expect(r.problemas).toHaveLength(0);
  });

  it("problema em item CRÍTICO reprova (não apto)", () => {
    const r = avaliarChecklist(tudoOk({ freios: "problema" }));
    expect(r.status).toBe("reprovado");
    expect(r.apto).toBe(false);
    expect(r.criticosReprovados.map((c) => c.id)).toContain("freios");
    expect(r.resumo).toMatch(/não apto/i);
  });

  it("problema em item NÃO crítico → ressalva, ainda apto", () => {
    const r = avaliarChecklist(tudoOk({ epi: "problema" }));
    expect(r.status).toBe("ressalva");
    expect(r.apto).toBe(true);
    expect(r.problemas.map((p) => p.id)).toContain("epi");
    expect(r.criticosReprovados).toHaveLength(0);
  });

  it("ressalva em qualquer item → status ressalva, apto", () => {
    const r = avaliarChecklist(tudoOk({ espelhos: "ressalva" }));
    expect(r.status).toBe("ressalva");
    expect(r.apto).toBe(true);
    expect(r.ressalvas.map((p) => p.id)).toContain("espelhos");
  });

  it("item sem resposta deixa a vistoria incompleta (não apto)", () => {
    const respostas = tudoOk();
    delete respostas.cnh;
    const r = avaliarChecklist(respostas);
    expect(r.status).toBe("incompleto");
    expect(r.completo).toBe(false);
    expect(r.apto).toBe(false);
    expect(r.pendentes).toBe(1);
    expect(r.resumo).toMatch(/faltam 1/i);
  });

  it("crítico com problema vence a ressalva na definição do status", () => {
    // Um crítico com problema E um não-crítico com ressalva → reprovado.
    const r = avaliarChecklist(tudoOk({ pneus: "problema", epi: "ressalva" }));
    expect(r.status).toBe("reprovado");
    expect(r.apto).toBe(false);
  });

  it("ignora resposta inválida como se o item não tivesse sido respondido", () => {
    const r = avaliarChecklist(tudoOk({ pneus: "talvez" }));
    expect(r.status).toBe("incompleto");
    expect(r.pendentes).toBe(1);
  });

  it("os grupos saem na ordem de aparição, sem repetir", () => {
    expect(GRUPOS_CHECKLIST).toEqual(["Veículo", "Energia", "Segurança", "Documentos", "Carga"]);
  });
});
