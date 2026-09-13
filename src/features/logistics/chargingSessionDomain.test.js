import { describe, expect, it } from "vitest";
import {
  energiaMedida,
  duracaoMinutos,
  normalizarSessao,
  validarSessao,
  custoDaSessao,
  sessaoMedida,
  resumoSessoes,
  energiaMedidaPorVeiculo,
  totalEnergiaMedida,
} from "./chargingSessionDomain.js";

describe("energia medida (kWh direto ou pela diferença do medidor)", () => {
  it("usa o kWh direto quando informado", () => {
    expect(energiaMedida({ energiaKwh: 120 })).toBe(120);
  });
  it("cai para a diferença do medidor quando não há kWh direto", () => {
    expect(energiaMedida({ medidorInicial: 1000, medidorFinal: 1085 })).toBe(85);
  });
  it("medidor que anda para trás não é medição: devolve 0", () => {
    expect(energiaMedida({ medidorInicial: 1100, medidorFinal: 1000 })).toBe(0);
    expect(energiaMedida({})).toBe(0);
  });
});

describe("duração", () => {
  it("minutos entre início e fim", () => {
    expect(duracaoMinutos({ inicioEm: "2026-01-15T22:00", fimEm: "2026-01-15T23:30" })).toBe(90);
  });
  it("fim antes do início é dado torto: null, não negativo", () => {
    expect(duracaoMinutos({ inicioEm: "2026-01-15T23:00", fimEm: "2026-01-15T22:00" })).toBe(null);
    expect(duracaoMinutos({ inicioEm: "2026-01-15T22:00" })).toBe(null);
  });
});

describe("validação da sessão", () => {
  it("exige ponto e início", () => {
    expect(validarSessao({})).toMatch(/ponto/i);
    expect(validarSessao({ pontoId: "p1" })).toMatch(/começou/i);
  });
  it("concluída sem energia medida é recusada (é o que a diferencia da estimativa)", () => {
    expect(validarSessao({ pontoId: "p1", inicioEm: "2026-01-15T22:00", status: "concluida" })).toMatch(/kWh/i);
    expect(validarSessao({ pontoId: "p1", inicioEm: "2026-01-15T22:00", status: "concluida", energiaKwh: 50 })).toBe("");
  });
  it("em andamento pode não ter energia ainda", () => {
    expect(validarSessao({ pontoId: "p1", inicioEm: "2026-01-15T22:00", status: "em_andamento" })).toBe("");
  });
});

describe("normalização", () => {
  it("status e fonte fora do catálogo caem no padrão; segmento só b2b/b2c", () => {
    const s = normalizarSessao({ pontoId: "p1", status: "xpto", fonte: "hacker", segmento: "B2B" });
    expect(s.status).toBe("em_andamento");
    expect(s.fonte).toBe("manual");
    expect(s.segmento).toBe("b2b");
    expect(normalizarSessao({ segmento: "vip" }).segmento).toBe("");
  });
});

describe("custo derivado da tarifa na hora do início", () => {
  it("recarga na ponta (19h) custa a tarifa de ponta", () => {
    const c = custoDaSessao({ inicioEm: "2026-01-15T19:00", energiaKwh: 100 }, { base: 1 });
    expect(c.faixa).toBe("ponta");
    expect(c.tarifaKwh).toBe(1.8);
    expect(c.custo).toBe(180);
  });
  it("recarga de madrugada (3h) custa a tarifa fora de ponta", () => {
    const c = custoDaSessao({ inicioEm: "2026-01-15T03:00", energiaKwh: 100 }, { base: 1 });
    expect(c.faixa).toBe("fora-ponta");
    expect(c.custo).toBe(100);
  });
  it("sem energia medida, custo zero mas ainda diz a tarifa", () => {
    const c = custoDaSessao({ inicioEm: "2026-01-15T03:00" }, { base: 1 });
    expect(c.energiaKwh).toBe(0);
    expect(c.custo).toBe(0);
  });
});

describe("sessão medida = concluída com kWh > 0", () => {
  it("em andamento ou sem kWh não conta como medição", () => {
    expect(sessaoMedida({ status: "concluida", energiaKwh: 50 })).toBe(true);
    expect(sessaoMedida({ status: "em_andamento", energiaKwh: 50 })).toBe(false);
    expect(sessaoMedida({ status: "concluida", energiaKwh: 0 })).toBe(false);
  });
});

describe("resumo e energia medida por veículo", () => {
  const sessoes = [
    { status: "concluida", energiaKwh: 100, inicioEm: "2026-01-10T03:00", pontoNome: "Pátio", veiculoId: "v1", veiculoRotulo: "V-01" },
    { status: "concluida", energiaKwh: 50, inicioEm: "2026-01-12T03:00", pontoNome: "Pátio", veiculoId: "v1", veiculoRotulo: "V-01" },
    { status: "concluida", energiaKwh: 200, inicioEm: "2026-02-01T03:00", pontoNome: "Rua", veiculoId: "v2", veiculoRotulo: "V-02" },
    { status: "em_andamento", energiaKwh: 30, inicioEm: "2026-02-02T03:00", veiculoId: "v2" },
  ];
  it("soma só as sessões medidas; conta as em andamento à parte", () => {
    const r = resumoSessoes(sessoes, { base: 1 });
    expect(r.total).toBe(4);
    expect(r.medidas).toBe(3);
    expect(r.emAndamento).toBe(1);
    expect(r.energiaKwh).toBe(350); // 100+50+200, a em andamento não entra
  });
  it("energia medida por veículo, ordenada, respeitando a janela", () => {
    const porVeic = energiaMedidaPorVeiculo(sessoes);
    expect(porVeic[0].rotulo).toBe("V-02"); // 200
    expect(porVeic[1].rotulo).toBe("V-01"); // 150
    // janela só janeiro: exclui a de fevereiro (v2)
    const jan = energiaMedidaPorVeiculo(sessoes, { de: "2026-01-01", ate: "2026-01-31" });
    expect(jan).toHaveLength(1);
    expect(jan[0].energiaKwh).toBe(150);
    expect(totalEnergiaMedida(sessoes, { de: "2026-01-01", ate: "2026-01-31" })).toBe(150);
  });
});
