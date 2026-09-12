import { describe, expect, it } from "vitest";
import {
  avaliarConformidadeJornada,
  duracaoMinutos,
  formatarDuracao,
  resumoDaJornada,
  turnoAberto,
} from "./driverJourneyDomain.js";

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

describe("conformidade da jornada (fadiga · Lei 13.103/2015)", () => {
  it("sem turnos: conforme, sem inventar alerta", () => {
    const r = avaliarConformidadeJornada([], "2026-09-11T20:00:00Z");
    expect(r.conforme).toBe(true);
    expect(r.alertas).toHaveLength(0);
  });

  it("jornada curta e normal: conforme", () => {
    const r = avaliarConformidadeJornada(
      [{ id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T08:00:00Z", encerradoEm: "2026-09-11T12:00:00Z" }],
      "2026-09-11T20:00:00Z",
    );
    expect(r.conforme).toBe(true);
  });

  it("direção contínua acima de 5h30 dispara alerta crítico", () => {
    const r = avaliarConformidadeJornada(
      [{ id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T06:00:00Z", encerradoEm: "2026-09-11T12:00:00Z" }], // 6h
      "2026-09-11T20:00:00Z",
    );
    const a = r.alertas.find((x) => x.tipo === "direcao_continua");
    expect(a).toBeTruthy();
    expect(a.gravidade).toBe("critica");
    expect(r.conforme).toBe(false);
  });

  it("turno aberto que já passou do limite acende ao vivo com 'agora'", () => {
    const r = avaliarConformidadeJornada(
      [{ id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T06:00:00Z" }], // sem fim
      "2026-09-11T12:30:00Z", // 6h30 rodando
    );
    const a = r.alertas.find((x) => x.tipo === "direcao_continua");
    expect(a).toBeTruthy();
    expect(a.mensagem).toMatch(/em aberto/i);
  });

  it("interjornada abaixo de 11h entre dois turnos", () => {
    const r = avaliarConformidadeJornada(
      [
        { id: "1", dataServico: "2026-09-10", iniciadoEm: "2026-09-10T08:00:00Z", encerradoEm: "2026-09-10T16:00:00Z" },
        // só 8h de descanso até o próximo
        { id: "2", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T00:00:00Z", encerradoEm: "2026-09-11T03:00:00Z" },
      ],
      "2026-09-11T20:00:00Z",
    );
    const a = r.alertas.find((x) => x.tipo === "interjornada");
    expect(a).toBeTruthy();
    expect(a.gravidade).toBe("alta");
  });

  it("jornada diária somada acima do teto de 10h", () => {
    const r = avaliarConformidadeJornada(
      [
        { id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T05:00:00Z", encerradoEm: "2026-09-11T10:00:00Z" }, // 5h
        { id: "2", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T12:00:00Z", encerradoEm: "2026-09-11T18:00:00Z" }, // 6h
      ],
      "2026-09-11T20:00:00Z",
    );
    const a = r.alertas.find((x) => x.tipo === "jornada_diaria");
    expect(a).toBeTruthy();
    expect(a.minutos).toBe(660); // 11h
  });

  it("limites editáveis: empresa mais rígida", () => {
    const r = avaliarConformidadeJornada(
      [{ id: "1", dataServico: "2026-09-11", iniciadoEm: "2026-09-11T08:00:00Z", encerradoEm: "2026-09-11T12:00:00Z" }], // 4h
      "2026-09-11T20:00:00Z",
      { direcaoContinuaMaxMin: 180 }, // 3h
    );
    expect(r.conforme).toBe(false);
    expect(r.alertas.some((x) => x.tipo === "direcao_continua")).toBe(true);
  });
});
