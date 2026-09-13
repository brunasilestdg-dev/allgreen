import { describe, it, expect } from "vitest";
import {
  JANELA_DUPLICADA_MS,
  normalizarTrackId,
  ehDuplicada,
  registrarRecente,
  resumoDaLeva,
} from "./tmsBipagemDomain.js";

describe("normalizarTrackId", () => {
  it("apara espaços e converte para texto", () => {
    expect(normalizarTrackId("  ABC123  ")).toBe("ABC123");
    expect(normalizarTrackId(123)).toBe("123");
    expect(normalizarTrackId(null)).toBe("");
    expect(normalizarTrackId(undefined)).toBe("");
  });
});

describe("ehDuplicada", () => {
  const agora = 1_000_000;
  it("reconhece o mesmo Track ID dentro da janela", () => {
    const recentes = [{ trackId: "VOL-1", quando: agora - 1000 }];
    expect(ehDuplicada("VOL-1", recentes, agora)).toBe(true);
  });

  it("ignora espaços na comparação", () => {
    const recentes = [{ trackId: "VOL-1", quando: agora - 1000 }];
    expect(ehDuplicada("  VOL-1 ", recentes, agora)).toBe(true);
  });

  it("não é duplicada fora da janela (fronteira exata)", () => {
    // exatamente na janela já não conta como duplicada
    const recentes = [{ trackId: "VOL-1", quando: agora - JANELA_DUPLICADA_MS }];
    expect(ehDuplicada("VOL-1", recentes, agora)).toBe(false);
  });

  it("é duplicada 1ms antes da fronteira", () => {
    const recentes = [{ trackId: "VOL-1", quando: agora - (JANELA_DUPLICADA_MS - 1) }];
    expect(ehDuplicada("VOL-1", recentes, agora)).toBe(true);
  });

  it("Track ID diferente não é duplicada", () => {
    const recentes = [{ trackId: "VOL-1", quando: agora - 500 }];
    expect(ehDuplicada("VOL-2", recentes, agora)).toBe(false);
  });

  it("código vazio nunca é duplicada", () => {
    expect(ehDuplicada("", [{ trackId: "", quando: agora }], agora)).toBe(false);
    expect(ehDuplicada("   ", [], agora)).toBe(false);
  });

  it("lista vazia ou ausente não quebra", () => {
    expect(ehDuplicada("VOL-1", [], agora)).toBe(false);
    expect(ehDuplicada("VOL-1", undefined, agora)).toBe(false);
  });
});

describe("registrarRecente", () => {
  const agora = 1_000_000;
  it("acrescenta a leitura nova normalizada", () => {
    const proximo = registrarRecente([], "  VOL-9 ", agora);
    expect(proximo).toEqual([{ trackId: "VOL-9", quando: agora }]);
  });

  it("descarta leituras fora da janela e mantém as vivas", () => {
    const recentes = [
      { trackId: "VELHO", quando: agora - JANELA_DUPLICADA_MS - 1 },
      { trackId: "VIVO", quando: agora - 100 },
    ];
    const proximo = registrarRecente(recentes, "NOVO", agora);
    expect(proximo.map((r) => r.trackId)).toEqual(["VIVO", "NOVO"]);
  });

  it("lista ausente não quebra", () => {
    expect(registrarRecente(undefined, "X", agora)).toEqual([{ trackId: "X", quando: agora }]);
  });
});

describe("resumoDaLeva", () => {
  it("conta acertos, erros e repetições separadamente", () => {
    const historico = [
      { ok: true, trackId: "A" },
      { ok: false, duplicada: true, trackId: "A" },
      { ok: false, trackId: "B" },
      { ok: true, trackId: "C" },
    ];
    expect(resumoDaLeva(historico)).toEqual({ ok: 2, erros: 1, duplicadas: 1 });
  });

  it("histórico vazio ou ausente zera tudo", () => {
    expect(resumoDaLeva([])).toEqual({ ok: 0, erros: 0, duplicadas: 0 });
    expect(resumoDaLeva(undefined)).toEqual({ ok: 0, erros: 0, duplicadas: 0 });
  });
});
