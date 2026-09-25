import { describe, expect, it } from "vitest";
import { IMPLEMENTED_MODULE_IDS, MODULE_IMPLEMENTATION } from "./features/logistics/shell/catalogoDeModulos.js";

// Guarda contra a regressão CAT-01: um módulo com implementação registrada em
// MODULE_IMPLEMENTATION (rota + página renderizada) mas ausente de
// IMPLEMENTED_MODULE_IDS aparece como "Em implantação" (cinza) e some do menu,
// apesar de pronto e com backend. Foi assim que a área Green Tech Core inteira
// ficou escondida. Este teste confere os dois catálogos e falha quando eles
// divergem — a próxima vez que alguém adicionar uma tela e esquecer de liberá-la
// vira teste vermelho, não funcionalidade invisível.
//
// Os dois catálogos são dado puro (./features/logistics/shell/), então entram
// por import. Antes o teste lia LogisticsVertical.jsx como texto, e o regex só
// casava chave ENTRE ASPAS — as que têm hífen. As chaves sem hífen nunca eram
// conferidas, e sete delas estão hoje fora de IMPLEMENTED_MODULE_IDS. Elas
// ficam listadas abaixo, à vista, em vez de escondidas pelo regex: nenhuma é id
// do catálogo de rotinas (o conjunto só é consultado com esses ids), então não
// há cartão cinza por causa delas hoje. Entrar no conjunto é decisão de
// produto, não desta guarda — e a lista não pode crescer.
const FORA_DO_CONJUNTO_CONHECIDAS = Object.freeze([
  "esg",
  "regua",
  "titulos",
  "rateios",
  "rh",
  "acessos",
  "integracoes",
]);

const chavesDeImplementacao = () => Object.keys(MODULE_IMPLEMENTATION);

describe("catálogos de módulos da vertical (CAT-01)", () => {
  it("os dois catálogos foram encontrados e não estão vazios", () => {
    expect(IMPLEMENTED_MODULE_IDS.size).toBeGreaterThan(50);
    expect(chavesDeImplementacao().length).toBeGreaterThan(20);
  });

  it("todo módulo com implementação registrada está marcado como liberado", () => {
    const escondidos = chavesDeImplementacao().filter(
      (id) => !IMPLEMENTED_MODULE_IDS.has(id) && !FORA_DO_CONJUNTO_CONHECIDAS.includes(id),
    );
    expect(
      escondidos,
      `Módulos com MODULE_IMPLEMENTATION mas fora de IMPLEMENTED_MODULE_IDS (aparecem como "Em implantação"): ${escondidos.join(", ")}`,
    ).toEqual([]);
  });

  it("a lista de exceções só contém chave real que continua fora do conjunto", () => {
    // Liberou uma delas? Tira daqui também. Exceção que já não é exceção é
    // lugar para a próxima esconder um módulo sem ninguém ver.
    for (const id of FORA_DO_CONJUNTO_CONHECIDAS) {
      expect(Object.hasOwn(MODULE_IMPLEMENTATION, id), `${id} não é tela registrada`).toBe(true);
      expect(IMPLEMENTED_MODULE_IDS.has(id), `${id} já está liberado; remova da lista de exceções`).toBe(false);
    }
    // Nenhuma chave com hífen — as que o teste antigo conferia — é exceção.
    expect(FORA_DO_CONJUNTO_CONHECIDAS.filter((id) => id.includes("-"))).toEqual([]);
  });
});
