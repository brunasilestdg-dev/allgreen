import { describe, it, expect } from "vitest";
import {
  normalizarLimites,
  autorizarSessao,
  faturaConsolidada,
  custoPorKm,
  semLimite,
} from "./corporateAccountDomain.js";

describe("corporateAccountDomain", () => {
  it("semLimite distingue ausência (null/'') de zero (empresa proibiu)", () => {
    expect(semLimite(null)).toBe(true);
    expect(semLimite("")).toBe(true);
    expect(semLimite(undefined)).toBe(true);
    expect(semLimite(0)).toBe(false);
    expect(semLimite(1.5)).toBe(false);
  });

  it("normalizarLimites converte '' em null e nunca aceita negativos", () => {
    const l = normalizarLimites({ porSessaoKwh: "", porSessaoReais: -5, porDiaKwh: 30 });
    expect(l.porSessaoKwh).toBeNull();
    expect(l.porSessaoReais).toBe(0);
    expect(l.porDiaKwh).toBe(30);
  });

  it("autorizarSessao aceita sessão dentro dos limites", () => {
    const r = autorizarSessao({
      demanda: { kwh: 20, reais: 30 },
      limites: { porSessaoKwh: 30, porDiaKwh: 60, porMesReais: 500 },
      sessoesAnteriores: [{ dataYmd: "2026-01-10", kwh: 20, custo: 25, status: "paga" }],
      hojeYmd: "2026-01-15",
    });
    expect(r.autorizada).toBe(true);
    expect(r.limiteQueBateu).toBeNull();
  });

  it("autorizarSessao recusa quando o teto da sessão estoura", () => {
    const r = autorizarSessao({
      demanda: { kwh: 40 },
      limites: { porSessaoKwh: 30 },
      sessoesAnteriores: [],
      hojeYmd: "2026-01-15",
    });
    expect(r.autorizada).toBe(false);
    expect(r.limiteQueBateu).toBe("porSessaoKwh");
  });

  it("autorizarSessao recusa quando o teto do dia é estourado ao SOMAR o pedido", () => {
    const r = autorizarSessao({
      demanda: { kwh: 20 },
      limites: { porDiaKwh: 25 },
      sessoesAnteriores: [{ dataYmd: "2026-01-15", kwh: 10, custo: 0, status: "paga" }],
      hojeYmd: "2026-01-15",
    });
    expect(r.autorizada).toBe(false);
    expect(r.limiteQueBateu).toBe("porDiaKwh");
  });

  it("autorizarSessao ignora sessão recusada no acumulado do dia", () => {
    const r = autorizarSessao({
      demanda: { kwh: 20 },
      limites: { porDiaKwh: 25 },
      sessoesAnteriores: [{ dataYmd: "2026-01-15", kwh: 100, status: "recusada" }],
      hojeYmd: "2026-01-15",
    });
    expect(r.autorizada).toBe(true);
  });

  it("faturaConsolidada agrega por veículo e motorista dentro do ciclo, ordenando pelo maior gasto", () => {
    const sessoes = [
      { dataYmd: "2026-01-05", veiculoId: "v1", motoristaId: "d1", kwh: 30, custo: 60, status: "paga" },
      { dataYmd: "2026-01-08", veiculoId: "v2", motoristaId: "d1", kwh: 20, custo: 40, status: "paga" },
      { dataYmd: "2026-01-20", veiculoId: "v1", motoristaId: "d2", kwh: 10, custo: 20, status: "paga" },
      { dataYmd: "2025-12-30", veiculoId: "v1", motoristaId: "d1", kwh: 999, custo: 999, status: "paga" }, // fora do ciclo
      { dataYmd: "2026-01-10", veiculoId: "v3", motoristaId: "d3", kwh: 15, custo: 15, status: "recusada" }, // não conta
    ];
    const f = faturaConsolidada(sessoes, { inicioYmd: "2026-01-01", fimYmd: "2026-01-31" });
    expect(f.sessoes).toBe(3);
    expect(f.totalKwh).toBe(60);
    expect(f.totalReais).toBe(120);
    expect(f.veiculos[0].veiculoId).toBe("v1");
    expect(f.veiculos[0].reais).toBe(80);
    expect(f.motoristas[0].motoristaId).toBe("d1");
    expect(f.motoristas[0].reais).toBe(100);
  });

  it("custoPorKm devolve null sem km e valor arredondado em 4 casas com km", () => {
    expect(custoPorKm({ totalReais: 100 }, 0)).toBeNull();
    expect(custoPorKm({ totalReais: 300 }, 1000)).toBe(0.3);
  });
});
