import { describe, expect, it } from "vitest";
import { montarDadosDaVertical } from "./dadosDaVertical.js";

describe("montarDadosDaVertical", () => {
  // Clientes, Oportunidades e Avanços da semana leem `verticalData.comments` e
  // `verticalData.interactions`. Até 24/09/2026 este mapeamento não os
  // repassava: o que a pessoa registrava ia para o servidor, mas a lista na
  // tela ficava sempre vazia — parecia que nada tinha sido salvo.
  it("repassa comentários e interações que os registros carregaram", () => {
    const comentario = { id: "c1", clientId: "cli-1", opportunityId: "", comentario: "Ligar amanhã" };
    const interacao = { id: "i1", clientId: "cli-1", opportunityId: "op-1", tipo: "reuniao", assunto: "Apresentação" };
    const dados = montarDadosDaVertical({ comments: [comentario], interactions: [interacao] });
    expect(dados.comments).toEqual([comentario]);
    expect(dados.interactions).toEqual([interacao]);
  });

  it("sem registros carregados, devolve listas vazias (nunca undefined)", () => {
    const dados = montarDadosDaVertical({});
    expect(dados.comments).toEqual([]);
    expect(dados.interactions).toEqual([]);
  });
});
