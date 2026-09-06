import { describe, expect, it } from "vitest";
import { resolverReguaEsg, sanitizarFatores, sanitizarPesos } from "./esgParametersDomain.js";

const FAT = { methodologyVersion: "tdg-env-v2", dieselKgCo2ePerLiter: 2.68, dieselKmPerLiter: 4.2, treeKgCo2eYear: 22 };
const PESOS = { reduction: 35, lowEmissionKm: 20, cleanEnergy: 15 };

describe("régua ESG editável — saneamento", () => {
  it("aplica o valor gravado quando é número positivo válido", () => {
    const r = sanitizarFatores({ dieselKgCo2ePerLiter: 2.9 }, FAT);
    expect(r.dieselKgCo2ePerLiter).toBe(2.9);
    expect(r.dieselKmPerLiter).toBe(4.2); // não veio → default
  });

  it("ignora fator zero, negativo ou não-numérico (cai no default)", () => {
    const r = sanitizarFatores({ dieselKgCo2ePerLiter: 0, dieselKmPerLiter: -1, treeKgCo2eYear: "abc" }, FAT);
    expect(r.dieselKgCo2ePerLiter).toBe(2.68);
    expect(r.dieselKmPerLiter).toBe(4.2);
    expect(r.treeKgCo2eYear).toBe(22);
  });

  it("nunca deixa entrar chave desconhecida (não envenena o motor)", () => {
    const r = sanitizarFatores({ hackFactor: 999, dieselKgCo2ePerLiter: 3 }, FAT);
    expect(r.hackFactor).toBeUndefined();
    expect(r.dieselKgCo2ePerLiter).toBe(3);
  });

  it("mantém o rótulo de metodologia quando vem preenchido", () => {
    expect(sanitizarFatores({ methodologyVersion: "tdg-env-v3" }, FAT).methodologyVersion).toBe("tdg-env-v3");
    expect(sanitizarFatores({ methodologyVersion: "" }, FAT).methodologyVersion).toBe("tdg-env-v2");
  });

  it("peso aceita zero (desliga o componente), mas não negativo", () => {
    const r = sanitizarPesos({ reduction: 0, lowEmissionKm: -5, cleanEnergy: 40 }, PESOS);
    expect(r.reduction).toBe(0);
    expect(r.lowEmissionKm).toBe(20); // negativo → default
    expect(r.cleanEnergy).toBe(40);
  });

  it("resolve régua completa a partir do gravado + defaults", () => {
    const r = resolverReguaEsg(
      { factors: { dieselKgCo2ePerLiter: 3 }, weights: { reduction: 40 } },
      { fatoresPadrao: FAT, pesosPadrao: PESOS },
    );
    expect(r.fatores.dieselKgCo2ePerLiter).toBe(3);
    expect(r.fatores.dieselKmPerLiter).toBe(4.2);
    expect(r.pesos.reduction).toBe(40);
    expect(r.pesos.cleanEnergy).toBe(15);
  });

  it("sem nada gravado, régua = defaults de fábrica (comportamento idêntico ao de hoje)", () => {
    const r = resolverReguaEsg(null, { fatoresPadrao: FAT, pesosPadrao: PESOS });
    expect(r.fatores).toEqual(FAT);
    expect(r.pesos).toEqual(PESOS);
  });
});
