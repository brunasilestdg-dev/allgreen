import { describe, expect, it } from "vitest";
import {
  normalizarRegraPreco,
  validarRegraPreco,
  precoConfigurado,
  resolverPrecoKwh,
  cobrarSessao,
  faturamentoPorCliente,
} from "./chargingBillingDomain.js";

describe("regra de preço: normalização e validação", () => {
  it("base não guarda segmento nem cliente", () => {
    const r = normalizarRegraPreco({ escopo: "base", segmento: "b2b", clienteId: "c1", precoPorKwh: 1.5 });
    expect(r.segmento).toBe("");
    expect(r.clienteId).toBe("");
    expect(r.precoPorKwh).toBe(1.5);
  });
  it("exige preço > 0 e segmento/cliente conforme o escopo", () => {
    expect(validarRegraPreco({ escopo: "base", precoPorKwh: 0 })).toMatch(/preço/i);
    expect(validarRegraPreco({ escopo: "segmento", precoPorKwh: 1 })).toMatch(/segmento/i);
    expect(validarRegraPreco({ escopo: "cliente", precoPorKwh: 1 })).toMatch(/cliente/i);
    expect(validarRegraPreco({ escopo: "base", precoPorKwh: 1 })).toBe("");
  });
});

describe("resolução de preço: cliente > segmento > base", () => {
  const regras = [
    { escopo: "base", precoPorKwh: 2 },
    { escopo: "segmento", segmento: "b2b", precoPorKwh: 1.5 },
    { escopo: "cliente", clienteId: "c1", precoPorKwh: 1.2 },
  ];
  it("cliente com contrato vence tudo", () => {
    expect(resolverPrecoKwh(regras, { clienteId: "c1", segmento: "b2b" })).toEqual({ precoPorKwh: 1.2, origem: "cliente" });
  });
  it("sem contrato do cliente, o segmento vence a base", () => {
    expect(resolverPrecoKwh(regras, { clienteId: "c9", segmento: "b2b" })).toEqual({ precoPorKwh: 1.5, origem: "segmento" });
  });
  it("sem segmento aplicável, cai na base", () => {
    expect(resolverPrecoKwh(regras, { clienteId: "c9", segmento: "b2c" })).toEqual({ precoPorKwh: 2, origem: "base" });
  });
  it("sem nenhuma regra, sem-preço", () => {
    expect(resolverPrecoKwh([], {})).toEqual({ precoPorKwh: 0, origem: "sem-preco" });
  });
});

describe("cobrança de uma sessão", () => {
  const regras = [{ escopo: "base", precoPorKwh: 2 }];
  it("sessão medida com cliente é faturável: kWh × preço", () => {
    const c = cobrarSessao({ status: "concluida", energiaKwh: 100, clienteId: "c1" }, regras);
    expect(c.faturavel).toBe(true);
    expect(c.valor).toBe(200);
    expect(c.origem).toBe("base");
  });
  it("sem cliente é uso interno: não fatura", () => {
    const c = cobrarSessao({ status: "concluida", energiaKwh: 100 }, regras);
    expect(c.faturavel).toBe(false);
    expect(c.motivo).toBe("uso-interno");
  });
  it("em andamento não é faturável", () => {
    const c = cobrarSessao({ status: "em_andamento", energiaKwh: 100, clienteId: "c1" }, regras);
    expect(c.faturavel).toBe(false);
    expect(c.motivo).toBe("nao-medida");
  });
  it("sem preço aplicável, não fatura (não cobra R$ 0)", () => {
    const c = cobrarSessao({ status: "concluida", energiaKwh: 100, clienteId: "c1" }, []);
    expect(c.faturavel).toBe(false);
    expect(c.motivo).toBe("sem-preco");
  });
});

describe("faturamento por cliente no período", () => {
  const regras = [
    { escopo: "base", precoPorKwh: 2 },
    { escopo: "cliente", clienteId: "c1", precoPorKwh: 1 },
  ];
  const sessoes = [
    { status: "concluida", energiaKwh: 100, inicioEm: "2026-01-05T03:00", clienteId: "c1", clienteNome: "Alfa" },
    { status: "concluida", energiaKwh: 50, inicioEm: "2026-01-20T03:00", clienteId: "c1", clienteNome: "Alfa" },
    { status: "concluida", energiaKwh: 80, inicioEm: "2026-01-10T03:00", clienteId: "c2", clienteNome: "Beta" },
    { status: "concluida", energiaKwh: 40, inicioEm: "2026-01-10T03:00" }, // uso interno
    { status: "concluida", energiaKwh: 10, inicioEm: "2026-02-10T03:00", clienteId: "c1", clienteNome: "Alfa" }, // fora do período
  ];
  it("agrupa por cliente com o preço certo e ignora o que está fora", () => {
    const f = faturamentoPorCliente(sessoes, regras, { de: "2026-01-01", ate: "2026-01-31" });
    // Beta usa base (2) → 80×2 = 160; Alfa usa contrato (1) → 150×1 = 150
    expect(f.faturas).toHaveLength(2);
    const alfa = f.faturas.find((x) => x.clienteId === "c1");
    const beta = f.faturas.find((x) => x.clienteId === "c2");
    expect(alfa.valor).toBe(150);
    expect(alfa.energiaKwh).toBe(150);
    expect(beta.valor).toBe(160);
    expect(f.totalGeral).toBe(310);
    expect(f.usoInterno).toBe(1);
  });
  it("ordena por valor, maior primeiro", () => {
    const f = faturamentoPorCliente(sessoes, regras, { de: "2026-01-01", ate: "2026-01-31" });
    expect(f.faturas[0].clienteId).toBe("c2"); // 160 > 150
  });
  it("sem preço configurado, nada é faturável", () => {
    const f = faturamentoPorCliente(sessoes, [], {});
    expect(f.configurado).toBe(false);
    expect(f.faturas).toHaveLength(0);
  });
});

describe("preço configurado", () => {
  it("só conta regra com preço > 0", () => {
    expect(precoConfigurado([{ escopo: "base", precoPorKwh: 0 }])).toBe(false);
    expect(precoConfigurado([{ escopo: "base", precoPorKwh: 1 }])).toBe(true);
  });
});
