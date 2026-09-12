import { describe, expect, it } from "vitest";
import {
  servePesado,
  coordenadaValida,
  normalizarPontoRecarga,
  validarPontoRecarga,
  resumoPontos,
  pontosParaMapa,
  POTENCIA_PESADO_KW,
} from "./chargingPointsDomain.js";

describe("serve pesado (derivado de corrente + potência)", () => {
  it("DC rápido (≥50 kW) serve pesado; AC potente não", () => {
    expect(servePesado({ tipoCorrente: "DC", potenciaKw: 150 })).toBe(true);
    expect(servePesado({ tipoCorrente: "DC", potenciaKw: POTENCIA_PESADO_KW })).toBe(true);
    expect(servePesado({ tipoCorrente: "DC", potenciaKw: 22 })).toBe(false);
    expect(servePesado({ tipoCorrente: "AC", potenciaKw: 300 })).toBe(false);
  });
});

describe("coordenada válida", () => {
  it("recusa (0,0), fora do globo e não-número; aceita coordenada real", () => {
    expect(coordenadaValida(0, 0)).toBe(false);
    expect(coordenadaValida(-23.5, -46.6)).toBe(true);
    expect(coordenadaValida(95, 10)).toBe(false);
    expect(coordenadaValida("abc", 10)).toBe(false);
    expect(coordenadaValida(null, null)).toBe(false);
  });
});

describe("normalizar ponto de recarga", () => {
  it("deriva servePesado e zera coordenada inválida (não inventa 0,0)", () => {
    const p = normalizarPontoRecarga({
      nome: "  Pátio Guarulhos  ", operador: "GreenOn",
      tipoCorrente: "dc", conector: "CCS2", potenciaKw: "120",
      latitude: 0, longitude: 0, status: "ativo",
    });
    expect(p.nome).toBe("Pátio Guarulhos");
    expect(p.tipoCorrente).toBe("DC");
    expect(p.potenciaKw).toBe(120);
    expect(p.servePesado).toBe(true);
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
  });

  it("mantém coordenada real e normaliza status desconhecido", () => {
    const p = normalizarPontoRecarga({ nome: "X", latitude: -23.5, longitude: -46.6, status: "vish" });
    expect(p.latitude).toBe(-23.5);
    expect(p.status).toBe("ativo");
  });
});

describe("validar ponto de recarga", () => {
  it("exige nome", () => {
    expect(validarPontoRecarga({ nome: "" })).toMatch(/nome/i);
    expect(validarPontoRecarga({ nome: "Ponto A" })).toBe("");
  });
  it("recusa coordenada pela metade, aceita completa ou ausente", () => {
    expect(validarPontoRecarga({ nome: "A", latitude: -23.5 })).toMatch(/latitude e longitude juntas/i);
    expect(validarPontoRecarga({ nome: "A", latitude: -23.5, longitude: -46.6 })).toBe("");
    expect(validarPontoRecarga({ nome: "A" })).toBe("");
    expect(validarPontoRecarga({ nome: "A", latitude: 0, longitude: 0 })).toBe(""); // (0,0) = sem coordenada
    expect(validarPontoRecarga({ nome: "A", latitude: 95, longitude: 10 })).toMatch(/inválida/i);
  });
});

describe("resumo e pontos para o mapa", () => {
  const pontos = [
    { id: "1", operador: "Ground", tipoCorrente: "DC", potenciaKw: 150, status: "ativo", latitude: -23.5, longitude: -46.6 },
    { id: "2", operador: "GreenOn", tipoCorrente: "AC", potenciaKw: 22, status: "ativo", latitude: 0, longitude: 0 },
    { id: "3", operador: "Ground", tipoCorrente: "DC", potenciaKw: 60, status: "manutencao", latitude: -22.9, longitude: -43.2 },
  ];

  it("resumo conta ativos, potência total e quem serve pesado", () => {
    const r = resumoPontos(pontos);
    expect(r.total).toBe(3);
    expect(r.ativos).toBe(2);
    expect(r.emManutencao).toBe(1);
    expect(r.servemPesado).toBe(2); // os dois DC ≥ 50
    expect(r.comCoordenada).toBe(2); // o (0,0) não conta
    expect(r.potenciaTotalKw).toBe(232);
    expect(r.porOperador.Ground).toBe(2);
  });

  it("mapa só desenha ativo com coordenada válida", () => {
    const mapa = pontosParaMapa(pontos);
    expect(mapa).toHaveLength(1); // o ativo sem coord e o em manutenção saem
    expect(mapa[0].id).toBe("1");
    expect(mapa[0].proprio).toBe(true);
    expect(mapa[0].servePesado).toBe(true);
  });
});
