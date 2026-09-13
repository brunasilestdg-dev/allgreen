import { describe, expect, it } from "vitest";
import { chaveDeRecuperacao, deveRecarregarPorVersaoTrocada, ehErroDeVersaoTrocada } from "./chunkRecovery.js";

describe("recuperação de versão trocada", () => {
  it("reconhece a falha de pedaço que sumiu depois do deploy", () => {
    expect(ehErroDeVersaoTrocada(new Error("Failed to fetch dynamically imported module: /assets/Clientes-a1b2.js"))).toBe(true);
    expect(ehErroDeVersaoTrocada(new Error("error loading dynamically imported module"))).toBe(true);
    expect(ehErroDeVersaoTrocada(new Error("Importing a module script failed."))).toBe(true);
    expect(ehErroDeVersaoTrocada("expected a JavaScript module script but the server responded with a MIME type of text/html")).toBe(true);
    const chunk = new Error("carregamento falhou");
    chunk.name = "ChunkLoadError";
    expect(ehErroDeVersaoTrocada(chunk)).toBe(true);
  });

  it("NÃO confunde bug de verdade com versão trocada", () => {
    // Este é o ponto do item: recarregar não pode virar o remédio de tudo.
    expect(ehErroDeVersaoTrocada(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(ehErroDeVersaoTrocada(new Error("tarefa.status is not a function"))).toBe(false);
    expect(ehErroDeVersaoTrocada(new TypeError("Failed to fetch"))).toBe(false);
    expect(ehErroDeVersaoTrocada(null)).toBe(false);
  });

  it("recarrega uma vez por versão e nunca entra em laço", () => {
    const erro = new Error("Failed to fetch dynamically imported module: /assets/x.js");
    expect(deveRecarregarPorVersaoTrocada({ erro })).toBe(true);
    expect(deveRecarregarPorVersaoTrocada({ erro, jaTentouNestaVersao: true })).toBe(false);
  });

  it("a trava é por versão publicada, para a versão seguinte poder se recuperar", () => {
    expect(chaveDeRecuperacao("2026.09.13")).toBe("sf-chunk-reload:2026.09.13");
    expect(chaveDeRecuperacao("")).toBe("sf-chunk-reload:local");
  });
});
