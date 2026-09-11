import { describe, expect, it } from "vitest";
import {
  ROTULO_STATUS_ROTA,
  concluirParadasDaOperacao,
  linkNavegacao,
  marcarParadaConcluida,
  montarParadasDaRota,
  progressoDaRota,
  resumoDaRota,
  rotaValidaParaAtribuir,
  statusPelaConclusao,
} from "./routePlanDomain.js";

describe("concluirParadasDaOperacao", () => {
  const paradas = [
    { operationId: "op-1", tipo: "coleta", concluida: false },
    { operationId: "op-1", tipo: "entrega", concluida: false },
    { operationId: "op-2", tipo: "entrega", concluida: false },
    { rotulo: "Parada manual", concluida: false },
  ];

  it("projeta coleta somente na coleta da operação certa", () => {
    const atualizadas = concluirParadasDaOperacao(paradas, "op-1", "coleta");
    expect(atualizadas.map((p) => p.concluida)).toEqual([true, false, false, false]);
  });

  it("entrega conclui coleta e entrega da mesma operação", () => {
    const atualizadas = concluirParadasDaOperacao(paradas, "op-1", "entrega");
    expect(atualizadas.map((p) => p.concluida)).toEqual([true, true, false, false]);
  });

  it("ignora ocorrência e não muta a lista original", () => {
    expect(concluirParadasDaOperacao(paradas, "op-1", "ocorrencia")).toBe(paradas);
    expect(paradas.every((p) => !p.concluida)).toBe(true);
  });
});

describe("montar paradas da rota", () => {
  const paradas = [
    { rotulo: "Base, São Paulo", coord: [-23.5, -46.6] },
    { rotulo: "Cliente A, Campinas", coord: [-22.9, -47.0] },
    { rotulo: "Cliente B, Jundiaí", coord: [-23.1, -46.9] },
  ];

  it("numera na ordem e carrega coordenada, janela e recarga", () => {
    const stops = montarParadasDaRota({
      paradas,
      recargas: new Set([1]),
      janelas: [{ inicio: "08:00", fim: "" }, { inicio: "10:00", fim: "11:00" }, {}],
    });
    expect(stops).toHaveLength(3);
    expect(stops[0]).toMatchObject({ ordem: 1, rotulo: "Base, São Paulo", lat: -23.5, lng: -46.6, recarga: false });
    expect(stops[1]).toMatchObject({ ordem: 2, recarga: true, janelaInicio: "10:00", janelaFim: "11:00" });
    expect(stops[2].concluida).toBe(false);
  });

  it("descarta parada sem rótulo e renumera", () => {
    const stops = montarParadasDaRota({ paradas: [{ rotulo: "A", coord: [1, 2] }, { rotulo: "  " }, { rotulo: "C", coord: [3, 4] }] });
    expect(stops.map((s) => s.rotulo)).toEqual(["A", "C"]);
    expect(stops.map((s) => s.ordem)).toEqual([1, 2]);
  });

  it("aceita recargas como array, não só Set", () => {
    const stops = montarParadasDaRota({ paradas, recargas: [0, 2] });
    expect(stops.map((s) => s.recarga)).toEqual([true, false, true]);
  });

  it("coordenada inválida vira null, não zero", () => {
    const stops = montarParadasDaRota({ paradas: [{ rotulo: "A", coord: ["x", null] }, { rotulo: "B", coord: [1, 2] }] });
    expect(stops[0].lat).toBeNull();
    expect(stops[0].lng).toBeNull();
  });
});

describe("resumo e progresso", () => {
  const stops = [
    { rotulo: "A", concluida: true, recarga: false },
    { rotulo: "B", concluida: false, recarga: true },
    { rotulo: "C", concluida: false, recarga: false },
  ];

  it("conta total, recargas, concluídas e pendentes", () => {
    expect(resumoDaRota(stops)).toEqual({ total: 3, recargas: 1, concluidas: 1, pendentes: 2 });
  });

  it("progresso é a fração concluída, arredondada", () => {
    expect(progressoDaRota(stops)).toBe(33);
    expect(progressoDaRota([])).toBe(0);
    expect(progressoDaRota(stops.map((s) => ({ ...s, concluida: true })))).toBe(100);
  });
});

describe("status pela conclusão", () => {
  it("planejada quando nada foi feito, em rota no meio, concluída no fim", () => {
    expect(statusPelaConclusao([])).toBe("planejada");
    expect(statusPelaConclusao([{ concluida: false }, { concluida: false }])).toBe("planejada");
    expect(statusPelaConclusao([{ concluida: true }, { concluida: false }])).toBe("em_rota");
    expect(statusPelaConclusao([{ concluida: true }, { concluida: true }])).toBe("concluida");
  });

  it("cada status tem rótulo humano", () => {
    expect(ROTULO_STATUS_ROTA.planejada).toBe("Planejada");
    expect(ROTULO_STATUS_ROTA.em_rota).toBe("Em rota");
    expect(ROTULO_STATUS_ROTA.concluida).toBe("Concluída");
  });
});

describe("marcar parada concluída", () => {
  it("alterna só a parada do índice, sem mutar a lista", () => {
    const original = [{ rotulo: "A", concluida: false }, { rotulo: "B", concluida: false }];
    const nova = marcarParadaConcluida(original, 1, true);
    expect(nova[1].concluida).toBe(true);
    expect(nova[0].concluida).toBe(false);
    expect(original[1].concluida).toBe(false); // não mutou
  });
});

describe("link de navegação", () => {
  it("prefere a coordenada quando existe", () => {
    expect(linkNavegacao({ lat: -23.5, lng: -46.6 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-23.5,-46.6",
    );
  });

  it("cai no endereço quando não há coordenada", () => {
    expect(linkNavegacao({ endereco: "Av. Paulista, 1000" })).toContain("destination=Av.%20Paulista%2C%201000");
  });

  it("sem coordenada nem endereço, não inventa link", () => {
    expect(linkNavegacao({})).toBe("");
  });
});

describe("validação para atribuir", () => {
  it("exige motorista e ao menos duas paradas", () => {
    expect(rotaValidaParaAtribuir({ driverId: "", stops: [{}, {}] }).valido).toBe(false);
    expect(rotaValidaParaAtribuir({ driverId: "m1", stops: [{}] }).valido).toBe(false);
    expect(rotaValidaParaAtribuir({ driverId: "m1", stops: [{}, {}] })).toEqual({ valido: true, erro: "" });
  });
});
