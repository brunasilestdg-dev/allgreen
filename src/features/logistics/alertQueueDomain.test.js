import { describe, it, expect } from "vitest";
import {
  criarAlerta,
  appendHistory,
  transitar,
  slaRestanteMinutos,
  priorizarFila,
  capPorOperador,
  falsePositiveRate,
  slaMinutosPara,
  ESTADOS,
  CRITICIDADES,
} from "./alertQueueDomain.js";

const iso = (offsetMin) => new Date(Date.now() + offsetMin * 60000).toISOString();

describe("alertQueueDomain", () => {
  it("criarAlerta preenche defaults; sem severidade vai para 'atencao'", () => {
    const a = criarAlerta({ titulo: "Bateria crítica" });
    expect(a.severidade).toBe("atencao");
    expect(a.slaMinutos).toBe(CRITICIDADES.atencao);
    expect(a.estado).toBe("aberto");
    expect(a.responsavel).toBe("pendente-atribuir");
  });

  it("slaMinutosPara respeita valor explícito positivo e ignora negativo", () => {
    expect(slaMinutosPara("critico")).toBe(15);
    expect(slaMinutosPara("atencao", 42)).toBe(42);
    expect(slaMinutosPara("atencao", -3)).toBe(CRITICIDADES.atencao);
  });

  it("appendHistory acrescenta linha imutável", () => {
    const a = criarAlerta({ titulo: "X" });
    const b = appendHistory(a, { autor: "op", acao: "reconhecer", motivo: "vou tratar" });
    expect(a.historico).toHaveLength(0);
    expect(b.historico).toHaveLength(1);
    expect(b.historico[0].autor).toBe("op");
  });

  it("transitar bloqueia estado inválido e registra a mudança", () => {
    const a = criarAlerta({ titulo: "X" });
    expect(transitar(a, "??")).toEqual(a);
    const b = transitar(a, "em-tratamento", { autor: "op" });
    expect(b.estado).toBe("em-tratamento");
    expect(ESTADOS).toContain(b.estado);
    expect(b.historico[0].para).toBe("em-tratamento");
  });

  it("slaRestanteMinutos negativo indica SLA vencido", () => {
    const a = criarAlerta({ titulo: "X", severidade: "critico", criadoEm: iso(-30) });
    const r = slaRestanteMinutos(a);
    expect(r).toBeLessThan(0);
  });

  it("priorizarFila coloca críticos primeiro e ignora resolvidos", () => {
    const alertas = [
      criarAlerta({ id: "1", titulo: "info", severidade: "info", criadoEm: iso(-5) }),
      criarAlerta({ id: "2", titulo: "critico", severidade: "critico", criadoEm: iso(-5) }),
      criarAlerta({ id: "3", titulo: "resolvido", severidade: "alto", criadoEm: iso(-10), estado: "resolvido" }),
    ];
    const fila = priorizarFila(alertas);
    expect(fila.map((a) => a.id)).toEqual(["2", "1"]);
  });

  it("capPorOperador rebaixa excedentes para 'aguardando', exceto críticos", () => {
    const responsavel = "op-1";
    const alertas = Array.from({ length: 12 }, (_, i) =>
      criarAlerta({ id: `a${i}`, titulo: `t${i}`, severidade: i === 11 ? "critico" : "alto", responsavel, criadoEm: iso(-i) }),
    );
    const capped = capPorOperador(alertas, 3);
    const aguardando = capped.filter((a) => a.estado === "aguardando");
    const criticos = capped.filter((a) => a.severidade === "critico");
    expect(aguardando.length).toBeGreaterThan(0);
    // nenhum crítico foi rebaixado
    expect(criticos.every((a) => a.estado !== "aguardando")).toBe(true);
  });

  it("falsePositiveRate calcula proporção na janela e recomenda desligar >=50%", () => {
    const alertas = [
      criarAlerta({ origem: "regra-A", criadoEm: iso(-30), estado: "falso-positivo" }),
      criarAlerta({ origem: "regra-A", criadoEm: iso(-60), estado: "falso-positivo" }),
      criarAlerta({ origem: "regra-A", criadoEm: iso(-90), estado: "resolvido" }),
      criarAlerta({ origem: "regra-A", criadoEm: iso(-60 * 26), estado: "falso-positivo" }), // fora da janela
    ];
    const r = falsePositiveRate(alertas, "regra-A", 24);
    expect(r.total).toBe(3);
    expect(r.falsosPositivos).toBe(2);
    expect(r.taxa).toBeCloseTo(0.67, 1);
    expect(r.recomendaDesligar).toBe(true);
    expect(falsePositiveRate(alertas, "regra-inexistente")).toBeNull();
  });
});
