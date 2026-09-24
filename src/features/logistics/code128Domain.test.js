import { describe, expect, it } from "vitest";
import {
  BinaryBitmap,
  Code128Reader,
  HybridBinarizer,
  RGBLuminanceSource,
} from "@zxing/library";
import { code128cModules, formatarChaveDeAcesso } from "./code128Domain.js";

// Desenha os módulos num bitmap e lê com o mesmo leitor que o app usa para
// etiqueta: se a tabela de padrões ou o dígito verificador estivessem errados,
// a leitura falharia ou devolveria outra sequência.
const ler = (modulos) => {
  const escala = 2;
  const margem = 12;
  const largura = (modulos.length + margem * 2) * escala;
  const altura = 30;
  const luminancia = new Uint8ClampedArray(largura * altura).fill(255);
  for (let y = 0; y < altura; y += 1)
    for (let x = 0; x < modulos.length; x += 1)
      if (modulos[x] === "1")
        for (let dx = 0; dx < escala; dx += 1)
          luminancia[y * largura + (x + margem) * escala + dx] = 0;
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(luminancia, largura, altura)),
  );
  return new Code128Reader().decode(bitmap).getText();
};

describe("CODE-128C da chave de acesso", () => {
  it("gera um código que o leitor decodifica de volta na mesma chave", () => {
    const chave = "35260912345678000190570010000000011000000019";
    const modulos = code128cModules(chave);
    // início + 22 pares + verificador = 24 símbolos de 11 módulos, parada de 13.
    expect(modulos).toHaveLength(24 * 11 + 13);
    expect(ler(modulos)).toBe(chave);
  });

  it("vale para outras sequências pares, inclusive com zeros à esquerda", () => {
    for (const valor of ["00", "0099", "123456", "4312" + "0".repeat(40)])
      expect(ler(code128cModules(valor))).toBe(valor);
  });

  it("recusa entrada que não dá para codificar em vez de imprimir lixo", () => {
    expect(code128cModules("")).toBe("");
    expect(code128cModules("123")).toBe("");
    expect(code128cModules("12AB")).toBe("");
    expect(code128cModules(null)).toBe("");
  });

  it("formata a chave em grupos de quatro para leitura humana", () => {
    expect(formatarChaveDeAcesso("35260912345678000190570010000000011000000019")).toBe(
      "3526 0912 3456 7800 0190 5700 1000 0000 0110 0000 0019",
    );
    expect(formatarChaveDeAcesso("")).toBe("");
  });
});
