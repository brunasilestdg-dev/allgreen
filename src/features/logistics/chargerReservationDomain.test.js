import { describe, expect, it } from "vitest";
import {
  statusReservaValido,
  reservaAtiva,
  validarReserva,
  intervalosSobrepoem,
  conflitoDeReserva,
  pontoDisponivelEm,
  proximasReservas,
  resumoReservas,
} from "./chargerReservationDomain.js";

describe("validação da reserva", () => {
  it("exige ponto, início, fim e fim depois do início", () => {
    expect(validarReserva({})).toMatch(/ponto/i);
    expect(validarReserva({ pontoId: "p1" })).toMatch(/início/i);
    expect(validarReserva({ pontoId: "p1", inicioEm: "2026-01-15T22:00" })).toMatch(/fim/i);
    expect(validarReserva({ pontoId: "p1", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-15T21:00" })).toMatch(/depois/i);
    expect(validarReserva({ pontoId: "p1", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-15T23:00" })).toBe("");
  });
});

describe("sobreposição de intervalos", () => {
  it("cruzam de verdade = conflito", () => {
    expect(intervalosSobrepoem(
      { inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T02:00" },
      { inicioEm: "2026-01-16T01:00", fimEm: "2026-01-16T03:00" },
    )).toBe(true);
  });
  it("encostar na fronteira NÃO é conflito (uma acaba quando a outra começa)", () => {
    expect(intervalosSobrepoem(
      { inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T00:00" },
      { inicioEm: "2026-01-16T00:00", fimEm: "2026-01-16T02:00" },
    )).toBe(false);
  });
});

describe("conflito de reserva (coração do módulo)", () => {
  const existentes = [
    { id: "r1", pontoId: "p1", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T02:00", status: "reservada" },
    { id: "r2", pontoId: "p2", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T02:00", status: "reservada" },
    { id: "r3", pontoId: "p1", inicioEm: "2026-01-16T10:00", fimEm: "2026-01-16T12:00", status: "cancelada" },
  ];
  it("mesmo ponto, horário cruzado, ativa = conflita", () => {
    const c = conflitoDeReserva(existentes, { pontoId: "p1", inicioEm: "2026-01-16T01:00", fimEm: "2026-01-16T03:00" });
    expect(c?.id).toBe("r1");
  });
  it("ponto diferente não conflita", () => {
    expect(conflitoDeReserva(existentes, { pontoId: "p3", inicioEm: "2026-01-16T01:00", fimEm: "2026-01-16T03:00" })).toBe(null);
  });
  it("reserva cancelada não bloqueia (liberou a tomada)", () => {
    expect(conflitoDeReserva(existentes, { pontoId: "p1", inicioEm: "2026-01-16T10:30", fimEm: "2026-01-16T11:00" })).toBe(null);
  });
  it("ignora a própria reserva na edição (por id)", () => {
    expect(conflitoDeReserva(existentes, { id: "r1", pontoId: "p1", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T02:00" })).toBe(null);
  });
});

describe("disponibilidade e agenda", () => {
  const reservas = [
    { id: "r1", pontoId: "p1", inicioEm: "2026-01-15T22:00", fimEm: "2026-01-16T02:00", status: "reservada" },
    { id: "r2", pontoId: "p1", inicioEm: "2026-01-20T10:00", fimEm: "2026-01-20T12:00", status: "concluida" },
  ];
  it("ponto ocupado num instante dentro da janela ativa", () => {
    expect(pontoDisponivelEm(reservas, "p1", "2026-01-15T23:00")).toBe(false);
    expect(pontoDisponivelEm(reservas, "p1", "2026-01-16T05:00")).toBe(true);
  });
  it("agenda traz só ativas futuras/vigentes, ordenadas", () => {
    const ag = proximasReservas(reservas, "2026-01-15T00:00");
    expect(ag).toHaveLength(1); // a concluída fica de fora
    expect(ag[0].id).toBe("r1");
  });
  it("resumo conta ativas e status", () => {
    const r = resumoReservas(reservas, "2026-01-15T00:00");
    expect(r.total).toBe(2);
    expect(r.ativas).toBe(1);
    expect(r.concluidas).toBe(1);
    expect(r.futuras).toBe(1);
  });
});

describe("status", () => {
  it("status fora do catálogo cai em reservada; ativa = reservada|em_uso", () => {
    expect(statusReservaValido("xpto")).toBe("reservada");
    expect(reservaAtiva({ status: "em_uso" })).toBe(true);
    expect(reservaAtiva({ status: "concluida" })).toBe(false);
  });
});
