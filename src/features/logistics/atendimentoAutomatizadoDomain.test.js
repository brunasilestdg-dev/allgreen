import { describe, expect, it } from "vitest";
import {
  LIMITE_MENSAGEM,
  triagemAtendimento,
  TERMOS_SENSIVEIS,
  TERMOS_RELATO_PROBLEMA,
} from "./atendimentoAutomatizadoDomain.js";
import { TIPOS_SOLICITACAO } from "./clientRequestDomain.js";

describe("triagemAtendimento", () => {
  it("responde na hora uma pergunta de status (informacional)", () => {
    const t = triagemAtendimento("Onde está minha carga da nota 1234?");
    expect(t.acao).toBe("responder_ia");
    expect(t.autoRespondivel).toBe(true);
    expect(t.escalar).toBe(false);
    expect(t.sensivel).toBe(false);
  });

  it("responde pergunta sobre green score com a própria base", () => {
    const t = triagemAtendimento("Qual é o meu green score neste mês?");
    expect(t.acao).toBe("responder_ia");
    expect(t.tipo).toBe("relatorio_esg");
  });

  it("escala pedido de nova rota como ação da equipe, nunca resposta de IA", () => {
    const t = triagemAtendimento("Preciso incluir uma nova rota de São Paulo para Curitiba");
    expect(t.acao).toBe("escalar");
    expect(t.autoRespondivel).toBe(false);
    expect(t.tipo).toBe("nova_rota");
  });

  it("uma nova rota EM FORMA DE PERGUNTA ainda vai para a equipe", () => {
    // A pergunta não pode virar um atalho para pular a execução da equipe.
    const t = triagemAtendimento("Vocês conseguem incluir a rota nova de Campinas?");
    expect(t.acao).toBe("escalar");
    expect(t.tipo).toBe("nova_rota");
  });

  it("relato de avaria abre ocorrência com urgência alta", () => {
    const t = triagemAtendimento("Minha carga chegou avariada, o produto quebrou");
    expect(t.acao).toBe("escalar");
    expect(t.tipo).toBe("ocorrencia");
    expect(t.urgencia).toBe("alta");
  });

  it("perguntar onde está uma entrega atrasada é informacional (não é relato)", () => {
    // "atrasado" sozinho é sinal de urgência, não de problema declarado: a IA
    // responde o status sem incomodar a equipe.
    const t = triagemAtendimento("Onde está minha entrega que está atrasada?");
    expect(t.acao).toBe("responder_ia");
  });

  it("assunto comercial/preço nunca recebe resposta automática", () => {
    for (const frase of [
      "Qual o preço para aumentar o frete?",
      "Quero renegociar o contrato",
      "Preciso falar com um humano do comercial",
    ]) {
      const t = triagemAtendimento(frase);
      expect(t.acao, frase).toBe("escalar");
      expect(t.sensivel, frase).toBe(true);
    }
  });

  it("mensagem vaga, sem pergunta clara, vai para uma pessoa", () => {
    const t = triagemAtendimento("preciso de uma ajuda aqui");
    expect(t.acao).toBe("escalar");
    expect(t.autoRespondivel).toBe(false);
  });

  it("urgência é detectada por palavra, não declarada pelo cliente", () => {
    const t = triagemAtendimento("Preciso de uma coleta extra urgente hoje");
    expect(t.tipo).toBe("coleta_extra");
    expect(t.urgencia).toBe("alta");
    expect(t.acao).toBe("escalar");
  });

  it("o tipo sugerido é sempre um tipo real de solicitação", () => {
    for (const frase of [
      "onde está minha carga?",
      "quero aumentar o volume",
      "preciso da segunda via da nota",
      "avaria na entrega",
      "assunto qualquer sem palavra-chave",
    ]) {
      const t = triagemAtendimento(frase);
      expect(Object.prototype.hasOwnProperty.call(TIPOS_SOLICITACAO, t.tipo), frase).toBe(true);
    }
  });

  it("o assunto tem corpo: usa o texto ou cai no rótulo do tipo", () => {
    expect(triagemAtendimento("Onde está a NF 55?").assunto.length).toBeGreaterThanOrEqual(4);
    // Texto curto demais vira o rótulo do tipo classificado.
    const curta = triagemAtendimento("oi");
    expect(curta.assunto).toBe(TIPOS_SOLICITACAO.outro.rotulo);
  });

  it("acento e caixa não mudam a decisão", () => {
    const comAcento = triagemAtendimento("URGÊNCIA: avaria na carga");
    const semAcento = triagemAtendimento("urgencia: avaria na carga");
    expect(comAcento.acao).toBe(semAcento.acao);
    expect(comAcento.tipo).toBe(semAcento.tipo);
    expect(comAcento.urgencia).toBe(semAcento.urgencia);
  });

  it("entrada vazia não quebra e cai no encaminhamento seguro", () => {
    const t = triagemAtendimento("");
    expect(t.acao).toBe("escalar");
    expect(t.tipo).toBe("outro");
  });

  it("as réguas de termos existem para o teste conferir", () => {
    expect(TERMOS_SENSIVEIS).toContain("contrato");
    expect(TERMOS_RELATO_PROBLEMA).toContain("extravi");
    expect(LIMITE_MENSAGEM).toBe(2000);
  });
});
