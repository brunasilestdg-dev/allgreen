import { describe, expect, it } from "vitest";
import {
  BYTES_MAXIMOS_IMAGEM,
  bytesDoBase64,
  dimensoesReduzidas,
  ehImagem,
  interpretarDataUrl,
  validarImagemDataUrl,
} from "./podCaptura.js";

// Um data URL de imagem mínimo e válido (1x1 GIF transparente).
const GIF_1PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("dimensoesReduzidas", () => {
  it("reduz mantendo a proporção quando o maior lado passa do teto", () => {
    expect(dimensoesReduzidas(4000, 3000, 1280)).toEqual({ largura: 1280, altura: 960 });
    expect(dimensoesReduzidas(3000, 4000, 1280)).toEqual({ largura: 960, altura: 1280 });
  });

  it("NUNCA amplia: imagem menor que o teto sai igual", () => {
    expect(dimensoesReduzidas(800, 600, 1280)).toEqual({ largura: 800, altura: 600 });
  });

  it("garante ao menos 1px no lado que arredondaria para zero", () => {
    expect(dimensoesReduzidas(4000, 1, 1280)).toEqual({ largura: 1280, altura: 1 });
  });

  it("devolve zero para dimensões inválidas", () => {
    expect(dimensoesReduzidas(0, 100)).toEqual({ largura: 0, altura: 0 });
    expect(dimensoesReduzidas(NaN, 100)).toEqual({ largura: 0, altura: 0 });
  });
});

describe("interpretarDataUrl", () => {
  it("separa mime e base64 de um data URL", () => {
    expect(interpretarDataUrl(GIF_1PX)).toMatchObject({ mime: "image/gif" });
  });

  it("tolera espaços/quebras no meio do base64", () => {
    const comQuebra = "data:image/png;base64,iVBOR\nw0KG\t go=";
    expect(interpretarDataUrl(comQuebra)?.base64).toBe("iVBORw0KGgo=");
  });

  it("rejeita o que não é data URL base64", () => {
    expect(interpretarDataUrl("https://exemplo/foto.png")).toBeNull();
    expect(interpretarDataUrl("data:image/png,sembase64")).toBeNull();
    expect(interpretarDataUrl("")).toBeNull();
  });
});

describe("ehImagem", () => {
  it("aceita só mime de imagem", () => {
    expect(ehImagem("image/jpeg")).toBe(true);
    expect(ehImagem("application/pdf")).toBe(false);
    expect(ehImagem("")).toBe(false);
  });
});

describe("bytesDoBase64", () => {
  it("estima o tamanho decodificado descontando o padding", () => {
    // "AAAA" -> 3 bytes; "AAA=" -> 2 bytes; "AA==" -> 1 byte.
    expect(bytesDoBase64("AAAA")).toBe(3);
    expect(bytesDoBase64("AAA=")).toBe(2);
    expect(bytesDoBase64("AA==")).toBe(1);
    expect(bytesDoBase64("")).toBe(0);
  });
});

describe("validarImagemDataUrl", () => {
  it("aceita uma imagem válida e devolve mime/base64/bytes", () => {
    const r = validarImagemDataUrl(GIF_1PX);
    expect(typeof r).toBe("object");
    expect(r).toMatchObject({ mime: "image/gif" });
    expect(r.bytes).toBeGreaterThan(0);
  });

  it("recusa quando não é imagem", () => {
    expect(validarImagemDataUrl("data:application/pdf;base64,JVBERi0=")).toBe("O comprovante precisa ser uma imagem.");
  });

  it("recusa formato irreconhecível", () => {
    expect(validarImagemDataUrl("não é data url")).toBe("Formato de imagem não reconhecido.");
  });

  it("recusa imagem acima do teto de bytes", () => {
    // base64 de ~ (teto+algo) bytes de 'A': muito além de BYTES_MAXIMOS_IMAGEM.
    const grande = "data:image/jpeg;base64," + "A".repeat(Math.ceil((BYTES_MAXIMOS_IMAGEM + 1024) / 3) * 4);
    expect(validarImagemDataUrl(grande)).toBe("A imagem é grande demais.");
  });
});
