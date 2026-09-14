import { describe, it, expect } from "vitest";
import {
  criarContrato,
  registrarAvaria,
  cobrancaFinal,
  registrarDevolucao,
  scopeContratosDoLocatario,
  historicoNaLocacao,
  kmRodados,
} from "./greenmobRentalDomain.js";

describe("greenmobRentalDomain", () => {
  it("criarContrato preenche defaults e normaliza campos numéricos negativos", () => {
    const c = criarContrato({ locatarioId: "loc-1", tenantId: "t1", veiculoId: "v1", precoMensalReais: -100, kmSaida: -20 });
    expect(c.precoMensalReais).toBe(0);
    expect(c.kmSaida).toBe(0);
    expect(c.estado).toBe("ativo");
    expect(Array.isArray(c.avarias)).toBe(true);
  });

  it("registrarAvaria classifica pré-existente x durante-locação", () => {
    let c = criarContrato({ id: "r1" });
    c = registrarAvaria(c, { descricao: "Risco no para-choque", momento: "pre-existente", valorReparoReais: 200 });
    c = registrarAvaria(c, { descricao: "Amassado na porta", momento: "durante-locacao", valorReparoReais: 800 });
    expect(c.avarias).toHaveLength(2);
    expect(c.avarias[0].momento).toBe("pre-existente");
    expect(c.avarias[1].momento).toBe("durante-locacao");
  });

  it("cobrancaFinal soma mensalidade + km excedente + avarias 'durante-locacao'", () => {
    let c = criarContrato({
      inicioYmd: "2026-01-01",
      fimContratadoYmd: "2026-02-01",
      precoMensalReais: 3000,
      franquiaKmMes: 2000,
      precoKmExcedenteReais: 0.5,
      kmSaida: 10000,
    });
    c = { ...c, kmDevolucao: 12500, devolvidoEmYmd: "2026-02-01" };
    c = registrarAvaria(c, { descricao: "Risco pré", momento: "pre-existente", valorReparoReais: 500 });
    c = registrarAvaria(c, { descricao: "Amassado novo", momento: "durante-locacao", valorReparoReais: 800 });
    const cf = cobrancaFinal(c);
    // 32 dias / 30 → 2 meses (arredondado para cima)
    expect(cf.mesesCobrados).toBe(2);
    expect(cf.mensalidadeReais).toBe(6000);
    // 2500 km rodados − franquia 2×2000 = 4000 → excedente 0
    expect(cf.excedenteKm).toBe(0);
    expect(cf.avariasCobradas).toBe(1);
    expect(cf.avariasReais).toBe(800);
    expect(cf.totalReais).toBe(6800);
  });

  it("cobrancaFinal sem preço mensal deixa mensalidadeReais null (não invento 0)", () => {
    const c = criarContrato({ inicioYmd: "2026-01-01", devolvidoEmYmd: "2026-02-01", precoMensalReais: 0 });
    const cf = cobrancaFinal(c);
    expect(cf.mensalidadeReais).toBeNull();
    expect(cf.totalReais).toBeNull();
  });

  it("kmRodados devolve 0 sem devolução informada", () => {
    const c = criarContrato({ kmSaida: 10000 });
    expect(kmRodados(c)).toBe(0);
    expect(kmRodados({ ...c, kmDevolucao: 12500 })).toBe(2500);
  });

  it("registrarDevolucao encerra o contrato e escreve histórico", () => {
    let c = criarContrato({ id: "r2", inicioYmd: "2026-01-01" });
    c = registrarDevolucao(c, { devolvidoEmYmd: "2026-02-05", kmDevolucao: 15000, socDevolucaoPct: 42, autor: "op" });
    expect(c.estado).toBe("devolvido");
    expect(c.devolvidoEmYmd).toBe("2026-02-05");
    expect(c.kmDevolucao).toBe(15000);
    expect(c.socDevolucaoPct).toBe(42);
    expect(c.historico.at(-1).acao).toBe("devolucao");
  });

  it("scopeContratosDoLocatario NUNCA vaza contrato de outro locatário", () => {
    const contratos = [
      criarContrato({ id: "a", tenantId: "t1", locatarioId: "loc-1" }),
      criarContrato({ id: "b", tenantId: "t1", locatarioId: "loc-2" }),
      criarContrato({ id: "c", tenantId: "t2", locatarioId: "loc-1" }),
    ];
    const vistos = scopeContratosDoLocatario(contratos, {
      role: "locatario_admin",
      tenantId: "t1",
      tenantAccountId: "loc-1",
    });
    expect(vistos.map((c) => c.id)).toEqual(["a"]);
    // sem sessão, ninguém vê nada
    expect(scopeContratosDoLocatario(contratos, null)).toEqual([]);
    // admin da plataforma vê todos
    expect(scopeContratosDoLocatario(contratos, { role: "plataforma_admin" })).toHaveLength(3);
  });

  it("historicoNaLocacao só devolve eventos do veículo dentro do período", () => {
    const c = criarContrato({
      id: "r3",
      veiculoId: "v1",
      inicioYmd: "2026-01-01",
      devolvidoEmYmd: "2026-01-31",
    });
    const eventos = [
      { veiculoId: "v1", dataYmd: "2025-12-30", tipo: "recarga" },   // fora (antes)
      { veiculoId: "v1", dataYmd: "2026-01-05", tipo: "entrega" },   // dentro
      { veiculoId: "v2", dataYmd: "2026-01-10", tipo: "entrega" },   // outro veículo
      { veiculoId: "v1", dataYmd: "2026-02-02", tipo: "recarga" },   // fora (depois)
    ];
    const dentro = historicoNaLocacao(c, eventos);
    expect(dentro).toEqual([{ veiculoId: "v1", dataYmd: "2026-01-05", tipo: "entrega" }]);
  });
});
