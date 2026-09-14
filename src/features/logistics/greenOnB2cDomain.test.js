import { describe, it, expect } from "vitest";
import {
  distanceKm,
  findStations,
  createReservation,
  reservationStatus,
  buildAuthQrPayload,
  liveSessionMetrics,
  closeSession,
  buildHistory,
  loyaltyPoints,
  SESSION_STATES,
  PAYMENT_METHODS,
} from "./greenOnB2cDomain.js";

describe("greenOnB2cDomain", () => {
  it("distanceKm devolve haversine coerente com pontos conhecidos", () => {
    // São Paulo (Sé) → Rio (Central) ≈ 355 km
    const sp = { lat: -23.55, lon: -46.63 };
    const rj = { lat: -22.90, lon: -43.20 };
    const d = distanceKm(sp, rj);
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(370);
    expect(distanceKm(null, rj)).toBeNull();
  });

  it("findStations filtra por preço, plugue e disponibilidade; ordena por distância", () => {
    const origem = { lat: -23.55, lon: -46.63 };
    const stations = [
      { id: "a", local: { lat: -23.552, lon: -46.632 }, plugues: ["CCS2", "Type2"], disponiveis: 2, precoPorKwh: 1.5 },
      { id: "b", local: { lat: -23.6, lon: -46.7 }, plugues: ["CCS2"], disponiveis: 0, precoPorKwh: 1.2 },
      { id: "c", local: { lat: -23.554, lon: -46.635 }, plugues: ["CHAdeMO"], disponiveis: 1, precoPorKwh: 2.5 },
      { id: "d", local: { lat: -23.55, lon: -46.63 }, plugues: ["CCS2"], disponiveis: 1 }, // sem preço: fora do app
    ];
    const r = findStations(stations, { origem, plug: "CCS2", precoMaximoReais: 1.9, apenasDisponiveis: true });
    expect(r.map((s) => s.id)).toEqual(["a"]);
  });

  it("createReservation exige stationId e userId; carrega tolerância", () => {
    expect(() => createReservation({ userId: "u" })).toThrow();
    expect(() => createReservation({ stationId: "s" })).toThrow();
    const r = createReservation({ stationId: "s", connectorId: 1, userId: "u", agoraMs: 1000, toleranciaMinutos: 5 });
    expect(r.state).toBe("reserved");
    expect(SESSION_STATES).toContain(r.state);
    expect(r.toleranciaMs).toBe(5 * 60000);
  });

  it("reservationStatus marca inválida após a tolerância", () => {
    const r = createReservation({ stationId: "s", userId: "u", agoraMs: 1000, toleranciaMinutos: 5 });
    expect(reservationStatus(r, 1000 + 4 * 60000).valid).toBe(true);
    expect(reservationStatus(r, 1000 + 6 * 60000).valid).toBe(false);
    expect(reservationStatus(r, 1000 + 6 * 60000).motivo).toBe("tolerância-excedida");
  });

  it("buildAuthQrPayload monta URL universal com token curto e validade", () => {
    const p = buildAuthQrPayload({ stationId: "s1", connectorId: 2, userId: "u1", agoraMs: 1000 });
    expect(p.stationId).toBe("s1");
    expect(p.token.length).toBe(24);
    expect(p.expiraEmMs).toBeGreaterThan(1000);
    expect(p.url.startsWith("greenon://auth?")).toBe(true);
  });

  it("liveSessionMetrics devolve custo travado no preço mostrado", () => {
    const m = liveSessionMetrics({ kwh: 15, tempoMs: 30 * 60000, kwAtual: 60, socPct: 72, precoPorKwh: 1.9 });
    expect(m.kwh).toBe(15);
    expect(m.tempoMinutos).toBe(30);
    expect(m.potenciaKw).toBe(60);
    expect(m.socPct).toBe(72);
    expect(m.custoEstimadoReais).toBe(28.5);
  });

  it("closeSession NÃO cobra estimando quando kwh <= 0 — devolve precisaRevisao", () => {
    const r = closeSession({ sessionId: "s", kwh: 0, tempoMs: 60 * 60000, precoPorKwh: 1.5, metodo: "greenpay" });
    expect(r.precisaRevisao).toBe(true);
    expect(r.valorReais).toBe(0);
    expect(r.recibo).toBeNull();
  });

  it("closeSession cobra energia + ociosidade quando há medição confiável", () => {
    const r = closeSession({
      sessionId: "s",
      kwh: 20,
      tempoMs: 30 * 60000,
      precoPorKwh: 1.5,
      metodo: "greenpay",
      ociosidadeMinutos: 10,
      precoOciosidadeReais: 0.2,
    });
    expect(r.valorEnergiaReais).toBe(30);
    expect(r.valorOciosidadeReais).toBe(2);
    expect(r.valorReais).toBe(32);
    expect(r.recibo.linhas).toHaveLength(2);
    expect(PAYMENT_METHODS).toContain(r.metodo);
  });

  it("closeSession recusa método de pagamento desconhecido", () => {
    expect(() => closeSession({ sessionId: "s", kwh: 10, precoPorKwh: 1, metodo: "bitcoin" })).toThrow();
  });

  it("buildHistory filtra por usuário, ordena por mais recente e soma totais", () => {
    const s = [
      { userId: "u1", fechadaEmMs: 100, kwh: 10, valorReais: 20 },
      { userId: "u1", fechadaEmMs: 300, kwh: 5, valorReais: 10 },
      { userId: "u2", fechadaEmMs: 200, kwh: 8, valorReais: 16 },
      { userId: "u1", fechadaEmMs: 200, kwh: 7, valorReais: 14 },
    ];
    const h = buildHistory(s, "u1");
    expect(h.sessoes.map((x) => x.fechadaEmMs)).toEqual([300, 200, 100]);
    expect(h.contagem).toBe(3);
    expect(h.totalKwh).toBe(22);
    expect(h.totalReais).toBe(44);
  });

  it("loyaltyPoints devolve inteiro >= 0", () => {
    expect(loyaltyPoints(35.5)).toBe(35);
    expect(loyaltyPoints(-10)).toBe(0);
    expect(loyaltyPoints(100, { pontosPorReal: 2 })).toBe(200);
  });
});
