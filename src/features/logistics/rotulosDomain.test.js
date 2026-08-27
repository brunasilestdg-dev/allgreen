import { describe, expect, it } from "vitest";
import { comRotulo, rotuloLegivel } from "./rotulosDomain.js";

// A régua deste módulo é uma só: nada que ele devolve pode parecer código.

describe("rotuloLegivel", () => {
  it("traduz os códigos que estavam vazando nas telas", () => {
    expect(rotuloLegivel("em_execucao")).toBe("Em execução");
    expect(rotuloLegivel("aguardando_cliente")).toBe("Aguardando cliente");
    expect(rotuloLegivel("com_ocorrencia")).toBe("Com ocorrência");
    expect(rotuloLegivel("nao_iniciada")).toBe("Não iniciada");
  });

  it("traduz status que nascem em inglês no banco", () => {
    expect(rotuloLegivel("in_transit")).toBe("Em trânsito");
    expect(rotuloLegivel("not_required")).toBe("Não obrigatório");
    expect(rotuloLegivel("in_progress")).toBe("Em andamento");
    expect(rotuloLegivel("issued")).toBe("Emitido");
  });

  it("devolve acento, não a versão sem acento do próprio código", () => {
    // Trocar `em_execucao` por "Em execucao" seria trocar um defeito por outro.
    expect(rotuloLegivel("em_execucao")).not.toContain("execucao");
    expect(rotuloLegivel("nao_aprovada")).toBe("Não aprovada");
  });

  it("separa camelCase, que também aparece em campo livre", () => {
    expect(rotuloLegivel("dataQuality")).toBe("Data quality");
    expect(rotuloLegivel("occupancyPercent")).toBe("Occupancy percent");
  });

  it("preserva sigla que a operação usa em caixa alta", () => {
    for (const sigla of ["CTE", "MDFE", "POD", "SLA", "CIOT", "BSC"])
      expect(rotuloLegivel(sigla)).toBe(sigla);
  });

  it("não mexe em texto que já é frase de gente", () => {
    expect(rotuloLegivel("Entregue no prazo")).toBe("Entregue no prazo");
    expect(rotuloLegivel("Ocorrência")).toBe("Ocorrência");
  });

  it("é frase, não título: só a primeira palavra sobe", () => {
    expect(rotuloLegivel("aguardando_de_cliente")).toBe("Aguardando de cliente");
    expect(rotuloLegivel("pedido_de_compra_aprovado")).toBe("Pedido de compra aprovado");
  });

  it("vazio devolve vazio, para quem chama decidir o que mostrar", () => {
    expect(rotuloLegivel("")).toBe("");
    expect(rotuloLegivel(null)).toBe("");
    expect(rotuloLegivel(undefined)).toBe("");
  });

  it("nunca devolve underscore — é o que denunciava o código na tela", () => {
    const amostra = [
      "em_execucao", "not_required", "aguardando_cliente", "in_transit",
      "carga_lotacao", "tac_agregado", "por_veiculo_dia", "a_vencer",
      "status_totalmente_novo_que_ninguem_previu",
    ];
    for (const codigo of amostra) expect(rotuloLegivel(codigo)).not.toMatch(/_/);
  });
});

describe("comRotulo", () => {
  const dicionario = { aberta: "Aberta", em_analise: "Em análise" };

  it("o rótulo escrito à mão continua ganhando", () => {
    expect(comRotulo(dicionario, "em_analise")).toBe("Em análise");
  });

  it("valor desconhecido vira português, não identificador", () => {
    expect(comRotulo(dicionario, "aguardando_transportadora")).toBe("Aguardando transportadora");
  });

  it("valor ausente usa o texto de vazio de quem chamou", () => {
    expect(comRotulo(dicionario, "")).toBe("—");
    expect(comRotulo(dicionario, null, "Sem status")).toBe("Sem status");
  });
});
