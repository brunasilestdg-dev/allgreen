import { describe, expect, it } from "vitest";
import { duracaoMinutos, formatarDuracao, resumoDaJornada, turnoAberto } from "./driverJourneyDomain.js";

describe("jornada do motorista", () => {
  it("duração em minutos, sem negativo nem NaN", () => {
    expect(duracaoMinutos("2026-09-11T08:00:00Z", "2026-09-11T11:07:00Z")).toBe(187);
    expect(duracaoMinutos("2026-09-11T11:00:00Z", "2026-09-11T10:00:00Z")).toBe(0); // fim antes do início
    expect(duracaoMinutos("", "2026-09-11T10:00:00Z")).toBe(0);
    expect(duracaoMinutos("lixo", "lixo")).toBe(0);
  });

  it("formata a duração como o motorista lê", () => {
    expect(formatarDuracao(187)).toBe("3h07");
    expect(formatarDuracao(60)).toBe("1h00");
    expect(formatarDuracao(0)).toBe("0h00");
  });

  it("acha o turno aberto (iniciado e sem fim)", () => {
    const turnos = [
      { id: "a", iniciadoEm: "2026-09-10T08:00:00Z", encerradoEm: "2026-09-10T17:00:00Z" },
      { id: "b", iniciadoEm: "2026-09-11T08:00:00Z", encerradoEm: "" },
    ];
    expect(turnoAberto(turnos)?.id).toBe("b");
    expect(turnoAberto([{ id: "c", iniciadoEm: "x", encerradoEm: "y" }])).toBeNull();
  });

  it("em turno: conta o decorrido até agora e libera encerrar, não iniciar", () => {
    const agora = "2026-09-11T11:30:00Z";
    const r = resumoDaJornada(
      [{ id: "b", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T08:00:00Z", encerradoEm: "" }],
      agora,
    );
    expect(r.emTurno).toBe(true);
    expect(r.turnoAtual.minutosDecorridos).toBe(210); // 3h30
    expect(r.minutosHoje).toBe(210);
    expect(r.podeIniciar).toBe(false);
    expect(r.podeEncerrar).toBe(true);
  });

  it("fora de turno: soma os turnos de hoje e libera iniciar", () => {
    const agora = "2026-09-11T18:00:00Z";
    const r = resumoDaJornada(
      [
        { id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T08:00:00Z", encerradoEm: "2026-09-11T12:00:00Z" },
        { id: "2", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T13:00:00Z", encerradoEm: "2026-09-11T17:00:00Z" },
        { id: "3", dataServico: "2026-09-10", iniciadoEm: "2026-09-10T08:00:00Z", encerradoEm: "2026-09-10T17:00:00Z" },
      ],
      agora,
    );
    expect(r.emTurno).toBe(false);
    expect(r.turnosHoje).toBe(2);
    expect(r.minutosHoje).toBe(480); // 4h + 4h; o de ontem não entra
    expect(r.podeIniciar).toBe(true);
    expect(r.podeEncerrar).toBe(false);
  });

  it("sem turnos: pode iniciar, zero horas", () => {
    const r = resumoDaJornada([], "2026-09-11T08:00:00Z");
    expect(r.emTurno).toBe(false);
    expect(r.minutosHoje).toBe(0);
    expect(r.podeIniciar).toBe(true);
    expect(r.podeEncerrar).toBe(false);
  });
});
